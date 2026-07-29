import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

const ORIGIN = "https://app.example.com";

describe(`cors (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("answers preflight with 204 and CORS headers derived from trustedOrigins", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth({ trustedOrigins: [ORIGIN] }) },
		});
		const response = await request(app.getHttpServer())
			.options("/api/auth/sign-in/email")
			.set("Origin", ORIGIN)
			.set("Access-Control-Request-Method", "POST")
			.set("Access-Control-Request-Headers", "content-type");
		expect(response.status).toBe(204);
		expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
		expect(response.headers["access-control-allow-credentials"]).toBe("true");
		expect(response.headers["access-control-allow-methods"]).toContain("POST");
		expect(response.headers["access-control-allow-headers"]).toBe("content-type");
	});

	it("adds CORS headers on actual auth responses for trusted origins", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth({ trustedOrigins: [ORIGIN] }) },
		});
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.set("Origin", ORIGIN)
			.send({
				email: `cors-${process.pid}@example.com`,
				password: "super-secure-password",
				name: "C",
			});
		expect(response.status).toBe(200);
		expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
	});

	it("ignores untrusted origins", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth({ trustedOrigins: [ORIGIN] }) },
		});
		const response = await request(app.getHttpServer())
			.options("/api/auth/sign-in/email")
			.set("Origin", "https://evil.example.com")
			.set("Access-Control-Request-Method", "POST");
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("supports wildcard origin patterns via cors.origin", async () => {
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				cors: { origin: ["https://*.example.com"] },
			},
		});
		const response = await request(app.getHttpServer())
			.options("/api/auth/sign-in/email")
			.set("Origin", "https://tenant-a.example.com")
			.set("Access-Control-Request-Method", "POST");
		expect(response.status).toBe(204);
		expect(response.headers["access-control-allow-origin"]).toBe("https://tenant-a.example.com");
	});

	it("cors: false disables CORS handling on auth routes", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth({ trustedOrigins: [ORIGIN] }), cors: false },
		});
		const response = await request(app.getHttpServer())
			.options("/api/auth/sign-in/email")
			.set("Origin", ORIGIN)
			.set("Access-Control-Request-Method", "POST");
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("boots (with a warning, not an error) when trustedOrigins is a function", async () => {
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth({ trustedOrigins: () => [ORIGIN] }),
			},
		});
		const response = await request(app.getHttpServer())
			.options("/api/auth/sign-in/email")
			.set("Origin", ORIGIN)
			.set("Access-Control-Request-Method", "POST");
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});
});
