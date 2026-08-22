import { describe, expect, it, vi } from "vitest";

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
		expect(harness.queries).toHaveLength(2);
		expect(harness.queries[0]).toEqual({
			sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			parameters: [organizationId],
		});
		expect(harness.queries[0]!.sql).not.toContain(organizationId);
		expect(harness.queries[1]).toEqual({
			sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			parameters: ["org-2"],
		});
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
		).toThrow(/does not provide the PostgreSQL transaction-scoped advisory locks/);
	});
});
