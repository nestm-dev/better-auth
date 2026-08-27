import { BetterAuthError } from "better-auth";
import { createAdapterFactory } from "better-auth/adapters";
import type {
	AdapterFactory,
	AdapterFactoryConfig,
	AdapterFactoryOptions,
	CleanedWhere,
	CustomAdapter,
} from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth/types";
import { resolveDialect } from "./dialect.ts";
import { executeQuery, requireEntityManager } from "./capabilities.ts";
import { TypeormModelRegistry } from "./registry.ts";
import {
	boundedInteger,
	columnRef,
	compileWhere,
	ParameterBag,
	projection,
	tableRef,
} from "./sql.ts";
import type { SqlContext } from "./sql.ts";
import type { TypeormAdapterConfig, TypeormDataSource, TypeormEntityManager } from "./types.ts";

type Row = Record<string, unknown>;

/** Alias for the statement's own table, and for the compare-and-swap subquery's copy of it. */
const TABLE_ALIAS = "m";
const SUBQUERY_ALIAS = "s";

interface StatementResult {
	rows: Row[];
	affected: number;
}

/**
 * A TypeORM-backed Better Auth adapter.
 *
 * ## Why raw SQL instead of `QueryBuilder`
 *
 * The deciding reason is `consumeOne` and `incrementOne`. Both must be ONE statement whose
 * predicate is simultaneously the row selector and the guard, with the guard repeated outside
 * the subquery — see `compareAndSwap` below for why. That statement is not expressible through
 * `QueryBuilder` without hand-written SQL fragments, and `tests/postgres/atomicity.spec.ts`
 * shows the cost of getting it wrong: the query-builder-based reference adapter lets all 32
 * racers past a `count < 10` guard.
 *
 * Two further properties follow from the same choice. Raw SQL never constructs an entity, so
 * entity subscribers and listeners do not fire on auth writes — a caller with an audit
 * subscriber on `user` does not want a session refresh in their audit log. And the `UPDATE`
 * carries exactly the columns Better Auth asked for: `QueryBuilder` writes `updated_at` for an
 * `@UpdateDateColumn` on its own, injecting `CURRENT_TIMESTAMP` (a `timestamptz` cast using the
 * SERVER's zone) whenever the payload omits the field. Better Auth force-materialises
 * `updatedAt` into every update payload, so on TypeORM 1.1 the two agree and the caller's value
 * wins — but that is a coincidence of how this version resolves the overlap, not a contract.
 * `tests/postgres/update-date-column.spec.ts` pins both sides of it.
 *
 * TypeORM still earns its place: connection pooling, `EntityMetadata` for name resolution,
 * `driver.escape()` for identifier quoting, and `dataSource.transaction()`.
 *
 * **No value is ever interpolated into a statement** — every one is bound through
 * {@link ParameterBag}. The only text written into SQL is a fixed keyword or an identifier
 * that came from `EntityMetadata`.
 *
 * ## Timezone
 *
 * The adapter owns the UTC contract for `timestamp` columns end to end, without mutating any
 * process-global driver state. See {@link ParameterBag.push} for the write side and
 * `projection()` in `sql.ts` for the read side.
 *
 * @example
 * ```ts
 * betterAuth({ database: typeormAdapter(dataSource) });
 * ```
 */
