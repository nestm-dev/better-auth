import { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";

import { typeormAdapter } from "../../src/typeorm/adapter.ts";
import type {
	TypeormCallableCapability,
	TypeormDataSource,
	TypeormEntityManager,
} from "../../src/typeorm/types.ts";

/** Simulates an equivalent DataSource class arriving from another peer path. */
class LinkedWorkspaceDataSource implements TypeormDataSource {
	readonly #nominalBrand = true;
	readonly getMetadata: TypeormCallableCapability;
	readonly transaction: TypeormCallableCapability;

	constructor(private readonly source: DataSource) {
		this.getMetadata = source.getMetadata.bind(source);
		this.transaction = source.transaction.bind(source);
	}

	get hasPrivateBrand(): boolean {
		return this.#nominalBrand;
	}

	get options(): TypeormDataSource["options"] {
		return this.source.options;
	}

	get driver(): TypeormDataSource["driver"] {
		return this.source.driver;
	}

	get entityMetadatas(): TypeormDataSource["entityMetadatas"] {
		return this.source.entityMetadatas;
	}

	get manager(): TypeormEntityManager {
		return this.source.manager;
	}
}

describe("TypeORM adapter portability", () => {
	it("accepts a privately branded consumer DataSource through structural capabilities", () => {
		const source = new LinkedWorkspaceDataSource(
			new DataSource({ type: "postgres", entities: [] }),
		);

		expect(source.hasPrivateBrand).toBe(true);
		expect(typeormAdapter(source)).toBeTypeOf("function");
	});
});
