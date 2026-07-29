import { afterEach, describe, expect, it } from "vitest";
import { Injectable } from "@nestjs/common";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import {
	AfterCreate,
	AfterUpdate,
	BeforeCreate,
	BeforeUpdate,
	DatabaseHook,
} from "../../src/index.ts";
import { createTestAuth, createTestAuthOptions } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { bearer, signUpUser } from "../shared/auth-client.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

@Injectable()
class DbTracker {
	events: string[] = [];
}

@DatabaseHook()
@Injectable()
class UserDatabaseHooks {
	constructor(private readonly tracker: DbTracker) {}

	@BeforeCreate("user")
	beforeCreate(data: { email?: string }): { data: Record<string, unknown> } | undefined {
		this.tracker.events.push(`before-create:${data.email}`);
		return { data: { name: "Renamed By Hook" } };
	}

	@AfterCreate("user")
	afterCreate(record: { email?: string }): void {
		this.tracker.events.push(`after-create:${record.email}`);
	}

	@BeforeUpdate("user")
	beforeUpdate(): void {
		this.tracker.events.push("before-update");
	}

	@AfterUpdate("user")
	afterUpdate(): void {
		this.tracker.events.push("after-update");
	}
}

@DatabaseHook()
@Injectable()
class SessionDatabaseHooks {
	constructor(private readonly tracker: DbTracker) {}

	@BeforeCreate("session")
	beforeCreate(): void {
		this.tracker.events.push("session:before-create");
	}
}

@DatabaseHook()
@Injectable()
class AbortingUserHook {
	@BeforeCreate("user")
	abort(data: { email?: string }): false | undefined {
		if (data.email?.endsWith("@aborted.example.com")) return false;
		return undefined;
	}
}

describe(`database hooks (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	it("fires user create/update hooks in options mode without databaseHooks declared", async () => {
		app = await createTestApp({
			forRoot: { options: createTestAuthOptions() },
			metadata: { providers: [DbTracker, UserDatabaseHooks, SessionDatabaseHooks] },
		});
		const user = await signUpUser(app);
		const tracker = app.get(DbTracker);
		expect(tracker.events).toContain(`before-create:${user.email}`);
		expect(tracker.events).toContain(`after-create:${user.email}`);
		expect(tracker.events).toContain("session:before-create");
	});

	it("merges { data } returns into the created record", async () => {
		app = await createTestApp({
			forRoot: { options: createTestAuthOptions() },
			metadata: { providers: [DbTracker, UserDatabaseHooks] },
		});
		const user = await signUpUser(app);
		const session = await request(app.getHttpServer())
			.get("/api/auth/get-session")
			.set(bearer(user.token));
		expect(session.body.user.name).toBe("Renamed By Hook");
	});

	it("aborts the operation when a before hook returns false", async () => {
		app = await createTestApp({
			forRoot: { options: createTestAuthOptions() },
			metadata: { providers: [AbortingUserHook] },
		});
		const response = await request(app.getHttpServer())
			.post("/api/auth/sign-up/email")
			.send({
				email: `abort-${process.pid}@aborted.example.com`,
				password: "super-secure-password",
				name: "Aborted",
			});
		expect(response.status).toBeGreaterThanOrEqual(400);
	});

	it("works in instance mode when databaseHooks: {} was declared", async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth({ databaseHooks: {} }) },
			metadata: { providers: [DbTracker, UserDatabaseHooks] },
		});
		const user = await signUpUser(app);
		expect(app.get(DbTracker).events).toContain(`before-create:${user.email}`);
	});

	it("still runs user-declared databaseHooks alongside decorator hooks", async () => {
		const events: string[] = [];
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth({
					databaseHooks: {
						user: {
							create: {
								before: async (user) => {
									events.push("user-declared");
									return { data: { ...user, name: "From User Hook" } };
								},
							},
						},
					},
				}),
			},
			metadata: { providers: [DbTracker, UserDatabaseHooks] },
		});
		await signUpUser(app);
		expect(events).toContain("user-declared");
		// Decorator hook runs after the user hook and overrides the name.
		expect(app.get(DbTracker).events.some((e) => e.startsWith("before-create:"))).toBe(true);
	});

	it("throws an actionable bootstrap error in instance mode without databaseHooks", async () => {
		await expect(
			createTestApp({
				forRoot: { auth: createTestAuth() },
				metadata: { providers: [DbTracker, UserDatabaseHooks] },
			}),
		).rejects.toThrow(/databaseHooks/);
	});
});
