import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { bearer, signUpUser } from "../shared/auth-client.ts";
import { TestController } from "../shared/test-controller.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

describe(`rest auth (${testHttpAdapter})`, () => {
	let app: INestApplication;
	let auth: ReturnType<typeof createTestAuth>;

	beforeAll(async () => {
		auth = createTestAuth();
		app = await createTestApp({
			forRoot: { auth },
			metadata: { controllers: [TestController] },
		});
	});

	afterAll(async () => {
		await app.close();
	});

	it("serves better-auth endpoints without bodyParser:false", async () => {
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();

		const session = await request(app.getHttpServer())
			.get("/api/auth/get-session")
			.set(bearer(user.token));
		expect(session.status).toBe(200);
		expect(session.body.user.email).toBe(user.email);
	});

	it("signs in through the mounted handler", async () => {
		const user = await signUpUser(app);
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-in/email")
			.send({ email: user.email, password: user.password });
		expect(response.status).toBe(200);
		expect(response.body.token).toBeTruthy();
	});

	it("rejects protected routes without a session", async () => {
		const response = await request(app.getHttpServer()).get("/test/protected");
		expect(response.status).toBe(401);
	});

	it("allows protected routes with a bearer token", async () => {
		const user = await signUpUser(app);
		const response = await request(app.getHttpServer())
			.get("/test/protected")
			.set(bearer(user.token));
		expect(response.status).toBe(200);
		expect(response.body.userId).toBe(user.userId);
	});

	it("@AllowAnonymous allows access and skips the session lookup entirely", async () => {
		const spy = vi.spyOn(auth.api, "getSession");
		const response = await request(app.getHttpServer()).get("/test/public");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ public: true });
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("@AllowAnonymous({ resolveSession: true }) resolves the session on public routes", async () => {
		const user = await signUpUser(app);
		const authed = await request(app.getHttpServer())
			.get("/test/public-with-session")
			.set(bearer(user.token));
		expect(authed.body).toEqual({ authenticated: true });

		const anonymous = await request(app.getHttpServer()).get("/test/public-with-session");
		expect(anonymous.status).toBe(200);
		expect(anonymous.body).toEqual({ authenticated: false });
	});

	it("@OptionalAuth allows both authenticated and anonymous access", async () => {
		const anonymous = await request(app.getHttpServer()).get("/test/optional");
		expect(anonymous.status).toBe(200);
		expect(anonymous.body).toEqual({ authenticated: false });

		const user = await signUpUser(app);
		const authed = await request(app.getHttpServer())
			.get("/test/optional")
			.set(bearer(user.token));
		expect(authed.body).toEqual({ authenticated: true });
	});

	it("@CurrentUser injects the user", async () => {
		const user = await signUpUser(app);
		const response = await request(app.getHttpServer())
			.get("/test/current-user")
			.set(bearer(user.token));
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ email: user.email });
	});

	it("@Roles denies a regular user and allows an admin", async () => {
		const user = await signUpUser(app);
		const denied = await request(app.getHttpServer())
			.get("/test/admin")
			.set(bearer(user.token));
		expect(denied.status).toBe(403);

		const adminUser = await signUpUser(app);
		const ctx = await auth.$context;
		await ctx.internalAdapter.updateUser(adminUser.userId, { role: "admin" });
		const allowed = await request(app.getHttpServer())
			.get("/test/admin")
			.set(bearer(adminUser.token));
		expect(allowed.status).toBe(200);
	});

	it("still parses JSON bodies on regular app routes", async () => {
		const payload = { hello: "world", nested: { a: 1 } };
		const response = await request(app.getHttpServer()).post("/test/echo").send(payload);
		expect(response.status).toBe(201);
		expect(response.body).toEqual(payload);
	});

	it("returns better-auth's own error responses through the mount", async () => {
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-in/email")
			.send({ email: "nobody@example.com", password: "wrong-password" });
		expect(response.status).toBe(401);
	});
});

describe(`rest auth with global prefix (${testHttpAdapter})`, () => {
	let app: INestApplication;

	beforeAll(async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { controllers: [TestController] },
			globalPrefix: "v1",
		});
	});

	afterAll(async () => {
		await app.close();
	});

	it("keeps auth routes at the un-prefixed base path", async () => {
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
	});

	it("prefixes controller routes", async () => {
		const prefixed = await request(app.getHttpServer()).get("/v1/test/public");
		expect(prefixed.status).toBe(200);
		const unprefixed = await request(app.getHttpServer()).get("/test/public");
		expect(unprefixed.status).toBe(404);
	});
});
