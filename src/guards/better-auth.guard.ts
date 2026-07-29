import { Inject, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { SESSION_RESOLVED } from "../better-auth.constants.ts";
import { BETTER_AUTH_INSTANCE } from "../better-auth.tokens.ts";
import {
	AllowAnonymous,
	MemberHasPermission,
	OptionalAuth,
	OrgRoles,
	RequireActiveOrg,
	Roles,
	UserHasPermission,
	type AllowAnonymousOptions,
	type PermissionCheckOptions,
} from "../decorators/access-control.decorators.ts";
import {
	getRequestFromContext,
	resolveContextKind,
	type AuthContextKind,
} from "../utils/execution-context.util.ts";
import { createAuthError } from "./auth-errors.ts";
import type { AnyAuth } from "../types/auth.types.ts";

/** Loosely-typed view of the session for guard-internal checks. */
interface GuardSession {
	user?: { role?: string | string[] } & Record<string, unknown>;
	session?: { activeOrganizationId?: string } & Record<string, unknown>;
}

function matchesRequiredRole(
	role: string | readonly string[] | null | undefined,
	required: readonly string[],
): boolean {
	if (!role) return false;
	const actual = Array.isArray(role)
		? (role as string[])
		: String(role)
				.split(",")
				.map((r) => r.trim());
	return actual.some((r) => required.includes(r));
}

@Injectable()
export class BetterAuthGuard implements CanActivate {
	private readonly logger = new Logger(BetterAuthGuard.name);
	private readonly loggedMisconfigurations = new Set<string>();

	constructor(
		private readonly reflector: Reflector,
		@Inject(BETTER_AUTH_INSTANCE) private readonly auth: AnyAuth,
	) {}

	/**
	 * A class-level `@AllowAnonymous`/`@OptionalAuth` must not silently defeat
	 * a handler that declares its own authorization requirements — explicit
	 * handler-level authz wins over an inherited public marker (fail closed).
	 */
	private handlerDeclaresAuthorization(handler: Parameters<Reflector["get"]>[1]): boolean {
		return (
			this.reflector.get(Roles, handler) !== undefined ||
			this.reflector.get(OrgRoles, handler) !== undefined ||
			this.reflector.get(RequireActiveOrg, handler) !== undefined ||
			this.reflector.get(UserHasPermission, handler) !== undefined ||
			this.reflector.get(MemberHasPermission, handler) !== undefined
		);
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const handler = context.getHandler();
		const targets = [handler, context.getClass()];
		let anonymous: AllowAnonymousOptions | undefined = this.reflector.getAllAndOverride(
			AllowAnonymous,
			targets,
		);
		let optional: true | undefined = this.reflector.getAllAndOverride(OptionalAuth, targets);
		if (
			(anonymous || optional) &&
			this.reflector.get(AllowAnonymous, handler) === undefined &&
			this.reflector.get(OptionalAuth, handler) === undefined &&
			this.handlerDeclaresAuthorization(handler)
		) {
			anonymous = undefined;
			optional = undefined;
		}
		const kind = resolveContextKind(context);
		const request = await getRequestFromContext(context);
		// A WS "request" is the long-lived socket client and an RPC context has
		// no per-request object either — caching the session verdict there
		// would keep a revoked session authorized for the connection lifetime.
		const cacheable = kind === "http" || kind === "graphql";

		if (anonymous && !anonymous.resolveSession) {
			// Perf: public route — never hit the auth backend.
			if (request) {
				if (cacheable) {
					request.session ??= null;
					request.user ??= null;
				}
				request[SESSION_RESOLVED] = true;
			}
			return true;
		}

		const headers = fromNodeHeaders(request?.headers ?? request?.handshake?.headers ?? {});
		let session: GuardSession | null;
		if (cacheable && request?.[SESSION_RESOLVED]) {
			// Idempotency: APP_GUARD + @UseGuards on the same route must not double-fetch.
			session = (request.session ?? null) as GuardSession | null;
		} else {
			session = ((await this.auth.api.getSession({ headers })) ?? null) as GuardSession | null;
			if (request) {
				request.session = session;
				request.user = session?.user ?? null;
				request[SESSION_RESOLVED] = true;
			}
		}

		if (anonymous) return true;

		if (!session) {
			if (optional) return true;
			throw await createAuthError(kind, "UNAUTHORIZED");
		}

		const orgRoles = this.reflector.getAllAndOverride(OrgRoles, targets);
		const requireActiveOrg =
			this.reflector.getAllAndOverride(RequireActiveOrg, targets) === true || !!orgRoles;
		if (requireActiveOrg && !session.session?.activeOrganizationId) {
			throw await createAuthError(kind, "FORBIDDEN", "Active organization is required");
		}

		const roles = this.reflector.getAllAndOverride(Roles, targets);
		if (roles && !matchesRequiredRole(session.user?.role, roles)) {
			throw await createAuthError(kind, "FORBIDDEN", "Insufficient permissions");
		}

		if (orgRoles) {
			const memberRole = await this.getActiveMemberRole(headers);
			if (!matchesRequiredRole(memberRole, orgRoles)) {
				throw await createAuthError(kind, "FORBIDDEN", "Insufficient organization permissions");
			}
		}

		const userPermission = this.reflector.getAllAndOverride(UserHasPermission, targets);
		if (userPermission) {
			await this.checkPermission(kind, headers, userPermission, "userHasPermission");
		}

		const memberPermission = this.reflector.getAllAndOverride(MemberHasPermission, targets);
		if (memberPermission) {
			await this.checkPermission(kind, headers, memberPermission, "hasPermission");
		}

		return true;
	}

	private api(): Record<string, unknown> {
		return this.auth.api as unknown as Record<string, unknown>;
	}

	private logMisconfigurationOnce(message: string): void {
		if (this.loggedMisconfigurations.has(message)) return;
		this.loggedMisconfigurations.add(message);
		this.logger.error(message);
	}

	private async getActiveMemberRole(headers: Headers): Promise<string | string[] | null> {
		const api = this.api();
		try {
			if (typeof api.getActiveMemberRole === "function") {
				const result = (await (api.getActiveMemberRole as (input: unknown) => Promise<unknown>)({
					headers,
				})) as { role?: string | string[] } | null;
				return result?.role ?? null;
			}
			if (typeof api.getActiveMember === "function") {
				const result = (await (api.getActiveMember as (input: unknown) => Promise<unknown>)({
					headers,
				})) as { role?: string | string[] } | null;
				return result?.role ?? null;
			}
			this.logMisconfigurationOnce(
				"@OrgRoles requires the better-auth organization plugin (auth.api.getActiveMemberRole/getActiveMember are missing).",
			);
			return null;
		} catch (error) {
			this.logger.warn(
				`Failed to resolve the active organization member role: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return null;
		}
	}

	private async checkPermission(
		kind: AuthContextKind,
		headers: Headers,
		options: PermissionCheckOptions,
		endpoint: "userHasPermission" | "hasPermission",
	): Promise<void> {
		const api = this.api();
		const fn = api[endpoint];
		if (typeof fn !== "function") {
			this.logMisconfigurationOnce(
				endpoint === "userHasPermission"
					? "@UserHasPermission requires the better-auth admin plugin (auth.api.userHasPermission is missing)."
					: "@MemberHasPermission requires the better-auth organization plugin (auth.api.hasPermission is missing).",
			);
			throw await createAuthError(kind, "FORBIDDEN", "Insufficient permissions");
		}
		let success = false;
		try {
			// With an explicit `role`, omit the session headers: better-auth
			// prefers the session user over `body.role`, which would silently
			// evaluate the caller's own role instead of the requested one.
			const input = options.role
				? { body: { permissions: options.permissions, role: options.role } }
				: { body: { permissions: options.permissions }, headers };
			const result = (await (fn as (input: unknown) => Promise<unknown>)(input)) as {
				success?: boolean;
			} | null;
			success = result?.success === true;
		} catch (error) {
			this.logger.warn(
				`Permission check '${endpoint}' failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			success = false;
		}
		if (!success) {
			throw await createAuthError(kind, "FORBIDDEN", "Insufficient permissions");
		}
	}
}
