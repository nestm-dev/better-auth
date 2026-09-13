import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { BeforeHook, BetterAuthModule, Hook, type AuthHookContext } from "../../src/index.ts";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { signUpUser } from "../shared/auth-client.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";
import { ServerResponse } from "node:http";

describe(`mount options (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("runs the `middleware` wrapper around every auth request", async () => {
		const order: string[] = [];
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				middleware: async (_req, _res, run) => {
					order.push("wrap-start");
					await run();
					order.push("wrap-end");
				},
			},
		});
		await signUpUser(app);
		expect(order).toEqual(["wrap-start", "wrap-end"]);
	});

	it("maps a throwing `middleware` wrapper to a 500, not a hang", async () => {
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				middleware: () => {
					throw new Error("wrapper exploded");
				},
			},
		});
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send({ email: "x@example.com", password: "super-secure-password", name: "X" });
		expect(response.status).toBe(500);
	});

	it("keeps auth headers and body private until the middleware finishes", async () => {
		let headersSentBeforeCommit: boolean | undefined;
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				middleware: async (_req, res, run) => {
					await run();
					headersSentBeforeCommit = nodeResponse(res).headersSent;
				},
			},
		});
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
		expect(headersSentBeforeCommit).toBe(false);
	});

	it("withholds session cookies and success when middleware fails after the handler", async () => {
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				middleware: async (_req, _res, run) => {
					await run();
					throw new Error("transaction commit failed");
				},
			},
		});
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send({ email: "commit@example.com", password: "super-secure-password", name: "Commit" });
		expect(response.status).toBe(500);
		expect(response.headers["set-cookie"]).toBeUndefined();
	});

	it("preserves middleware that answers the request without invoking the handler", async () => {
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				middleware: (_req, res) => {
					const response = nodeResponse(res);
					response.statusCode = 403;
					response.end("Denied");
				},
			},
		});
		const response = await request(app.getHttpServer()).get("/api/auth/get-session");
		expect(response.status).toBe(403);
		expect(response.text).toBe("Denied");
	});

	it("initializes without an HTTP adapter (application context) with a warning, not a crash", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [BetterAuthModule.forRoot({ auth: createTestAuth() })],
		}).compile();
		// No createNestApplication: this is the application-context path.
		await expect(moduleRef.init()).resolves.toBeDefined();
		await moduleRef.close();
	});

	it("keeps serving and firing hooks with a dynamic baseURL config (upstream contract canary)", async () => {
		@Injectable()
		class DynamicTracker {
			events: string[] = [];
		}

		@Hook()
		@Injectable()
		class DynamicHook {
			constructor(private readonly tracker: DynamicTracker) {}

			@BeforeHook("/sign-up/email")
			onSignUp(_ctx: AuthHookContext): void {
				this.tracker.events.push("fired");
			}
		}

		app = await createTestApp({
			forRoot: {
				auth: createTestAuth({
					// Per-request base URL resolution takes a different context path
					// upstream (shallow-spread of ctx.options) — this guards that our
					// installed hooks object survives it.
					baseURL: { allowedHosts: ["*"], fallback: "http://localhost:3000" },
				}),
			},
			metadata: { providers: [DynamicTracker, DynamicHook] },
		});
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
		expect(app.get(DynamicTracker).events).toEqual(["fired"]);
	});
});

function nodeResponse(value: unknown): ServerResponse {
	if (value instanceof ServerResponse) return value;
	if (
		typeof value === "object" &&
		value !== null &&
		"raw" in value &&
		value.raw instanceof ServerResponse
	)
		return value.raw;
	throw new Error("Expected a Node response");
}
