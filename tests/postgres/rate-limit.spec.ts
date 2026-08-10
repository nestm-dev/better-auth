import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { ARMS, createArm } from "./harness.ts";
import type { Arm, ArmContext } from "./harness.ts";
import type { BetterAuthOptions } from "better-auth/types";

const MAX_REQUESTS = 5;
const ATTEMPTS = 12;
const BASE_URL = "http://localhost:3000";

/**
 * The database-backed rate limiter, which is the only production caller of `incrementOne`.
 *
 * It is also the only place a `bigint` column is read back and compared numerically:
 * `rate_limit.last_request` holds epoch millis, node-pg returns `int8` as a STRING, and raw SQL
 * bypasses any TypeORM `ValueTransformer` that would otherwise fix it. Without the adapter's
 * `customTransformOutput`, `now - data.lastRequest > windowInMs` compares a number to a string
 * and every window looks expired — the limiter would let everything through.
 */
describe.each(ARMS)("database rate limiting on the %s adapter", (arm: Arm) => {
	let context: ArmContext;
	let statuses: number[];

	beforeAll(async () => {
		// Annotated, not inferred: this spec drives the HTTP handler and the adapter directly, so
		// it needs no plugin endpoints — and the wider type keeps `ArmContext` at its default.
		const options: Partial<BetterAuthOptions> = {
			rateLimit: { enabled: true, storage: "database", window: 60, max: MAX_REQUESTS },
		};
		context = await createArm(arm, options);

		statuses = [];
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			const response = await context.auth.auth.handler(
				new Request(`${BASE_URL}/api/auth/sign-in/email`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-forwarded-for": "203.0.113.7",
					},
					body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password" }),
				}),
			);
			statuses.push(response.status);
		}
	});

	afterAll(async () => {
		await context?.dispose();
	});

	test("admits the first requests and then starts refusing", () => {
		expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
		expect(statuses.filter((status) => status !== 429).length).toBeGreaterThan(0);
		// Refusals must come after admissions, never interleaved: an interleaved pattern means
		// the counter was being lost and re-read.
		const firstRefusal = statuses.indexOf(429);
		expect(statuses.slice(firstRefusal).every((status) => status === 429)).toBe(true);
	});

	test("persists exactly one counter row whose count is the number admitted", async () => {
		const rows = await context.readTable("rate_limit");
		expect(rows).toHaveLength(1);
		// `/sign-in/email` carries a stricter built-in rule than the global `max`, so the ceiling
		// is not `MAX_REQUESTS`. The invariant that matters is the one an adapter can break:
		// the persisted counter equals the number of requests that were actually let through.
		const admitted = statuses.filter((status) => status !== 429).length;
		expect(Number(rows[0]?.count)).toBe(admitted);
	});

	test("reads `last_request` back as a number, not the string node-pg returns", async () => {
		const row = await context.auth.db.findOne<{ count: number; lastRequest: number }>({
			model: "rateLimit",
			where: [{ field: "count", operator: "gte", value: 1 }],
		});
		expect(row).not.toBeNull();
		expect(typeof row?.lastRequest).toBe("number");
		expect(typeof row?.count).toBe("number");
		// Epoch millis: comfortably inside Number.MAX_SAFE_INTEGER, and recognisably recent.
		expect(row?.lastRequest).toBeGreaterThan(1_700_000_000_000);
		expect(row?.lastRequest).toBeLessThan(Date.now() + 1000);
	});
});
