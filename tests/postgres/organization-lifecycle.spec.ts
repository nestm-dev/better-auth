import type { BetterAuthOptions } from "better-auth/types";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
	createTypeormBetterAuthControlPlaneLifecycleCoordinator,
	createTypeormBetterAuthOrganizationLifecycleCoordinator,
	typeormAdapter,
} from "../../src/typeorm/index.ts";
import { createArm } from "./harness.ts";
import type { ArmContext } from "./harness.ts";

const MINIMAL_OPTIONS = {
	rateLimit: { storage: "database" },
} as unknown as BetterAuthOptions;

const TRY_ADVISORY_LOCK_SQL =
	"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired";

function advisoryLockResult(value: unknown): boolean {
	if (!Array.isArray(value)) {
		throw new TypeError("PostgreSQL returned an invalid advisory-lock result.");
	}
	const row: unknown = value[0];
	if (
		typeof row !== "object" ||
		row === null ||
		!("acquired" in row) ||
		typeof row.acquired !== "boolean"
	) {
		throw new TypeError("PostgreSQL returned an invalid advisory-lock result.");
	}
	return row.acquired;
}

describe("TypeORM organization lifecycle coordinator", () => {
	let context: ArmContext;

	beforeAll(async () => {
		context = await createArm("typeorm");
	});

	afterAll(async () => {
		await context?.dispose();
	});

	test("makes Better Auth adapter transactions join its commit and rollback", async () => {
		const dataSource = context.dataSource!;
		const coordinator = createTypeormBetterAuthOrganizationLifecycleCoordinator(dataSource);
		const db = typeormAdapter(dataSource, {
			getManager: coordinator.getManager,
			transaction: true,
		})(MINIMAL_OPTIONS);

		await coordinator.run("org-commit", async () => {
			await db.transaction(async (trx) => {
				await trx.create({
					model: "rateLimit",
					data: { key: "lifecycle-commit", count: 1, lastRequest: 1 },
				});
			});
		});
		expect(
			await db.findOne({
				model: "rateLimit",
				where: [{ field: "key", value: "lifecycle-commit" }],
			}),
		).not.toBeNull();

		await expect(
			coordinator.run("org-rollback", async () => {
				await db.transaction(async (trx) => {
					await trx.create({
						model: "rateLimit",
						data: {
							key: "lifecycle-rollback",
							count: 1,
							lastRequest: 1,
						},
					});
				});
				throw new Error("roll back lifecycle mutation");
			}),
		).rejects.toThrow("roll back lifecycle mutation");
		expect(
			await db.findOne({
				model: "rateLimit",
				where: [{ field: "key", value: "lifecycle-rollback" }],
			}),
		).toBeNull();
	});

	test("dual-locks legacy and namespaced organization keys during rolling upgrades", async () => {
		const dataSource = context.dataSource!;
		const coordinator = createTypeormBetterAuthControlPlaneLifecycleCoordinator(dataSource);
		const organizationId = "organization-lock-target";

		await coordinator.run("organization", organizationId, async () => {
			const [legacyProcessKey, namespacedKey, differentOrganization] = await dataSource.transaction(
				async (manager) => {
					const legacy = await manager.query(TRY_ADVISORY_LOCK_SQL, [organizationId]);
					const namespaced = await manager.query(TRY_ADVISORY_LOCK_SQL, [
						`organization:${organizationId}`,
					]);
					const different = await manager.query(TRY_ADVISORY_LOCK_SQL, [
						"organization:different-organization",
					]);
					return [
						advisoryLockResult(legacy),
						advisoryLockResult(namespaced),
						advisoryLockResult(different),
					] as const;
				},
			);

			expect(legacyProcessKey).toBe(false);
			expect(namespacedKey).toBe(false);
			expect(differentOrganization).toBe(true);
		});

		const released = await dataSource.transaction(async (manager) => {
			const legacy = await manager.query(TRY_ADVISORY_LOCK_SQL, [organizationId]);
			const namespaced = await manager.query(TRY_ADVISORY_LOCK_SQL, [
				`organization:${organizationId}`,
			]);
			return [advisoryLockResult(legacy), advisoryLockResult(namespaced)] as const;
		});
		expect(released).toEqual([true, true]);
	});

	test("namespaces equal user and organization ids while sharing the adapter transaction", async () => {
		const dataSource = context.dataSource!;
		const coordinator = createTypeormBetterAuthControlPlaneLifecycleCoordinator(dataSource);
		const resourceId = "shared-resource-id";

		await coordinator.run("user", resourceId, async () => {
			const [sameUser, sameIdOrganization] = await dataSource.transaction(async (manager) => {
				const same = await manager.query(TRY_ADVISORY_LOCK_SQL, [`user:${resourceId}`]);
				const otherScope = await manager.query(TRY_ADVISORY_LOCK_SQL, [
					`organization:${resourceId}`,
				]);
				return [advisoryLockResult(same), advisoryLockResult(otherScope)] as const;
			});

			expect(sameUser).toBe(false);
			expect(sameIdOrganization).toBe(true);
		});
	});
});
