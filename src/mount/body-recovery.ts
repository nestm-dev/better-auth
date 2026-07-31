import type { IncomingMessage } from "node:http";
import type { AdapterRequest } from "./request-utils.ts";

interface RecoverableRequest extends IncomingMessage {
	body?: unknown;
	rawBody?: unknown;
}

export interface RecoveredBody {
	/** Body parsed by the framework adapter before better-auth recovery. */
	body: unknown;
	/** Byte-exact body captured by Nest's `{ rawBody: true }` mode. */
	rawBody: Uint8Array | undefined;
}

function parsePolicyBody(rawBody: Uint8Array, contentType: string | undefined): unknown {
	const body = Buffer.from(rawBody).toString("utf8");
	if (body === "") return undefined;
	const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
	if (mediaType === "application/json" || mediaType?.endsWith("+json")) {
		try {
			return JSON.parse(body);
		} catch {
			return undefined;
		}
	}
	if (mediaType === "application/x-www-form-urlencoded") {
		return Object.fromEntries(new URLSearchParams(body));
	}
	return undefined;
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
export function recoverBody(frameworkReq: AdapterRequest, nodeReq: IncomingMessage): RecoveredBody {
	const target = nodeReq as RecoverableRequest;
	const body = frameworkReq?.body ?? target.body;
	const capturedRawBody = frameworkReq?.rawBody ?? target.rawBody;
	const rawBody = Buffer.isBuffer(capturedRawBody) ? capturedRawBody : undefined;

	if (target.readable && !target.readableEnded) {
		return { body, rawBody };
	}

	if (Buffer.isBuffer(rawBody)) {
		target.body = rawBody.toString("utf8");
		return { body, rawBody };
	}
	if (target.body === undefined && frameworkReq?.body !== undefined) {
		target.body = frameworkReq.body;
	}
	return { body, rawBody };
}

/**
 * Route policies need body data before the auth handler runs. Fastify raw
 * middleware executes before its content-type parser, so when no parsed or
 * captured body exists yet this consumes the untouched stream, installs the
 * same string fallback better-call already understands, and exposes a
 * conservative JSON/form parse to the policy.
 */
export async function recoverBodyForPolicy(
	frameworkReq: AdapterRequest,
	nodeReq: IncomingMessage,
): Promise<RecoveredBody> {
	const recovered = recoverBody(frameworkReq, nodeReq);
	if (recovered.body !== undefined) return recovered;
	if (recovered.rawBody !== undefined) {
		return {
			body: parsePolicyBody(recovered.rawBody, nodeReq.headers["content-type"]),
			rawBody: recovered.rawBody,
		};
	}
	if (!nodeReq.readable || nodeReq.readableEnded) return recovered;

	const chunks: Buffer[] = [];
	for await (const chunk of nodeReq) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const rawBody = Buffer.concat(chunks);
	(nodeReq as RecoverableRequest).body = rawBody.toString("utf8");
	return {
		body: parsePolicyBody(rawBody, nodeReq.headers["content-type"]),
		rawBody,
	};
}
