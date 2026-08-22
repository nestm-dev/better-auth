import type { IncomingMessage, ServerResponse } from "node:http";

/** Framework request shape we probe structurally (Express or Fastify). */
// oxlint-disable-next-line typescript/no-explicit-any -- adapter request shapes are untyped by design
export type AdapterRequest = any;
// oxlint-disable-next-line typescript/no-explicit-any
export type AdapterResponse = any;

/** One WHATWG-normalized view of the request target, reused by mount and policies. */
export interface CanonicalRequestTarget {
	/** The original request target, including its query string. */
	readonly url: string;
	/** The WHATWG URL pathname seen by Better Auth's downstream Fetch router. */
	readonly pathname: string;
}

export function getRequestUrl(req: AdapterRequest): string {
	return req?.raw?.url ?? req?.url ?? req?.originalUrl ?? "";
}

/**
 * Apply the same WHATWG URL parsing that the downstream Node-to-Fetch bridge
 * applies before Better Auth routes a request. In particular, encoded dot
 * segments are removed here before any base-path or route-policy decision.
 */
export function canonicalizeRequestTarget(req: AdapterRequest): CanonicalRequestTarget | undefined {
	const url = getRequestUrl(req);
	if (typeof url !== "string" || url.length === 0) return undefined;
	try {
		return {
			url,
			pathname: new URL(`http://better-auth.invalid${url}`).pathname,
		};
	} catch {
		return undefined;
	}
}

export function matchesBasePath(pathname: string, basePath: string): boolean {
	return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

/** Unwraps Fastify's `req.raw`; Express requests are already Node requests. */
export function getNodeRequest(req: AdapterRequest): IncomingMessage {
	return (req?.raw ?? req) as IncomingMessage;
}

export function getNodeResponse(res: AdapterResponse): ServerResponse {
	return (res?.raw ?? res) as ServerResponse;
}
