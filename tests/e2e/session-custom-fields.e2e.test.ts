import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { bearer as bearerPlugin, username } from "better-auth/plugins";
import { Controller, Get } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { BetterAuthService, Session, type UserSession } from "../../src/index.ts";
import { TEST_BASE_URL, TEST_SECRET, uniqueUser } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { bearer } from "../shared/auth-client.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

const auth = betterAuth({
	baseURL: TEST_BASE_URL,
	secret: TEST_SECRET,
	emailAndPassword: { enabled: true },
	telemetry: { enabled: false },
	plugins: [bearerPlugin(), username()],
});

@Controller("session-fields")
class SessionFieldsController {
	constructor(private readonly authService: BetterAuthService<typeof auth>) {}

	@Get("me")
	me(@Session() session: UserSession<typeof auth>): { username: string | null | undefined } {
		return { username: session.user.username };
	}

	@Get("via-service")
	async viaService(@Session() session: UserSession<typeof auth>): Promise<{ same: boolean }> {
		const fromApi = await this.authService.api.getSession({
			headers: new Headers(),
		});
		// Different transport, same shape — compile-time check that the service
		// api surface carries plugin fields too.
		void fromApi?.user.username;
		return { same: session.user.username !== undefined };
	}
}

describe(`session custom fields (${testHttpAdapter})`, () => {
	let app: INestApplication;
	let token: string;
	let expectedUsername: string;

	beforeAll(async () => {
		app = await createTestApp({
			forRoot: { auth },
			metadata: { controllers: [SessionFieldsController] },
		});
		const user = uniqueUser();
		expectedUsername = `user${Date.now()}`;
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send({
				email: user.email,
				password: user.password,
				name: user.name,
				username: expectedUsername,
			});
		expect(response.status).toBe(200);
		token = response.body.token;
	});

	afterAll(async () => {
		await app.close();
	});

	it("exposes plugin-added user fields on @Session()", async () => {
		const response = await request(app.getHttpServer())
			.get("/session-fields/me")
			.set(bearer(token));
		expect(response.status).toBe(200);
		expect(response.body.username).toBe(expectedUsername.toLowerCase());
	});

	it("exposes plugin-typed api on BetterAuthService", async () => {
		const response = await request(app.getHttpServer())
			.get("/session-fields/via-service")
			.set(bearer(token));
		expect(response.status).toBe(200);
		expect(response.body.same).toBe(true);
	});
});
