import type { IncomingMessage } from "node:http";
import type { AdapterRequest } from "./request-utils.ts";

interface RecoverableRequest extends IncomingMessage {
	body?: unknown;
	rawBody?: unknown;
}

/**
 * better-auth reads the request body from the raw Node stream. When a body
 * parser already consumed it, better-call (>=1.3.5, pinned by better-auth
 * >=1.6) falls back to `req.body`. Three tiers:
 *
 * 1. stream untouched — nothing to do;
 * 2. `rawBody` buffer present (Nest's `{ rawBody: true }`) — byte-exact;
 * 3. re-serialize the parsed `body` (flat JSON round-trips losslessly).
 */
export function recoverBody(frameworkReq: AdapterRequest, nodeReq: IncomingMessage): void {
	const target = nodeReq as RecoverableRequest;
	if (target.readable && target.readableEnded !== true) return;

	const rawBody = frameworkReq?.rawBody ?? target.rawBody;
	if (Buffer.isBuffer(rawBody)) {
		target.body = rawBody.toString("utf8");
		return;
	}
	if (target.body === undefined && frameworkReq?.body !== undefined) {
		target.body = frameworkReq.body;
	}
}
