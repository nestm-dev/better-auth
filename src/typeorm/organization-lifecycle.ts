import { BetterAuthError } from "better-auth";

import type { BetterAuthOrganizationLifecycleCoordinator } from "../interfaces/better-auth-organization-lifecycle.interface.ts";
import {
	createTypeormBetterAuthControlPlaneLifecycleCoordinator,
	type TypeormBetterAuthControlPlaneLifecycleCoordinator,
} from "./control-plane-lifecycle.ts";
import type { TypeormDataSource } from "./types.ts";

/**
 * Backwards-compatible organization-scoped view of the shared TypeORM
 * control-plane coordinator.
 */
export interface TypeormBetterAuthOrganizationLifecycleCoordinator extends BetterAuthOrganizationLifecycleCoordinator {
	/** The active lifecycle transaction manager, or `undefined` outside `run`. */
	readonly getManager: TypeormBetterAuthControlPlaneLifecycleCoordinator["getManager"];
}

function requireOrganizationId(organizationId: string): string {
	if (typeof organizationId !== "string" || organizationId.trim().length === 0) {
		throw new BetterAuthError(
			"[TypeORM Organization Lifecycle] organizationId must be a non-empty string.",
		);
	}
	return organizationId;
}

/**
 * Creates the legacy organization-only API over the generalized control-plane
 * coordinator. New applications with user management should create one
 * control-plane coordinator and pass it to every service instead.
 */
export function createTypeormBetterAuthOrganizationLifecycleCoordinator(
	dataSource: TypeormDataSource,
): TypeormBetterAuthOrganizationLifecycleCoordinator {
	const coordinator = createTypeormBetterAuthControlPlaneLifecycleCoordinator(dataSource);
	return {
		getManager: coordinator.getManager,
		run: async (organizationId, operation) =>
			await coordinator.run("organization", requireOrganizationId(organizationId), operation),
	};
}
