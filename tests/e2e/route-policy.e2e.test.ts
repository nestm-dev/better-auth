import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { BetterAuthRoutePolicy, BetterAuthRoutePolicyContext } from "../../src/index.ts";
import { createTestApp } from "../shared/test-app.ts";
import { createTestAuth, uniqueUser } from "../shared/test-auth.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

const ORIGIN = "https://station.example.com";

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
		});

		const response = await request(app.getHttpServer())
			.options("/api/auth/sign-in/email")
			.set("Origin", ORIGIN)
			.set("Access-Control-Request-Method", "POST");

		expect(response.status).toBe(204);
		expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
		expect(policyCalls).toBe(0);
	});
});
