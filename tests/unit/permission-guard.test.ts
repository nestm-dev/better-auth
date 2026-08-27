import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import {
	BetterAuthGuard,
	MemberHasPermission,
	UserHasPermission,
	type AnyAuth,
} from "../../src/index.ts";

interface PermissionInput {
	body: { permissions: Record<string, string[]>; organizationId?: string };
	headers: Headers;
}

function createHandler(): () => void {
	return () => undefined;
}

function httpContext(handler: () => void, headers: Record<string, string>): ExecutionContext {
	const request = { headers };
	return {
		getHandler: () => handler,
		getClass: () => httpContext,
		getType: () => "http",
		switchToHttp: () => ({ getRequest: () => request }),
	} as unknown as ExecutionContext;
}

describe("BetterAuthGuard permission checks", () => {
	it.each([
		["@UserHasPermission", UserHasPermission.KEY, "userHasPermission"],
		["@MemberHasPermission", MemberHasPermission.KEY, "hasPermission"],
	] as const)("passes the authenticated caller to %s", async (_label, metadataKey, endpoint) => {
		const permissions = { project: ["read"] };
		const handler = createHandler();
		Reflect.defineMetadata(metadataKey, { permissions }, handler);

		const checkPermission = vi.fn(async (_input: PermissionInput) => ({ success: true }));
		const auth: AnyAuth = {
			handler: vi.fn(async () => new Response()),
			api: {
				getSession: vi.fn(async () => ({
					user: { id: "caller", role: "user" },
					session: { id: "session", activeOrganizationId: "authoritative-organization" },
				})),
				[endpoint]: checkPermission,
			},
			options: {},
			$context: Promise.resolve({}),
			$Infer: { Session: {} },
			$ERROR_CODES: {},
		};
		const guard = new BetterAuthGuard(new Reflector(), auth);

		await expect(
			guard.canActivate(httpContext(handler, { authorization: "Bearer caller-session" })),
		).resolves.toBe(true);

		expect(checkPermission).toHaveBeenCalledOnce();
		const input = checkPermission.mock.calls[0]?.[0];
		expect(input?.body).toEqual(
			endpoint === "hasPermission"
				? { permissions, organizationId: "authoritative-organization" }
				: { permissions },
		);
		expect(input?.body).not.toHaveProperty("role");
		expect(input?.headers).toBeInstanceOf(Headers);
		expect(input?.headers?.get("authorization")).toBe("Bearer caller-session");
	});
});
