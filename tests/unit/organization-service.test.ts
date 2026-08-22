import { HttpException, Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BetterAuthOrganizationService,
	BetterAuthService,
	type AnyAuth,
	type BetterAuthControlPlaneLifecycleCoordinator,
	type BetterAuthControlPlaneLifecycleScope,
	type BetterAuthModuleOptions,
	type BetterAuthOrganizationLifecycleCoordinator,
} from "../../src/index.ts";

const CREATED_AT = new Date("2026-01-01T10:00:00.000Z");
const EXPIRES_AT = new Date("2099-09-01T10:00:00.000Z");
const EXPIRED_AT = new Date("2000-01-02T10:00:00.000Z");
const ORGANIZATION_ID = "organization-id";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function member(overrides: Record<string, unknown> = {}) {
	return {
		id: "member-id",
		userId: "member-user-id",
		organizationId: ORGANIZATION_ID,
		role: "member",
		createdAt: CREATED_AT,
		user: {
			id: "member-user-id",
			name: "Member User",
			email: "member@example.com",
			image: null,
		},
		...overrides,
	};
}

function invitation(overrides: Record<string, unknown> = {}) {
	return {
		id: "invitation-id",
		email: "invitee@example.com",
		role: "member",
		organizationId: ORGANIZATION_ID,
		inviterId: "owner-user-id",
		status: "pending",
		expiresAt: EXPIRES_AT,
		createdAt: CREATED_AT,
		...overrides,
	};
}

function invitationPreview(overrides: Record<string, unknown> = {}) {
	return {
		...invitation(),
		organizationName: "Organization",
		organizationSlug: "organization",
		inviterEmail: "owner@example.com",
		...overrides,
	};
}

function receivedInvitation(overrides: Record<string, unknown> = {}) {
	return {
		...invitation(),
		organizationName: "Organization",
		...overrides,
	};
}

function createApi(overrides: Record<string, unknown> = {}) {
	return {
		getSession: vi.fn(async (_input: unknown) => ({
			session: { id: "session-id" },
			user: { id: "member-user-id" },
		})),
		listMembers: vi.fn(async (_input: unknown) => ({ members: [member()], total: 1 })),
		updateMemberRole: vi.fn(async (_input: unknown) => ({
			id: "member-id",
			userId: "member-user-id",
			organizationId: ORGANIZATION_ID,
			role: "admin",
			createdAt: CREATED_AT,
		})),
		removeMember: vi.fn(async (_input: unknown) => ({ member: member() })),
		leaveOrganization: vi.fn(async (_input: unknown) => member()),
		listInvitations: vi.fn(async (_input: unknown) => [invitation()]),
		createInvitation: vi.fn(async (_input: unknown) => invitation()),
		cancelInvitation: vi.fn(async (_input: unknown) => invitation({ status: "canceled" })),
		listUserInvitations: vi.fn(async (_input: unknown) => [receivedInvitation()]),
		getInvitation: vi.fn(async (_input: unknown) => invitationPreview()),
		acceptInvitation: vi.fn(async (_input: unknown) => ({
			invitation: invitation({ status: "accepted" }),
			member: {
				id: "member-id",
				userId: "member-user-id",
				organizationId: ORGANIZATION_ID,
				role: "member",
				createdAt: CREATED_AT,
			},
		})),
		rejectInvitation: vi.fn(async (_input: unknown) => ({
			invitation: invitation({ status: "rejected" }),
			member: null,
		})),
		...overrides,
	};
}

class RecordingCoordinator implements BetterAuthOrganizationLifecycleCoordinator {
	readonly organizationIds: string[] = [];

	async run<T>(organizationId: string, operation: () => Promise<T>): Promise<T> {
		this.organizationIds.push(organizationId);
		return operation();
	}
}

class RecordingControlPlaneCoordinator implements BetterAuthControlPlaneLifecycleCoordinator {
	readonly calls: Array<{
		readonly scope: BetterAuthControlPlaneLifecycleScope;
		readonly resourceId: string;
	}> = [];

	async run<T>(
		scope: BetterAuthControlPlaneLifecycleScope,
		resourceId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		this.calls.push({ scope, resourceId });
		return operation();
	}
}

