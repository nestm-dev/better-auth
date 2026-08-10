/**
 * Adapter-independent request information supplied to HTTP route policies.
 *
 * `url` is the original request target (including its query string),
 * `pathname` is the full application pathname, and `authPath` is relative to
 * the resolved better-auth mount path. `rawBody` is byte-exact when Nest was
 * bootstrapped with `{ rawBody: true }` or the adapter stream is still
 * untouched; it is otherwise `undefined`.
 */
export interface BetterAuthRoutePolicyContext {
	/** Uppercase HTTP method (`GET`, `POST`, ...). */
	readonly method: string;
	/** Original request target, including its query string. */
	readonly url: string;
	/** Full request pathname, without the query string. */
	readonly pathname: string;
	/** Path relative to the better-auth mount, always beginning with `/`. */
	readonly authPath: string;
	/** Request headers normalized to the Web `Headers` API. */
	readonly headers: Headers;
	/** Body parsed by the active Nest HTTP adapter, when available. */
	readonly body: unknown;
	/** Byte-exact request body when it is still recoverable. */
	readonly rawBody: Uint8Array | undefined;
}

/** A JSON denial returned by a class-based HTTP route policy. */
export type BetterAuthRoutePolicyHeadersInit = ConstructorParameters<typeof Headers>[0];

export interface BetterAuthRoutePolicyDenial {
	readonly effect: "deny";
	readonly status: number;
	readonly body?: unknown;
	readonly headers?: BetterAuthRoutePolicyHeadersInit;
}

/** Creates a JSON denial for a class-based HTTP route policy. */
export function deny(
	status: number,
	body?: unknown,
	headers?: BetterAuthRoutePolicyHeadersInit,
): BetterAuthRoutePolicyDenial {
	return { effect: "deny", status, body, headers };
}

/** A class-based policy may abstain, return a Web `Response`, or return {@link deny}. */
export type BetterAuthRoutePolicyResult = Response | BetterAuthRoutePolicyDenial | void;

/** Class contract implemented by providers decorated with `@AuthRoutePolicy`. */
export interface BetterAuthRoutePolicyHandler {
	evaluate(
		context: BetterAuthRoutePolicyContext,
	): Promise<BetterAuthRoutePolicyResult> | BetterAuthRoutePolicyResult;
}

/**
 * Functional policy configured through `forRoot({ routePolicy })`.
 * It runs before class-based policies for backward compatibility.
 */
export type BetterAuthRoutePolicy = (
	context: BetterAuthRoutePolicyContext,
) => Promise<Response | void> | Response | void;

export type BetterAuthRoutePolicyPathMatcher =
	string | readonly string[] | RegExp | ((context: BetterAuthRoutePolicyContext) => boolean);

/** Class-level matcher and ordering metadata for `@AuthRoutePolicy`. */
export interface BetterAuthRoutePolicyOptions {
	/**
	 * Auth-relative paths to match. Strings are exact unless they end in `/*`,
	 * which performs a segment-safe prefix match. Omit to match every path.
	 */
	path?: BetterAuthRoutePolicyPathMatcher;
	/** Uppercase or lowercase HTTP methods. Omit to match every method. */
	methods?: string | readonly string[];
	/** Lower values run first; ties preserve discovery order. */
	order?: number;
}
