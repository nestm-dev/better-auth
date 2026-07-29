import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { signUpUser } from "../shared/auth-client.ts";
import { TestController } from "../shared/test-controller.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

describe(`body handling tiers (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("works with Nest's default body parsers enabled (re-serialized body)", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { controllers: [TestController] },
		});
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
	});

	it("works with rawBody: true (byte-exact recovery)", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { controllers: [TestController] },
			appOptions: { rawBody: true },
		});
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
	});

	it("works with bodyParser: false (untouched stream)", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { controllers: [TestController] },
			appOptions: { bodyParser: false },
		});
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
	});

	it("handles pretty-printed JSON bodies through the recovery path", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			appOptions: { rawBody: true },
		});
		const body = JSON.stringify(
			{
				email: `pretty-${process.pid}@example.com`,
				password: "super-secure-password",
				name: "Pretty Printed",
			},
			null,
			2,
		);
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.set("Content-Type", "application/json")
			.send(body);
		expect(response.status).toBe(200);
		expect(response.body.token).toBeTruthy();
	});
});

describe(`custom base path (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("mounts at the path embedded in baseURL (overrides basePath, like better-auth)", async () => {
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth({
					baseURL: "http://localhost:3000/custom/auth",
					basePath: "/ignored",
				}),
			},
		});
		const user = await signUpUser(app, "/custom/auth");
		expect(user.token).toBeTruthy();
		const missed = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send({ email: "x@example.com", password: "super-secure-password", name: "X" });
		expect(missed.status).toBe(404);
	});

	it("mounts at options.basePath when baseURL has no path", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth({ basePath: "/auth-api" }) },
		});
		const user = await signUpUser(app, "/auth-api");
		expect(user.token).toBeTruthy();
	});

	it("honors the module-level basePath override", async () => {
		// The module option only changes where the handler is mounted; better-auth
		// itself must agree on the path, so point its basePath at the same value.
		app = await createTestApp({
			forRoot: { auth: createTestAuth({ basePath: "/override" }), basePath: "/override" },
		});
		const user = await signUpUser(app, "/override");
		expect(user.token).toBeTruthy();
	});
});
