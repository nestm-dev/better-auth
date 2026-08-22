import type { BetterAuthOptions } from "better-auth";
import type { AnyAuth } from "../types/auth.types.ts";
import type { BetterAuthRoutePolicy } from "../policies/route-policy.ts";
import type { BetterAuthControlPlaneLifecycleCoordinator } from "./better-auth-control-plane-lifecycle.interface.ts";
import type { BetterAuthOrganizationLifecycleCoordinator } from "./better-auth-organization-lifecycle.interface.ts";

/**
 * CORS configuration for the mounted better-auth routes. When omitted,
 * `origin` is derived from the auth instance's `trustedOrigins` (array form
 * only). Pass `false` to disable CORS handling entirely.
 */
export interface BetterAuthCorsOptions {
	/** Allowed origins; supports `*` wildcards (e.g. `https://*.example.com`). */
	origin?: readonly string[];
	/** Defaults to `true`. */
	credentials?: boolean;
	/** Defaults to `GET, POST, PUT, DELETE`. */
	methods?: readonly string[];
	/** Defaults to echoing `Access-Control-Request-Headers`. */
	allowedHeaders?: readonly string[];
	/** `Access-Control-Max-Age` in seconds. */
	maxAge?: number;
}

/**
 * Wrapper invoked around the better-auth handler for every auth request.
 * Escape hatch for request-context libraries (MikroORM `RequestContext`,
 * AsyncLocalStorage setups, ...). Call `run()` to execute the handler.
 */
export type BetterAuthRequestMiddleware = (
	request: unknown,
	response: unknown,
	run: () => Promise<void>,
) => unknown;

/** Metadata owned by another guard that {@link BetterAuthGuard} should honor. */
export interface BetterAuthInteropOptions {
	/**
	 * Foreign `@Public()`-equivalent metadata keys. Their presence skips session
	 * resolution, subject to the same handler-level authorization override as
	 * {@link AllowAnonymous}.
	 */
	readonly publicKeys?: readonly (string | symbol)[];
}

interface BetterAuthModuleCommonOptions {
	/**
	 * Overrides the mount path. When omitted it is resolved from the auth
	 * config the same way better-auth itself does: a path inside `baseURL`
	 * wins over `basePath`, then `/api/auth`.
	 */
	basePath?: string;
	cors?: false | BetterAuthCorsOptions;
	middleware?: BetterAuthRequestMiddleware;
	routePolicy?: BetterAuthRoutePolicy;
	/** Maximum bytes buffered from an untouched stream for route-policy body inspection. Default 1 MiB. */
	routePolicyBodyLimit?: number;
	interop?: BetterAuthInteropOptions;
	/**
	 * Optional, shared serialization boundary for organization and user
	 * control-plane mutations. Prefer this over the legacy organization-only
	 * coordinator when more than one control-plane service is enabled.
	 */
	controlPlaneLifecycle?: BetterAuthControlPlaneLifecycleCoordinator;
	/**
	 * Optional serialization boundary for organization membership and invitation
	 * mutations made through `BetterAuthOrganizationService`.
	 *
	 * @deprecated Prefer `controlPlaneLifecycle`, which uses one transaction
	 * context for every Better Auth control-plane service.
	 */
	organizationLifecycle?: BetterAuthOrganizationLifecycleCoordinator;
}

/**
 * Instance mode: pass a pre-built `betterAuth()` instance. Best plugin type
 * inference (`typeof auth`) and cheapest for the compiler.
 */
export interface BetterAuthInstanceModeOptions<
	TAuth extends AnyAuth = AnyAuth,
> extends BetterAuthModuleCommonOptions {
	auth: TAuth;
	options?: never;
}

/**
 * Options mode: pass raw `BetterAuthOptions` and the module calls
 * `betterAuth()` itself. Enables fully DI-driven configuration via
 * `forRootAsync`, and `hooks`/`databaseHooks` are pre-seeded so decorator
 * hooks always work.
 */
export interface BetterAuthOptionsModeOptions<
	TOptions extends BetterAuthOptions = BetterAuthOptions,
> extends BetterAuthModuleCommonOptions {
	auth?: never;
	options: TOptions;
}

export type BetterAuthModuleOptions = BetterAuthInstanceModeOptions | BetterAuthOptionsModeOptions;

/** Extras — shape the module graph and are never injected at runtime. */
export interface BetterAuthModuleExtras {
	/** Register the module globally. Defaults to `true`. */
	isGlobal?: boolean;
	/** Skip the automatic `APP_GUARD` registration of `BetterAuthGuard`. Defaults to `false`. */
	disableGlobalGuard?: boolean;
}
