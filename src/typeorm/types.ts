import type { AdapterFactoryConfig } from "better-auth/adapters";

/**
 * Anything `DataSource.getMetadata()` accepts as an entity handle.
 *
 * Mirrors TypeORM's own accepted union rather than the wider `EntityTarget`, which also
 * admits a `{ type, name }` form.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM types a decorated entity class as `Function`.
export type TypeormEntityTarget = Function | TypeormEntitySchema | string;

/** Structural EntitySchema identity used only as a DataSource lookup handle. */
export interface TypeormEntitySchema {
	readonly options: { readonly name: string };
}

export interface TypeormColumnMetadata {
	readonly propertyName: string;
	readonly databaseName: string;
	readonly type: unknown;
}

export interface TypeormEntityMetadata {
	readonly targetName: string;
	readonly tableName: string;
	readonly schema?: string;
	readonly columns: readonly TypeormColumnMetadata[];
}

export type TypeormCallableCapability = (...parameters: never[]) => unknown;

/** Minimal, structurally portable manager capability used by the adapter. */
export interface TypeormEntityManager {
	readonly query: TypeormCallableCapability;
}

/**
 * Minimal DataSource capability required by the adapter.
 *
 * Using TypeORM's full DataSource class here leaks its private nominal brand
 * into consumers. That makes identical peer versions installed at two linked
 * workspace paths fail assignability even though the runtime API is the same.
 */
export interface TypeormDataSource {
	readonly options: { readonly type: unknown };
	readonly driver: {
		escape(identifier: string): string;
		createParameter(parameterName: string, index: number): string;
	};
	readonly entityMetadatas: readonly unknown[];
	readonly manager: TypeormEntityManager;
	readonly getMetadata: TypeormCallableCapability;
	readonly transaction: TypeormCallableCapability;
}

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
	 * When `transaction` is enabled, a defined manager also signals that the application already
	 * owns the transaction. Better Auth's transaction callback joins and pins that manager rather
	 * than opening an independent `dataSource.transaction()`. Return `undefined` whenever no
	 * application transaction is active.
	 */
	getManager?: (() => TypeormEntityManager | undefined) | undefined;

	/**
	 * Enable Better Auth's `transaction()` support. It joins a manager returned by `getManager`,
	 * or opens a `dataSource.transaction()` when the hook is absent or returns `undefined`.
	 *
	 * @default false
	 */
	transaction?: boolean | undefined;

	/** Append an `s` to every model name when resolving entities. @default false */
	usePlural?: boolean | undefined;

	/** Forwarded to the adapter factory's debug logging. @default false */
	debugLogs?: AdapterFactoryConfig["debugLogs"];
}
