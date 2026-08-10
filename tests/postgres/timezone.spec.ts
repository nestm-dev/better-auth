import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createArm } from "./harness.ts";
import type { ArmContext } from "./harness.ts";

import { scenarioOptions } from "./scenario.ts";

/**
 * Zones chosen to break different assumptions: behind UTC, ahead of UTC, and a HALF-HOUR
 * offset, which catches code that gets the sign right but rounds to whole hours.
 */
const ZONES = ["UTC", "America/Sao_Paulo", "Asia/Tokyo", "Asia/Kolkata"];

/** A fixed instant with a wall-clock that differs in every zone above. */
const INSTANT = new Date("2026-03-04T05:06:07.000Z");
const EXPECTED_UTC_TEXT = "2026-03-04 05:06:07";

/**
 * Every Better Auth timestamp column is `timestamp` WITHOUT time zone holding a UTC instant,
 * and session and OTP expiry are wall-clock comparisons against it. Reading or writing one of
 * those columns through the process's local zone does not fail loudly — it expires credentials
 * early or late by the machine's offset.
 *
 * The trap is that on a UTC machine every implementation agrees, so a CI job that runs UTC
 * (which is to say: nearly all of them) cannot see the bug. These tests move the PROCESS zone
 * and assert against the stored TEXT, which is the only reading no driver can colour.
 *
 * The adapter owns this concern rather than delegating it. See `ParameterBag.push` and
 * `projection()` in `src/typeorm/sql.ts` for the two halves.
 */
describe("timezone independence", () => {
	let context: ArmContext;
	const originalTimezone = process.env.TZ;

	beforeAll(async () => {
		context = await createArm("typeorm", scenarioOptions().options);
	});

	afterAll(async () => {
		process.env.TZ = originalTimezone;
		await context?.dispose();
	});

	test.each(ZONES)("round-trips a UTC instant with the process in %s", async (zone) => {
		process.env.TZ = zone;
		const db = context.auth.db;
		const identifier = `tz-${zone}`;

		const created = await db.create<Record<string, unknown>, { id: string; expiresAt: Date }>({
			model: "verification",
			data: { identifier, value: "tz", expiresAt: INSTANT },
		});

		// 1. What actually landed in the column, with no driver parsing it.
		const [stored] = await context.exec(
			`SELECT "expires_at"::text AS at FROM "${context.schema}"."verification" WHERE "identifier" = $1`,
			[identifier],
		);
		expect(stored?.at).toBe(EXPECTED_UTC_TEXT);

		// 2. What the adapter hands back, from the INSERT's own RETURNING clause...
		expect(created.expiresAt.getTime()).toBe(INSTANT.getTime());

		// 3. ...and from a subsequent read.
		const found = await db.findOne<{ expiresAt: Date }>({
			model: "verification",
			where: [{ field: "identifier", value: identifier }],
		});
		expect(found?.expiresAt).toBeInstanceOf(Date);
		expect(found?.expiresAt.getTime()).toBe(INSTANT.getTime());
	});

	test.each(ZONES)("a wall-clock comparison stays correct in %s", async (zone) => {
		process.env.TZ = zone;
		const db = context.auth.db;
		const identifier = `tz-compare-${zone}`;
		// One second in the future. Any offset error larger than a second flips this predicate,
		// which is exactly how a session expires early or refuses to.
		const soon = new Date(Date.now() + 1000);

		await db.create({ model: "verification", data: { identifier, value: "x", expiresAt: soon } });

		const unexpired = await db.findMany({
			model: "verification",
			where: [
				{ field: "identifier", value: identifier },
				{ field: "expiresAt", operator: "gt", value: new Date() },
			],
			limit: 10,
		});
		expect(unexpired).toHaveLength(1);

		const expired = await db.findMany({
			model: "verification",
			where: [
				{ field: "identifier", value: identifier },
				{ field: "expiresAt", operator: "lt", value: new Date() },
			],
			limit: 10,
		});
		expect(expired).toHaveLength(0);
	});

	/**
	 * The counter-proof, and the reason the adapter does this work at all.
	 *
	 * This is what a straightforward TypeORM implementation gets: a JS `Date` handed to node-pg
	 * as a bind parameter, and a bare `timestamp` column read back. Both halves are rendered and
	 * parsed in the PROCESS's zone, so the value is wrong by the offset in each direction.
	 *
	 * If this test ever fails, node-pg has changed its defaults — at which point the adapter's
	 * conversions become belt-and-braces rather than load-bearing, and the README should say so.
	 */
	test("node-pg's own defaults are offset-dependent, in both directions", async () => {
		process.env.TZ = "Asia/Tokyo"; // +09:00, no DST
		const pool = new pg.Pool({ connectionString: process.env.PG_URL, max: 1 });
		try {
			await pool.query(`CREATE TABLE IF NOT EXISTS "${context.schema}".tz_counterproof (
				id text primary key, at timestamp)`);
			await pool.query(`INSERT INTO "${context.schema}".tz_counterproof VALUES ($1, $2)`, [
				"naive",
				INSTANT,
			]);

			// Written through a `Date`: stored as Tokyo wall-clock, nine hours off the instant.
			const stored = await pool.query(
				`SELECT at::text AS at FROM "${context.schema}".tz_counterproof WHERE id = 'naive'`,
			);
			expect(stored.rows[0].at).toBe("2026-03-04 14:06:07");
			expect(stored.rows[0].at).not.toBe(EXPECTED_UTC_TEXT);

			// Read back bare: reinterpreted as Tokyo local, moving it nine hours the other way.
			await pool.query(
				`INSERT INTO "${context.schema}".tz_counterproof VALUES ('utc', '${EXPECTED_UTC_TEXT}')`,
			);
			const bare = await pool.query(
				`SELECT at FROM "${context.schema}".tz_counterproof WHERE id = 'utc'`,
			);
			expect((bare.rows[0].at as Date).toISOString()).toBe("2026-03-03T20:06:07.000Z");

			// The adapter's projection is the fix, and it needs no global driver configuration.
			const projected = await pool.query(
				`SELECT at AT TIME ZONE 'UTC' AS at FROM "${context.schema}".tz_counterproof WHERE id = 'utc'`,
			);
			expect((projected.rows[0].at as Date).toISOString()).toBe(INSTANT.toISOString());
		} finally {
			await pool.query(`DROP TABLE IF EXISTS "${context.schema}".tz_counterproof`);
			await pool.end();
		}
	});
});
