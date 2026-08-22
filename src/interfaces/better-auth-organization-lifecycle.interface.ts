/**
 * Coordinates organization mutations that must observe one serialized view of
 * membership and invitation state.
 *
 * Implementations must keep the callback inside the same transaction/context
 * used by the configured Better Auth database adapter. The TypeORM subpath
 * provides a PostgreSQL implementation backed by transaction-scoped advisory
 * locks.
 */
export interface BetterAuthOrganizationLifecycleCoordinator {
	run<T>(organizationId: string, operation: () => Promise<T>): Promise<T>;
}
