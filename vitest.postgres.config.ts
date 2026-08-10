import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/postgres/**/*.spec.ts"],
		setupFiles: ["tests/setup.ts", "tests/postgres/require-postgres.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		pool: "forks",
		// Each arm provisions its own schema, but the concurrency suite hammers a shared
		// connection pool and the differential compares whole-table snapshots. Serial files keep
		// both honest and keep the Postgres connection count bounded.
		fileParallelism: false,
	},
});
