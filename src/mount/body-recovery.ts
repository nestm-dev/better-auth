import type { IncomingMessage } from "node:http";
import type { AdapterRequest } from "./request-utils.ts";

interface RecoverableRequest extends IncomingMessage {
	body?: unknown;
	rawBody?: unknown;
}

export interface RecoveredBody {
	/** Body parsed by the framework adapter before better-auth recovery. */
	body: unknown;
	/** Byte-exact body captured by Nest or read from an untouched stream. */
	rawBody: Uint8Array | undefined;
}

/** Matches Fastify's default request body limit. */
export const DEFAULT_ROUTE_POLICY_BODY_LIMIT = 1_048_576;

export class RoutePolicyBodyTooLargeError extends Error {
	constructor(readonly limit: number) {
		super(`Route policy body exceeds the configured limit of ${String(limit)} bytes.`);
		this.name = "RoutePolicyBodyTooLargeError";
	}
}

export function resolveRoutePolicyBodyLimit(configured: number | undefined): number {
	const limit = configured ?? DEFAULT_ROUTE_POLICY_BODY_LIMIT;
	if (!Number.isSafeInteger(limit) || limit <= 0) {
		throw new TypeError("routePolicyBodyLimit must be a positive safe integer.");
	}
	return limit;
}

function assertWithinPolicyBodyLimit(size: number, limit: number): void {
	if (size > limit) throw new RoutePolicyBodyTooLargeError(limit);
}

function declaredContentLength(nodeReq: IncomingMessage): number | undefined {
	const header = nodeReq.headers["content-length"];
	const value = Array.isArray(header) ? header[0] : header;
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
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
	limit = DEFAULT_ROUTE_POLICY_BODY_LIMIT,
): Promise<RecoveredBody> {
	const recovered = recoverBody(frameworkReq, nodeReq);
	if (recovered.body !== undefined) return recovered;
	if (recovered.rawBody !== undefined) {
		assertWithinPolicyBodyLimit(recovered.rawBody.byteLength, limit);
		return {
			body: parsePolicyBody(recovered.rawBody, nodeReq.headers["content-type"]),
			rawBody: recovered.rawBody,
		};
	}
	if (!nodeReq.readable || nodeReq.readableEnded) return recovered;
	const contentLength = declaredContentLength(nodeReq);
	if (contentLength !== undefined && contentLength > limit) {
		nodeReq.resume();
		throw new RoutePolicyBodyTooLargeError(limit);
	}

	const chunks: Buffer[] = [];
	let size = 0;
	let exceeded = false;
	for await (const chunk of nodeReq.iterator({ destroyOnReturn: false })) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > limit) {
			exceeded = true;
			break;
		}
		chunks.push(buffer);
	}
	if (exceeded) {
		nodeReq.resume();
		throw new RoutePolicyBodyTooLargeError(limit);
	}
	const rawBody = Buffer.concat(chunks);
	(nodeReq as RecoverableRequest).body = rawBody.toString("utf8");
	return {
		body: parsePolicyBody(rawBody, nodeReq.headers["content-type"]),
		rawBody,
	};
}
