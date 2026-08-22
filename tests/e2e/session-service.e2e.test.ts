import {
	Controller,
	Get,
	Headers as RequestHeaders,
	HttpCode,
	HttpStatus,
	Param,
	Post,
} from "@nestjs/common";
import { betterAuth } from "better-auth";
import { bearer as bearerPlugin } from "better-auth/plugins";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import {
	BetterAuthModule,
	BetterAuthSessionManagementRoutePolicy,
	BetterAuthSessionService,
} from "../../src/index.ts";
import { bearer, signUpUser, type SignedUpUser } from "../shared/auth-client.ts";
import { createTestApp } from "../shared/test-app.ts";
import { TEST_BASE_URL, TEST_SECRET } from "../shared/test-auth.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";
import type { IncomingHttpHeaders } from "node:http";

const auth = betterAuth({
	baseURL: TEST_BASE_URL,
	secret: TEST_SECRET,
	emailAndPassword: { enabled: true },
	telemetry: { enabled: false },
	plugins: [bearerPlugin()],
});

@Controller("account/sessions")
class SessionFacadeController {
	constructor(private readonly sessions: BetterAuthSessionService<typeof auth>) {}

	@Get()
	list(@RequestHeaders() headers: IncomingHttpHeaders) {
		return this.sessions.list(headers);
	}

	@Post("revoke-others")
	@HttpCode(HttpStatus.OK)
	revokeOthers(@RequestHeaders() headers: IncomingHttpHeaders) {
		return this.sessions.revokeOthers(headers);
	}

	@Post("revoke-all")
	@HttpCode(HttpStatus.OK)
	revokeAll(@RequestHeaders() headers: IncomingHttpHeaders) {
		return this.sessions.revokeAll(headers);
	}

	@Post(":sessionId/revoke")
	@HttpCode(HttpStatus.OK)
	revokeById(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("sessionId") sessionId: string,
	) {
		return this.sessions.revokeById(headers, sessionId);
	}
}

async function signInAgain(app: INestApplication, user: SignedUpUser): Promise<string> {
	const response = await request(app.getHttpServer())
		.post("/api/auth/sign-in/email")
		.send({ email: user.email, password: user.password });
	if (response.status !== 200 || typeof response.body?.token !== "string") {
		throw new Error(`sign-in/email failed: ${response.status} ${JSON.stringify(response.body)}`);
	}
	return response.body.token;
}

async function sessionForToken(app: INestApplication, token: string): Promise<unknown> {
	const response = await request(app.getHttpServer())
		.get("/api/auth/get-session")
		.set(bearer(token));
	if (response.status !== 200) {
		throw new Error(`get-session failed: ${response.status} ${JSON.stringify(response.body)}`);
	}
	return response.body;
}

