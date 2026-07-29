import { Reflector } from "@nestjs/core";
import { METADATA_KEY } from "../better-auth.constants.ts";

export interface AllowAnonymousOptions {
	/**
	 * By default `@AllowAnonymous` skips the session lookup entirely (the
	 * request never hits the auth backend). Set `resolveSession: true` to
	 * still resolve the session (populating `@Session()`) while keeping the
	 * route public.
	 */
	resolveSession?: boolean;
}

/** Marks a route (or controller) public: the guard always allows access. */
export const AllowAnonymous = Reflector.createDecorator<
	AllowAnonymousOptions | undefined,
	AllowAnonymousOptions
>({
	key: METADATA_KEY.allowAnonymous,
	transform: (options) => options ?? {},
});

/** Ecosystem-standard alias of {@link AllowAnonymous}. */
export const Public = AllowAnonymous;

/**
 * Resolves the session but tolerates its absence: authenticated and anonymous
 * requests are both allowed, and `@Session()` is `null` for the latter.
 */
export const OptionalAuth = Reflector.createDecorator<void, true>({
	key: METADATA_KEY.optionalAuth,
	transform: () => true,
});

function toRoleArray(roles: string | readonly string[]): string[] {
	return Array.isArray(roles) ? [...roles] : [roles as string];
}

/**
 * Requires the authenticated user's `user.role` (admin plugin) to include at
 * least one of the given roles. Deliberately distinct from {@link OrgRoles}:
 * an organization role never satisfies a `@Roles` requirement.
 */
export const Roles = Reflector.createDecorator<string | readonly string[], string[]>({
	key: METADATA_KEY.roles,
	transform: toRoleArray,
});

/** Requires an active organization on the session (organization plugin). */
export const RequireActiveOrg = Reflector.createDecorator<void, true>({
	key: METADATA_KEY.requireActiveOrg,
	transform: () => true,
});

/**
 * Requires the user's role in the active organization to include at least one
 * of the given roles. Implies {@link RequireActiveOrg}.
 */
export const OrgRoles = Reflector.createDecorator<string | readonly string[], string[]>({
	key: METADATA_KEY.orgRoles,
	transform: toRoleArray,
});

export interface PermissionCheckOptions {
	/** Access-control statement, e.g. `{ project: ["create"] }`. */
	permissions: Record<string, string[]>;
	/** Check against an explicit role instead of the user's own. */
	role?: string;
}

function assertPermissions(options: PermissionCheckOptions): PermissionCheckOptions {
	if (!options || typeof options !== "object" || !options.permissions) {
		throw new Error("@UserHasPermission/@MemberHasPermission require a `permissions` object.");
	}
	return options;
}

/** Checks `auth.api.userHasPermission` (admin plugin) for the current user. */
export const UserHasPermission = Reflector.createDecorator<
	PermissionCheckOptions,
	PermissionCheckOptions
>({
	key: METADATA_KEY.userHasPermission,
	transform: assertPermissions,
});

/**
 * Checks `auth.api.hasPermission` (organization plugin) for the current
 * member of the active organization.
 */
export const MemberHasPermission = Reflector.createDecorator<
	PermissionCheckOptions,
	PermissionCheckOptions
>({
	key: METADATA_KEY.memberHasPermission,
	transform: assertPermissions,
});
