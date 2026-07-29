import type { HookPathMatcher } from "../decorators/hook.decorators.ts";
import type { AuthHookContext } from "../types/auth.types.ts";

export type CompiledHookMatcher = (ctx: AuthHookContext) => boolean;

function compileStringPattern(pattern: string): (path: string) => boolean {
	if (pattern.endsWith("/*")) {
		const base = pattern.slice(0, -2);
		const prefix = `${base}/`;
		return (path) => path === base || path.startsWith(prefix);
	}
	return (path) => path === pattern;
}

/**
 * Compiles a hook `path` option into a predicate over the hook context.
 * Strings are exact matches, `'/x/*'` is a prefix match, arrays are unions,
 * RegExps test `ctx.path`, functions are used as-is.
 */
export function compileHookMatcher(path?: HookPathMatcher): CompiledHookMatcher {
	if (path === undefined) return () => true;
	if (typeof path === "function") return path;
	if (path instanceof RegExp) return (ctx) => path.test(ctx.path);
	const patterns = (Array.isArray(path) ? path : [path]).map((p) =>
		compileStringPattern(p as string),
	);
	return (ctx) => patterns.some((matches) => matches(ctx.path));
}