function createService(
	api = createApi(),
	contextOverrides: Record<string, unknown> = {},
	controlPlaneLifecycle?: BetterAuthControlPlaneLifecycleCoordinator,
) {
	const internalAdapter = {
		listSessions: vi.fn(async (_userId: string) => []),
		updateSession: vi.fn(async (_token: string, _update: Record<string, unknown>) => ({
			status: true,
		})),
		...contextOverrides,
	};
	const auth = {
		handler: async (_request: Request) => new Response(),
		api,
		options: {},
		$context: Promise.resolve({ internalAdapter }),
		$Infer: { Session: {} },
		$ERROR_CODES: {},
	} satisfies AnyAuth;
	const coordinator = new RecordingCoordinator();
	const options = {
		auth,
		organizationLifecycle: coordinator,
		...(controlPlaneLifecycle === undefined ? {} : { controlPlaneLifecycle }),
	} satisfies BetterAuthModuleOptions;
	return {
		api,
		coordinator,
		internalAdapter,
		service: new BetterAuthOrganizationService(new BetterAuthService(auth), options),
	};
}

describe("BetterAuthOrganizationService", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prefers the namespaced control-plane coordinator over the legacy organization one", async () => {
		const genericCoordinator = new RecordingControlPlaneCoordinator();
		const { coordinator, service } = createService(createApi(), {}, genericCoordinator);

		await service.updateMemberRole({}, ORGANIZATION_ID, "member-id", "admin");

		expect(genericCoordinator.calls).toEqual([
			{ scope: "organization", resourceId: ORGANIZATION_ID },
		]);
		expect(coordinator.organizationIds).toEqual([]);
	});

	it("re-reads the joined member after a stock updateMemberRole response", async () => {
		const updatedMember = member({ role: "admin" });
		const api = createApi({
			listMembers: vi.fn(async (_input: unknown) => ({ members: [updatedMember], total: 1 })),
		});
		const { coordinator, service } = createService(api);

		const result = await service.updateMemberRole({}, ORGANIZATION_ID, "member-id", ["admin"]);

		expect(result).toEqual({
			...updatedMember,
			user: { ...updatedMember.user, redactedFields: [] },
		});
		expect(result.user.email).toBe("member@example.com");
		expect(api.updateMemberRole).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: {
				organizationId: ORGANIZATION_ID,
				memberId: "member-id",
				role: ["admin"],
			},
		});
		expect(api.listMembers).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: {
				organizationId: ORGANIZATION_ID,
				limit: 1,
				offset: 0,
				filterField: "id",
				filterValue: "member-id",
			},
		});
		expect(coordinator.organizationIds).toEqual([ORGANIZATION_ID]);
	});

	it("keeps role updates and removals operable through bounded member identity projections", async () => {
		const oversizedName = "n".repeat(300);
		const api = createApi({
			listMembers: vi.fn(async (_input: unknown) => ({
				members: [
					member({
						user: {
							id: "member-user-id",
							name: oversizedName,
							email: `${"e".repeat(400)}@example.com`,
							image: "i".repeat(4_097),
						},
					}),
				],
				total: 1,
			})),
		});
		const { coordinator, service } = createService(api);

		const listed = await service.listMembers({}, ORGANIZATION_ID);
		const updated = await service.updateMemberRole({}, ORGANIZATION_ID, "member-id", "admin");
		const removed = await service.removeMember({}, ORGANIZATION_ID, "member-id");

		for (const projected of [listed.members[0], updated, removed]) {
			expect(projected?.user).toEqual({
				id: "member-user-id",
				name: "n".repeat(256),
				email: null,
				image: null,
				redactedFields: ["name", "email", "image"],
			});
		}
		expect(api.updateMemberRole).toHaveBeenCalledOnce();
		expect(api.removeMember).toHaveBeenCalledOnce();
		expect(coordinator.organizationIds).toEqual([ORGANIZATION_ID, ORGANIZATION_ID]);
	});

	it("cancels expired pending invitations for the normalized email before inviting", async () => {
		const events: string[] = [];
		const api = createApi({
			listInvitations: vi.fn(async (_input: unknown) => [
				invitation({ id: "expired-id", email: "Invitee@Example.com", expiresAt: EXPIRED_AT }),
				invitation({ id: "other-id", email: "other@example.com", expiresAt: EXPIRED_AT }),
			]),
			cancelInvitation: vi.fn(async (input: unknown) => {
				events.push("cancel");
				if (!isRecord(input) || !isRecord(input.body)) throw new TypeError("invalid input");
				const invitationId = input.body.invitationId;
				if (typeof invitationId !== "string") throw new TypeError("invalid invitation id");
				return invitation({ id: invitationId, status: "canceled" });
			}),
			createInvitation: vi.fn(async (_input: unknown) => {
				events.push("create");
				return invitation({ id: "fresh-id", email: "invitee@example.com" });
			}),
		});
		const { coordinator, service } = createService(api);

		const result = await service.invite({}, ORGANIZATION_ID, "  Invitee@Example.com ", "member");

		expect(result.id).toBe("fresh-id");
		expect(events).toEqual(["cancel", "create"]);
		expect(api.cancelInvitation).toHaveBeenCalledOnce();
		expect(api.cancelInvitation).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { invitationId: "expired-id" },
		});
		expect(api.createInvitation).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: {
				email: "invitee@example.com",
				organizationId: ORGANIZATION_ID,
				role: "member",
			},
		});
		expect(coordinator.organizationIds).toEqual([ORGANIZATION_ID]);
	});

	it("resends one live invitation through stock createInvitation({ resend: true })", async () => {
		const api = createApi({
			createInvitation: vi.fn(async (_input: unknown) =>
				invitation({ expiresAt: new Date("2099-10-01T10:00:00.000Z") }),
			),
		});
		const { coordinator, service } = createService(api);

		const result = await service.resendInvitation({}, ORGANIZATION_ID, "invitation-id");

		expect(result.id).toBe("invitation-id");
		expect(api.createInvitation).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: {
				email: "invitee@example.com",
				organizationId: ORGANIZATION_ID,
				role: "member",
				resend: true,
			},
		});
		expect(api.cancelInvitation).not.toHaveBeenCalled();
		expect(coordinator.organizationIds).toEqual([ORGANIZATION_ID]);
	});

	it("cancels and replaces an expired pending invitation during resend", async () => {
		const events: string[] = [];
		const api = createApi({
			listInvitations: vi.fn(async (_input: unknown) => [invitation({ expiresAt: EXPIRED_AT })]),
			cancelInvitation: vi.fn(async (_input: unknown) => {
				events.push("cancel");
				return invitation({ expiresAt: EXPIRED_AT, status: "canceled" });
			}),
			createInvitation: vi.fn(async (_input: unknown) => {
				events.push("create");
				return invitation({ id: "replacement-id" });
			}),
		});
		const { service } = createService(api);

		const result = await service.resendInvitation({}, ORGANIZATION_ID, "invitation-id");

		expect(result.id).toBe("replacement-id");
		expect(events).toEqual(["cancel", "create"]);
		expect(api.createInvitation).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: {
				email: "invitee@example.com",
				organizationId: ORGANIZATION_ID,
				role: "member",
			},
		});
	});

	it("rechecks account invitations inside the organization coordinator", async () => {
		const api = createApi();
		const { coordinator, service } = createService(api);

		const accepted = await service.acceptInvitation({}, "invitation-id");
		const rejected = await service.rejectInvitation({}, "invitation-id");

		expect(accepted.invitation.status).toBe("accepted");
		expect(accepted.member.user.email).toBe("member@example.com");
		expect(rejected.status).toBe("rejected");
		expect(api.getInvitation).toHaveBeenCalledTimes(4);
		expect(coordinator.organizationIds).toEqual([ORGANIZATION_ID, ORGANIZATION_ID]);
	});

	it("normalizes stock terminal invitation preflights to a stable facade error", async () => {
		const api = createApi({
			getInvitation: vi.fn(async (_input: unknown) => {
				throw new APIError("BAD_REQUEST", { message: "Invitation not found!" });
			}),
		});
		const { service } = createService(api);

		await expect(service.rejectInvitation({}, "terminal-id")).rejects.toMatchObject({
			status: 400,
			response: {
				statusCode: 400,
				code: "INVITATION_NOT_FOUND",
				message: "Invitation not found.",
			},
		});
		expect(api.rejectInvitation).not.toHaveBeenCalled();
	});

	it("normalizes an invitation that becomes terminal after entering the coordinator", async () => {
		let previewCalls = 0;
		const api = createApi({
			getInvitation: vi.fn(async (_input: unknown) => {
				previewCalls += 1;
				if (previewCalls === 1) return invitationPreview();
				throw new APIError("BAD_REQUEST", { message: "Invitation not found!" });
			}),
		});
		const { coordinator, service } = createService(api);

		await expect(service.acceptInvitation({}, "raced-id")).rejects.toMatchObject({
			status: 400,
			response: { code: "INVITATION_NOT_FOUND" },
		});
		expect(coordinator.organizationIds).toEqual([ORGANIZATION_ID]);
		expect(api.acceptInvitation).not.toHaveBeenCalled();
	});

	it("preserves stock recipient authorization failures from invitation preflight", async () => {
		const api = createApi({
			getInvitation: vi.fn(async (_input: unknown) => {
				throw new APIError("FORBIDDEN", {
					code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
					message: "You are not the recipient of the invitation.",
				});
			}),
		});
		const { service } = createService(api);

		await expect(service.acceptInvitation({}, "foreign-id")).rejects.toMatchObject({
			status: 403,
			response: {
				code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
				message: "You are not the recipient of the invitation.",
			},
		});
		expect(api.acceptInvitation).not.toHaveBeenCalled();
	});

	it("rejects canceling a non-pending or cross-organization invitation before mutation", async () => {
		const api = createApi({
			listInvitations: vi.fn(async (_input: unknown) => [
				invitation({ id: "accepted-id", status: "accepted" }),
			]),
		});
		const { service } = createService(api);

		await expect(
			service.cancelInvitation({}, ORGANIZATION_ID, "accepted-id"),
		).rejects.toMatchObject({
			status: 404,
			response: { code: "INVITATION_NOT_FOUND" },
		});
		expect(api.cancelInvitation).not.toHaveBeenCalled();
	});

	it("clears every matching session selector after remove without failing the mutation", async () => {
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		const api = createApi();
		const listSessions = vi.fn(async (_userId: string) => [
			{ token: "matching-one", activeOrganizationId: ORGANIZATION_ID },
			{ token: "unrelated", activeOrganizationId: "other-organization" },
			{ token: "matching-two", activeOrganizationId: ORGANIZATION_ID },
		]);
		const updateSession = vi.fn(async (token: string) => {
			if (token === "matching-two") throw new Error("secondary store unavailable");
			return { status: true };
		});
		const { coordinator, service } = createService(api, { listSessions, updateSession });

		await expect(service.removeMember({}, ORGANIZATION_ID, "member-id")).resolves.toMatchObject({
			id: "member-id",
			user: { id: "member-user-id" },
		});

		expect(api.removeMember).toHaveBeenCalledOnce();
		expect(listSessions).toHaveBeenCalledWith("member-user-id");
		expect(updateSession).toHaveBeenCalledTimes(2);
		expect(updateSession).toHaveBeenCalledWith("matching-one", {
			activeOrganizationId: null,
		});
		expect(updateSession).toHaveBeenCalledWith("matching-two", {
			activeOrganizationId: null,
		});
		expect(coordinator.organizationIds).toEqual([ORGANIZATION_ID]);
	});

	it("coordinates leave by the authoritative session user and clears its selectors", async () => {
		const api = createApi();
		const listSessions = vi.fn(async (_userId: string) => [
			{ token: "leaving-session", activeOrganizationId: ORGANIZATION_ID },
		]);
		const updateSession = vi.fn(async (_token: string) => ({ status: true }));
		const { coordinator, service } = createService(api, { listSessions, updateSession });

		const result = await service.leave({}, ORGANIZATION_ID);

		expect(result.userId).toBe("member-user-id");
		expect(api.getSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: { disableCookieCache: true, disableRefresh: true },
		});
		expect(api.listMembers).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: {
				organizationId: ORGANIZATION_ID,
				limit: 1,
				offset: 0,
				filterField: "userId",
				filterValue: "member-user-id",
			},
		});
		expect(api.leaveOrganization).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { organizationId: ORGANIZATION_ID },
		});
		expect(updateSession).toHaveBeenCalledWith("leaving-session", {
			activeOrganizationId: null,
		});
		expect(coordinator.organizationIds).toEqual([ORGANIZATION_ID]);
	});

	it("returns normalized account lists and previews", async () => {
		const { service } = createService();

		const listed = await service.listUserInvitations({});
		const preview = await service.getInvitation({}, "invitation-id");

		expect(listed).toEqual([receivedInvitation()]);
		expect(preview).toEqual(invitationPreview());
		expect(listed[0]?.createdAt).toBeInstanceOf(Date);
		expect(preview.expiresAt).toBeInstanceOf(Date);
	});

	it("still rejects malformed authoritative member identity data", async () => {
		const api = createApi({
			listMembers: vi.fn(async (_input: unknown) => ({
				members: [
					member({ user: { name: "Member User", email: "member@example.com", image: null } }),
				],
				total: 1,
			})),
		});
		const { service } = createService(api);

		const error = await service
			.listMembers({}, ORGANIZATION_ID)
			.catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(HttpException);
		if (!(error instanceof HttpException)) throw error;
		expect(error.getStatus()).toBe(500);
		expect(error.getResponse()).toMatchObject({ code: "INVALID_BETTER_AUTH_RESPONSE" });
	});
});
