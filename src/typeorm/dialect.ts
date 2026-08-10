import { BetterAuthError } from "better-auth";
import type { DataSource } from "typeorm";

/**
 * The TypeORM driver types this adapter emits verified SQL for.
 *
 * The adapter writes SQL by hand rather than through `QueryBuilder` (see `adapter.ts` for
 * why), so every grammar it emits — `RETURNING`, `x AT TIME ZONE 'UTC'`, `UPDATE t AS a`,
 * `DELETE FROM t AS a` — is a dialect commitment rather than something the ORM abstracts.
 * All three entries here share TypeORM's Postgres driver and its grammar.
 *
 * Other drivers are rejected at construction instead of being half-supported: a MySQL user
 * would otherwise get `UPDATE ... RETURNING` syntax errors at the first write, and a SQLite
 * user would silently lose the UTC timestamp projection. Widening this set means adding the
 * dialect's grammar to `sql.ts` and a conformance arm to `tests/postgres/`.
 */
const VERIFIED_DRIVER_TYPES: ReadonlySet<string> = new Set([
	"postgres",
	"aurora-postgres",
	"cockroachdb",
]);

/**
 * The dialect-specific primitives the statement builder needs.
 *
 * Both `escape` and `parameter` delegate to the live TypeORM driver rather than
 * reimplementing quoting: `PostgresDriver.escape` doubles embedded `"` and `createParameter`
 * owns the placeholder syntax. Identifiers reaching `escape` always originate from
 * `EntityMetadata`, never from caller input.
 */
export interface TypeormDialect {
	readonly driverType: string;
	/**
	 * Whether `INSERT`/`UPDATE`/`DELETE ... RETURNING` is available.
	 *
	 * `consumeOne` and `incrementOne` are single-statement compare-and-swaps that must read
	 * back the row they mutated, so they are only attached to the adapter when this is true.
	 * With it false the factory's documented `transaction(findMany + deleteMany/updateMany)`
	 * fallback runs instead.
	 */
	readonly supportsReturning: boolean;
	escape(identifier: string): string;
	parameter(index: number): string;
}

export function resolveDialect(dataSource: DataSource): TypeormDialect {
	const driverType = String(dataSource.options.type);
	if (!VERIFIED_DRIVER_TYPES.has(driverType)) {
		throw new BetterAuthError(
			`[TypeORM Adapter] Unsupported TypeORM driver "${driverType}". This adapter emits ` +
				`PostgreSQL grammar directly and is only verified against ` +
				`${[...VERIFIED_DRIVER_TYPES].join(", ")}. Use one of those drivers, or open an ` +
				`issue at https://github.com/nestm-dev/better-auth/issues describing the dialect.`,
		);
	}

	const { driver } = dataSource;
	return {
		driverType,
		supportsReturning: true,
		escape: (identifier) => driver.escape(identifier),
		parameter: (index) => driver.createParameter("p", index),
	};
}
