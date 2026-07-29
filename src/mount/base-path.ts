import type { AnyAuth } from "../types/auth.types.ts";

export function normalizeBasePath(path: string): string {
	let normalized = path.trim();
	if (!normalized.startsWith("/")) normalized = `/${normalized}`;
	normalized = normalized.replace(/\/+$/, "");
	return normalized === "" ? "/" : normalized;
}

function pathFromUrl(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		const pathname = new URL(url).pathname.replace(/\/+$/, "");
		if (pathname && pathname !== "/") return pathname;
	} catch {
		// not an absolute URL — ignore
	}
	return undefined;
}

/**
 * Resolves the path the better-auth handler must be mounted at, mirroring
 * better-auth's own precedence: an explicit override wins, then a path
 * embedded in `baseURL` (string or `{ fallback }`), then — only when no
 * `baseURL` is configured — `BETTER_AUTH_URL`, then `basePath`, then
 * `/api/auth`. A `baseURL` that carries a path silently overrides `basePath`
 * upstream, so it must do the same here.
 */
export function resolveAuthBasePath(auth: AnyAuth, override?: string): string {
	if (override) return normalizeBasePath(override);
	const options = (auth?.options ?? {}) as {
		baseURL?: string | { fallback?: string };
		basePath?: string;
	};
	const configuredBaseUrl =
		typeof options.baseURL === "string" ? options.baseURL : options.baseURL?.fallback;
	// better-auth only consults the env var when no baseURL is configured.
	const effectiveBaseUrl = configuredBaseUrl ?? process.env.BETTER_AUTH_URL;
	const path = pathFromUrl(effectiveBaseUrl);
	if (path) return normalizeBasePath(path);
	return normalizeBasePath(options.basePath?.trim() ? options.basePath : "/api/auth");
}
