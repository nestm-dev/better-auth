import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { User } from "./entities.ts";
import { createArm } from "./harness.ts";
import type { ArmContext } from "./harness.ts";

import { scenarioOptions } from "./scenario.ts";

/**
 * `@UpdateDateColumn` is where Better Auth's write model and TypeORM's collide, so it is worth
 * pinning exactly what each side does.
 *
 * Better Auth force-materialises `updatedAt` into every update payload: the factory's
 * `transformInput` re-applies any field carrying `onUpdate`, whether or not the caller asked
 * for it. TypeORM's `QueryBuilder` wants to write the same column itself. The tests below
 * record how TypeORM 1.1 resolves that overlap — and, more usefully, assert that the adapter
 * does not depend on the answer, because it never routes a write through the ORM's date
 * handling at all.
 */
describe("@UpdateDateColumn", () => {
	let context: ArmContext;

	beforeAll(async () => {
		context = await createArm("typeorm", scenarioOptions().options);
	});

	afterAll(async () => {
		await context?.dispose();
	});

	test("the adapter updates a model whose updatedAt is an @UpdateDateColumn", async () => {
		const db = context.auth.db;
		const created = await db.create<Record<string, unknown>, { id: string; updatedAt: Date }>({
			model: "user",
			data: {
				email: "update-date@example.com",
				name: "Before",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});

		const updated = await db.update<{ name: string; updatedAt: Date }>({
			model: "user",
			where: [{ field: "id", value: created.id }],
			// Exactly what Better Auth sends: the caller's field PLUS the materialised `updatedAt`.
			update: { name: "After", updatedAt: new Date() },
		});

		expect(updated?.name).toBe("After");
		expect(updated?.updatedAt).toBeInstanceOf(Date);
	});

	/**
	 * What TypeORM 1.1 actually emits, recorded rather than assumed.
	 *
	 * With `updatedAt` in the payload it SUBSTITUTES the caller's value; only when the payload
	 * omits it does it inject `CURRENT_TIMESTAMP`. So on this version the overlap resolves
	 * silently and there is no duplicate-assignment error.
	 *
	 * It is still not a mechanism to build on. `CURRENT_TIMESTAMP` is a `timestamptz` cast to
	 * `timestamp` using the SERVER's zone, so the injected branch writes a value whose meaning
	 * depends on a database setting — in a column every other write treats as UTC. And an
	 * earlier or later TypeORM appending instead of substituting would make this two
	 * assignments to one column, which PostgreSQL rejects with `42701`.
	 *
	 * If this test fails, TypeORM changed how it resolves the overlap. The adapter is unaffected
	 * either way; update the expectation and this comment.
	 */
	test("TypeORM's QueryBuilder writes updated_at itself, substituting rather than duplicating", () => {
		const dataSource = context.dataSource;
		expect(dataSource).toBeDefined();

		const withExplicit = dataSource!
			.createQueryBuilder()
			.update(User)
			.set({ name: "After", updatedAt: new Date() })
			.where("id = :id", { id: "x" })
			.getQuery();
		const withoutExplicit = dataSource!
			.createQueryBuilder()
			.update(User)
			.set({ name: "After" })
			.where("id = :id", { id: "x" })
			.getQuery();

		// One assignment, carrying the caller's value.
		expect(withExplicit).toMatch(/SET "name" = :orm_param_0, "updated_at" = :orm_param_1 /);
		expect(withExplicit).not.toContain("CURRENT_TIMESTAMP");
		// ...and the ORM's own value when the payload is silent.
		expect(withoutExplicit).toContain(`"updated_at" = CURRENT_TIMESTAMP`);
	});

	test("the adapter's UPDATE assigns exactly the payload's columns and nothing else", async () => {
		const dataSource = context.dataSource;
		const statements: string[] = [];
		const original = dataSource!.manager.query.bind(dataSource!.manager);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow spy over a raw API.
		(dataSource!.manager as any).query = (sql: string, parameters?: unknown[]) => {
			statements.push(sql);
			return original(sql, parameters as never);
		};

		try {
			const db = context.auth.db;
			const created = await db.create<Record<string, unknown>, { id: string }>({
				model: "user",
				data: {
					email: "exact-columns@example.com",
					name: "Before",
					emailVerified: false,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			});
			statements.length = 0;

			await db.update({
				model: "user",
				where: [{ field: "id", value: created.id }],
				update: { name: "After", updatedAt: new Date() },
			});

			const update = statements.find((statement) => statement.startsWith("UPDATE"));
			expect(update).toBeDefined();
			expect(update).not.toContain("CURRENT_TIMESTAMP");
			// `name` and `updated_at`, once each — the payload, verbatim.
			expect(update?.match(/"updated_at" =/g)).toHaveLength(1);
			expect(update?.match(/"name" =/g)).toHaveLength(1);
		} finally {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- restore the spy.
			(dataSource!.manager as any).query = original;
		}
	});

	test("auth writes do not fire TypeORM entity subscribers", async () => {
		// Raw SQL never constructs an entity, so a subscriber a consumer registered for their own
		// domain logic — an audit trail, a cache eviction — is not triggered by session refreshes
		// or token cleanup it knows nothing about.
		const dataSource = context.dataSource;
		expect(dataSource!.subscribers).toHaveLength(0);

		let broadcasts = 0;
		dataSource!.subscribers.push({
			listenTo: () => User,
			afterUpdate: () => {
				broadcasts++;
			},
		});
		try {
			const db = context.auth.db;
			const created = await db.create<Record<string, unknown>, { id: string }>({
				model: "user",
				data: {
					email: "subscriber@example.com",
					name: "Subscriber",
					emailVerified: false,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			});
			await db.update({
				model: "user",
				where: [{ field: "id", value: created.id }],
				update: { name: "Changed", updatedAt: new Date() },
			});
			expect(broadcasts).toBe(0);
		} finally {
			dataSource!.subscribers.pop();
		}
	});
});
