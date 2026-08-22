import { AsyncLocalStorage } from "node:async_hooks";

import { BetterAuthError } from "better-auth";

import type { BetterAuthOrganizationLifecycleCoordinator } from "../interfaces/better-auth-organization-lifecycle.interface.ts";
import { executeQuery, requireEntityManager } from "./capabilities.ts";
import { resolveDialect } from "./dialect.ts";
import type { TypeormDataSource, TypeormEntityManager } from "./types.ts";

const ADVISORY_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))";

const ADVISORY_LOCK_DRIVER_TYPES: ReadonlySet<string> = new Set(["postgres", "aurora-postgres"]);

interface OrganizationLifecycleState {
	active: boolean;
	readonly manager: TypeormEntityManager;
	readonly locks: Map<string, Promise<void>>;
}

/**
 * A TypeORM organization-lifecycle coordinator whose manager can also be used
 * by {@link typeormAdapter} to join the same transaction.
 */
export interface TypeormBetterAuthOrganizationLifecycleCoordinator extends BetterAuthOrganizationLifecycleCoordinator {
	/** The active lifecycle transaction manager, or `undefined` outside `run`. */
	readonly getManager: () => TypeormEntityManager | undefined;
}

function invalidCoordinatorInput(message: string): BetterAuthError {
	return new BetterAuthError(`[TypeORM Organization Lifecycle] ${message}`);
}

function requireOrganizationId(organizationId: string): string {
	if (typeof organizationId !== "string" || organizationId.trim().length === 0) {
		throw invalidCoordinatorInput("organizationId must be a non-empty string.");
	}
	return organizationId;
}

function requireOperation<T>(operation: () => Promise<T>): () => Promise<T> {
	if (typeof operation !== "function") {
		throw invalidCoordinatorInput("operation must be a function.");
	}
	return operation;
}

/**
 * Creates a PostgreSQL transaction and advisory-lock boundary for Better Auth
 * organization lifecycle mutations.
 *
 * Pass `coordinator.getManager` to {@link typeormAdapter} with
 * `transaction: true`. Better Auth will then join the transaction opened by
 * {@link TypeormBetterAuthOrganizationLifecycleCoordinator.run} instead of
 * opening a second transaction on another pooled connection.
 */
export function createTypeormBetterAuthOrganizationLifecycleCoordinator(
	dataSource: TypeormDataSource,
): TypeormBetterAuthOrganizationLifecycleCoordinator {
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

	const storage = new AsyncLocalStorage<OrganizationLifecycleState>();

	const getManager = (): TypeormEntityManager | undefined => {
		const state = storage.getStore();
		return state?.active ? state.manager : undefined;
	};

	const acquireLock = async (
		state: OrganizationLifecycleState,
		organizationId: string,
	): Promise<void> => {
		const existing = state.locks.get(organizationId);
		if (existing) return existing;

		const pending = executeQuery(state.manager, ADVISORY_LOCK_SQL, [organizationId]).then(
			() => undefined,
		);
		state.locks.set(organizationId, pending);
		return pending;
	};

	const run = async <T>(
		organizationIdInput: string,
		operationInput: () => Promise<T>,
	): Promise<T> => {
		const organizationId = requireOrganizationId(organizationIdInput);
		const operation = requireOperation(operationInput);
		const current = storage.getStore();

		if (current?.active) {
			await acquireLock(current, organizationId);
			return await operation();
		}

		const transaction = dataSource.transaction;
		return await Reflect.apply(transaction, dataSource, [
			async (managerInput: unknown) => {
				const state: OrganizationLifecycleState = {
					active: true,
					manager: requireEntityManager(managerInput),
					locks: new Map(),
				};

				return await storage.run(state, async () => {
					try {
						await acquireLock(state, organizationId);
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
