import { BetterAuthError } from "better-auth";
import type { CleanedWhere } from "better-auth/adapters";
import type { EntityMetadata } from "typeorm";

import type { TypeormDialect } from "./dialect.ts";
import type { TypeormModelRegistry } from "./registry.ts";

/**
 * Accumulates bound parameters so placeholder numbering stays correct across a whole
 * statement — `SET` assignments are emitted before the `WHERE` clause, and `consumeOne`
 * renders its guard twice, so no clause can number its own placeholders in isolation.
 *
 * Every value the adapter sends to the database goes through `push`. **Nothing is ever
 * interpolated into the SQL string**; the only text this module writes into a statement is
 * either a fixed keyword or an identifier that came from `EntityMetadata` via
 * `dialect.escape`.
 */
export class ParameterBag {
	readonly #dialect: TypeormDialect;
	readonly #values: unknown[] = [];

	constructor(dialect: TypeormDialect) {
		this.#dialect = dialect;
	}

	/**
	 * Binds a value and returns its placeholder.
	 *
	 * `Date` is normalised to an ISO-8601 UTC string here — the single write-side half of this
	 * adapter's timezone contract. node-pg renders a `Date` parameter with the process's LOCAL
	 * offset (`2026-08-09T23:43:19-03:00`), and Postgres casting that to `timestamp` DROPS the
	 * offset, so a UTC instant would land in the column as local wall-clock. Sending
	 * `2026-08-09T23:43:19.000Z` instead makes the intent explicit in the text itself: cast to
	 * `timestamp` it keeps the UTC wall-clock we wrote, and cast to `timestamptz` it resolves to
	 * the same instant. Correct on any machine, in either column type, and — because the
	 * driver's `Date` handling is bypassed entirely — regardless of whether the surrounding
	 * application has set `pg.defaults.parseInputDatesAsUTC`.
	 */
	push(value: unknown): string {
		const bound = value instanceof Date ? value.toISOString() : value;
		this.#values.push(bound);
		return this.#dialect.parameter(this.#values.length - 1);
	}

	values(): unknown[] {
		return this.#values;
	}
}

/** A model's compilation context: everything the builders need to name things. */
export interface SqlContext {
	readonly dialect: TypeormDialect;
	readonly registry: TypeormModelRegistry;
	readonly model: string;
	/** Better Auth field name -> whether the field is `type: "date"`. */
	readonly isDateField: (fieldName: string) => boolean;
}

export function tableRef(dialect: TypeormDialect, entity: EntityMetadata): string {
	const table = dialect.escape(entity.tableName);
	return entity.schema ? `${dialect.escape(entity.schema)}.${table}` : table;
}

/** `"m"."user_id"` — a column reference qualified by the statement's table alias. */
export function columnRef(context: SqlContext, alias: string, fieldName: string): string {
	const { databaseName } = context.registry.column(context.model, fieldName);
	return `${context.dialect.escape(alias)}.${context.dialect.escape(databaseName)}`;
}

/**
 * Builds the `SELECT`/`RETURNING` list, aliased back into Better Auth's field-name space.
 *
 * The factory's `transformOutput` reads each value as `row[fieldAttributes.fieldName || key]`
 * — the logical name, `userId`, never the physical `user_id`. Drizzle gets this for free
 * because its row objects are keyed by the schema property. Raw SQL returns rows keyed by the
 * column, so every projection is aliased: `"m"."user_id" AS "userId"`.
 *
 * Date-typed fields on a naive `timestamp` column additionally go through
 * `AT TIME ZONE 'UTC'`, which is the read-side half of the timezone contract. That expression
 * yields a `timestamptz`, so the value arrives over the wire with an explicit offset and the
 * driver cannot misread it as local time. Leaving the column bare would hand node-pg a
 * `timestamp` (OID 1114), whose default parser interprets the text in the PROCESS's zone —
 * turning a stored `05:06:07` UTC into `08:06:07Z` on a UTC-3 machine, and agreeing with the
 * truth only when the process happens to run on UTC. Session and OTP expiry are wall-clock
 * comparisons, so that error expires credentials early or late rather than failing loudly.
 */
export function projection(
	context: SqlContext,
	alias: string,
	fieldNames: readonly string[],
): string {
	return fieldNames
		.map((fieldName) => {
			const column = context.registry.column(context.model, fieldName);
			const reference = `${context.dialect.escape(alias)}.${context.dialect.escape(column.databaseName)}`;
			const expression =
				context.isDateField(fieldName) && !column.isZoneAware
					? `${reference} AT TIME ZONE 'UTC'`
					: reference;
			return `${expression} AS ${context.dialect.escape(fieldName)}`;
		})
		.join(", ");
}

