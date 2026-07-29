import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Controller, Get, Injectable, Module } from "@nestjs/common";
import { createAuthMiddleware } from "better-auth/api";
import type { INestApplication, MiddlewareConsumer, NestModule } from "@nestjs/common";
import {
	AllowAnonymous,
	BeforeCreate,
	BeforeHook,
	DatabaseHook,
	Hook,
	Roles,
	type AuthHookContext,
} from "../../src/index.ts";
import { createTestAuth, createTestAuthOptions } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { bearer, signUpUser } from "../shared/auth-client.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

describe(`review regressions (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("preserves a consumer after-hook's response override and cookies", async () => {
		const auth = createTestAuth({
			hooks: {
				after: createAuthMiddleware(async (ctx) => {
					if (ctx.path !== "/get-session") return;
					ctx.setCookie("from_after", "1");
					ctx.setHeader("x-from-after", "yes");
					return ctx.json({ patched: true });
				}),
			},
		});
		app = await createTestApp({ forRoot: { auth } });
		const user = await signUpUser(app);
		const response = await request(app.getHttpServer())
			.get("/api/auth/get-session")
			.set(bearer(user.token));
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ patched: true });
		expect(response.headers["x-from-after"]).toBe("yes");
		expect(String(response.headers["set-cookie"])).toContain("from_after=1");
	});

	it("preserves cookies from a consumer before-hook short-circuit", async () => {
		const auth = createTestAuth({
			hooks: {
				before: createAuthMiddleware(async (ctx) => {
					if (ctx.path !== "/sign-in/email") return;
					ctx.setCookie("from_before", "1");
					return ctx.json({ blocked: true });
				}),
			},
		});
		app = await createTestApp({ forRoot: { auth } });
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-in/email")
			.send({ email: "x@example.com", password: "irrelevant-password" });
		expect(response.body).toEqual({ blocked: true });
		expect(String(response.headers["set-cookie"])).toContain("from_before=1");
	});

	it("registers both families of a class decorated with @Hook AND @DatabaseHook", async () => {
		@Injectable()
		class CombinedTracker {
			events: string[] = [];
		}

		@Hook()
		@DatabaseHook()
		@Injectable()
		class CombinedHooks {
			constructor(private readonly tracker: CombinedTracker) {}

			@BeforeHook("/sign-up/email")
			request(_ctx: AuthHookContext): void {
				this.tracker.events.push("request-hook");
			}

			@BeforeCreate("user")
			database(): void {
				this.tracker.events.push("database-hook");
			}
		}

		app = await createTestApp({
			forRoot: { options: createTestAuthOptions() },
			metadata: { providers: [CombinedTracker, CombinedHooks] },
		});
		await signUpUser(app);
		const tracker = app.get(CombinedTracker);
		expect(tracker.events).toContain("request-hook");
		expect(tracker.events).toContain("database-hook");
	});

	it("runs MiddlewareConsumer middleware for auth routes", async () => {
		const seen: string[] = [];

		@Module({})
		class MarkerModule implements NestModule {
			configure(consumer: MiddlewareConsumer): void {
				consumer
					.apply((req: { originalUrl?: string; url?: string }, _res: unknown, next: () => void) => {
						seen.push(req.originalUrl ?? req.url ?? "");
						next();
					})
					.forRoutes("{*path}");
			}
		}

		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { imports: [MarkerModule] },
		});
		await signUpUser(app);
		expect(seen.some((url) => url.includes("/api/auth/sign-up/email"))).toBe(true);
	});

	it("handler-level @Roles overrides a class-level @AllowAnonymous (fail closed)", async () => {
		@Controller("mixed")
		@AllowAnonymous()
		class MixedController {
			@Get("open")
			open(): { open: boolean } {
				return { open: true };
			}

			@Get("admin")
			@Roles("admin")
			admin(): { admin: boolean } {
				return { admin: true };
			}
		}

		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { controllers: [MixedController] },
		});

		const open = await request(app.getHttpServer()).get("/mixed/open");
		expect(open.status).toBe(200);

		const anonymous = await request(app.getHttpServer()).get("/mixed/admin");
		expect(anonymous.status).toBe(401);

		const user = await signUpUser(app);
		const nonAdmin = await request(app.getHttpServer()).get("/mixed/admin").set(bearer(user.token));
		expect(nonAdmin.status).toBe(403);
	});

	it("rejects a root basePath at bootstrap instead of breaking silently", async () => {
		await expect(
			createTestApp({
				forRoot: { auth: createTestAuth(), basePath: "/" },
			}),
		).rejects.toThrow(/cannot be mounted at '\/'/);
	});
});
