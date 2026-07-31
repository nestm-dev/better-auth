import type { IncomingMessage, ServerResponse } from "node:http";

/** Framework request shape we probe structurally (Express or Fastify). */
// oxlint-disable-next-line typescript/no-explicit-any -- adapter request shapes are untyped by design
export type AdapterRequest = any;
// oxlint-disable-next-line typescript/no-explicit-any
export type AdapterResponse = any;

export function getRequestUrl(req: AdapterRequest): string {
	return req?.originalUrl ?? req?.url ?? req?.raw?.url ?? "";
}

export function getRequestPath(req: AdapterRequest): string {
	const url = getRequestUrl(req);
	const queryIndex = url.indexOf("?");
	return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

export function matchesBasePath(req: AdapterRequest, basePath: string): boolean {
	const path = getRequestPath(req);
	return path === basePath || path.startsWith(`${basePath}/`);
}

/** Unwraps Fastify's `req.raw`; Express requests are already Node requests. */
export function getNodeRequest(req: AdapterRequest): IncomingMessage {
	return (req?.raw ?? req) as IncomingMessage;
}

export function getNodeResponse(res: AdapterResponse): ServerResponse {
	return (res?.raw ?? res) as ServerResponse;
}
