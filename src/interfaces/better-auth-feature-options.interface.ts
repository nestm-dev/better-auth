import type { Type } from "@nestjs/common";

export interface BetterAuthFeatureOptions {
	/**
	 * `@Hook()` / `@DatabaseHook()` classes to register as providers. Note that
	 * hook classes are discovered container-wide, so a class listed in any
	 * module's `providers` array works identically — `forFeature` is
	 * convenience. Hook classes that inject feature-local (non-global)
	 * providers should be listed in that feature module's own `providers`
	 * instead, so their dependencies resolve.
	 */
	hooks?: Type<unknown>[];
}
