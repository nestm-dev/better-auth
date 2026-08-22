import { HttpException } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import {
	BetterAuthService,
	mapBetterAuthApiError,
	normalizeBetterAuthHeaders,
	type AnyAuth,
} from "../../src/index.ts";
import type { IncomingHttpHeaders } from "node:http";

function createAuth<TApi extends Record<string, unknown>>(api: TApi) {
	return {
		handler: async (_request: Request) => new Response(),
		api,
		options: {},
		$context: Promise.resolve({}),
		$Infer: { Session: {} },
		$ERROR_CODES: {},
	} satisfies AnyAuth;
}

describe("normalizeBetterAuthHeaders", () => {
	it("converts Node headers without dropping repeated values", () => {
		const source: IncomingHttpHeaders = {
			cookie: "session=abc",
			"x-forwarded-for": ["192.0.2.1", "192.0.2.2"],
		};

		const headers = normalizeBetterAuthHeaders(source);

		expect(headers).toBeInstanceOf(Headers);
		expect(headers.get("cookie")).toBe("session=abc");
		expect(headers.get("x-forwarded-for")).toBe("192.0.2.1, 192.0.2.2");
	});

	it("copies an existing Web Headers object", () => {
		const source = new Headers({ authorization: "Bearer token" });

		const headers = normalizeBetterAuthHeaders(source);
		source.set("authorization", "Bearer changed");

		expect(headers).not.toBe(source);
		expect(headers.get("authorization")).toBe("Bearer token");
	});
});

describe("mapBetterAuthApiError", () => {
	it("preserves status, code, and message but strips arbitrary error body fields", () => {
		const error = new APIError("FORBIDDEN", {
			code: "MEMBER_ACCESS_DENIED",
			message: "Member access denied.",
			cause: new Error("database details"),
			internal: "not-for-the-response",
		});

		const mapped = mapBetterAuthApiError(error);

		expect(mapped).toBeInstanceOf(HttpException);
		expect(mapped?.getStatus()).toBe(403);
		expect(mapped?.getResponse()).toEqual({
			statusCode: 403,
			code: "MEMBER_ACCESS_DENIED",
			message: "Member access denied.",
		});
		expect(mapped?.cause).toBe(error);
	});

	it("uses the Better Auth status name when the body has no code", () => {
		const mapped = mapBetterAuthApiError(new APIError("UNAUTHORIZED", { message: "Sign in." }));

		expect(mapped?.getResponse()).toEqual({
			statusCode: 401,
			code: "UNAUTHORIZED",
			message: "Sign in.",
		});
	});

	it("does not reinterpret application errors", () => {
		expect(mapBetterAuthApiError(new Error("application failure"))).toBeUndefined();
	});
});

describe("BetterAuthService.invokeApi", () => {
	it("passes plugin API and normalized headers to the operation", async () => {
		const inspect = vi.fn((headers: Headers) => headers.get("authorization"));
		const auth = createAuth({ inspect });
		const service = new BetterAuthService(auth);

		const result = await service.invokeApi({ authorization: "Bearer caller" }, (api, headers) =>
			api.inspect(headers),
		);

		expect(result).toBe("Bearer caller");
		expect(inspect).toHaveBeenCalledOnce();
	});

	it("maps Better Auth API errors thrown asynchronously", async () => {
		const service = new BetterAuthService(createAuth({}));

		const promise = service.invokeApi({}, async () => {
			throw new APIError("CONFLICT", {
				code: "INVITATION_ALREADY_EXISTS",
				message: "Invitation already exists.",
			});
		});

		await expect(promise).rejects.toMatchObject({
			status: 409,
			response: {
				statusCode: 409,
				code: "INVITATION_ALREADY_EXISTS",
				message: "Invitation already exists.",
			},
		});
	});

	it("rethrows non-Better-Auth failures unchanged", async () => {
		const service = new BetterAuthService(createAuth({}));
		const failure = new Error("audit store unavailable");

		const promise = service.invokeApi({}, () => {
			throw failure;
		});

		await expect(promise).rejects.toBe(failure);
	});
});
