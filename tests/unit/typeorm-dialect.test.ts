import type { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";

import { typeormAdapter } from "../../src/typeorm/index.ts";

function dataSourceWithDriver(type: string): DataSource {
	// Construction validates only `options.type`; no driver package or database is needed to
	// prove that an unverified dialect is refused before the first auth operation.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal construction-time DataSource fixture
	return { options: { type }, driver: {} } as unknown as DataSource;
}

describe("TypeORM adapter driver validation", () => {
	it("accepts TypeORM's standard postgres driver at construction", () => {
		expect(() => typeormAdapter(dataSourceWithDriver("postgres"))).not.toThrow();
	});

	it.each(["aurora-postgres", "cockroachdb"])(
		'rejects the unverified "%s" driver at construction',
		(type) => {
			expect(() => typeormAdapter(dataSourceWithDriver(type))).toThrow(
				new RegExp(
					`Unsupported TypeORM driver "${type}".*only verified against ` +
						`TypeORM's standard "postgres" driver`,
					"s",
				),
			);
		},
	);

	it("rejects a non-PostgreSQL driver at construction", () => {
		expect(() => typeormAdapter(dataSourceWithDriver("mysql"))).toThrow(
			/Unsupported TypeORM driver "mysql"/,
		);
	});
});
