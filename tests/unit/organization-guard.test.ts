import { Reflector } from "@nestjs/core";
import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host";
import { describe, expect, it, vi } from "vitest";
import {
	BetterAuthGuard,
	MemberHasPermission,
	OrgRoles,
	RequireActiveOrg,
	type AnyAuth,
} from "../../src/index.ts";

class RequiresActiveOrganizationController {
	@OrgRoles(["owner"])
	admin(this: void): void {}

	@RequireActiveOrg()
	read(this: void): void {}

	@MemberHasPermission({ permissions: { organization: ["update"] } })
	update(this: void): void {}
}

function executionContext(
	handler = RequiresActiveOrganizationController.prototype.read,
): ExecutionContextHost {
	const context = new ExecutionContextHost(
		[
			{
				headers: {
					authorization: "Bearer authoritative-session",
					cookie: "better-auth.session_data=stale-cookie-selector",
				},
			},
		],
		RequiresActiveOrganizationController,
		handler,
	);
	context.setType("http");
	return context;
}

function authWithOrganizationApi(organizationApi: Record<string, unknown>): AnyAuth {
	return {
		handler: async (_request: Request) => new Response(),
		api: {
			getSession: vi.fn(async (_input: unknown) => ({
				session: { activeOrganizationId: "authoritative-organization" },
				user: { id: "user-id" },
			})),
			...organizationApi,
		},
		options: {},
		$context: Promise.resolve({}),
		$Infer: { Session: {} },
		$ERROR_CODES: {},
	} satisfies AnyAuth;
}

describe("BetterAuthGuard organization membership lookup", () => {
	it("passes the authoritative session organization to getActiveMemberRole", async () => {
		const getActiveMemberRole = vi.fn(async (_input: unknown) => ({ role: "member" }));
		const auth = authWithOrganizationApi({ getActiveMemberRole });
		const guard = new BetterAuthGuard(new Reflector(), auth);

		await expect(guard.canActivate(executionContext())).resolves.toBe(true);

		expect(auth.api.getSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: { disableCookieCache: true },
		});
		expect(getActiveMemberRole).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: { organizationId: "authoritative-organization" },
		});
	});

	it("passes the same authoritative organization to the getActiveMember fallback", async () => {
		const getActiveMember = vi.fn(async (_input: unknown) => ({
			organizationId: "authoritative-organization",
			role: "member",
		}));
		const guard = new BetterAuthGuard(
			new Reflector(),
			authWithOrganizationApi({ getActiveMember }),
		);

		await expect(guard.canActivate(executionContext())).resolves.toBe(true);

		expect(getActiveMember).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: { organizationId: "authoritative-organization" },
		});
	});

	it("fails closed when the fallback resolves a member from a stale organization", async () => {
		const getActiveMember = vi.fn(async (_input: unknown) => ({
			organizationId: "stale-cookie-organization",
			role: "owner",
		}));
		const guard = new BetterAuthGuard(
			new Reflector(),
			authWithOrganizationApi({ getActiveMember }),
		);

		await expect(guard.canActivate(executionContext())).rejects.toMatchObject({
			response: { message: "Active organization membership is required" },
		});
	});

	it("pins MemberHasPermission to the authoritative selector instead of the signed cookie", async () => {
		const hasPermission = vi.fn(async (_input: unknown) => ({ success: true }));
		const guard = new BetterAuthGuard(new Reflector(), authWithOrganizationApi({ hasPermission }));

		await expect(
			guard.canActivate(executionContext(RequiresActiveOrganizationController.prototype.update)),
		).resolves.toBe(true);

		expect(hasPermission).toHaveBeenCalledWith({
			body: {
				permissions: { organization: ["update"] },
				organizationId: "authoritative-organization",
			},
			headers: expect.any(Headers),
		});
	});
});

describe("request-specific organization selection", () => {
	it("checks roles and permissions for each requested organization without changing the session", async () => {
		const sharedSession = Object.freeze({
			session: Object.freeze({ activeOrganizationId: "cookie-org" }),
			user: Object.freeze({ id: "viewer" }),
		});
		const getActiveMemberRole = vi.fn(async (input: { query: { organizationId: string } }) => ({
			role: input.query.organizationId === "first" ? "owner" : "member",
		}));
		const hasPermission = vi.fn(async (_input: unknown) => ({ success: true }));
		const auth = authWithOrganizationApi({
			getActiveMemberRole,
			hasPermission,
			getSession: vi.fn(async () => sharedSession),
		});
		const guard = new BetterAuthGuard(new Reflector(), auth, {
			auth,
			organizationResolver: {
				resolve: ({ request }) =>
					(request as { params: { organizationId?: string } }).params.organizationId,
			},
		});
		const scoped = (
			organizationId: string,
			handler = RequiresActiveOrganizationController.prototype.admin,
		) => {
			const context = executionContext(handler);
			context.switchToHttp().getRequest<{ params: { organizationId: string } }>().params = {
				organizationId,
			};
			return context;
		};
		const first = scoped("first");
		const second = scoped("second");
		await expect(guard.canActivate(first)).resolves.toBe(true);
		await expect(guard.canActivate(second)).rejects.toMatchObject({
			response: { message: "Insufficient organization permissions" },
		});
		await expect(
			guard.canActivate(scoped("second", RequiresActiveOrganizationController.prototype.update)),
		).resolves.toBe(true);
		expect(hasPermission).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { permissions: { organization: ["update"] }, organizationId: "second" },
		});
		expect(
			first.switchToHttp().getRequest<{ resolvedOrganizationId: string }>().resolvedOrganizationId,
		).toBe("first");
		expect(sharedSession.session.activeOrganizationId).toBe("cookie-org");
	});

	it.each([null, undefined, ""])(
		"does not fall back to a session organization for %s",
		async (selection) => {
			const getActiveMemberRole = vi.fn(async () => ({ role: "owner" }));
			const hasPermission = vi.fn(async () => ({ success: true }));
			const auth = authWithOrganizationApi({ getActiveMemberRole, hasPermission });
			const guard = new BetterAuthGuard(new Reflector(), auth, {
				auth,
				organizationResolver: { resolve: () => selection },
			});
			await expect(guard.canActivate(executionContext())).rejects.toThrow();
			await expect(
				guard.canActivate(executionContext(RequiresActiveOrganizationController.prototype.update)),
			).rejects.toThrow();
			expect(getActiveMemberRole).not.toHaveBeenCalled();
			expect(hasPermission).not.toHaveBeenCalled();
		},
	);

	it("does not continue when the resolver fails", async () => {
		const getActiveMemberRole = vi.fn(async () => ({ role: "owner" }));
		const auth = authWithOrganizationApi({ getActiveMemberRole });
		const guard = new BetterAuthGuard(new Reflector(), auth, {
			auth,
			organizationResolver: {
				resolve: () => {
					throw new Error("invalid route");
				},
			},
		});
		await expect(guard.canActivate(executionContext())).rejects.toThrow("invalid route");
		expect(getActiveMemberRole).not.toHaveBeenCalled();
	});
});