describe(`BetterAuthSessionService (${testHttpAdapter})`, () => {
	let app: INestApplication;

	beforeAll(async () => {
		app = await createTestApp({
			forRoot: { auth },
			metadata: {
				controllers: [SessionFacadeController],
				imports: [
					BetterAuthModule.forFeature({
						routePolicies: [BetterAuthSessionManagementRoutePolicy],
					}),
				],
			},
		});
	});

	afterAll(async () => {
		await app.close();
	});

	it("lists safe summaries and identifies the requesting session without exposing tokens", async () => {
		const user = await signUpUser(app);
		const currentToken = await signInAgain(app, user);

		const response = await request(app.getHttpServer())
			.get("/account/sessions")
			.set(bearer(currentToken));

		expect(response.status).toBe(200);
		expect(response.body).toHaveLength(2);
		expect(response.body.filter((entry: { current: boolean }) => entry.current)).toHaveLength(1);
		for (const summary of response.body) {
			expect(summary).toEqual({
				id: expect.any(String),
				createdAt: expect.any(String),
				updatedAt: expect.any(String),
				expiresAt: expect.any(String),
				ipAddress: expect.toBeOneOf([expect.any(String), null]),
				userAgent: expect.toBeOneOf([expect.any(String), null]),
				current: expect.any(Boolean),
			});
		}
		const serialized = JSON.stringify(response.body);
		expect(serialized).not.toContain("token");
		expect(serialized).not.toContain("userId");
		expect(serialized).not.toContain(user.token);
		expect(serialized).not.toContain(currentToken);
	});

	it("revokes a caller-owned session by id while preserving the current session", async () => {
		const user = await signUpUser(app);
		const currentToken = await signInAgain(app, user);
		const listed = await request(app.getHttpServer())
			.get("/account/sessions")
			.set(bearer(currentToken));
		const other = listed.body.find((entry: { current: boolean }) => !entry.current);

		const revoked = await request(app.getHttpServer())
			.post(`/account/sessions/${other.id}/revoke`)
			.set(bearer(currentToken));

		expect(revoked.status).toBe(200);
		expect(revoked.body).toEqual({
			status: true,
			revokedSessionId: other.id,
			revokedCurrentSession: false,
		});
		expect(JSON.stringify(revoked.body)).not.toContain(user.token);
		expect(await sessionForToken(app, user.token)).toBeNull();
		expect(await sessionForToken(app, currentToken)).toMatchObject({
			session: { id: expect.any(String) },
		});
	});

	it("does not reveal or revoke another user's session by id", async () => {
		const caller = await signUpUser(app);
		const otherUser = await signUpUser(app);
		const otherList = await request(app.getHttpServer())
			.get("/account/sessions")
			.set(bearer(otherUser.token));
		const foreignSessionId: string = otherList.body[0].id;

		const response = await request(app.getHttpServer())
			.post(`/account/sessions/${foreignSessionId}/revoke`)
			.set(bearer(caller.token));

		expect(response.status).toBe(404);
		expect(response.body).toEqual({
			statusCode: 404,
			code: "SESSION_NOT_FOUND",
			message: "Session not found.",
		});
		expect(await sessionForToken(app, otherUser.token)).toMatchObject({
			session: { id: foreignSessionId },
		});
	});

	it("revokes other sessions and then the current session through bulk operations", async () => {
		const user = await signUpUser(app);
		const secondToken = await signInAgain(app, user);
		const currentToken = await signInAgain(app, user);

		const others = await request(app.getHttpServer())
			.post("/account/sessions/revoke-others")
			.set(bearer(currentToken));

		expect(others.status).toBe(200);
		expect(others.body).toEqual({ status: true });
		expect(await sessionForToken(app, user.token)).toBeNull();
		expect(await sessionForToken(app, secondToken)).toBeNull();
		expect(await sessionForToken(app, currentToken)).not.toBeNull();

		const all = await request(app.getHttpServer())
			.post("/account/sessions/revoke-all")
			.set(bearer(currentToken));

		expect(all.status).toBe(200);
		expect(all.body).toEqual({ status: true });
		expect(await sessionForToken(app, currentToken)).toBeNull();
	});

	it("blocks Better Auth's raw token-bearing routes while keeping the server facade usable", async () => {
		const user = await signUpUser(app);

		const rawList = await request(app.getHttpServer())
			.get("/api/auth/list-sessions")
			.set(bearer(user.token));
		const rawRevoke = await request(app.getHttpServer())
			.post("/api/auth/revoke-session")
			.set(bearer(user.token))
			.send({ token: user.token });
		const facadeList = await request(app.getHttpServer())
			.get("/account/sessions")
			.set(bearer(user.token));

		for (const response of [rawList, rawRevoke]) {
			expect(response.status).toBe(403);
			expect(response.body).toEqual({
				statusCode: 403,
				code: "SESSION_MANAGEMENT_FACADE_REQUIRED",
				message: "Use the application's session-management endpoints.",
			});
		}
		expect(facadeList.status).toBe(200);
		expect(facadeList.body).toHaveLength(1);
		expect(JSON.stringify(facadeList.body)).not.toContain(user.token);
	});
});
