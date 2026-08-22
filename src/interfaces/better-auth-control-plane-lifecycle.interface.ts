/** Namespaces serialized Better Auth control-plane mutations. */
export type BetterAuthControlPlaneLifecycleScope = "organization" | "user" | "platform";

/**
 * Coordinates control-plane mutations that must observe one serialized view
 * of a resource's state.
 *
 * Implementations must keep the callback inside the same transaction/context
 * used by the configured Better Auth database adapter. Scope is part of the
 * resource identity so equal organization and user ids never share a lock.
 */
export interface BetterAuthControlPlaneLifecycleCoordinator {
	run<T>(
		scope: BetterAuthControlPlaneLifecycleScope,
		resourceId: string,
		operation: () => Promise<T>,
	): Promise<T>;
}
