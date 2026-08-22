import { AsyncLocalStorage } from "node:async_hooks";

import { BetterAuthError } from "better-auth";

import type {
	BetterAuthControlPlaneLifecycleCoordinator,
	BetterAuthControlPlaneLifecycleScope,
} from "../interfaces/better-auth-control-plane-lifecycle.interface.ts";
import { executeQuery, requireEntityManager } from "./capabilities.ts";
import { resolveDialect } from "./dialect.ts";
import type { TypeormDataSource, TypeormEntityManager } from "./types.ts";

const ADVISORY_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))";
const ADVISORY_LOCK_DRIVER_TYPES: ReadonlySet<string> = new Set(["postgres", "aurora-postgres"]);
const CONTROL_PLANE_SCOPES: ReadonlySet<string> = new Set(["organization", "user", "platform"]);

interface ControlPlaneLifecycleState {
	active: boolean;
	readonly manager: TypeormEntityManager;
	readonly locks: Map<string, Promise<void>>;
}

/**
 * A TypeORM control-plane coordinator whose manager can also be used by
 * {@link typeormAdapter} to join the same transaction.
 */
export interface TypeormBetterAuthControlPlaneLifecycleCoordinator extends BetterAuthControlPlaneLifecycleCoordinator {
	/** The active lifecycle transaction manager, or `undefined` outside `run`. */
	readonly getManager: () => TypeormEntityManager | undefined;
}

function invalidCoordinatorInput(message: string): BetterAuthError {
	return new BetterAuthError(`[TypeORM Control Plane Lifecycle] ${message}`);
}

function requireScope(
	scope: BetterAuthControlPlaneLifecycleScope,
): BetterAuthControlPlaneLifecycleScope {
	if (!CONTROL_PLANE_SCOPES.has(scope)) {
		throw invalidCoordinatorInput(
			`scope must be one of "organization", "user", or "platform"; received ${String(scope)}.`,
		);
	}
	return scope;
}

function requireResourceId(resourceId: string): string {
	if (typeof resourceId !== "string" || resourceId.trim().length === 0) {
		throw invalidCoordinatorInput("resourceId must be a non-empty string.");
	}
	return resourceId;
}

function requireOperation<T>(operation: () => Promise<T>): () => Promise<T> {
	if (typeof operation !== "function") {
		throw invalidCoordinatorInput("operation must be a function.");
	}
	return operation;
}

function scopedLockKeys(
	scope: BetterAuthControlPlaneLifecycleScope,
	resourceId: string,
): readonly string[] {
	const namespaced = `${scope}:${resourceId}`;
	// Organization coordination predates scoped keys. Acquire both during the
	// compatibility window so a rolling deployment still serializes against an
	// older process that holds only the raw organization id. Sorting the pair is
	// mandatory: every new process must request the two locks in the same order.
	return scope === "organization" ? [resourceId, namespaced].toSorted() : [namespaced];
}

/**
 * Creates one PostgreSQL transaction/context and namespaced advisory-lock
 * boundary shared by every Better Auth control-plane service.
 *
 * Pass `coordinator.getManager` to {@link typeormAdapter} with
 * `transaction: true`, and pass the coordinator itself as the Nest module's
 * `controlPlaneLifecycle` option.
 */
export function createTypeormBetterAuthControlPlaneLifecycleCoordinator(
	dataSource: TypeormDataSource,
): TypeormBetterAuthControlPlaneLifecycleCoordinator {
	if (
		typeof dataSource !== "object" ||
		dataSource === null ||
		typeof dataSource.transaction !== "function"
	) {
		throw invalidCoordinatorInput("A DataSource with transaction support is required.");
	}

	const { driverType } = resolveDialect(dataSource);
	if (!ADVISORY_LOCK_DRIVER_TYPES.has(driverType)) {
		throw invalidCoordinatorInput(
			`Driver "${driverType}" does not provide the PostgreSQL transaction-scoped advisory locks required by this coordinator.`,
		);
	}

	const storage = new AsyncLocalStorage<ControlPlaneLifecycleState>();

	const getManager = (): TypeormEntityManager | undefined => {
		const state = storage.getStore();
		return state?.active ? state.manager : undefined;
	};

	const acquireLock = async (state: ControlPlaneLifecycleState, lockKey: string): Promise<void> => {
		const existing = state.locks.get(lockKey);
		if (existing) return existing;

		const pending = executeQuery(state.manager, ADVISORY_LOCK_SQL, [lockKey]).then(() => undefined);
		state.locks.set(lockKey, pending);
		return pending;
	};

	const run = async <T>(
		scopeInput: BetterAuthControlPlaneLifecycleScope,
		resourceIdInput: string,
		operationInput: () => Promise<T>,
	): Promise<T> => {
		const scope = requireScope(scopeInput);
		const resourceId = requireResourceId(resourceIdInput);
		const operation = requireOperation(operationInput);
		const lockKeys = scopedLockKeys(scope, resourceId);
		const current = storage.getStore();

		if (current?.active) {
			for (const lockKey of lockKeys) await acquireLock(current, lockKey);
			return await operation();
		}

		const transaction = dataSource.transaction;
		return await Reflect.apply(transaction, dataSource, [
			async (managerInput: unknown) => {
				const state: ControlPlaneLifecycleState = {
					active: true,
					manager: requireEntityManager(managerInput),
					locks: new Map(),
				};

				return await storage.run(state, async () => {
					try {
						for (const lockKey of lockKeys) await acquireLock(state, lockKey);
						return await operation();
					} finally {
						state.active = false;
					}
				});
			},
		]);
	};

	return { getManager, run };
}
