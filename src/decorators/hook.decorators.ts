import { DiscoveryService, Reflector } from "@nestjs/core";
import { METADATA_KEY } from "../better-auth.constants.ts";
import type { AuthHookContext } from "../types/auth.types.ts";

export interface HookClassOptions {
	/** Base ordering for all hook methods of this class (lower runs first). */
	order?: number;
}

/**
 * Marks a provider class as a better-auth hook container. Its methods
 * decorated with `@BeforeHook`/`@AfterHook` are discovered at bootstrap and
 * wired into the auth instance. Must be singleton-scoped.
 */
export const Hook = DiscoveryService.createDecorator<HookClassOptions | undefined>();

export type HookPathMatcher =
	| string
	| readonly string[]
	| RegExp
	| ((ctx: AuthHookContext) => boolean);

export interface HookMethodOptions {
	/**
	 * Which endpoint paths this hook applies to. A string is an exact match
	 * (`'/sign-up/email'`) unless it ends with `/*` (prefix match,
	 * `'/organization/*'`). Omit to match every endpoint.
	 */
	path?: HookPathMatcher;
	/** Lower runs first; defaults to `0`, ties keep registration order. */
	order?: number;
}

type HookMethodInput = HookPathMatcher | HookMethodOptions | undefined;

function isOptionsObject(input: HookMethodInput): input is HookMethodOptions {
	return (
		typeof input === "object" &&
		input !== null &&
		!Array.isArray(input) &&
		!(input instanceof RegExp)
	);
}

function normalizeHookOptions(input: HookMethodInput): HookMethodOptions {
	if (input === undefined) return {};
	if (isOptionsObject(input)) return input;
	return { path: input };
}

/** Runs before matching better-auth endpoints. See better-auth's hooks docs for the return protocol. */
export const BeforeHook = Reflector.createDecorator<HookMethodInput, HookMethodOptions>({
	key: METADATA_KEY.beforeHook,
	transform: normalizeHookOptions,
});

/** Runs after matching better-auth endpoints. */
export const AfterHook = Reflector.createDecorator<HookMethodInput, HookMethodOptions>({
	key: METADATA_KEY.afterHook,
	transform: normalizeHookOptions,
});