/**
 * Compiles a `CleanedWhere[]` into `(AND-group) AND (OR-group)`.
 *
 * The shape is not a choice — it is what the Drizzle and Kysely adapters both produce, and
 * Better Auth's own callers are written against it. Returns `undefined` for an absent or empty
 * clause so callers can omit `WHERE` entirely.
 */
export function compileWhere(
	context: SqlContext,
	alias: string,
	where: readonly CleanedWhere[] | undefined,
	parameters: ParameterBag,
): string | undefined {
	if (!where || where.length === 0) return undefined;

	const andGroup = where.filter((clause) => clause.connector !== "OR");
	const orGroup = where.filter((clause) => clause.connector === "OR");

	const render = (clauses: readonly CleanedWhere[], joiner: string): string =>
		`(${clauses.map((clause) => compileClause(context, alias, clause, parameters)).join(joiner)})`;

	if (andGroup.length > 0 && orGroup.length > 0) {
		return `${render(andGroup, " AND ")} AND ${render(orGroup, " OR ")}`;
	}
	if (andGroup.length > 0) return render(andGroup, " AND ");
	return render(orGroup, " OR ");
}

function compileClause(
	context: SqlContext,
	alias: string,
	clause: CleanedWhere,
	parameters: ParameterBag,
): string {
	const column = columnRef(context, alias, clause.field);
	const { value, operator } = clause;

	// Case-insensitivity only means anything for strings; matching the reference adapters, a
	// non-string value silently keeps its sensitive comparison rather than erroring.
	const insensitive =
		clause.mode === "insensitive" &&
		(typeof value === "string" ||
			(Array.isArray(value) && value.every((entry) => typeof entry === "string")));

	switch (operator) {
		case "in":
		case "not_in": {
			if (!Array.isArray(value)) {
				throw new BetterAuthError(
					`[TypeORM Adapter] The value for field "${clause.field}" must be an array when using ` +
						`the "${operator}" operator.`,
				);
			}
			// An empty set has no rows to match, and its complement has all of them. Emitting
			// `IN ()` would be a syntax error, so the identity is written out directly.
			if (value.length === 0) return operator === "in" ? "FALSE" : "TRUE";
			const list = value
				.map((entry) => (insensitive ? `LOWER(${parameters.push(entry)})` : parameters.push(entry)))
				.join(", ");
			const subject = insensitive ? `LOWER(${column})` : column;
			return `${subject} ${operator === "in" ? "IN" : "NOT IN"} (${list})`;
		}
		case "contains":
			return likeClause(column, `%${String(value)}%`, insensitive, parameters);
		case "starts_with":
			return likeClause(column, `${String(value)}%`, insensitive, parameters);
		case "ends_with":
			return likeClause(column, `%${String(value)}`, insensitive, parameters);
		case "lt":
			return `${column} < ${parameters.push(value)}`;
		case "lte":
			return `${column} <= ${parameters.push(value)}`;
		case "gt":
			return `${column} > ${parameters.push(value)}`;
		case "gte":
			return `${column} >= ${parameters.push(value)}`;
		case "ne":
			if (value === null) return `${column} IS NOT NULL`;
			if (insensitive) return `LOWER(${column}) <> LOWER(${parameters.push(value)})`;
			return `${column} <> ${parameters.push(value)}`;
		case "eq":
			if (value === null) return `${column} IS NULL`;
			if (insensitive) return `LOWER(${column}) = LOWER(${parameters.push(value)})`;
			return `${column} = ${parameters.push(value)}`;
		default: {
			const exhaustive: never = operator;
			throw new BetterAuthError(
				`[TypeORM Adapter] Unsupported where operator "${String(exhaustive)}".`,
			);
		}
	}
}

/**
 * `ILIKE` is Postgres's case-insensitive `LIKE`.
 *
 * Like the Drizzle and Kysely adapters, `%` and `_` inside the value are NOT escaped, so a
 * caller-supplied wildcard stays a wildcard. Changing that here would silently diverge from
 * every other Better Auth adapter.
 */
function likeClause(
	column: string,
	pattern: string,
	insensitive: boolean,
	parameters: ParameterBag,
): string {
	return `${column} ${insensitive ? "ILIKE" : "LIKE"} ${parameters.push(pattern)}`;
}

/** Guards `LIMIT`/`OFFSET`, which are the only numbers that would otherwise reach the SQL text. */
export function boundedInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 0) {
		throw new BetterAuthError(
			`[TypeORM Adapter] ${label} must be a non-negative integer, received ${String(value)}.`,
		);
	}
	return value;
}
