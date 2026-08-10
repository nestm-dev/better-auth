import type { ModuleMetadata, Type } from "@nestjs/common";
import type { BetterAuthRoutePolicyHandler } from "../policies/route-policy.ts";

export interface BetterAuthFeatureOptions {
	/**
	 * `@Hook()` / `@DatabaseHook()` classes to register as providers. Note that
	 * hook classes are discovered container-wide, so a class listed in any
	 * module's `providers` array works identically — `forFeature` is
	 * convenience.
	 */
	hooks?: Type<unknown>[];
	/**
	 * Singleton `@AuthRoutePolicy()` providers. Policies are also discovered
	 * when listed directly in any module's `providers` array.
	 */
	routePolicies?: Type<BetterAuthRoutePolicyHandler>[];
	/**
	 * Modules whose exported providers the hook or policy classes depend on.
	 * Providers run inside the feature host module, so non-global dependencies
	 * must be imported here (or the class listed in your own module instead).
	 */
	imports?: ModuleMetadata["imports"];
}
