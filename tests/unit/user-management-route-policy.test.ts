import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
	BETTER_AUTH_USER_MANAGEMENT_PATHS,
	BetterAuthUserManagementRoutePolicy,
} from "../../src/index.ts";

describe("BetterAuthUserManagementRoutePolicy", () => {
	it("uses one segment-safe wildcard for the complete admin namespace", () => {
		expect(BETTER_AUTH_USER_MANAGEMENT_PATHS).toEqual(["/admin/*"]);
	});

	it("returns a stable opt-in denial", () => {
		expect(new BetterAuthUserManagementRoutePolicy().evaluate()).toEqual({
			effect: "deny",
			status: HttpStatus.FORBIDDEN,
			body: {
				statusCode: HttpStatus.FORBIDDEN,
				code: "USER_MANAGEMENT_FACADE_REQUIRED",
				message: "Use the application's user-management endpoints.",
			},
			headers: undefined,
		});
	});
});
