/**
 * Compile-time assertions (checked by `tsc --noEmit`, no runtime tests).
 * Regression guard for the AnyAuth variance fix: an auth instance with
 * required `user.additionalFields` must satisfy every public generic surface.
 */
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import type { AnyAuth, AuthUser, RegisteredAuth, UserSession } from "../../src/index.ts";
import { BetterAuthService, resolveAuthBasePath } from "../../src/index.ts";
import type { BetterAuthModuleOptions } from "../../src/index.ts";

const strictAuth = betterAuth({
	user: {
		additionalFields: {
			tenantId: { type: "string", required: true },
		},
	},
	plugins: [organization()],
});

// Assignability to the structural supertype and to the options union.
const asAny: AnyAuth = strictAuth;
const asOptions: BetterAuthModuleOptions = { auth: strictAuth };

// Generic surfaces accept the concrete instance type.
type StrictSession = UserSession<typeof strictAuth>;
type StrictUser = AuthUser<typeof strictAuth>;
declare const session: StrictSession;
const tenantId: string = session.user.tenantId;

declare const service: BetterAuthService<typeof strictAuth>;
const api: (typeof strictAuth)["api"] = service.api;

// Un-augmented registry falls back to plain Auth without erroring.
type DefaultSession = UserSession<RegisteredAuth>;
declare const defaultSession: DefaultSession;
const email: string = defaultSession.user.email;

const basePath: string = resolveAuthBasePath(strictAuth);

export { asAny, asOptions, tenantId, api, email, basePath };
export type { StrictSession, StrictUser };
