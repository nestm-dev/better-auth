import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { ARMS, createArm } from "./harness.ts";
import type { Arm, ArmContext } from "./harness.ts";
import { scenarioOptions } from "./scenario.ts";

const RACERS = 32;
const GUARD_LIMIT = 10;

/**
 * `consumeOne` and `incrementOne` are the two primitives Better Auth documents as race-safe,
 * and they are the reason this adapter issues raw SQL: both must be a single statement whose
 * predicate is simultaneously the selector and the guard.
 *
 * Every assertion here is an invariant that any correct implementation must satisfy, so both
 * arms are held to the same bar.
 */
describe.each(ARMS)("atomicity on the %s adapter", (arm: Arm) => {
	let context: ArmContext;
	const scenario = scenarioOptions();

	beforeAll(async () => {
		context = await createArm(arm, scenario.options, RACERS);
	});

	afterAll(async () => {
		await context?.dispose();
	});

	test(`consumeOne hands a single-use row to exactly one of ${RACERS} racers`, async () => {
		const db = context.auth.db;

		for (const round of [1, 2, 3]) {
			const identifier = `race-${arm}-${round}`;
			await db.create({
				model: "verification",
				data: {
					identifier,
					value: "single-use",
					expiresAt: new Date(Date.now() + 60_000),
				},
			});

			const outcomes = await Promise.all(
				Array.from({ length: RACERS }, () =>
					db.consumeOne<{ id: string }>({
						model: "verification",
						where: [{ field: "identifier", value: identifier }],
					}),
				),
			);

			const winners = outcomes.filter((outcome) => outcome !== null);
			expect(winners).toHaveLength(1);
			// Everyone who "won" must have won the same row, and the row must be gone.
			expect(new Set(winners.map((winner) => winner?.id)).size).toBe(1);
			expect(
				await db.findMany({
					model: "verification",
					where: [{ field: "identifier", value: identifier }],
					limit: 10,
				}),
			).toEqual([]);
		}
	});

	test("consumeOne never deletes a second row that also matches a non-unique predicate", async () => {
		const db = context.auth.db;
		const identifier = `multi-${arm}`;
		for (const index of [1, 2, 3]) {
			await db.create({
				model: "verification",
				data: {
					identifier,
					value: `value-${index}`,
					expiresAt: new Date(Date.now() + 60_000),
				},
			});
		}

		const consumed = await db.consumeOne<{ id: string }>({
			model: "verification",
			where: [{ field: "identifier", value: identifier }],
		});

		expect(consumed).not.toBeNull();
		const remaining = await db.findMany({
			model: "verification",
			where: [{ field: "identifier", value: identifier }],
			limit: 10,
		});
		expect(remaining).toHaveLength(2);
	});

	test(`incrementOne under ${RACERS} racers never loses or invents an update`, async () => {
		const db = context.auth.db;
		const key = `counter-${arm}`;
		await db.create({ model: "rateLimit", data: { key, count: 0, lastRequest: 0 } });

		const outcomes = await Promise.all(
			Array.from({ length: RACERS }, () =>
				db.incrementOne<{ count: number }>({
					model: "rateLimit",
					where: [{ field: "key", value: key }],
					increment: { count: 1 },
				}),
			),
		);

		const winners = outcomes.filter((outcome) => outcome !== null);
		expect(winners).toHaveLength(RACERS);

		const final = await db.findOne<{ count: number }>({
			model: "rateLimit",
			where: [{ field: "key", value: key }],
		});
		// Every racer reported success, so every increment must be visible: a lost update would
		// show up here as a count below the number of successes.
		expect(final?.count).toBe(RACERS);
		// And each racer's returned row must be a distinct step of the counter, which is what
		// makes `RETURNING` from the same statement meaningful.
		expect(new Set(winners.map((winner) => winner?.count)).size).toBe(RACERS);
	});

	test(`incrementOne honours a guard when calls are SEQUENTIAL`, async () => {
		const db = context.auth.db;
		const key = `guarded-sequential-${arm}`;
		await db.create({ model: "rateLimit", data: { key, count: 0, lastRequest: 0 } });

		let winners = 0;
		for (let attempt = 0; attempt < RACERS; attempt++) {
			const outcome = await db.incrementOne<{ count: number }>({
				model: "rateLimit",
				where: [
					{ field: "key", value: key },
					{ field: "count", operator: "lt", value: GUARD_LIMIT },
				],
				increment: { count: 1 },
			});
			if (outcome) winners++;
		}

		const final = await db.findOne<{ count: number }>({
			model: "rateLimit",
			where: [{ field: "key", value: key }],
		});

		// Uncontended, both arms compile the guard identically and both stop at the limit. This
		// is the control for the concurrent case below: it proves any difference there is a RACE,
		// not a disagreement about what `count < 10` means.
		expect(final?.count).toBe(GUARD_LIMIT);
		expect(winners).toBe(GUARD_LIMIT);
	});

	test(`incrementOne under ${RACERS} CONCURRENT racers: guard enforcement`, async () => {
		const db = context.auth.db;
		const key = `guarded-concurrent-${arm}`;
		await db.create({ model: "rateLimit", data: { key, count: 0, lastRequest: 0 } });

		const outcomes = await Promise.all(
			Array.from({ length: RACERS }, () =>
				db.incrementOne<{ count: number }>({
					model: "rateLimit",
					where: [
						{ field: "key", value: key },
						{ field: "count", operator: "lt", value: GUARD_LIMIT },
					],
					increment: { count: 1 },
				}),
			),
		);

		const winners = outcomes.filter((outcome) => outcome !== null);
		const final = await db.findOne<{ count: number }>({
			model: "rateLimit",
			where: [{ field: "key", value: key }],
		});

		// Holds for both arms: nobody may report success without their write landing.
		expect(final?.count).toBe(winners.length);

		if (arm === "typeorm") {
			// `count < 10` must not admit an eleventh writer, no matter how many racers were
			// blocked on the row when it was released. This adapter repeats the guard OUTSIDE the
			// `IN (SELECT ... LIMIT 1)` subquery precisely so Postgres re-checks it against the
			// newest row version during EvalPlanQual.
			expect(final?.count).toBe(GUARD_LIMIT);
			expect(winners).toHaveLength(GUARD_LIMIT);
		} else {
			// Recorded, not endorsed. `@better-auth/drizzle-adapter` guards only inside the
			// subquery, so every racer that was blocked on the row proceeds once it unblocks: the
			// subquery it re-evaluates still sees its original snapshot. The sequential test above
			// rules out a where-compilation difference, which leaves the race.
			//
			// If this assertion ever fails, the reference adapter has been strengthened — check
			// whether the note in README.md's "Divergences from the Drizzle adapter" still holds.
			expect(final?.count).toBeGreaterThan(GUARD_LIMIT);
		}
	});
});
