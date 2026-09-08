// Module
export { BetterAuthModule, BetterAuthFeatureModule } from "./better-auth.module.ts";
export {
	MODULE_OPTIONS_TOKEN,
	OPTIONS_TYPE,
	ASYNC_OPTIONS_TYPE,
	type BetterAuthForRootOptions,
	type BetterAuthForRootAsyncOptions,
} from "./better-auth.module-definition.ts";

// Tokens & constants
export {
	BETTER_AUTH_INSTANCE,
	BETTER_AUTH_MODULE_OPTIONS,
	BETTER_AUTH_BASE_PATH,
} from "./better-auth.tokens.ts";
export {
	DATABASE_HOOK_MODELS,
	DATABASE_HOOK_OPERATIONS,
	SESSION_RESOLVED,
	METADATA_KEY,
	type DatabaseHookModel,
	type DatabaseHookOperation,
	type DatabaseHookPhase,
} from "./better-auth.constants.ts";

// Options interfaces
export type {
	BetterAuthModuleOptions,
	BetterAuthInstanceModeOptions,
	BetterAuthOptionsModeOptions,
	BetterAuthModuleExtras,
	BetterAuthCorsOptions,
	BetterAuthInteropOptions,
	BetterAuthRequestMiddleware,
} from "./interfaces/better-auth-module-options.interface.ts";
export type { BetterAuthFeatureOptions } from "./interfaces/better-auth-feature-options.interface.ts";
export type { BetterAuthOptionsFactory } from "./interfaces/better-auth-options-factory.interface.ts";
export type {
	BetterAuthControlPlaneLifecycleCoordinator,
	BetterAuthControlPlaneLifecycleScope,
} from "./interfaces/better-auth-control-plane-lifecycle.interface.ts";
export type { BetterAuthOrganizationLifecycleCoordinator } from "./interfaces/better-auth-organization-lifecycle.interface.ts";
export {
	deny,
	type BetterAuthRoutePolicy,
	type BetterAuthRoutePolicyContext,
	type BetterAuthRoutePolicyDenial,
	type BetterAuthRoutePolicyHandler,
	type BetterAuthRoutePolicyHeadersInit,
	type BetterAuthRoutePolicyOptions,
	type BetterAuthRoutePolicyPathMatcher,
	type BetterAuthRoutePolicyResult,
} from "./policies/route-policy.ts";

export type {
	BetterAuthOrganizationResolver,
	BetterAuthOrganizationResolutionContext,
} from "./interfaces/better-auth-organization-resolver.interface.ts";

// Types
export {
	defineBetterAuthOptions,
	type AnyAuth,
	type AuthContextOf,
	type AuthHookContext,
	type AuthUser,
	type BetterAuthRequestState,
	type BetterAuthTypeRegistry,
	type InferAuth,
	type RegisteredAuth,
	type UserSession,
} from "./types/auth.types.ts";

