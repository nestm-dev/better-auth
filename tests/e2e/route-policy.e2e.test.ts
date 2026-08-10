import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Inject, Injectable } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import {
	AuthRoutePolicy,
	BETTER_AUTH_BASE_PATH,
	deny,
	type BetterAuthRoutePolicy,
	type BetterAuthRoutePolicyContext,
	type BetterAuthRoutePolicyHandler,
} from "../../src/index.ts";
import { createTestApp } from "../shared/test-app.ts";
import { createTestAuth, uniqueUser } from "../shared/test-auth.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

const ORIGIN = "https://station.example.com";

@Injectable()
class PolicyTracker {
	events: string[] = [];
	contexts: BetterAuthRoutePolicyContext[] = [];
	basePaths: string[] = [];
}

@AuthRoutePolicy({ path: "/sign-up/*", methods: "post" })
@Injectable()
class DisableSelfSignupPolicy implements BetterAuthRoutePolicyHandler {
	constructor(
		private readonly tracker: PolicyTracker,
		@Inject(BETTER_AUTH_BASE_PATH) private readonly basePath: string,
	) {}

	evaluate(context: BetterAuthRoutePolicyContext) {
		this.tracker.events.push("disable-sign-up");
		this.tracker.contexts.push(context);
		this.tracker.basePaths.push(this.basePath);
		return deny(
			403,
			{ code: "SIGN_UP_DISABLED", message: "Self-service sign-up is disabled." },
			{ "x-route-policy": "di" },
		);
	}
}

@AuthRoutePolicy({ path: "/sign-up/email" })
@Injectable()
class RecordingPolicy implements BetterAuthRoutePolicyHandler {
	constructor(private readonly tracker: PolicyTracker) {}

	evaluate(context: BetterAuthRoutePolicyContext): void {
		this.tracker.events.push("provider");
		this.tracker.contexts.push(context);
	}
}

@AuthRoutePolicy({ path: "/sign-up/email", order: 20 })
@Injectable()
class LatePolicy implements BetterAuthRoutePolicyHandler {
	constructor(private readonly tracker: PolicyTracker) {}
	evaluate(): void {
		this.tracker.events.push("late");
	}
}

@AuthRoutePolicy({ path: "/sign-up/email", order: -10 })
@Injectable()
class FirstPolicy implements BetterAuthRoutePolicyHandler {
	constructor(private readonly tracker: PolicyTracker) {}
	evaluate(): void {
		this.tracker.events.push("first");
	}
}

@AuthRoutePolicy({ path: "/sign-up/email" })
@Injectable()
class DenyingPolicy implements BetterAuthRoutePolicyHandler {
	constructor(private readonly tracker: PolicyTracker) {}
	evaluate() {
		this.tracker.events.push("deny");
		return deny(409, { code: "POLICY_DENIED" });
	}
}

@AuthRoutePolicy()
@Injectable()
class CatchAllRecordingPolicy implements BetterAuthRoutePolicyHandler {
	constructor(private readonly tracker: PolicyTracker) {}
	evaluate(): void {
		this.tracker.events.push("catch-all");
	}
}

@AuthRoutePolicy({ path: "/sign-up/email" })
@Injectable()
class ThrowingPolicy implements BetterAuthRoutePolicyHandler {
	evaluate(): never {
		throw new Error("provider policy failure");
	}
}

