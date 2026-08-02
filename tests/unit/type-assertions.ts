/**
 * Compile-time assertions (checked by `tsc --noEmit`, no runtime tests).
 * Regression guard for the AnyAuth variance fix: an auth instance with
 * required `user.additionalFields` must satisfy every public generic surface.
 */
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import type {
	AnyAuth,
	AuthUser,
	BetterAuthRequestState,
	RegisteredAuth,
	UserSession,
} from "../../src/index.ts";
import { BetterAuthService, resolveAuthBasePath, SESSION_RESOLVED } from "../../src/index.ts";
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

declare const requestState: BetterAuthRequestState<typeof strictAuth>;
const requestSession: StrictSession | null | undefined = requestState.session;
const requestUser: StrictUser | null | undefined = requestState.user;
const sessionResolved: boolean | undefined = requestState[SESSION_RESOLVED];

// Un-augmented registry falls back to plain Auth without erroring.
type DefaultSession = UserSession<RegisteredAuth>;
declare const defaultSession: DefaultSession;
const email: string = defaultSession.user.email;

const basePath: string = resolveAuthBasePath(strictAuth);

export {
	asAny,
	asOptions,
	tenantId,
	api,
	requestSession,
	requestUser,
	sessionResolved,
	email,
	basePath,
};
export type { StrictSession, StrictUser };
