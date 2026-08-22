import { Controller, Get, Headers as RequestHeaders, Post } from "@nestjs/common";
import { betterAuth } from "better-auth";
import { bearer as bearerPlugin, organization } from "better-auth/plugins";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { BetterAuthService } from "../../src/index.ts";
import { signUpUser, bearer } from "../shared/auth-client.ts";
import { createTestApp } from "../shared/test-app.ts";
import { TEST_BASE_URL, TEST_SECRET } from "../shared/test-auth.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";
import type { IncomingHttpHeaders } from "node:http";

const auth = betterAuth({
	baseURL: TEST_BASE_URL,
	secret: TEST_SECRET,
	emailAndPassword: { enabled: true },
	telemetry: { enabled: false },
	plugins: [bearerPlugin(), organization()],
});

@Controller("auth-facade")
class AuthFacadeController {
	constructor(private readonly authService: BetterAuthService<typeof auth>) {}

	@Get("session")
	getSession(@RequestHeaders() requestHeaders: IncomingHttpHeaders) {
		return this.authService.invokeApi(requestHeaders, (api, headers) =>
			api.getSession({ headers }),
		);
	}

	@Post("missing-invitation")
	acceptMissingInvitation(@RequestHeaders() requestHeaders: IncomingHttpHeaders) {
		return this.authService.invokeApi(requestHeaders, (api, headers) =>
			api.acceptInvitation({
				body: { invitationId: "missing-invitation" },
				headers,
			}),
		);
	}
}

describe(`BetterAuthService.invokeApi (${testHttpAdapter})`, () => {
	let app: INestApplication;
	let token: string;

	beforeAll(async () => {
		app = await createTestApp({
			forRoot: { auth },
			metadata: { controllers: [AuthFacadeController] },
		});
		token = (await signUpUser(app)).token;
	});

	afterAll(async () => {
		await app.close();
	});

	it("authenticates a server API call with normalized request headers", async () => {
		const response = await request(app.getHttpServer())
			.get("/auth-facade/session")
			.set(bearer(token));

		expect(response.status).toBe(200);
		expect(response.body.session.token).toBe(token);
	});

	it("returns a stable Nest error for a Better Auth API failure", async () => {
		const response = await request(app.getHttpServer())
			.post("/auth-facade/missing-invitation")
			.set(bearer(token));

		expect(response.status).toBe(400);
		expect(response.body).toMatchObject({
			statusCode: 400,
			code: "INVITATION_NOT_FOUND",
		});
		expect(response.body.message).toEqual(expect.any(String));
	});
});
