import { HttpStatus, Injectable } from "@nestjs/common";
import { AuthRoutePolicy } from "../decorators/route-policy.decorator.ts";
import { deny, type BetterAuthRoutePolicyHandler } from "./route-policy.ts";

/**
 * Raw Better Auth organization routes superseded by an application control
 * plane backed by `BetterAuthOrganizationService`.
 */
export const BETTER_AUTH_ORGANIZATION_CONTROL_PLANE_PATHS = [
	"/organization/update",
	"/organization/get-full-organization",
	"/organization/has-permission",
	"/organization/invite-member",
	"/organization/resend-invitation",
	"/organization/cancel-invitation",
	"/organization/list-invitations",
	"/organization/list-members",
	"/organization/remove-member",
	"/organization/update-member-role",
	"/organization/leave",
	"/organization/accept-invitation",
	"/organization/reject-invitation",
	"/organization/get-invitation",
	"/organization/list-user-invitations",
] as const;

/**
 * Opt-in policy that closes Better Auth's raw organization control-plane
 * routes. Register it with `BetterAuthModule.forFeature({ routePolicies: [...] })`
 * after exposing the corresponding application facade endpoints.
 */
@AuthRoutePolicy({ path: BETTER_AUTH_ORGANIZATION_CONTROL_PLANE_PATHS, order: -100 })
@Injectable()
export class BetterAuthOrganizationControlPlaneRoutePolicy implements BetterAuthRoutePolicyHandler {
	evaluate() {
		return deny(HttpStatus.FORBIDDEN, {
			statusCode: HttpStatus.FORBIDDEN,
			code: "ORGANIZATION_CONTROL_PLANE_FACADE_REQUIRED",
			message: "Use the application's organization control-plane endpoints.",
		});
	}
}
