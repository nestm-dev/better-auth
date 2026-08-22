import type { BetterAuthOptions } from "better-auth/types";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
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

	test("holds an organization-keyed advisory lock until its transaction ends", async () => {
		const dataSource = context.dataSource!;
		const coordinator = createTypeormBetterAuthOrganizationLifecycleCoordinator(dataSource);
		const organizationId = "organization-lock-target";

		await coordinator.run(organizationId, async () => {
			const [sameOrganization, differentOrganization] = await dataSource.transaction(
				async (manager) => {
					const same = await manager.query(TRY_ADVISORY_LOCK_SQL, [organizationId]);
					const different = await manager.query(TRY_ADVISORY_LOCK_SQL, ["different-organization"]);
					return [advisoryLockResult(same), advisoryLockResult(different)] as const;
				},
			);

			expect(sameOrganization).toBe(false);
			expect(differentOrganization).toBe(true);
		});

		const released = await dataSource.transaction(async (manager) => {
			const rows = await manager.query(TRY_ADVISORY_LOCK_SQL, [organizationId]);
			return advisoryLockResult(rows);
		});
		expect(released).toBe(true);
	});
});