describe(`route policy (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("receives normalized JSON request context and short-circuits before middleware/auth", async () => {
		const auth = createTestAuth({ trustedOrigins: [ORIGIN] });
		const user = uniqueUser();
		let context: BetterAuthRoutePolicyContext | undefined;
		let middlewareCalls = 0;
		let policyCalls = 0;

		app = await createTestApp({
			appOptions: { rawBody: true },
			forRoot: {
				auth,
				routePolicy: (currentContext) => {
					policyCalls += 1;
					context = currentContext;
					return Response.json(
						{ code: "SIGN_UP_DISABLED", message: "Self-service sign-up is disabled." },
						{ status: 403, headers: { "x-route-policy": "denied" } },
					);
				},
				middleware: async (_request, _response, run) => {
					middlewareCalls += 1;
					await run();
				},
			},
		});

		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email?source=invitation")
			.set("Origin", ORIGIN)
			.send(user);

		expect(response.status).toBe(403);
		expect(response.body).toEqual({
			code: "SIGN_UP_DISABLED",
			message: "Self-service sign-up is disabled.",
		});
		expect(response.headers["x-route-policy"]).toBe("denied");
		expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
		expect(middlewareCalls).toBe(0);
		expect(policyCalls).toBe(1);

		expect(context).toBeDefined();
		expect(context?.method).toBe("POST");
		expect(context?.url).toBe("/api/auth/sign-up/email?source=invitation");
		expect(context?.pathname).toBe("/api/auth/sign-up/email");
		expect(context?.authPath).toBe("/sign-up/email");
		expect(context?.headers).toBeInstanceOf(Headers);
		expect(context?.headers.get("content-type")).toContain("application/json");
		expect(context?.body).toEqual(user);
		expect(JSON.parse(Buffer.from(context?.rawBody ?? []).toString("utf8"))).toEqual(user);

		// The denied HTTP handler did not create the user, and routePolicy is
		// deliberately outside the server-side auth.api call path.
		const serverSideResult = await auth.api.signUpEmail({ body: user });
		expect(serverSideResult.user.email).toBe(user.email);
		expect(policyCalls).toBe(1);
	});

	it("discovers an injected provider and denies only mounted HTTP traffic", async () => {
		const auth = createTestAuth({ trustedOrigins: [ORIGIN] });
		const user = uniqueUser();
		let middlewareCalls = 0;
		app = await createTestApp({
			appOptions: { rawBody: true },
			forRoot: {
				auth,
				middleware: async (_request, _response, run) => {
					middlewareCalls += 1;
					await run();
				},
			},
			metadata: { providers: [PolicyTracker, DisableSelfSignupPolicy] },
		});

		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email?source=invitation")
			.set("Origin", ORIGIN)
			.send(user);

		expect(response.status).toBe(403);
		expect(response.body).toEqual({
			code: "SIGN_UP_DISABLED",
			message: "Self-service sign-up is disabled.",
		});
		expect(response.headers["x-route-policy"]).toBe("di");
		expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
		expect(middlewareCalls).toBe(0);

		const tracker = app.get(PolicyTracker);
		expect(tracker.events).toEqual(["disable-sign-up"]);
		expect(tracker.basePaths).toEqual(["/api/auth"]);
		expect(tracker.contexts[0]?.authPath).toBe("/sign-up/email");
		expect(tracker.contexts[0]?.body).toEqual(user);
		expect(JSON.parse(Buffer.from(tracker.contexts[0]?.rawBody ?? []).toString("utf8"))).toEqual(
			user,
		);

		const serverSideResult = await auth.api.signUpEmail({ body: user });
		expect(serverSideResult.user.email).toBe(user.email);
		expect(tracker.events).toEqual(["disable-sign-up"]);
	});

	it("runs the legacy callback before providers and reuses one normalized context", async () => {
		const events: string[] = [];
		let legacyContext: BetterAuthRoutePolicyContext | undefined;
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				routePolicy: (context) => {
					events.push("legacy");
					legacyContext = context;
				},
				middleware: async (_request, _response, run) => {
					events.push("middleware");
					await run();
				},
			},
			metadata: {
				providers: [
					{ provide: PolicyTracker, useValue: { events, contexts: [], basePaths: [] } },
					RecordingPolicy,
				],
			},
		});

		const user = uniqueUser();
		const response = await request(app.getHttpServer()).post("/api/auth/sign-up/email").send(user);
		expect(response.status).toBe(200);
		expect(events).toEqual(["legacy", "provider", "middleware"]);
		expect(app.get(PolicyTracker).contexts[0]).toBe(legacyContext);
	});

	it("lets a legacy denial short-circuit all provider policies", async () => {
		let middlewareCalls = 0;
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				routePolicy: () => new Response(null, { status: 423 }),
				middleware: async (_request, _response, run) => {
					middlewareCalls += 1;
					await run();
				},
			},
			metadata: { providers: [PolicyTracker, RecordingPolicy] },
		});
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send(uniqueUser());
		expect(response.status).toBe(423);
		expect(app.get(PolicyTracker).events).toEqual([]);
		expect(middlewareCalls).toBe(0);
	});

	it("orders providers and stops after the first denial", async () => {
		let middlewareCalls = 0;
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				middleware: async (_request, _response, run) => {
					middlewareCalls += 1;
					await run();
				},
			},
			metadata: {
				providers: [PolicyTracker, LatePolicy, DenyingPolicy, FirstPolicy],
			},
		});
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send(uniqueUser());
		expect(response.status).toBe(409);
		expect(response.body).toEqual({ code: "POLICY_DENIED" });
		expect(app.get(PolicyTracker).events).toEqual(["first", "deny"]);
		expect(middlewareCalls).toBe(0);
	});

	it("forwards provider errors without running middleware", async () => {
		let middlewareCalls = 0;
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				middleware: async (_request, _response, run) => {
					middlewareCalls += 1;
					await run();
				},
			},
			metadata: { providers: [ThrowingPolicy] },
		});
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send(uniqueUser());
		expect(response.status).toBe(500);
		expect(middlewareCalls).toBe(0);
	});

	it("returns 413 before policies when untouched body recovery exceeds its limit", async () => {
		let middlewareCalls = 0;
		app = await createTestApp({
			appOptions: { bodyParser: false },
			forRoot: {
				auth: createTestAuth({ trustedOrigins: [ORIGIN] }),
				routePolicyBodyLimit: 32,
				middleware: async (_request, _response, run) => {
					middlewareCalls += 1;
					await run();
				},
			},
			metadata: { providers: [PolicyTracker, CatchAllRecordingPolicy] },
		});

		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.set("Origin", ORIGIN)
			.send(uniqueUser());

		expect(response.status).toBe(413);
		expect(response.body).toEqual({
			code: "PAYLOAD_TOO_LARGE",
			message: "Request body is too large.",
		});
		expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
		expect(app.get(PolicyTracker).events).toEqual([]);
		expect(middlewareCalls).toBe(0);
	});

	it("receives parsed and byte-exact URL-encoded bodies", async () => {
		let context: BetterAuthRoutePolicyContext | undefined;
		app = await createTestApp({
			appOptions: { rawBody: true },
			forRoot: {
				auth: createTestAuth(),
				routePolicy: (currentContext) => {
					context = currentContext;
					return new Response(null, { status: 409 });
				},
			},
		});

		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-in/email")
			.type("form")
			.send({
				email: "member@example.com",
				password: "super-secure-password",
				resend: "true",
			});

		expect(response.status).toBe(409);
		expect(context?.body).toMatchObject({
			email: "member@example.com",
			password: "super-secure-password",
			resend: "true",
		});
		const rawBody = new URLSearchParams(Buffer.from(context?.rawBody ?? []).toString("utf8"));
		expect(rawBody.get("email")).toBe("member@example.com");
		expect(rawBody.get("resend")).toBe("true");
	});

	it("continues through middleware and better-auth when the policy allows the route", async () => {
		const user = uniqueUser();
		let middlewareCalls = 0;
		const seenPaths: string[] = [];
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				routePolicy: (context) => {
					seenPaths.push(context.authPath);
				},
				middleware: async (_request, _response, run) => {
					middlewareCalls += 1;
					await run();
				},
			},
		});

		const response = await request(app.getHttpServer()).post("/api/auth/sign-up/email").send(user);

		expect(response.status).toBe(200);
		expect(response.body.user.email).toBe(user.email);
		expect(seenPaths).toEqual(["/sign-up/email"]);
		expect(middlewareCalls).toBe(1);
	});

	it.each([
		{
			label: "synchronous",
			policy: (() => {
				throw new Error("sync policy failure");
			}) satisfies BetterAuthRoutePolicy,
		},
		{
			label: "asynchronous",
			policy: (async () => {
				throw new Error("async policy failure");
			}) satisfies BetterAuthRoutePolicy,
		},
	])("forwards $label policy errors without running middleware", async ({ policy }) => {
		let middlewareCalls = 0;
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth(),
				routePolicy: policy,
				middleware: async (_request, _response, run) => {
					middlewareCalls += 1;
					await run();
				},
			},
		});

		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send(uniqueUser());

		expect(response.status).toBe(500);
		expect(middlewareCalls).toBe(0);
	});

	it("runs after CORS, so preflight bypasses the policy", async () => {
		let policyCalls = 0;
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth({ trustedOrigins: [ORIGIN] }),
				routePolicy: () => {
					policyCalls += 1;
					return new Response(null, { status: 418 });
				},
			},
			metadata: { providers: [PolicyTracker, CatchAllRecordingPolicy] },
		});

		const response = await request(app.getHttpServer())
			.options("/api/auth/sign-in/email")
			.set("Origin", ORIGIN)
			.set("Access-Control-Request-Method", "POST");

		expect(response.status).toBe(204);
		expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
		expect(policyCalls).toBe(0);
		expect(app.get(PolicyTracker).events).toEqual([]);
	});
});
