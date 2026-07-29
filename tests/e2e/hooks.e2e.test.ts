import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Injectable } from "@nestjs/common";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { INestApplication } from "@nestjs/common";
import { AfterHook, BeforeHook, Hook, type AuthHookContext } from "../../src/index.ts";
import { createTestAuth, createTestAuthOptions } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { signUpUser } from "../shared/auth-client.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

@Injectable()
class HookTracker {
	events: string[] = [];
	record(event: string): void {
		this.events.push(event);
	}
}

@Hook()
@Injectable()
class SignUpHooks {
	constructor(private readonly tracker: HookTracker) {}

	@BeforeHook("/sign-up/email")
	before(ctx: AuthHookContext): void {
		this.tracker.record(`before:${ctx.path}`);
	}

	@AfterHook("/sign-up/email")
	after(ctx: AuthHookContext): void {
		this.tracker.record(`after:${ctx.path}`);
	}
}

@Hook()
@Injectable()
class PrefixHooks {
	constructor(private readonly tracker: HookTracker) {}

	@BeforeHook("/sign-in/*")
	beforeSignIn(ctx: AuthHookContext): void {
		this.tracker.record(`prefix:${ctx.path}`);
	}

	@BeforeHook()
	beforeAll(ctx: AuthHookContext): void {
		this.tracker.record(`all:${ctx.path}`);
	}
}

@Hook()
@Injectable()
class OrderedHooks {
	constructor(private readonly tracker: HookTracker) {}

	@BeforeHook({ path: "/sign-up/email", order: 10 })
	second(): void {
		this.tracker.record("order:second");
	}

	@BeforeHook({ path: "/sign-up/email", order: -10 })
	first(): void {
		this.tracker.record("order:first");
	}
}

@Hook()
@Injectable()
class RejectingHook {
	@BeforeHook("/sign-up/email")
	reject(ctx: AuthHookContext): void {
		const email = (ctx.body as { email?: string } | undefined)?.email ?? "";
		if (email.endsWith("@blocked.example.com")) {
			throw new APIError("BAD_REQUEST", { message: "Email domain is not allowed" });
		}
	}
}

describe(`hooks (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("fires decorator hooks on an instance created WITHOUT a hooks key", async () => {
		// Headline fix over the reference: no `hooks: {}` pre-declaration needed.
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { providers: [HookTracker, SignUpHooks] },
		});
		await signUpUser(app);
		const tracker = app.get(HookTracker);
		expect(tracker.events).toEqual(["before:/sign-up/email", "after:/sign-up/email"]);
	});

	it("fires decorator hooks in options mode without hooks declared", async () => {
		app = await createTestApp({
			forRoot: { options: createTestAuthOptions() },
			metadata: { providers: [HookTracker, SignUpHooks] },
		});
		await signUpUser(app);
		expect(app.get(HookTracker).events).toEqual(["before:/sign-up/email", "after:/sign-up/email"]);
	});

	it("supports prefix and catch-all path matchers", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { providers: [HookTracker, PrefixHooks] },
		});
		const user = await signUpUser(app);
		const tracker = app.get(HookTracker);
		tracker.events = [];
		await request(app.getHttpServer())
			.post("/api/auth/sign-in/email")
			.send({ email: user.email, password: user.password });
		expect(tracker.events).toContain("prefix:/sign-in/email");
		expect(tracker.events).toContain("all:/sign-in/email");
		expect(tracker.events.filter((event) => event.startsWith("prefix:"))).toHaveLength(1);
	});

	it("orders hooks by `order` regardless of declaration order", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { providers: [HookTracker, OrderedHooks] },
		});
		await signUpUser(app);
		const ordered = app.get(HookTracker).events.filter((event) => event.startsWith("order:"));
		expect(ordered).toEqual(["order:first", "order:second"]);
	});

	it("aborts the endpoint when a before hook throws APIError", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { providers: [RejectingHook] },
		});
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send({
				email: `blocked-${process.pid}@blocked.example.com`,
				password: "super-secure-password",
				name: "Blocked",
			});
		expect(response.status).toBe(400);
		expect(response.body.message).toBe("Email domain is not allowed");
	});

	it("runs user-declared hooks before decorator hooks", async () => {
		const events: string[] = [];
		const auth = createTestAuth({
			hooks: {
				before: createAuthMiddleware(async (ctx) => {
					if (ctx.path === "/sign-up/email") events.push("user-hook");
				}),
			},
		});
		app = await createTestApp({
			forRoot: { auth },
			metadata: {
				providers: [
					{ provide: HookTracker, useValue: { events, record: (e: string) => events.push(e) } },
					SignUpHooks,
				],
			},
		});
		await signUpUser(app);
		expect(events.indexOf("user-hook")).toBeGreaterThanOrEqual(0);
		expect(events.indexOf("user-hook")).toBeLessThan(events.indexOf("before:/sign-up/email"));
	});

	it("swaps registries when a second app reuses the same auth instance", async () => {
		const auth = createTestAuth();
		app = await createTestApp({
			forRoot: { auth },
			metadata: { providers: [HookTracker, SignUpHooks] },
		});
		await signUpUser(app);
		expect(app.get(HookTracker).events).toHaveLength(2);
		await app.close();

		// Second app over the SAME instance: hooks must fire exactly once,
		// against the new app's registry.
		app = await createTestApp({
			forRoot: { auth },
			metadata: { providers: [HookTracker, SignUpHooks] },
		});
		await signUpUser(app);
		expect(app.get(HookTracker).events).toEqual(["before:/sign-up/email", "after:/sign-up/email"]);
	});
});
