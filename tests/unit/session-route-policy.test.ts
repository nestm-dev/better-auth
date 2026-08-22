import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
	BETTER_AUTH_SESSION_MANAGEMENT_PATHS,
	BetterAuthSessionManagementRoutePolicy,
} from "../../src/index.ts";

describe("BetterAuthSessionManagementRoutePolicy", () => {
	it("covers every token-oriented Better Auth session-management route", () => {
		expect(BETTER_AUTH_SESSION_MANAGEMENT_PATHS).toEqual([
			"/list-sessions",
			"/revoke-session",
			"/revoke-other-sessions",
			"/revoke-sessions",
		]);
	});

	it("returns a stable opt-in denial", () => {
		expect(new BetterAuthSessionManagementRoutePolicy().evaluate()).toEqual({
			effect: "deny",
			status: HttpStatus.FORBIDDEN,
			body: {
				statusCode: HttpStatus.FORBIDDEN,
				code: "SESSION_MANAGEMENT_FACADE_REQUIRED",
				message: "Use the application's session-management endpoints.",
			},
			headers: undefined,
		});
	});
});
