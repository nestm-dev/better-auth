import { describe, expect, it, vi } from "vitest";

import { createTypeormBetterAuthControlPlaneLifecycleCoordinator } from "../../src/typeorm/control-plane-lifecycle.ts";
import { createTypeormBetterAuthOrganizationLifecycleCoordinator } from "../../src/typeorm/organization-lifecycle.ts";
import type {
	TypeormCallableCapability,
	TypeormDataSource,
	TypeormEntityManager,
} from "../../src/typeorm/types.ts";

interface QueryCall {
	readonly parameters: readonly unknown[];
	readonly sql: string;
}

function createDataSource(driverType = "postgres") {
	const queries: QueryCall[] = [];
	let transactionCalls = 0;
	const query = vi.fn(async (sql: string, parameters: readonly unknown[]) => {
		queries.push({ sql, parameters });
		return [];
	});
	const manager: TypeormEntityManager = {
		query,
	};
	const transaction = (async (
		callback: (transactionManager: TypeormEntityManager) => Promise<unknown>,
	) => {
		transactionCalls += 1;
		return await callback(manager);
	}) as TypeormCallableCapability;
	const dataSource: TypeormDataSource = {
		options: { type: driverType },
		driver: {
			escape: (identifier) => `"${identifier}"`,
			createParameter: (_name, index) => `$${index + 1}`,
		},
		entityMetadatas: [],
		manager,
		getMetadata: vi.fn() as TypeormCallableCapability,
		transaction,
	};

	return {
		dataSource,
		queries,
		getTransactionCalls: () => transactionCalls,
	};
}

describe("TypeORM organization lifecycle coordinator", () => {
	it("opens one transaction, exposes its manager, and deduplicates nested locks", async () => {
		const harness = createDataSource();
		const coordinator = createTypeormBetterAuthOrganizationLifecycleCoordinator(harness.dataSource);
		const getManager = coordinator.getManager;
		const organizationId = `org-1'); SELECT pg_sleep(10); --`;

		expect(getManager()).toBeUndefined();
		await expect(
			coordinator.run(organizationId, async () => {
				expect(getManager()).toBeDefined();
				await Promise.all([
					coordinator.run(organizationId, async () => "first nested result"),
					coordinator.run(organizationId, async () => "second nested result"),
				]);
				await coordinator.run("org-2", async () => undefined);
				return "result";
			}),
		).resolves.toBe("result");

		expect(getManager()).toBeUndefined();
		expect(harness.getTransactionCalls()).toBe(1);
		expect(harness.queries).toHaveLength(4);
		expect(harness.queries.map(({ parameters }) => parameters)).toEqual([
			...[organizationId, `organization:${organizationId}`].toSorted().map((lockKey) => [lockKey]),
			...["org-2", "organization:org-2"].toSorted().map((lockKey) => [lockKey]),
		]);
		for (const { sql } of harness.queries) expect(sql).not.toContain(organizationId);
	});

	it("clears the exposed manager and propagates operation failures", async () => {
		const harness = createDataSource();
		const coordinator = createTypeormBetterAuthOrganizationLifecycleCoordinator(harness.dataSource);
		const operationError = new Error("operation failed");

		await expect(
			coordinator.run("org-1", async () => {
				throw operationError;
			}),
		).rejects.toBe(operationError);

		expect(coordinator.getManager()).toBeUndefined();
		expect(harness.getTransactionCalls()).toBe(1);
	});

	it("rejects invalid runtime inputs before opening a transaction", async () => {
		const harness = createDataSource();
		const coordinator = createTypeormBetterAuthOrganizationLifecycleCoordinator(harness.dataSource);

		await expect(coordinator.run("   ", async () => undefined)).rejects.toThrow(
			/organizationId must be a non-empty string/,
		);
		expect(harness.getTransactionCalls()).toBe(0);
	});

	it("rejects PostgreSQL-compatible dialects without advisory-lock support", () => {
		const harness = createDataSource("cockroachdb");

		expect(() =>
			createTypeormBetterAuthOrganizationLifecycleCoordinator(harness.dataSource),
		).toThrow(/only verified against TypeORM's standard "postgres" driver/);
	});
});

describe("TypeORM control-plane lifecycle coordinator", () => {
	it("shares one context while namespacing equal ids across resource scopes", async () => {
		const harness = createDataSource();
		const coordinator = createTypeormBetterAuthControlPlaneLifecycleCoordinator(harness.dataSource);

		await coordinator.run("platform", "global-administrators", async () => {
			expect(coordinator.getManager()).toBeDefined();
			await coordinator.run("organization", "same-id", async () => undefined);
			await coordinator.run("user", "same-id", async () => undefined);
			await coordinator.run("user", "same-id", async () => undefined);
		});

		expect(coordinator.getManager()).toBeUndefined();
		expect(harness.getTransactionCalls()).toBe(1);
		expect(harness.queries.map(({ parameters }) => parameters)).toEqual([
			["platform:global-administrators"],
			["organization:same-id"],
			["same-id"],
			["user:same-id"],
		]);
	});

	it.each([
		["invalid", "resource-id", /scope must be one of/],
		["user", "   ", /resourceId must be a non-empty string/],
	] as const)(
		"rejects invalid runtime scope/resource pairs",
		async (scope, resourceId, expected) => {
			const harness = createDataSource();
			const coordinator = createTypeormBetterAuthControlPlaneLifecycleCoordinator(
				harness.dataSource,
			);

			await expect(
				coordinator.run(
					scope as Parameters<typeof coordinator.run>[0],
					resourceId,
					async () => undefined,
				),
			).rejects.toThrow(expected);
			expect(harness.getTransactionCalls()).toBe(0);
		},
	);
});
