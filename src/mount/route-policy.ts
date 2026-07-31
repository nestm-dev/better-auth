import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { BetterAuthRoutePolicyContext } from "../interfaces/better-auth-module-options.interface.ts";
import type { AdapterRequest } from "./request-utils.ts";
import { getRequestPath, getRequestUrl } from "./request-utils.ts";
import type { RecoveredBody } from "./body-recovery.ts";

function toWebHeaders(headers: IncomingHttpHeaders): Headers {
	const result = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		if (Array.isArray(value)) {
			for (const entry of value) result.append(name, entry);
		} else if (value !== undefined) {
			result.append(name, value);
		}
	}
	return result;
}

function resolveAuthPath(pathname: string, basePath: string): string {
	const relative = pathname.slice(basePath.length);
	if (relative === "") return "/";
	return relative.startsWith("/") ? relative : `/${relative}`;
}

export function createRoutePolicyContext(
	frameworkReq: AdapterRequest,
	nodeReq: IncomingMessage,
	basePath: string,
	recoveredBody: RecoveredBody,
): BetterAuthRoutePolicyContext {
	const url = getRequestUrl(frameworkReq);
	const pathname = getRequestPath(frameworkReq);
	return {
		method: (nodeReq.method ?? "GET").toUpperCase(),
		url,
		pathname,
		authPath: resolveAuthPath(pathname, basePath),
		headers: toWebHeaders(nodeReq.headers),
		body: recoveredBody.body,
		rawBody: recoveredBody.rawBody,
	};
}

function mergeVaryHeader(response: ServerResponse, value: string): void {
	const existing = response.getHeader("Vary");
	if (!existing) {
		response.setHeader("Vary", value);
		return;
	}
	const values = new Set(
		`${String(existing)},${value}`
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
	response.setHeader("Vary", [...values].join(", "));
}

/**
 * Writes a Web `Response` directly to the raw adapter response while
 * preserving headers already installed by the auth-route CORS layer.
 */
export async function writeRoutePolicyResponse(
	policyResponse: Response,
	nodeResponse: ServerResponse,
	method: string,
): Promise<void> {
	nodeResponse.statusCode = policyResponse.status;
	if (policyResponse.statusText) nodeResponse.statusMessage = policyResponse.statusText;

	for (const [name, value] of policyResponse.headers) {
		if (name === "set-cookie") continue;
		if (name === "vary") {
			mergeVaryHeader(nodeResponse, value);
		} else {
			nodeResponse.setHeader(name, value);
		}
	}

	const cookies = policyResponse.headers.getSetCookie();
	if (cookies.length > 0) nodeResponse.setHeader("Set-Cookie", cookies);

	if (method === "HEAD" || policyResponse.body === null) {
		nodeResponse.end();
		return;
	}

	const body = Buffer.from(await policyResponse.arrayBuffer());
	if (!nodeResponse.hasHeader("Content-Length") && !nodeResponse.hasHeader("Transfer-Encoding")) {
		nodeResponse.setHeader("Content-Length", String(body.byteLength));
	}
	nodeResponse.end(body);
}
