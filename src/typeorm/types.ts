import type { AdapterFactoryConfig } from "better-auth/adapters";
import type { EntityManager, EntitySchema } from "typeorm";

/**
 * Anything `DataSource.getMetadata()` accepts as an entity handle.
 *
 * Mirrors TypeORM's own accepted union rather than the wider `EntityTarget`, which also
 * admits a `{ type, name }` form.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM types a decorated entity class as `Function`.
export type TypeormEntityTarget = Function | EntitySchema | string;

export interface TypeormAdapterConfig {
	/**
	 * Explicit model -> entity mapping, for models the automatic resolution cannot reach.
	 *
	 * Resolution tries the entity class name, then the table name, then the snake_cased model
	 * name, so `rateLimit -> class RateLimit -> table rate_limit` already works. Reach for this
	 * when a model maps to a differently named class, or when two entities match the same tier.
	 *
	 * @example
	 * ```ts
	 * typeormAdapter(dataSource, { entities: { user: AuthUser, rateLimit: ThrottleBucket } })
	 * ```
	 */
	entities?: Record<string, TypeormEntityTarget> | undefined;

	/**
	 * Supplies the `EntityManager` each statement runs on, resolved per statement.
	 *
	 * Defaults to `dataSource.manager`. Provide this when the surrounding application already
	 * owns a transaction — typically an `AsyncLocalStorage`-scoped unit of work — so auth
	 * writes join it instead of running on a separate pooled connection:
	 *
	 * ```ts
	 * typeormAdapter(dataSource, { getManager: () => store.getStore()?.manager })
	 * ```
	 *
	 * Returning `undefined` falls back to `dataSource.manager`, so the hook is safe to call
	 * outside a scoped context. It is deliberately consulted per statement rather than once at
	 * construction: an adapter is built at application boot, long before any request context
	 * exists.
	 *
	 * Statements issued inside `transaction()` ignore this hook and use the transactional
	 * manager, because a callback that escaped its own transaction would defeat the point.
	 */
	getManager?: (() => EntityManager | undefined) | undefined;

	/**
	 * Enable Better Auth's `transaction()` support, backed by `dataSource.transaction()`.
	 *
	 * @default false
	 */
	transaction?: boolean | undefined;

	/** Append an `s` to every model name when resolving entities. @default false */
	usePlural?: boolean | undefined;

	/** Forwarded to the adapter factory's debug logging. @default false */
	debugLogs?: AdapterFactoryConfig["debugLogs"];
}