export function typeormAdapter(
	dataSource: TypeormDataSource,
	config: TypeormAdapterConfig = {},
): AdapterFactory<BetterAuthOptions> {
	const dialect = resolveDialect(dataSource);
	const registry = new TypeormModelRegistry(dataSource, config.entities ?? {});

	// Captured when Better Auth calls the returned factory, so `transaction()` can build an
	// inner adapter bound to the transactional manager. Same shape the Drizzle and Kysely
	// adapters use for the same reason: the options are not known at construction time.
	let lazyOptions: BetterAuthOptions | null = null;

	const createCustomAdapter =
		(resolveManager: () => TypeormEntityManager): AdapterFactoryOptions["adapter"] =>
		({ schema, getFieldName, getDefaultModelName, getFieldAttributes }) => {
			/**
			 * TypeORM's Postgres query runner returns `raw.rows` for `SELECT`/`INSERT` but the
			 * tuple `[rows, rowCount]` for `UPDATE`/`DELETE` (`PostgresQueryRunner.query`, the
			 * `switch (raw.command)`). The caller knows which statement it issued, so the shape is
			 * declared rather than sniffed — a heuristic here would silently hand back a nested
			 * array as if it were a row.
			 */
			const run = async (
				sql: string,
				parameters: unknown[],
				shape: "rows" | "rowsWithCount",
			): Promise<StatementResult> => {
				const raw = await executeQuery(resolveManager(), sql, parameters);
				if (shape === "rows") {
					if (!Array.isArray(raw)) return { rows: [], affected: 0 };
					const rows = raw as Row[];
					return { rows, affected: rows.length };
				}
				if (Array.isArray(raw) && Array.isArray(raw[0]) && typeof raw[1] === "number") {
					return { rows: raw[0] as Row[], affected: raw[1] };
				}
				throw new BetterAuthError(
					`[TypeORM Adapter] Expected a [rows, rowCount] result from an UPDATE/DELETE but the ` +
						`driver returned ${Object.prototype.toString.call(raw)}. This adapter is only ` +
						`verified against TypeORM's standard "postgres" driver.`,
				);
			};

			const contextFor = (model: string): SqlContext => ({
				dialect,
				registry,
				model,
				isDateField: (fieldName) => getFieldAttributes({ model, field: fieldName }).type === "date",
			});

			/**
			 * Every field of a model in Better Auth's field-name space, `id` first.
			 *
			 * `id` is prepended explicitly because `getAuthTables()` leaves it implicit — the
			 * factory injects it into `fields` only while transforming.
			 */
			const allFieldNames = (model: string): string[] => {
				const fields = schema[getDefaultModelName(model)]?.fields ?? {};
				const names = ["id"];
				for (const field of Object.keys(fields)) {
					const fieldName = getFieldName({ model, field });
					if (!names.includes(fieldName)) names.push(fieldName);
				}
				return names;
			};

			/**
			 * `select` arrives as Better Auth field KEYS, which `getFieldName` maps into the same
			 * field-name space the projection aliases into.
			 */
			const selectedFieldNames = (model: string, select: string[] | undefined): string[] =>
				select && select.length > 0
					? select.map((field) => getFieldName({ model, field }))
					: allFieldNames(model);

			const rejectJoin = (model: string, join: unknown): void => {
				if (join && Object.keys(join).length > 0) {
					throw new BetterAuthError(
						`[TypeORM Adapter] Native joins are not supported (requested on model "${model}"). ` +
							`Remove \`experimental.joins\` from your Better Auth options and the factory will ` +
							`resolve relations with follow-up queries instead.`,
					);
				}
			};

			/** `WHERE ...`, or an empty string when the clause is absent. */
			const whereFragment = (
				context: SqlContext,
				alias: string,
				where: readonly CleanedWhere[] | undefined,
				parameters: ParameterBag,
			): string => {
				const compiled = compileWhere(context, alias, where, parameters);
				return compiled ? ` WHERE ${compiled}` : "";
			};

			/**
			 * The compare-and-swap body shared by `consumeOne` and `incrementOne`.
			 *
			 * The guard is repeated OUTSIDE the `IN (SELECT ... LIMIT 1)` subquery, which is
			 * stronger than what the Drizzle and Kysely adapters ship. The reason is Postgres's
			 * EvalPlanQual: when a racer blocks on a row another transaction is mutating and then
			 * unblocks, the subquery's snapshot is already stale — it is the OUTER qualification,
			 * re-checked against the newest row version, that decides whether the write still
			 * applies. Without it, two concurrent `consumeOne` calls on the same token can both
			 * pass their subquery and the second deletes a row it never legitimately matched.
			 *
			 * The subquery keeps `LIMIT 1`, which is what makes this touch at most one row even
			 * when the predicate is non-unique.
			 */
			const compareAndSwap = (
				context: SqlContext,
				where: readonly CleanedWhere[],
				parameters: ParameterBag,
			): string => {
				const idColumn = columnRef(context, TABLE_ALIAS, "id");
				const subject = contextFor(context.model);
				const subquerySelect = columnRef(subject, SUBQUERY_ALIAS, "id");
				const table = tableRef(dialect, registry.entity(context.model));
				const inner = compileWhere(subject, SUBQUERY_ALIAS, where, parameters);
				const outer = compileWhere(context, TABLE_ALIAS, where, parameters);

				const subquery =
					`SELECT ${subquerySelect} FROM ${table} AS ${dialect.escape(SUBQUERY_ALIAS)}` +
					`${inner ? ` WHERE ${inner}` : ""} LIMIT 1`;
				return ` WHERE ${idColumn} IN (${subquery})${outer ? ` AND ${outer}` : ""}`;
			};

			const adapter: CustomAdapter = {
				async create({ model, data }) {
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);
					const entries = Object.entries(data as Row);
					if (entries.length === 0) {
						throw new BetterAuthError(
							`[TypeORM Adapter] Refusing to insert an empty row into "${model}".`,
						);
					}

					const columns = entries
						.map(([field]) => {
							const { databaseName } = registry.column(model, field);
							return dialect.escape(databaseName);
						})
						.join(", ");
					const values = entries.map(([, value]) => parameters.push(value)).join(", ");

					const sql =
						`INSERT INTO ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)} ` +
						`(${columns}) VALUES (${values}) ` +
						`RETURNING ${projection(context, TABLE_ALIAS, allFieldNames(model))}`;

					const { rows } = await run(sql, parameters.values(), "rows");
					const created = rows[0];
					if (!created) {
						throw new BetterAuthError(`[TypeORM Adapter] INSERT into "${model}" returned no row.`);
					}
					return created as never;
				},

				async findOne({ model, where, select, join }) {
					rejectJoin(model, join);
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);
					const sql =
						`SELECT ${projection(context, TABLE_ALIAS, selectedFieldNames(model, select))} ` +
						`FROM ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)}` +
						`${whereFragment(context, TABLE_ALIAS, where, parameters)} LIMIT 1`;

					const { rows } = await run(sql, parameters.values(), "rows");
					return (rows[0] ?? null) as never;
				},

				async findMany({ model, where, limit, select, sortBy, offset, join }) {
					rejectJoin(model, join);
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);

					let sql =
						`SELECT ${projection(context, TABLE_ALIAS, selectedFieldNames(model, select))} ` +
						`FROM ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)}` +
						`${whereFragment(context, TABLE_ALIAS, where, parameters)}`;

					if (sortBy) {
						const column = columnRef(
							context,
							TABLE_ALIAS,
							getFieldName({ model, field: sortBy.field }),
						);
						sql += ` ORDER BY ${column} ${sortBy.direction === "desc" ? "DESC" : "ASC"}`;
					}
					// A NaN or negative bound would otherwise become `LIMIT NULL`, which Postgres
					// reads as "no limit" — a silent full-table read rather than an error.
					sql += ` LIMIT ${parameters.push(boundedInteger(limit, "limit"))}`;
					if (offset !== undefined) {
						sql += ` OFFSET ${parameters.push(boundedInteger(offset, "offset"))}`;
					}

					const { rows } = await run(sql, parameters.values(), "rows");
					return rows as never;
				},

				async count({ model, where }) {
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);
					const sql =
						`SELECT COUNT(*) AS ${dialect.escape("count")} ` +
						`FROM ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)}` +
						`${whereFragment(context, TABLE_ALIAS, where, parameters)}`;

					const { rows } = await run(sql, parameters.values(), "rows");
					// `COUNT(*)` is `int8`, which node-pg hands back as a string because 64 bits do
					// not fit a double. The factory returns this value untransformed.
					return Number(rows[0]?.count ?? 0);
				},

				async update({ model, where, update }) {
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);
					const assignments = assignmentList(context, update as Row, parameters);
					const sql =
						`UPDATE ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)} ` +
						`SET ${assignments}` +
						`${whereFragment(context, TABLE_ALIAS, where, parameters)} ` +
						`RETURNING ${projection(context, TABLE_ALIAS, allFieldNames(model))}`;

					const { rows } = await run(sql, parameters.values(), "rowsWithCount");
					return (rows[0] ?? null) as never;
				},

				async updateMany({ model, where, update }) {
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);
					const assignments = assignmentList(context, update as Row, parameters);
					const sql =
						`UPDATE ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)} ` +
						`SET ${assignments}` +
						`${whereFragment(context, TABLE_ALIAS, where, parameters)}`;

					const { affected } = await run(sql, parameters.values(), "rowsWithCount");
					return affected;
				},

				async delete({ model, where }) {
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);
					const sql =
						`DELETE FROM ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)}` +
						`${whereFragment(context, TABLE_ALIAS, where, parameters)}`;

					await run(sql, parameters.values(), "rowsWithCount");
				},

				async deleteMany({ model, where }) {
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);
					const sql =
						`DELETE FROM ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)}` +
						`${whereFragment(context, TABLE_ALIAS, where, parameters)}`;

					const { affected } = await run(sql, parameters.values(), "rowsWithCount");
					return affected;
				},

				async consumeOne({ model, where }) {
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);
					const sql =
						`DELETE FROM ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)}` +
						`${compareAndSwap(context, where, parameters)} ` +
						`RETURNING ${projection(context, TABLE_ALIAS, allFieldNames(model))}`;

					const { rows } = await run(sql, parameters.values(), "rowsWithCount");
					return (rows[0] ?? null) as never;
				},

				async incrementOne({ model, where, increment, set }) {
					const context = contextFor(model);
					const parameters = new ParameterBag(dialect);

					// Increments first, then `set`, so an absolute assignment wins over a delta on the
					// same field. That is the Drizzle adapter's precedence; Kysely's is the reverse.
					const assignments: string[] = [];
					for (const [field, delta] of Object.entries(increment)) {
						const { databaseName } = registry.column(model, field);
						if (set && field in set) continue;
						assignments.push(
							`${dialect.escape(databaseName)} = ${columnRef(context, TABLE_ALIAS, field)} + ${parameters.push(delta)}`,
						);
					}
					for (const [field, value] of Object.entries(set ?? {})) {
						const { databaseName } = registry.column(model, field);
						assignments.push(`${dialect.escape(databaseName)} = ${parameters.push(value)}`);
					}
					if (assignments.length === 0) {
						throw new BetterAuthError(
							`[TypeORM Adapter] incrementOne on "${model}" resolved to an empty assignment list.`,
						);
					}

					const sql =
						`UPDATE ${tableRef(dialect, registry.entity(model))} AS ${dialect.escape(TABLE_ALIAS)} ` +
						`SET ${assignments.join(", ")}` +
						`${compareAndSwap(context, where, parameters)} ` +
						`RETURNING ${projection(context, TABLE_ALIAS, allFieldNames(model))}`;

					const { rows } = await run(sql, parameters.values(), "rowsWithCount");
					return (rows[0] ?? null) as never;
				},

				options: { adapterId: "typeorm", driverType: dialect.driverType },
			};

			return adapter;
		};

	const adapterConfig: AdapterFactoryConfig = {
		adapterId: "typeorm",
		adapterName: "TypeORM Adapter",
		usePlural: config.usePlural ?? false,
		debugLogs: config.debugLogs ?? false,

		// `timestamp` and `boolean` columns are native, so Better Auth hands over `Date` and
		// `boolean` unchanged and this adapter is responsible for their wire representation.
		supportsDates: true,
		supportsBooleans: true,

		// Deliberately narrower than the Drizzle adapter, which sets both to `true` on Postgres.
		// Better Auth's own schema has no `json`, `string[]` or `number[]` field, so for a stock
		// instance these are inert — they only decide what happens to a consumer's additional
		// field. `false` makes such a field serialise to a string, which a `text` column accepts;
		// `true` would send an object or array and require `jsonb`/`text[]` DDL.
		supportsJSON: false,
		supportsArrays: false,

		// The one that is NOT cosmetic. With `true` AND `advanced.database.generateId: "uuid"`,
		// Better Auth stops emitting an `id` and expects the column to default one — which
		// `id text PRIMARY KEY` does not do, so every insert would fail on a NOT NULL violation.
		// `false` keeps id generation in Better Auth, where the schema this adapter targets needs
		// it. A consumer whose PK really is `uuid DEFAULT gen_random_uuid()` can express that with
		// a column default and `generateId: false`.
		supportsUUIDs: false,

		/**
		 * Raw SQL bypasses TypeORM's `ValueTransformer`s, so column-level coercion that an entity
		 * declares does not run. Two coercions have to be reapplied here:
		 *
		 *   * `date` fields — matching the Drizzle adapter, whose driver can also hand back a
		 *     string;
		 *   * string-valued `number` fields — `int8`/`bigint` arrives as a string from node-pg
		 *     because 64 bits do not fit a double. `rateLimit.lastRequest` is exactly this, and
		 *     without the coercion the rate limiter compares a string to a number.
		 *
		 * Identifier fields are excluded from the number rule on purpose: `transformOutput` has
		 * already `String()`-ed them one line earlier, and with `generateId: "serial"` their
		 * declared type is `number` — coercing back would undo the factory's own normalisation.
		 */
		customTransformOutput: ({ data, field, fieldAttributes }) => {
			if (data === null || data === undefined) return data;
			if (fieldAttributes.type === "date") {
				return data instanceof Date ? data : new Date(data as string);
			}
			const isIdentifier = field === "id" || fieldAttributes.references?.field === "id";
			if (!isIdentifier && fieldAttributes.type === "number" && typeof data === "string") {
				return Number(data);
			}
			return data;
		},

		transaction: config.transaction
			? (callback) => {
					const runWithManager = (manager: unknown) => {
						const transactionalManager = requireEntityManager(manager);
						return callback(
							createAdapterFactory({
								// Pin every inner statement to one manager. Resolving the hook again from
								// inside the callback could let a context change split one logical unit of work.
								adapter: createCustomAdapter(() => transactionalManager),
								config: { ...adapterConfig, transaction: false },
							})(lazyOptions ?? {}),
						);
					};

					// A defined scoped manager means the application already owns the transaction
					// (typically through AsyncLocalStorage). Join it so Better Auth writes can be
					// committed or rolled back atomically with application audit/outbox records.
					const scopedManager = config.getManager?.();
					if (scopedManager !== undefined) return runWithManager(scopedManager);

					return Reflect.apply(dataSource.transaction, dataSource, [runWithManager]);
				}
			: false,
	};

	const adapter = createAdapterFactory({
		adapter: createCustomAdapter(() => config.getManager?.() ?? dataSource.manager),
		config: adapterConfig,
	});

	return (options: BetterAuthOptions) => {
		lazyOptions = options;
		return adapter(options);
	};
}

/** `"a" = $1, "b" = $2` for an update payload already in Better Auth's field-name space. */
function assignmentList(context: SqlContext, update: Row, parameters: ParameterBag): string {
	const entries = Object.entries(update);
	if (entries.length === 0) {
		throw new BetterAuthError(
			`[TypeORM Adapter] Refusing to issue an UPDATE on "${context.model}" with no assignments. ` +
				`Every field in the payload was unknown to the schema or transformed away.`,
		);
	}
	return entries
		.map(([field, value]) => {
			const { databaseName } = context.registry.column(context.model, field);
			return `${context.dialect.escape(databaseName)} = ${parameters.push(value)}`;
		})
		.join(", ");
}
