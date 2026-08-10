import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_ROUTE_POLICY_BODY_LIMIT,
	recoverBodyForPolicy,
	resolveRoutePolicyBodyLimit,
	RoutePolicyBodyTooLargeError,
} from "../../src/mount/body-recovery.ts";

function requestStream(chunks: readonly Buffer[], contentType = "application/octet-stream") {
	const stream = Object.assign(Readable.from(chunks), {
		headers: { "content-type": contentType },
	});
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal IncomingMessage stream fixture
	return stream as IncomingMessage;
}

describe("route-policy body recovery", () => {
	it("uses a bounded default and validates configured limits", () => {
		expect(resolveRoutePolicyBodyLimit(undefined)).toBe(DEFAULT_ROUTE_POLICY_BODY_LIMIT);
		expect(resolveRoutePolicyBodyLimit(64)).toBe(64);
		for (const invalid of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => resolveRoutePolicyBodyLimit(invalid)).toThrow(/positive safe integer/);
		}
	});

	it("stops buffering a chunked stream after the configured limit", async () => {
		const nodeRequest = requestStream([Buffer.alloc(8), Buffer.alloc(8)]);
		await expect(recoverBodyForPolicy({}, nodeRequest, 10)).rejects.toEqual(
			new RoutePolicyBodyTooLargeError(10),
		);
	});

	it("accepts and parses a stream exactly at the configured limit", async () => {
		const body = Buffer.from('{"a":1}');
		const nodeRequest = requestStream([body], "application/json");
		const recovered = await recoverBodyForPolicy({}, nodeRequest, body.byteLength);
		expect(recovered.body).toEqual({ a: 1 });
		expect(recovered.rawBody).toEqual(body);
	});
});
