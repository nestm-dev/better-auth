import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
	BETTER_AUTH_ORGANIZATION_CONTROL_PLANE_PATHS,
	BetterAuthOrganizationControlPlaneRoutePolicy,
} from "../../src/index.ts";

describe("BetterAuthOrganizationControlPlaneRoutePolicy", () => {
	it("covers the application organization and account lifecycle routes", () => {
		expect(BETTER_AUTH_ORGANIZATION_CONTROL_PLANE_PATHS).toEqual([
			"/organization/update",
			"/organization/get-full-organization",
			"/organization/has-permission",
			"/organization/invite-member",
			"/organization/resend-invitation",
			"/organization/cancel-invitation",
			"/organization/list-invitations",
			"/organization/list-members",
			"/organization/remove-member",
			"/organization/update-member-role",
			"/organization/leave",
			"/organization/accept-invitation",
			"/organization/reject-invitation",
			"/organization/get-invitation",
			"/organization/list-user-invitations",
		]);
	});

	it("returns a stable opt-in denial", () => {
		expect(new BetterAuthOrganizationControlPlaneRoutePolicy().evaluate()).toEqual({
			effect: "deny",
			status: HttpStatus.FORBIDDEN,
			body: {
				statusCode: HttpStatus.FORBIDDEN,
				code: "ORGANIZATION_CONTROL_PLANE_FACADE_REQUIRED",
				message: "Use the application's organization control-plane endpoints.",
			},
			headers: undefined,
		});
	});
});
