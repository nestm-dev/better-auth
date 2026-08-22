import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { ARMS, createArm } from "./harness.ts";
import type { Arm, ArmContext } from "./harness.ts";
import { MEMBER_EMAIL, ORG_SLUG, runScenario, scenarioOptions } from "./scenario.ts";
import type { ScenarioResult } from "./scenario.ts";

/**
 * Every Better Auth flow the target application depends on, run identically on the Drizzle
 * reference adapter and on the TypeORM adapter.
 *
 * These are behavioural assertions on the flows themselves. `differential.spec.ts` then asserts
 * that the ROWS the two arms left behind are the same, which is the stronger statement.
 */
describe.each(ARMS)("flows on the %s adapter", (arm: Arm) => {
	let context: ArmContext;
	let result: ScenarioResult;
	const scenario = scenarioOptions();

	beforeAll(async () => {
		context = await createArm(arm, scenario.options);
		result = await runScenario(context, scenario);
	});

	afterAll(async () => {
		await context?.dispose();
	});

	test("signs a user up and issues a session", () => {
		expect(result.ownerId).toMatch(/^\w+$/);
		expect(result.firstSessionToken.length).toBeGreaterThan(0);
	});

	test("refreshes the session once it is past updateAge", () => {
		// The refresh extends `expiresAt`; equal values would mean `getSession` never wrote.
		expect(result.refreshedSessionExpiry).toBeGreaterThan(result.initialSessionExpiry);
	});

	test("consumes a one-time email OTP, leaving no verification row behind", async () => {
		expect(result.otpUserId.length).toBeGreaterThan(0);
		const verifications = await context.readTable("verification");
		expect(verifications).toHaveLength(0);
	});

	test("creates an organization, invites, and accepts", () => {
		expect(result.organizationId.length).toBeGreaterThan(0);
		expect(result.invitationStatus).toBe("accepted");
		expect(result.memberOrganizationIds).toEqual([result.organizationId]);
	});

	test("counts, sorts, limits and offsets", async () => {
		expect(result.memberCount).toBe(2);
		expect(result.fullOrganizationMemberCount).toBe(2);
		expect(result.sortedMemberUserIds).toHaveLength(2);
		const reverseSortedMembers = await context.auth.db.findMany<{ userId: string }>({
			model: "member",
			where: [{ field: "organizationId", value: result.organizationId }],
			sortBy: { field: "userId", direction: "desc" },
			limit: 10,
		});
		expect(reverseSortedMembers.map((member) => member.userId)).toEqual(
			result.sortedMemberUserIds.toReversed(),
		);
		expect(result.pagedOrganizationSlugs).toEqual([ORG_SLUG]);
		expect(result.pagedPastEndIsEmpty).toBe(true);
	});

	test("completes the MCP OAuth register / authorize / token exchange", async () => {
		expect(result.clientId.length).toBeGreaterThan(0);
		expect(result.hasAccessToken).toBe(true);
		const tokens = await context.readTable("oauth_access_token");
		expect(tokens).toHaveLength(1);
	});

	describe("where operators", () => {
		test("eq, ne, in, not_in, contains, starts_with, ends_with and null handling", async () => {
			const db = context.auth.db;
			const find = async (where: Parameters<typeof db.findMany>[0]["where"]) =>
				(await db.findMany<{ email: string }>({ model: "user", where, limit: 100 })).map(
					(row) => row.email,
				);

			expect(await find([{ field: "email", value: MEMBER_EMAIL }])).toEqual([MEMBER_EMAIL]);
			expect(await find([{ field: "email", value: MEMBER_EMAIL, operator: "ne" }])).not.toContain(
				MEMBER_EMAIL,
			);
			expect(await find([{ field: "email", value: [MEMBER_EMAIL], operator: "in" }])).toEqual([
				MEMBER_EMAIL,
			]);
			expect(
				await find([{ field: "email", value: [MEMBER_EMAIL], operator: "not_in" }]),
			).not.toContain(MEMBER_EMAIL);
			expect(await find([{ field: "email", value: "member", operator: "contains" }])).toEqual([
				MEMBER_EMAIL,
			]);
			expect(await find([{ field: "email", value: "member@", operator: "starts_with" }])).toEqual([
				MEMBER_EMAIL,
			]);
			expect(
				await find([{ field: "email", value: "ber@example.com", operator: "ends_with" }]),
			).toEqual([MEMBER_EMAIL]);
			// `image` is null for every user, so this separates `IS NULL` from `= NULL`, which
			// matches nothing in SQL.
			expect((await find([{ field: "image", value: null }])).length).toBeGreaterThan(0);
			expect(await find([{ field: "image", value: null, operator: "ne" }])).toEqual([]);
		});

		test("case-insensitive mode", async () => {
			const db = context.auth.db;
			const upper = MEMBER_EMAIL.toUpperCase();
			expect(
				await db.findOne<{ email: string }>({
					model: "user",
					where: [{ field: "email", value: upper, mode: "insensitive" }],
				}),
			).toMatchObject({ email: MEMBER_EMAIL });
			expect(
				await db.findOne({ model: "user", where: [{ field: "email", value: upper }] }),
			).toBeNull();
		});

		test("an empty `in` matches nothing and an empty `not_in` matches everything", async () => {
			const db = context.auth.db;
			const all = await db.findMany({ model: "user", limit: 100 });
			expect(
				await db.findMany({
					model: "user",
					where: [{ field: "email", value: [], operator: "in" }],
					limit: 100,
				}),
			).toEqual([]);
			expect(
				await db.findMany({
					model: "user",
					where: [{ field: "email", value: [], operator: "not_in" }],
					limit: 100,
				}),
			).toHaveLength(all.length);
		});

		test("AND and OR groups combine as (AND) AND (OR)", async () => {
			const db = context.auth.db;
			const rows = await db.findMany<{ email: string }>({
				model: "user",
				where: [
					{ field: "emailVerified", value: false, connector: "AND" },
					{ field: "email", value: MEMBER_EMAIL, connector: "OR" },
					{ field: "email", value: "nobody@example.com", connector: "OR" },
				],
				limit: 100,
			});
			expect(rows.map((row) => row.email)).toEqual([MEMBER_EMAIL]);
		});
	});

	test("reads a bigint column back as a number", async () => {
		const db = context.auth.db;
		await db.create({
			model: "rateLimit",
			data: { key: `probe-${arm}`, count: 3, lastRequest: 1_760_000_000_000 },
		});
		const row = await db.findOne<{ count: number; lastRequest: number }>({
			model: "rateLimit",
			where: [{ field: "key", value: `probe-${arm}` }],
		});
		expect(row).not.toBeNull();
		expect(typeof row?.lastRequest).toBe("number");
		expect(row?.lastRequest).toBe(1_760_000_000_000);
		expect(typeof row?.count).toBe("number");
	});

	test("updateMany and deleteMany report the number of affected rows", async () => {
		const db = context.auth.db;
		for (const index of [1, 2, 3]) {
			await db.create({
				model: "rateLimit",
				data: { key: `bulk-${arm}-${index}`, count: 0, lastRequest: index },
			});
		}
		const updated = await db.updateMany({
			model: "rateLimit",
			where: [{ field: "key", value: `bulk-${arm}-`, operator: "starts_with" }],
			update: { count: 9 },
		});
		expect(updated).toBe(3);

		const deleted = await db.deleteMany({
			model: "rateLimit",
			where: [{ field: "key", value: `bulk-${arm}-`, operator: "starts_with" }],
		});
		expect(deleted).toBe(3);
		expect(
			await db.deleteMany({
				model: "rateLimit",
				where: [{ field: "key", value: "nothing-matches-this" }],
			}),
		).toBe(0);
	});

	test("update returns the updated row and null when nothing matched", async () => {
		const db = context.auth.db;
		const updated = await db.update<{ name: string }>({
			model: "user",
			where: [{ field: "email", value: MEMBER_EMAIL }],
			update: { name: "Renamed Member" },
		});
		expect(updated).toMatchObject({ name: "Renamed Member" });

		expect(
			await db.update({
				model: "user",
				where: [{ field: "email", value: "ghost@example.com" }],
				update: { name: "nobody" },
			}),
		).toBeNull();
	});
});
