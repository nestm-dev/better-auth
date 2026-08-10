import { afterAll, beforeAll, expect, test } from "vitest";

import { AUTH_TABLES, captureTables, createArm } from "./harness.ts";
import type { ArmContext } from "./harness.ts";
import { runScenario, scenarioOptions } from "./scenario.ts";
import type { ScenarioResult } from "./scenario.ts";

let drizzleArm: ArmContext;
let typeormArm: ArmContext;
let drizzleCapture: Record<string, unknown[]>;
let typeormCapture: Record<string, unknown[]>;
let drizzleResult: ScenarioResult;
let typeormResult: ScenarioResult;

/**
 * The strongest statement this suite can make.
 *
 * `flows.spec.ts` asserts that each flow does what it should. This asserts that after running
 * the SAME flows against the SAME DDL, the rows the TypeORM adapter left behind are
 * indistinguishable from the ones `@better-auth/drizzle-adapter` left behind — across all 11
 * tables, column by column, including each value's JavaScript type.
 *
 * That catches the whole class of bug an adapter's own tests cannot: a column written under
 * the wrong name, a boolean stored as a string, a `bigint` read back as a string, a date an
 * hour off, a nullable column defaulted differently.
 */
beforeAll(async () => {
	const drizzleScenario = scenarioOptions();
	drizzleArm = await createArm("drizzle", drizzleScenario.options);
	drizzleResult = await runScenario(drizzleArm, drizzleScenario);
	drizzleCapture = await captureTables(drizzleArm);

	const typeormScenario = scenarioOptions();
	typeormArm = await createArm("typeorm", typeormScenario.options);
	typeormResult = await runScenario(typeormArm, typeormScenario);
	typeormCapture = await captureTables(typeormArm);
});

afterAll(async () => {
	await drizzleArm?.dispose();
	await typeormArm?.dispose();
});

test("the same tables end up populated, and the same ones end up empty", () => {
	const populated = (capture: Record<string, unknown[]>) =>
		AUTH_TABLES.filter((table) => (capture[table]?.length ?? 0) > 0);

	// `verification` is empty because the OTP was CONSUMED — an adapter whose `consumeOne`
	// silently failed to delete would show a row here. `oauth_consent` stays empty because the
	// MCP client is first-party, and `rate_limit` because enforcement is off in this scenario
	// (`rate-limit.spec.ts` covers it).
	expect(populated(typeormCapture)).toEqual([
		"user",
		"session",
		"account",
		"organization",
		"member",
		"invitation",
		"oauth_application",
		"oauth_access_token",
	]);
	expect(populated(typeormCapture)).toEqual(populated(drizzleCapture));
});

test.each(AUTH_TABLES)("table `%s` is identical across both adapters", (table) => {
	expect(typeormCapture[table]).toEqual(drizzleCapture[table]);
});

test("the flows themselves observed the same outcomes", () => {
	const comparable = (result: ScenarioResult) => ({
		invitationStatus: result.invitationStatus,
		memberCount: result.memberCount,
		fullOrganizationMemberCount: result.fullOrganizationMemberCount,
		organizationsJoined: result.memberOrganizationIds.length,
		sortedMemberCount: result.sortedMemberUserIds.length,
		pagedOrganizationSlugs: result.pagedOrganizationSlugs,
		pagedPastEndIsEmpty: result.pagedPastEndIsEmpty,
		hasAccessToken: result.hasAccessToken,
		sessionWasRefreshed: result.refreshedSessionExpiry > result.initialSessionExpiry,
	});

	expect(comparable(typeormResult)).toEqual(comparable(drizzleResult));
});
