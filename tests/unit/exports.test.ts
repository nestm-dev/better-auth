import { describe, expect, it } from "vitest";
import * as barrel from "../../src/index.ts";

const EXPECTED_VALUE_EXPORTS = [
	// module
	"BetterAuthModule",
	"BetterAuthFeatureModule",
	"MODULE_OPTIONS_TOKEN",
	"OPTIONS_TYPE",
	"ASYNC_OPTIONS_TYPE",
	// tokens & constants
	"BETTER_AUTH_INSTANCE",
	"BETTER_AUTH_MODULE_OPTIONS",
	"BETTER_AUTH_BASE_PATH",
	"DATABASE_HOOK_MODELS",
	"DATABASE_HOOK_OPERATIONS",
	"SESSION_RESOLVED",
	"METADATA_KEY",
	// helpers
	"defineBetterAuthOptions",
	"createAuthError",
	"mergeHookContext",
	"resolveAuthBasePath",
	"normalizeBasePath",
	"getRequestFromContext",
	"resolveContextKind",
	// services & guard
	"BetterAuthService",
	"BetterAuthGuard",
	"BetterAuthHookRegistry",
	"BetterAuthDatabaseHookRegistry",
	// decorators
	"AllowAnonymous",
	"Public",
	"OptionalAuth",
	"Roles",
	"OrgRoles",
	"RequireActiveOrg",
	"UserHasPermission",
	"MemberHasPermission",
	"Session",
	"CurrentUser",
	"InjectBetterAuth",
	"Hook",
	"BeforeHook",
	"AfterHook",
	"DatabaseHook",
	"DatabaseHookMethod",
	"BeforeCreate",
	"AfterCreate",
	"BeforeUpdate",
	"AfterUpdate",
	"BeforeDelete",
	"AfterDelete",
] as const;

describe("barrel exports", () => {
	const exported: Record<string, unknown> = { ...barrel };

	it.each(EXPECTED_VALUE_EXPORTS)("exports %s", (name) => {
		expect(exported[name]).toBeDefined();
	});

	it("MODULE_OPTIONS_TOKEN equals the public options token", () => {
		expect(barrel.MODULE_OPTIONS_TOKEN).toBe(barrel.BETTER_AUTH_MODULE_OPTIONS);
	});

	it("Public is an alias of AllowAnonymous", () => {
		expect(barrel.Public).toBe(barrel.AllowAnonymous);
	});
});
