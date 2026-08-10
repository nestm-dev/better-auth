import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { BetterAuthOptions } from "better-auth/types";
import { getTestInstance } from "better-auth/test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DataSource } from "typeorm";

import { typeormAdapter } from "../../src/typeorm/index.ts";
import { drizzleSchema } from "./drizzle-schema.ts";
import { AUTH_ENTITIES } from "./entities.ts";

export const ARMS = ["drizzle", "typeorm"] as const;
export type Arm = (typeof ARMS)[number];

/** The 11 tables the differential captures, in a fixed order. */
export const AUTH_TABLES = [
	"user",
	"session",
	"account",
	"verification",
	"organization",
	"member",
	"invitation",
	"oauth_application",
	"oauth_access_token",
	"oauth_consent",
	"rate_limit",
] as const;

const SCHEMA_SQL = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");

function connectionString(): string {
	const url = process.env.PG_URL;
	if (!url) throw new Error("PG_URL is required; tests/postgres/require-postgres.ts enforces it.");
	return url;
}

/**
 * A throwaway Postgres schema per arm, per test file.
 *
 * `getTestInstance`'s own `testWith: "postgres"` path is deliberately NOT used: it hardcodes
 * port 5432 and a schema it never exposes, so two arms could not be pointed at sibling copies
 * of the same DDL. Leaving `testWith` unset makes it provision a throwaway in-memory SQLite
 * for its migration step, while `options.database` — which wins, being spread after the
 * defaults — carries the adapter under test.
 */
function schemaName(arm: Arm): string {
	return `ba_${arm}_${process.pid}_${randomBytes(4).toString("hex")}`;
}

export interface ArmContext {
	readonly arm: Arm;
	readonly schema: string;
	readonly auth: Awaited<ReturnType<typeof getTestInstance>>;
	/** Only set on the `typeorm` arm; the specs that reach for it assert that first. */
	readonly dataSource: DataSource | undefined;
	/** Reads a table verbatim, ordered by primary key, for the differential capture. */
	readTable(table: string): Promise<Record<string, unknown>[]>;
	exec(sql: string, parameters?: unknown[]): Promise<Record<string, unknown>[]>;
	dispose(): Promise<void>;
}

export async function createArm(
	arm: Arm,
	options: Partial<BetterAuthOptions> = {},
	/**
	 * Connection pool size. The concurrency suite needs one connection per racer — with a
	 * smaller pool a "32-way race" is really a queue, and the compare-and-swap under test never
	 * gets contended.
	 */
	poolSize = 4,
): Promise<ArmContext> {
	const schema = schemaName(arm);
	const admin = postgres(connectionString(), { max: 1, onnotice: () => {} });
	await admin.unsafe(`CREATE SCHEMA "${schema}"`);
	await admin.unsafe(`SET search_path TO "${schema}"; ${SCHEMA_SQL}`);
	await admin.end();

	const client = postgres(connectionString(), {
		max: poolSize,
		onnotice: () => {},
		connection: { search_path: schema },
	});

	/**
	 * A SECOND, pristine connection, used only to read rows back for the differential.
	 *
	 * `drizzle(client)` mutates the postgres.js client it is handed — it replaces the type
	 * parser for `timestamp` with the identity function so it can map dates itself. Reading the
	 * differential capture through that same client would compare a Drizzle-configured reader
	 * against a stock one and report every timestamp as a difference. The reader has to be
	 * neutral for the comparison to mean anything, so it is never handed to any ORM.
	 */
	const reader = postgres(connectionString(), {
		max: 2,
		onnotice: () => {},
		connection: { search_path: schema },
	});

	let dataSource: DataSource | undefined;
	let database: BetterAuthOptions["database"];

	if (arm === "drizzle") {
		database = drizzleAdapter(drizzle(client, { schema: drizzleSchema }), {
			provider: "pg",
			schema: drizzleSchema,
		});
	} else {
		dataSource = new DataSource({
			type: "postgres",
			url: connectionString(),
			schema,
			entities: AUTH_ENTITIES,
			synchronize: false,
			migrationsRun: false,
			logging: false,
			extra: { max: poolSize },
		});
		await dataSource.initialize();
		database = typeormAdapter(dataSource);
	}

	// `options.database` wins because `getTestInstance` spreads the caller's options AFTER its
	// own defaults, so the throwaway SQLite it provisions is used only for its migration step.
	// `options.database` wins because `getTestInstance` spreads the caller's options AFTER its
	// own defaults, so the throwaway SQLite it provisions is used only for its migration step.
	// `getTestInstance` returns `Auth<O & { database }>`. The database it was handed is an
	// implementation detail of this harness, so the arm exposes the widened shape.
	const auth = (await getTestInstance({ ...options, database })) as unknown as ArmContext["auth"];

	return {
		arm,
		schema,
		auth,
		dataSource,
		async readTable(table) {
			return (await reader.unsafe(
				`SELECT * FROM "${schema}"."${table}" ORDER BY "id"`,
			)) as unknown as Record<string, unknown>[];
		},
		async exec(sql, parameters = []) {
			return (await reader.unsafe(sql, parameters as never[])) as unknown as Record<
				string,
				unknown
			>[];
		},
		async dispose() {
			if (dataSource?.isInitialized) await dataSource.destroy();
			await client.end();
			await reader.end();
			const cleanup = postgres(connectionString(), { max: 1, onnotice: () => {} });
			await cleanup.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
			await cleanup.end();
		},
	};
}

