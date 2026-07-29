import { betterAuth } from "better-auth";
import { admin, bearer, organization } from "better-auth/plugins";
import type { BetterAuthOptions } from "better-auth";

export const TEST_SECRET = "better-auth-test-secret-at-least-32-chars!";
export const TEST_BASE_URL = "http://localhost:3000";

/**
 * Base better-auth config for tests: in-memory adapter (no `database` key),
 * bearer() so tests can authenticate via the Authorization header, admin()
 * and organization() for role/permission scenarios.
 */
export function createTestAuthOptions(
	overrides: Partial<BetterAuthOptions> = {},
): BetterAuthOptions {
	return {
		baseURL: TEST_BASE_URL,
		secret: TEST_SECRET,
		emailAndPassword: { enabled: true },
		telemetry: { enabled: false },
		plugins: [bearer(), admin(), organization()],
		...overrides,
	};
}

export function createTestAuth(overrides: Partial<BetterAuthOptions> = {}) {
	return betterAuth(createTestAuthOptions(overrides));
}

let userCounter = 0;

export function uniqueUser(): { email: string; password: string; name: string } {
	userCounter += 1;
	return {
		email: `user-${userCounter}-${process.pid}@example.com`,
		password: "super-secure-password",
		name: `Test User ${userCounter}`,
	};
}
