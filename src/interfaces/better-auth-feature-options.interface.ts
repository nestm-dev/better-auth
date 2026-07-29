import type { ModuleMetadata, Type } from "@nestjs/common";

export interface BetterAuthFeatureOptions {
	/**
	 * `@Hook()` / `@DatabaseHook()` classes to register as providers. Note that
	 * hook classes are discovered container-wide, so a class listed in any
	 * module's `providers` array works identically — `forFeature` is
	 * convenience.
	 */
	hooks?: Type<unknown>[];
	/**
	 * Modules whose exported providers the hook classes depend on. Hooks run
	 * inside the feature host module, so non-global dependencies must be
	 * imported here (or the hook class listed in your own module's
	 * `providers` instead).
	 */
	imports?: ModuleMetadata["imports"];
}
