import type { BetterAuthOptions } from "better-auth/types";
import type { EntityManager } from "typeorm";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { typeormAdapter } from "../../src/typeorm/index.ts";
import { RateLimit, User } from "./entities.ts";
import { createArm } from "./harness.ts";
import type { ArmContext } from "./harness.ts";
import { scenarioOptions } from "./scenario.ts";

/** Enough options for `getAuthTables()` to produce the models these tests touch. */
const MINIMAL_OPTIONS = {
	rateLimit: { storage: "database" },
} as unknown as BetterAuthOptions;

describe("adapter options", () => {
	let context: ArmContext;

	beforeAll(async () => {
		context = await createArm("typeorm", scenarioOptions().options);
	});

	afterAll(async () => {
		await context?.dispose();
	});

	describe("select projection", () => {
		test("returns only the requested fields, keyed by field name", async () => {
			const db = context.auth.db;
			await db.create({
				model: "user",
				data: {
					email: "select@example.com",
					name: "Select",
					emailVerified: false,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			});

			const row = await db.findOne<Record<string, unknown>>({
				model: "user",
				where: [{ field: "email", value: "select@example.com" }],
				select: ["email", "emailVerified"],
			});

			// `emailVerified` is the point: the column is `email_verified`, and the factory's
			// `transformOutput` only finds it if the projection aliased it back.
			expect(row).toEqual({ email: "select@example.com", emailVerified: false });
		});

		test("a projected foreign key comes back under its camelCase field name", async () => {
			const db = context.auth.db;
			// `account.user_id` is written by the sign-up `getTestInstance` performs.
			const accounts = await db.findMany<Record<string, unknown>>({
				model: "account",
				limit: 1,
				select: ["userId", "providerId"],
			});
			expect(accounts).toHaveLength(1);

			// The column is `user_id`; the adapter has to alias it back to `userId` or the factory's
			// `transformOutput` reads `undefined`.
			expect(typeof accounts[0]!.userId).toBe("string");
			expect(accounts[0]!.providerId).toBe("credential");
			// Unselected fields are present-but-undefined rather than absent: unlike `findOne`, the
			// factory does not forward `select` to `transformOutput` for `findMany`, so it walks the
			// whole schema. Both adapters behave this way; it is the factory's shape, not ours.
			expect(accounts[0]!.password).toBeUndefined();
			expect(accounts[0]!.accessToken).toBeUndefined();
		});
	});

	describe("getManager", () => {
		test("statements run on the manager the hook returns, and roll back with it", async () => {
			const dataSource = context.dataSource!;
			let scoped: EntityManager | undefined;
			const db = typeormAdapter(dataSource, { getManager: () => scoped })(MINIMAL_OPTIONS);

			await expect(
				dataSource.transaction(async (manager) => {
					scoped = manager;
					await db.create({
						model: "rateLimit",
						data: { key: "scoped", count: 1, lastRequest: 1 },
					});
					// Visible INSIDE the transaction, which is only true if the statement joined it.
					expect(
						await db.findOne({ model: "rateLimit", where: [{ field: "key", value: "scoped" }] }),
					).not.toBeNull();
					throw new Error("roll back");
				}),
			).rejects.toThrow("roll back");

			scoped = undefined;
			// Gone: the row was written inside the rolled-back transaction, not alongside it.
			expect(
				await db.findOne({ model: "rateLimit", where: [{ field: "key", value: "scoped" }] }),
			).toBeNull();
		});

		test("falls back to dataSource.manager when the hook returns undefined", async () => {
			const dataSource = context.dataSource!;
			const db = typeormAdapter(dataSource, { getManager: () => undefined })(MINIMAL_OPTIONS);

			await db.create({ model: "rateLimit", data: { key: "fallback", count: 1, lastRequest: 1 } });
			expect(
				await db.findOne({ model: "rateLimit", where: [{ field: "key", value: "fallback" }] }),
			).not.toBeNull();
		});

		test("is resolved per statement, not captured at construction", async () => {
			const dataSource = context.dataSource!;
			let calls = 0;
			const db = typeormAdapter(dataSource, {
				getManager: () => {
					calls++;
					return undefined;
				},
			})(MINIMAL_OPTIONS);

			await db.count({ model: "rateLimit" });
			await db.count({ model: "rateLimit" });
			// An adapter is built at boot, long before any request scope exists, so a hook consulted
			// once at construction would be useless.
			expect(calls).toBe(2);
		});
	});

	describe("transaction", () => {
		test("joins an application-owned transaction supplied by getManager", async () => {
			const dataSource = context.dataSource!;
			let scoped: EntityManager | undefined;
			let managerResolutions = 0;
			const db = typeormAdapter(dataSource, {
				transaction: true,
				getManager: () => {
					managerResolutions++;
					return scoped;
				},
			})(MINIMAL_OPTIONS);

			await expect(
				dataSource.transaction(async (manager) => {
					scoped = manager;
					await db.transaction(async (trx) => {
						await trx.create({
							model: "rateLimit",
							data: { key: "joined-tx", count: 1, lastRequest: 1 },
						});
					});
					// The inner adapter is pinned: the hook identifies the outer transaction once,
					// rather than being re-resolved for every statement in Better Auth's callback.
					expect(managerResolutions).toBe(1);
					throw new Error("roll back application unit of work");
				}),
			).rejects.toThrow("roll back application unit of work");

			scoped = undefined;
			expect(
				await db.findOne({ model: "rateLimit", where: [{ field: "key", value: "joined-tx" }] }),
			).toBeNull();
		});

		test("commits when the callback resolves and rolls back when it throws", async () => {
			const dataSource = context.dataSource!;
			const db = typeormAdapter(dataSource, { transaction: true })(MINIMAL_OPTIONS);

			await db.transaction(async (trx) => {
				await trx.create({ model: "rateLimit", data: { key: "tx-ok", count: 1, lastRequest: 1 } });
			});
			expect(
				await db.findOne({ model: "rateLimit", where: [{ field: "key", value: "tx-ok" }] }),
			).not.toBeNull();

			await expect(
				db.transaction(async (trx) => {
					await trx.create({
						model: "rateLimit",
						data: { key: "tx-fail", count: 1, lastRequest: 1 },
					});
					throw new Error("nope");
				}),
			).rejects.toThrow("nope");
			expect(
				await db.findOne({ model: "rateLimit", where: [{ field: "key", value: "tx-fail" }] }),
			).toBeNull();
		});

		test("runs sequentially, without a transaction, when the option is off", async () => {
			const dataSource = context.dataSource!;
			const db = typeormAdapter(dataSource)(MINIMAL_OPTIONS);

			// The factory falls back to running the callback against the same adapter, so a throw
			// leaves earlier writes committed. Asserted so the default is a documented choice.
			await expect(
				db.transaction(async (trx) => {
					await trx.create({
						model: "rateLimit",
						data: { key: "no-tx", count: 1, lastRequest: 1 },
					});
					throw new Error("nope");
				}),
			).rejects.toThrow("nope");
			expect(
				await db.findOne({ model: "rateLimit", where: [{ field: "key", value: "no-tx" }] }),
			).not.toBeNull();
		});
	});

	describe("model and field resolution", () => {
		test("resolves rateLimit -> class RateLimit -> table rate_limit with no configuration", async () => {
			const db = typeormAdapter(context.dataSource!)(MINIMAL_OPTIONS);
			await expect(db.count({ model: "rateLimit" })).resolves.toBeTypeOf("number");
		});

		test("an explicit entities override wins", async () => {
			const db = typeormAdapter(context.dataSource!, { entities: { rateLimit: RateLimit } })(
				MINIMAL_OPTIONS,
			);
			await expect(db.count({ model: "rateLimit" })).resolves.toBeTypeOf("number");
		});

		test("an unresolvable model throws, naming the candidates it saw", async () => {
			// A DataSource that knows only about `User`, so `rateLimit` has nothing to resolve to.
			const partial = new DataSource({
				type: "postgres",
				url: process.env.PG_URL,
				schema: context.schema,
				entities: [User],
				synchronize: false,
				logging: false,
			});
			await partial.initialize();
			try {
				const db = typeormAdapter(partial)(MINIMAL_OPTIONS);
				await expect(db.count({ model: "rateLimit" })).rejects.toThrow(
					/No entity found for model "rateLimit".*Registered entities: User\(user\)/s,
				);
			} finally {
				await partial.destroy();
			}
		});

		test("an unknown field names the columns that do exist", async () => {
			// Point the `user` model at the wrong entity, so Better Auth asks for fields that
			// entity has no columns for.
			const misdirected = typeormAdapter(context.dataSource!, { entities: { user: RateLimit } })(
				MINIMAL_OPTIONS,
			);
			await expect(
				misdirected.findOne({ model: "user", where: [{ field: "email", value: "x" }] }),
			).rejects.toThrow(
				/has no column on entity "RateLimit" \(table "rate_limit"\).*Available columns: id\(id\), key\(key\), count\(count\), lastRequest\(last_request\)/s,
			);
		});
	});
});