/**
 * Fields whose value is legitimately different between two independent runs.
 *
 * Ids, tokens, secrets and hashes are random; timestamps are wall-clock. Replacing them with a
 * stable marker is what lets the differential assert `toEqual` on everything else — including
 * the shape and TYPE of each value, which is the class of divergence (a `bigint` read back as
 * a string, a date read back an hour off) the harness exists to catch.
 */
const VOLATILE_COLUMNS = new Set([
	"id",
	"token",
	"user_id",
	"account_id",
	"organization_id",
	"active_organization_id",
	"inviter_id",
	"client_id",
	"client_secret",
	"access_token",
	"refresh_token",
	"password",
	"value",
	"created_at",
	"updated_at",
	"expires_at",
	"access_token_expires_at",
	"refresh_token_expires_at",
	"last_request",
	"key",
	"identifier",
	"slug",
	"redirect_urls",
]);

/**
 * Normalises a captured row: volatile columns collapse to a type/nullness marker, everything
 * else is compared verbatim.
 *
 * The marker still carries the JavaScript type, so a column that is a `number` under Drizzle
 * and a `string` under TypeORM still fails the comparison — which is exactly what
 * `rate_limit.last_request` would do without the adapter's numeric coercion.
 */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
	const normalized: Record<string, unknown> = {};
	for (const [column, value] of Object.entries(row)) {
		if (!VOLATILE_COLUMNS.has(column)) {
			normalized[column] = value;
			continue;
		}
		if (value === null || value === undefined) {
			normalized[column] = "<null>";
		} else if (value instanceof Date) {
			normalized[column] = "<date>";
		} else {
			normalized[column] = `<${typeof value}>`;
		}
	}
	return normalized;
}

/**
 * Captures all 11 tables, normalised and put into a canonical order.
 *
 * The rows cannot be compared in primary-key order: ids are random, so "ordered by id" is a
 * different order in each arm. Sorting by the serialised NORMALISED row gives an order that
 * depends only on the content being compared, which turns the comparison into a multiset
 * equality — the right question, since no adapter promises an insertion order.
 */
export async function captureTables(
	context: Pick<ArmContext, "readTable">,
): Promise<Record<string, unknown[]>> {
	const capture: Record<string, unknown[]> = {};
	for (const table of AUTH_TABLES) {
		const rows = await context.readTable(table);
		capture[table] = rows
			.map(normalizeRow)
			.map((row) => [JSON.stringify(row), row] as const)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([, row]) => row);
	}
	return capture;
}
