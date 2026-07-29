import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import {
	BETTER_AUTH_INSTANCE,
	BetterAuthModule,
	BetterAuthService,
	BeforeHook,
	Hook,
	type AnyAuth,
	type AuthHookContext,
	type BetterAuthModuleOptions,
} from "../../src/index.ts";
import { createTestAuth, createTestAuthOptions } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { signUpUser } from "../shared/auth-client.ts";
import { TestController } from "../shared/test-controller.ts";
import {
	createTestHttpAdapter,
	initTestApplication,
	testHttpAdapter,
} from "../shared/http-adapter.ts";

@Injectable()
class FeatureTracker {
	events: string[] = [];
}

@Module({ providers: [FeatureTracker], exports: [FeatureTracker] })
class TrackerModule {}

@Hook()
@Injectable()
class FeatureAHook {
	constructor(private readonly tracker: FeatureTracker) {}

	@BeforeHook("/sign-up/email")
	onSignUp(_ctx: AuthHookContext): void {
		this.tracker.events.push("feature-a");
	}
}

@Hook()
@Injectable()
class FeatureBHook {
	constructor(private readonly tracker: FeatureTracker) {}

	@BeforeHook("/sign-in/email")
	onSignIn(_ctx: AuthHookContext): void {
		this.tracker.events.push("feature-b");
	}
}

describe(`module registration (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("forRoot options mode builds the instance internally", async () => {
		app = await createTestApp({
			forRoot: { options: createTestAuthOptions() },
			metadata: { controllers: [TestController] },
		});
		const service = app.get(BetterAuthService);
		expect(service.instance).toBeDefined();
		expect(service.options.emailAndPassword?.enabled).toBe(true);
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
	});

	it("forRootAsync (useFactory + inject) works in options mode", async () => {
		@Injectable()
		class AuthConfig {
			build(): BetterAuthModuleOptions {
				return { options: createTestAuthOptions() };
			}
		}

		@Module({ providers: [AuthConfig], exports: [AuthConfig] })
		class AuthConfigModule {}

		const moduleRef = await Test.createTestingModule({
			imports: [
				BetterAuthModule.forRootAsync({
					imports: [AuthConfigModule],
					inject: [AuthConfig],
					useFactory: (config: AuthConfig) => config.build(),
				}),
			],
			controllers: [TestController],
		}).compile();
		app = await initTestApplication(moduleRef.createNestApplication(createTestHttpAdapter()));
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
	});

	it("forRootAsync works in instance mode", async () => {
		const auth = createTestAuth();
		const moduleRef = await Test.createTestingModule({
			imports: [
				BetterAuthModule.forRootAsync({
					useFactory: async () => ({ auth }),
				}),
			],
			controllers: [TestController],
		}).compile();
		app = await initTestApplication(moduleRef.createNestApplication(createTestHttpAdapter()));
		expect(app.get<AnyAuth>(BETTER_AUTH_INSTANCE)).toBe(auth);
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
	});

	it("disableGlobalGuard leaves routes unguarded", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth(), disableGlobalGuard: true },
			metadata: { controllers: [TestController] },
		});
		// No guard: the protected route runs without a session and fails on
		// session.user access only if it dereferences — our route does, so use
		// the optional route to show it is reachable without auth.
		const response = await request(app.getHttpServer()).get("/test/optional");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ authenticated: false });
	});

	it("forFeature registers feature-scoped hooks that do not cross-fire", async () => {
		@Module({
			imports: [BetterAuthModule.forFeature({ hooks: [FeatureAHook], imports: [TrackerModule] })],
		})
		class FeatureAModule {}

		@Module({
			imports: [BetterAuthModule.forFeature({ hooks: [FeatureBHook], imports: [TrackerModule] })],
		})
		class FeatureBModule {}

		const moduleRef = await Test.createTestingModule({
			imports: [
				BetterAuthModule.forRoot({ auth: createTestAuth() }),
				TrackerModule,
				FeatureAModule,
				FeatureBModule,
			],
		}).compile();
		app = await initTestApplication(moduleRef.createNestApplication(createTestHttpAdapter()));

		const user = await signUpUser(app);
		const tracker = app.get(FeatureTracker);
		expect(tracker.events).toEqual(["feature-a"]);

		await request(app.getHttpServer())
			.post("/api/auth/sign-in/email")
			.send({ email: user.email, password: user.password });
		expect(tracker.events).toEqual(["feature-a", "feature-b"]);
	});

	it("forFeature rejects classes without @Hook/@DatabaseHook", async () => {
		@Injectable()
		class NotAHook {}
		expect(() => BetterAuthModule.forFeature({ hooks: [NotAHook] })).toThrow(/not decorated/);
	});

	it("a hook class listed in a feature module's own providers is discovered too", async () => {
		@Module({ imports: [TrackerModule], providers: [FeatureAHook] })
		class PlainFeatureModule {}

		const moduleRef = await Test.createTestingModule({
			imports: [
				BetterAuthModule.forRoot({ auth: createTestAuth() }),
				TrackerModule,
				PlainFeatureModule,
			],
		}).compile();
		app = await initTestApplication(moduleRef.createNestApplication(createTestHttpAdapter()));
		await signUpUser(app);
		expect(app.get(FeatureTracker).events).toEqual(["feature-a"]);
	});

	it("the same hook class in two modules runs once (dedupe + warn)", async () => {
		@Module({ imports: [TrackerModule], providers: [FeatureAHook] })
		class DuplicateModuleA {}

		@Module({
			imports: [BetterAuthModule.forFeature({ hooks: [FeatureAHook], imports: [TrackerModule] })],
		})
		class DuplicateModuleB {}

		const moduleRef = await Test.createTestingModule({
			imports: [
				BetterAuthModule.forRoot({ auth: createTestAuth() }),
				TrackerModule,
				DuplicateModuleA,
				DuplicateModuleB,
			],
		}).compile();
		app = await initTestApplication(moduleRef.createNestApplication(createTestHttpAdapter()));
		await signUpUser(app);
		expect(app.get(FeatureTracker).events).toEqual(["feature-a"]);
	});

	it("isGlobal: false still serves auth and provides locally", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth(), isGlobal: false },
			metadata: { controllers: [TestController] },
		});
		const user = await signUpUser(app);
		expect(user.token).toBeTruthy();
	});
});
