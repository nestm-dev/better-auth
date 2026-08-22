import { HttpException } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { BetterAuthService, BetterAuthSessionService, type AnyAuth } from "../../src/index.ts";
import type { IncomingHttpHeaders } from "node:http";

const CREATED_AT = new Date("2026-01-01T10:00:00.000Z");
const UPDATED_AT = new Date("2026-01-02T10:00:00.000Z");
const EXPIRES_AT = new Date("2027-01-01T10:00:00.000Z");

function session(id: string, token: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		token,
		userId: "caller-user-id",
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
		expiresAt: EXPIRES_AT,
		ipAddress: "192.0.2.10",
		userAgent: "Test Browser",
		...overrides,
	};
}

function createApi(overrides: Record<string, unknown> = {}) {
	return {
		getSession: vi.fn(
			async (_input: {
				headers: Headers;
				query: { disableCookieCache: boolean; disableRefresh: boolean };
			}) => ({
				session: session("current-id", "current-secret"),
				user: { id: "caller-user-id" },
			}),
		),
		listSessions: vi.fn(async (_input: { headers: Headers }) => [
			session("other-id", "other-secret", { ipAddress: undefined, userAgent: null }),
			session("current-id", "current-secret"),
		]),
		revokeSession: vi.fn(async (_input: { body: { token: string }; headers: Headers }) => ({
			status: true,
		})),
		revokeOtherSessions: vi.fn(async (_input: { headers: Headers }) => ({ status: true })),
		revokeSessions: vi.fn(async (_input: { headers: Headers }) => ({ status: true })),
		...overrides,
	};
}

function createService(api = createApi()) {
	const auth = {
		handler: async (_request: Request) => new Response(),
		api,
		options: {},
		$context: Promise.resolve({}),
		$Infer: { Session: {} },
		$ERROR_CODES: {},
	} satisfies AnyAuth;
	return { api, service: new BetterAuthSessionService(new BetterAuthService(auth)) };
}

describe("BetterAuthSessionService", () => {
	it("returns token-free summaries and marks the authoritative current session", async () => {
		const { api, service } = createService();
		const nodeHeaders: IncomingHttpHeaders = {
			authorization: "Bearer current-secret",
			"x-forwarded-for": ["192.0.2.10", "192.0.2.11"],
		};

		const result = await service.list(nodeHeaders);

		expect(result).toEqual([
			{
				id: "other-id",
				createdAt: CREATED_AT,
				updatedAt: UPDATED_AT,
				expiresAt: EXPIRES_AT,
				ipAddress: null,
				userAgent: null,
				current: false,
			},
			{
				id: "current-id",
				createdAt: CREATED_AT,
				updatedAt: UPDATED_AT,
				expiresAt: EXPIRES_AT,
				ipAddress: "192.0.2.10",
				userAgent: "Test Browser",
				current: true,
			},
		]);
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("token");
		expect(serialized).not.toContain("userId");
		expect(serialized).not.toContain("current-secret");
		expect(serialized).not.toContain("other-secret");

		const currentCall = api.getSession.mock.calls[0]?.[0];
		expect(currentCall?.headers).toBeInstanceOf(Headers);
		expect(currentCall?.headers.get("authorization")).toBe("Bearer current-secret");
		expect(currentCall?.headers.get("x-forwarded-for")).toBe("192.0.2.10, 192.0.2.11");
		expect(currentCall?.query).toEqual({ disableCookieCache: true, disableRefresh: true });
	});

	it("uses a caller-owned token internally when revoking by safe id", async () => {
		const { api, service } = createService();

		const result = await service.revokeById(new Headers({ cookie: "session=caller" }), "other-id");

		expect(api.revokeSession).toHaveBeenCalledWith({
			body: { token: "other-secret" },
			headers: expect.any(Headers),
		});
		expect(result).toEqual({
			status: true,
			revokedSessionId: "other-id",
			revokedCurrentSession: false,
		});
		expect(JSON.stringify(result)).not.toContain("other-secret");
	});

	it("reports when the revoked id belongs to the current session", async () => {
		const { service } = createService();

		await expect(service.revokeById({}, "current-id")).resolves.toEqual({
			status: true,
			revokedSessionId: "current-id",
			revokedCurrentSession: true,
		});
	});

	it.each(["unknown-id", "foreign-id"])(
		"uses the same not-found response for an absent or unowned id (%s)",
		async (sessionId) => {
			const { api, service } = createService();

			const promise = service.revokeById({}, sessionId);

			await expect(promise).rejects.toMatchObject({
				status: 404,
				response: {
					statusCode: 404,
					code: "SESSION_NOT_FOUND",
					message: "Session not found.",
				},
			});
			expect(api.revokeSession).not.toHaveBeenCalled();
		},
	);

	it("rejects an empty session id before calling Better Auth", async () => {
		const { api, service } = createService();

		await expect(service.revokeById({}, "  ")).rejects.toMatchObject({
			status: 400,
			response: {
				statusCode: 400,
				code: "INVALID_SESSION_ID",
				message: "Session id must be a non-empty string.",
			},
		});
		expect(api.getSession).not.toHaveBeenCalled();
	});

	it("maps Better Auth errors through the shared invocation boundary", async () => {
		const { service } = createService(
			createApi({
				listSessions: vi.fn(async () => {
					throw new APIError("FORBIDDEN", {
						code: "SESSION_NOT_FRESH",
						message: "A fresh session is required.",
						cause: new Error("private details"),
					});
				}),
			}),
		);

		const error = await service.list({}).catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(HttpException);
		if (!(error instanceof HttpException)) throw error;
		expect(error.getResponse()).toEqual({
			statusCode: 403,
			code: "SESSION_NOT_FRESH",
			message: "A fresh session is required.",
		});
	});

	it("maps an absent authoritative current session to a stable unauthorized error", async () => {
		const api = createApi({ getSession: vi.fn(async () => null) });
		const { service } = createService(api);

		await expect(service.list({})).rejects.toMatchObject({
			status: 401,
			response: {
				statusCode: 401,
				code: "UNAUTHORIZED",
				message: "Unauthorized.",
			},
		});
		expect(api.listSessions).not.toHaveBeenCalled();
	});

	it("delegates bulk revocations without exposing Better Auth payloads", async () => {
		const { api, service } = createService();

		await expect(service.revokeOthers({ authorization: "Bearer caller" })).resolves.toEqual({
			status: true,
		});
		await expect(service.revokeAll({ authorization: "Bearer caller" })).resolves.toEqual({
			status: true,
		});
		expect(api.revokeOtherSessions).toHaveBeenCalledOnce();
		expect(api.revokeSessions).toHaveBeenCalledOnce();
	});
});
