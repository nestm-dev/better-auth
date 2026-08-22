import { HttpStatus, Injectable } from "@nestjs/common";
import { AuthRoutePolicy } from "../decorators/route-policy.decorator.ts";
import { deny, type BetterAuthRoutePolicyHandler } from "./route-policy.ts";

/**
 * Segment-safe wildcard for every HTTP route owned by Better Auth's admin
 * plugin, including routes introduced by a compatible future release.
 */
export const BETTER_AUTH_USER_MANAGEMENT_PATHS = ["/admin/*"] as const;

/**
 * Opt-in policy that closes Better Auth's raw admin HTTP namespace after an
 * application exposes a user-management facade backed by
 * {@link BetterAuthUserManagementService}.
 */
@AuthRoutePolicy({ path: BETTER_AUTH_USER_MANAGEMENT_PATHS, order: -100 })
@Injectable()
export class BetterAuthUserManagementRoutePolicy implements BetterAuthRoutePolicyHandler {
	evaluate() {
		return deny(HttpStatus.FORBIDDEN, {
			statusCode: HttpStatus.FORBIDDEN,
			code: "USER_MANAGEMENT_FACADE_REQUIRED",
			message: "Use the application's user-management endpoints.",
		});
	}
}