// Service & guard
export { BetterAuthService } from "./services/better-auth.service.ts";
export type { BetterAuthApiInvocation } from "./services/better-auth.service.ts";
export {
	BetterAuthSessionService,
	type BetterAuthSessionBulkRevocationResult,
	type BetterAuthSessionRedactedField,
	type BetterAuthSessionRevocationResult,
	type BetterAuthSessionSummary,
} from "./services/better-auth-session.service.ts";
export {
	BetterAuthOrganizationService,
	type BetterAuthOrganizationInvitation,
	type BetterAuthOrganizationInvitationAcceptance,
	type BetterAuthOrganizationInvitationPreview,
	type BetterAuthOrganizationMember,
	type BetterAuthOrganizationMemberList,
	type BetterAuthOrganizationMemberListOptions,
	type BetterAuthOrganizationMemberUserRedactedField,
	type BetterAuthOrganizationRequestHeaders,
	type BetterAuthReceivedOrganizationInvitation,
} from "./services/better-auth-organization.service.ts";
export {
	BetterAuthUserManagementService,
	type BetterAuthManagedUser,
	type BetterAuthManagedUserBanOptions,
	type BetterAuthManagedUserListFilter,
	type BetterAuthManagedUserListOptions,
	type BetterAuthManagedUserPage,
	type BetterAuthManagedUserProfileUpdate,
	type BetterAuthManagedUserRedactedField,
	type BetterAuthManagedUserSearchField,
	type BetterAuthManagedUserSearchOperator,
	type BetterAuthManagedUserSession,
	type BetterAuthManagedUserSessionBulkRevocationResult,
	type BetterAuthManagedUserSessionRedactedField,
	type BetterAuthManagedUserSessionRevocationResult,
	type BetterAuthManagedUserSortDirection,
	type BetterAuthManagedUserSortField,
} from "./services/better-auth-user-management.service.ts";
export {
	mapBetterAuthApiError,
	normalizeBetterAuthHeaders,
	type BetterAuthApiErrorResponse,
	type BetterAuthApiHeaders,
} from "./services/better-auth-api-invocation.ts";
export { BetterAuthGuard } from "./guards/better-auth.guard.ts";
export {
	BETTER_AUTH_SESSION_MANAGEMENT_PATHS,
	BetterAuthSessionManagementRoutePolicy,
} from "./policies/session-management-route-policy.ts";
export {
	BETTER_AUTH_ORGANIZATION_CONTROL_PLANE_PATHS,
	BetterAuthOrganizationControlPlaneRoutePolicy,
} from "./policies/organization-control-plane-route-policy.ts";
export {
	BETTER_AUTH_USER_MANAGEMENT_PATHS,
	BetterAuthUserManagementRoutePolicy,
} from "./policies/user-management-route-policy.ts";
export { createAuthError, type AuthErrorStatus } from "./guards/auth-errors.ts";
export {
	MUTATION_ORIGIN_GUARD_OPTIONS,
	MutationOriginGuard,
	canonicalizeTrustedMutationOrigin,
	canonicalizeTrustedMutationOrigins,
	type MutationOriginCanonicalizationOptions,
	type MutationOriginGuardOptions,
} from "./guards/mutation-origin.guard.ts";

// Access-control decorators
export {
	AllowAnonymous,
	Public,
	OptionalAuth,
	Roles,
	OrgRoles,
	RequireActiveOrg,
	UserHasPermission,
	MemberHasPermission,
	type AllowAnonymousOptions,
	type PermissionCheckOptions,
} from "./decorators/access-control.decorators.ts";
export { Session, CurrentUser } from "./decorators/session.decorator.ts";
export { InjectBetterAuth } from "./decorators/inject-better-auth.decorator.ts";
export { AuthRoutePolicy } from "./decorators/route-policy.decorator.ts";

// Hook decorators & registries
export {
	Hook,
	BeforeHook,
	AfterHook,
	type HookClassOptions,
	type HookMethodOptions,
	type HookPathMatcher,
} from "./decorators/hook.decorators.ts";
export {
	DatabaseHook,
	DatabaseHookMethod,
	BeforeCreate,
	AfterCreate,
	BeforeUpdate,
	AfterUpdate,
	BeforeDelete,
	AfterDelete,
	type DatabaseHookMethodMetadata,
	type DatabaseHookMethodOptions,
} from "./decorators/database-hook.decorators.ts";
export {
	BetterAuthHookRegistry,
	mergeHookContext,
	type AuthHookEntry,
	type HookPhase,
} from "./hooks/hook-registry.service.ts";
export {
	BetterAuthDatabaseHookRegistry,
	type DatabaseHookEntry,
	type DatabaseHookFn,
} from "./hooks/database-hook-registry.service.ts";

// Mount utilities (advanced use)
export { resolveAuthBasePath, normalizeBasePath } from "./mount/base-path.ts";
export {
	getRequestFromContext,
	resolveContextKind,
	type AuthContextKind,
} from "./utils/execution-context.util.ts";
