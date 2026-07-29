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
	BetterAuthRequestMiddleware,
} from "./interfaces/better-auth-module-options.interface.ts";
export type { BetterAuthFeatureOptions } from "./interfaces/better-auth-feature-options.interface.ts";
export type { BetterAuthOptionsFactory } from "./interfaces/better-auth-options-factory.interface.ts";

// Types
export {
	defineBetterAuthOptions,
	type AnyAuth,
	type AuthContextOf,
	type AuthHookContext,
	type AuthUser,
	type BetterAuthTypeRegistry,
	type InferAuth,
	type RegisteredAuth,
	type UserSession,
} from "./types/auth.types.ts";

// Service & guard
export { BetterAuthService } from "./services/better-auth.service.ts";
export { BetterAuthGuard } from "./guards/better-auth.guard.ts";
export { createAuthError, type AuthErrorStatus } from "./guards/auth-errors.ts";

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
