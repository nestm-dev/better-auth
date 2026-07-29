import { createParamDecorator, Logger } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { SESSION_RESOLVED } from "../better-auth.constants.ts";
import { getRequestFromContext } from "../utils/execution-context.util.ts";

const logger = new Logger("BetterAuth");
let warnedUnresolvedSession = false;

function warnIfGuardNeverRan(request: { [SESSION_RESOLVED]?: boolean } | undefined): void {
	if (!request || request[SESSION_RESOLVED] || warnedUnresolvedSession) return;
	warnedUnresolvedSession = true;
	logger.warn(
		"@Session()/@CurrentUser() was used on a route where BetterAuthGuard did not run — " +
			"it will always be null. Apply @UseGuards(BetterAuthGuard) or keep the global guard enabled.",
	);
}

/**
 * Injects the session (`{ user, session }`) resolved by `BetterAuthGuard`,
 * or `null` when unauthenticated. Type it with `UserSession` (registry-aware)
 * or `UserSession<typeof auth>`.
 */
export const Session: ReturnType<typeof createParamDecorator> = createParamDecorator(
	async (_data: unknown, context: ExecutionContext): Promise<unknown> => {
		const request = await getRequestFromContext(context);
		warnIfGuardNeverRan(request);
		return request?.session ?? null;
	},
);

/** Injects the authenticated user, or `null`. Shorthand for `session.user`. */
export const CurrentUser: ReturnType<typeof createParamDecorator> = createParamDecorator(
	async (_data: unknown, context: ExecutionContext): Promise<unknown> => {
		const request = await getRequestFromContext(context);
		warnIfGuardNeverRan(request);
		return request?.session?.user ?? request?.user ?? null;
	},
);
