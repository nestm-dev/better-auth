export const DATABASE_HOOK_MODELS = ["user", "session", "account", "verification"] as const;
export type DatabaseHookModel = (typeof DATABASE_HOOK_MODELS)[number];

export const DATABASE_HOOK_OPERATIONS = ["create", "update", "delete"] as const;
export type DatabaseHookOperation = (typeof DATABASE_HOOK_OPERATIONS)[number];

export type DatabaseHookPhase = "before" | "after";

/**
 * Request-level marker set by `BetterAuthGuard` once it has resolved (or
 * deliberately skipped) the session for a request, so a second guard pass and
 * `@Session()` can tell "no session" apart from "guard never ran".
 */
export const SESSION_RESOLVED = Symbol("better_auth:session_resolved");

/** Namespaced metadata keys used by the guard-facing decorators. */
export const METADATA_KEY = {
	allowAnonymous: "better_auth:allow_anonymous",
	optionalAuth: "better_auth:optional_auth",
	roles: "better_auth:roles",
	orgRoles: "better_auth:org_roles",
	requireActiveOrg: "better_auth:require_active_org",
	userHasPermission: "better_auth:user_has_permission",
	memberHasPermission: "better_auth:member_has_permission",
	beforeHook: "better_auth:hook:before",
	afterHook: "better_auth:hook:after",
	databaseHook: "better_auth:database_hook",
} as const;
