import { HttpStatus, Injectable } from "@nestjs/common";
import { AuthRoutePolicy } from "../decorators/route-policy.decorator.ts";
import { deny, type BetterAuthRoutePolicyHandler } from "./route-policy.ts";

/** Raw Better Auth routes superseded by {@link BetterAuthSessionService}. */
export const BETTER_AUTH_SESSION_MANAGEMENT_PATHS = [
	"/list-sessions",
	"/revoke-session",
	"/revoke-other-sessions",
	"/revoke-sessions",
] as const;

/**
 * Opt-in policy that closes Better Auth's token-oriented HTTP session routes.
 * Server-side `BetterAuthSessionService` calls remain available.
 */
@AuthRoutePolicy({ path: BETTER_AUTH_SESSION_MANAGEMENT_PATHS, order: -100 })
@Injectable()
export class BetterAuthSessionManagementRoutePolicy implements BetterAuthRoutePolicyHandler {
	evaluate() {
		return deny(HttpStatus.FORBIDDEN, {
			statusCode: HttpStatus.FORBIDDEN,
			code: "SESSION_MANAGEMENT_FACADE_REQUIRED",
			message: "Use the application's session-management endpoints.",
		});
	}
}
