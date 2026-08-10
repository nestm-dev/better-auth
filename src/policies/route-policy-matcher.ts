import type {
	BetterAuthRoutePolicyContext,
	BetterAuthRoutePolicyOptions,
	BetterAuthRoutePolicyPathMatcher,
} from "./route-policy.ts";

export type CompiledRoutePolicyMatcher = (context: BetterAuthRoutePolicyContext) => boolean;

function compileStringPattern(pattern: string): (path: string) => boolean {
	if (pattern.endsWith("/*")) {
		const base = pattern.slice(0, -2);
		const prefix = `${base}/`;
		return (path) => path === base || path.startsWith(prefix);
	}
	return (path) => path === pattern;
}

function compilePathMatcher(path?: BetterAuthRoutePolicyPathMatcher): CompiledRoutePolicyMatcher {
	if (path === undefined) return () => true;
	if (typeof path === "function") return path;
	if (path instanceof RegExp) {
		return (context) => {
			path.lastIndex = 0;
			try {
				return path.test(context.authPath);
			} finally {
				path.lastIndex = 0;
			}
		};
	}
	const configuredPaths: readonly string[] = typeof path === "string" ? [path] : path;
	if (configuredPaths.length === 0) {
		throw new TypeError("Auth route policy paths cannot be empty.");
	}
	for (const pattern of configuredPaths) {
		if (!pattern.startsWith("/")) {
			throw new TypeError("Auth route policy paths must start with '/'.");
		}
	}
	const patterns = configuredPaths.map(compileStringPattern);
	return (context) => patterns.some((matches) => matches(context.authPath));
}

function compileMethodMatcher(methods?: string | readonly string[]): CompiledRoutePolicyMatcher {
	if (methods === undefined) return () => true;
	const configuredMethods: readonly string[] = typeof methods === "string" ? [methods] : methods;
	if (configuredMethods.length === 0 || configuredMethods.some((method) => method.trim() === "")) {
		throw new TypeError("Auth route policy methods cannot be empty.");
	}
	const allowed = new Set(configuredMethods.map((method) => method.trim().toUpperCase()));
	return (context) => allowed.has("*") || allowed.has(context.method.toUpperCase());
}

/** Compiles path and method metadata into one request predicate. */
export function compileRoutePolicyMatcher(
	options: BetterAuthRoutePolicyOptions = {},
): CompiledRoutePolicyMatcher {
	if (options.order !== undefined && !Number.isFinite(options.order)) {
		throw new TypeError("Auth route policy order must be a finite number.");
	}
	const matchesPath = compilePathMatcher(options.path);
	const matchesMethod = compileMethodMatcher(options.methods);
	return (context) => matchesMethod(context) && matchesPath(context);
}
