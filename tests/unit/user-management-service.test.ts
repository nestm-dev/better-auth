import { HttpException } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";

import {
	BetterAuthService,
	BetterAuthUserManagementService,
	type AnyAuth,
	type BetterAuthControlPlaneLifecycleCoordinator,
	type BetterAuthControlPlaneLifecycleScope,
	type BetterAuthModuleOptions,
} from "../../src/index.ts";

const CREATED_AT = new Date("2026-01-01T10:00:00.000Z");
const UPDATED_AT = new Date("2026-01-02T10:00:00.000Z");
const EXPIRES_AT = new Date("2099-01-01T10:00:00.000Z");
const EXPIRED_AT = new Date("2000-01-01T10:00:00.000Z");
const USER_ID = "managed-user-id";

function managedUser(overrides: Record<string, unknown> = {}) {
	return {
		id: USER_ID,
		name: "Managed User",
		email: "managed@example.com",
		emailVerified: true,
		image: null,
		role: "user",
		banned: false,
		banReason: null,
		banExpires: null,
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
		...overrides,
	};
}

function managedSession(id: string, token: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		token,
		userId: USER_ID,
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
		expiresAt: EXPIRES_AT,
		ipAddress: "192.0.2.20",
		userAgent: "Test Browser",
		impersonatedBy: null,
		...overrides,
	};
}

function createApi(overrides: Record<string, unknown> = {}) {
	return {
		getSession: vi.fn(async (_input: unknown) => null),
		getUser: vi.fn(async (_input: unknown) => managedUser()),
		listUsers: vi.fn(async (_input: unknown) => ({ users: [managedUser()], total: 1 })),
		adminUpdateUser: vi.fn(async (_input: unknown) => managedUser()),
		setRole: vi.fn(async (_input: unknown) => ({
			user: managedUser({ role: "platform_admin,user" }),
		})),
		banUser: vi.fn(async (_input: unknown) => ({
			user: managedUser({
				banned: true,
				banReason: "Policy violation",
				banExpires: EXPIRES_AT,
			}),
		})),
		unbanUser: vi.fn(async (_input: unknown) => ({ user: managedUser() })),
		listUserSessions: vi.fn(async (_input: unknown) => ({
			sessions: [
				managedSession("active-id", "active-secret"),
				managedSession("expired-id", "expired-secret", { expiresAt: EXPIRED_AT }),
			],
		})),
		revokeUserSession: vi.fn(async (_input: unknown) => ({ success: true })),
		revokeUserSessions: vi.fn(async (_input: unknown) => ({ success: true })),
		...overrides,
	};
}

interface LifecycleCall {
	readonly scope: BetterAuthControlPlaneLifecycleScope;
	readonly resourceId: string;
}

class RecordingControlPlaneCoordinator implements BetterAuthControlPlaneLifecycleCoordinator {
	readonly calls: LifecycleCall[] = [];

	async run<T>(
		scope: BetterAuthControlPlaneLifecycleScope,
		resourceId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		this.calls.push({ scope, resourceId });
		return operation();
	}
}

function createService(api = createApi()) {
	const auth = {
		handler: async (_request: Request) => new Response(),
		api,
		options: {},
		$context: Promise.resolve({}),
		$Infer: { Session: {} },
		$ERROR_CODES: {},
	} satisfies AnyAuth;
	const coordinator = new RecordingControlPlaneCoordinator();
	const options = { auth, controlPlaneLifecycle: coordinator } satisfies BetterAuthModuleOptions;
	return {
		api,
		coordinator,
		service: new BetterAuthUserManagementService(new BetterAuthService(auth), options),
	};
}

describe("BetterAuthUserManagementService", () => {
	it("normalizes bounded list pagination without trusting Better Auth output", async () => {
		const { api, service } = createService();

		const result = await service.list({ authorization: "Bearer admin" });

		expect(api.listUsers).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: {
				limit: 50,
				offset: 0,
				sortBy: "email",
				sortDirection: "asc",
			},
		});
		expect(result).toEqual({
			users: [
				{
					id: USER_ID,
					name: "Managed User",
					email: "managed@example.com",
					emailVerified: true,
					image: null,
					roles: ["user"],
					banned: false,
					banReason: null,
					banExpiresAt: null,
					createdAt: CREATED_AT,
					updatedAt: UPDATED_AT,
					redactedFields: [],
				},
			],
			total: 1,
			limit: 50,
			offset: 0,
		});
	});

	it("maps only the stock safe search, exact filter, sort, and pagination inputs", async () => {
		const { api, service } = createService();

		await service.list(
			{},
			{
				limit: 20,
				offset: 40,
				search: "  USER@Example.COM ",
				searchField: "email",
				searchOperator: "starts_with",
				filter: { field: "role", value: " platform_admin " },
				sortBy: "updatedAt",
				sortDirection: "desc",
			},
		);

		expect(api.listUsers).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: {
				limit: 20,
				offset: 40,
				searchValue: "user@example.com",
				searchField: "email",
				searchOperator: "starts_with",
				filterField: "role",
				filterValue: "platform_admin",
				filterOperator: "eq",
				sortBy: "updatedAt",
				sortDirection: "desc",
			},
		});
	});

	it("rejects a list response larger than the requested bound", async () => {
		const { service } = createService(
			createApi({
				listUsers: vi.fn(async (_input: unknown) => ({
					users: [managedUser(), managedUser({ id: "second-user" })],
					total: 2,
				})),
			}),
		);

		await expect(service.list({}, { limit: 1 })).rejects.toMatchObject({
			status: 500,
			response: { code: "INVALID_BETTER_AUTH_RESPONSE" },
		});
	});

	it.each([
		{ limit: 0 },
		{ limit: 101 },
		{ offset: -1 },
		{ searchField: "email" },
		{ filter: { field: "banned", value: "true" } },
		{ filter: { field: "role", value: "user", extra: true } },
		{ unknown: true },
	])("rejects an unsafe list shape before calling Better Auth: %o", async (options) => {
		const { api, service } = createService();

		await expect(
			service.list({}, options as unknown as Parameters<typeof service.list>[1]),
		).rejects.toMatchObject({ status: 400 });
		expect(api.listUsers).not.toHaveBeenCalled();
	});

	it("updates only a normalized name and syntactically valid email", async () => {
		const api = createApi({
			adminUpdateUser: vi.fn(async (_input: unknown) =>
				managedUser({
					name: "Renamed",
					email: "renamed@example.com",
					emailVerified: false,
				}),
			),
		});
		const { coordinator, service } = createService(api);

		const result = await service.updateProfile({}, USER_ID, {
			name: "  Renamed ",
			email: " RENAMED@Example.COM ",
		});

		expect(api.adminUpdateUser).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: {
				userId: USER_ID,
				data: {
					name: "Renamed",
					email: "renamed@example.com",
					emailVerified: false,
				},
			},
		});
		expect(result.email).toBe("renamed@example.com");
		expect(result.emailVerified).toBe(false);
		expect(coordinator.calls).toEqual([{ scope: "user", resourceId: USER_ID }]);

		await expect(
			service.updateProfile({}, USER_ID, { email: "not-an-email" }),
		).rejects.toMatchObject({
			status: 400,
		});
		await expect(
			service.updateProfile({}, USER_ID, { emailVerified: true } as unknown as Parameters<
				typeof service.updateProfile
			>[2]),
		).rejects.toMatchObject({ status: 400 });
		expect(api.adminUpdateUser).toHaveBeenCalledOnce();
	});

	it("preserves verification for a same/case-only email while applying a name update", async () => {
		const api = createApi({
			getUser: vi.fn(async (_input: unknown) =>
				managedUser({ email: "Managed@Example.com", emailVerified: true }),
			),
			adminUpdateUser: vi.fn(async (_input: unknown) =>
				managedUser({
					name: "Renamed",
					email: "Managed@Example.com",
					emailVerified: true,
				}),
			),
		});
		const { service } = createService(api);

		const result = await service.updateProfile({}, USER_ID, {
			name: " Renamed ",
			email: " managed@example.COM ",
		});

		expect(api.adminUpdateUser).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID, data: { name: "Renamed" } },
		});
		expect(result).toMatchObject({
			name: "Renamed",
			email: "Managed@Example.com",
			emailVerified: true,
		});
	});

	it("returns the authoritative user without calling adminUpdateUser for an email-only no-op", async () => {
		const api = createApi({
			getUser: vi.fn(async (_input: unknown) =>
				managedUser({ email: "Managed@Example.com", emailVerified: true }),
			),
		});
		const { coordinator, service } = createService(api);

		const result = await service.updateProfile({}, USER_ID, {
			email: "managed@example.com",
		});

		expect(api.adminUpdateUser).not.toHaveBeenCalled();
		expect(result.email).toBe("Managed@Example.com");
		expect(result.emailVerified).toBe(true);
		expect(coordinator.calls).toEqual([{ scope: "user", resourceId: USER_ID }]);
	});

	it("serializes roles and ban state through the namespaced user lifecycle", async () => {
		const { api, coordinator, service } = createService();

		const roleResult = await service.setRoles({}, USER_ID, [" platform_admin ", "user"]);
		const banned = await service.ban({}, USER_ID, {
			reason: " Policy violation ",
			expiresInSeconds: 3_600,
		});
		const unbanned = await service.unban({}, USER_ID);

		expect(api.setRole).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID, role: ["platform_admin", "user"] },
		});
		expect(api.banUser).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID, banReason: "Policy violation", banExpiresIn: 3_600 },
		});
		expect(api.unbanUser).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID },
		});
		expect(roleResult.roles).toEqual(["platform_admin", "user"]);
		expect(banned).toMatchObject({ banned: true, banReason: "Policy violation" });
		expect(unbanned.banned).toBe(false);
		expect(coordinator.calls).toEqual([
			{ scope: "user", resourceId: USER_ID },
			{ scope: "user", resourceId: USER_ID },
			{ scope: "user", resourceId: USER_ID },
		]);
	});

	it("omits ban fields so the stock admin plugin can apply its configured defaults", async () => {
		const { api, service } = createService();

		await service.ban({}, USER_ID);

		expect(api.banUser).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID },
		});
	});

	it("clears a previous temporary expiry before applying an expiry-omitted re-ban", async () => {
		const banUser = vi.fn(async (_input: unknown) => ({
			user: managedUser({ banned: true, banExpires: null }),
		}));
		const api = createApi({
			getUser: vi.fn(async (_input: unknown) =>
				managedUser({ banned: true, banExpires: EXPIRES_AT }),
			),
			banUser,
		});
		const { coordinator, service } = createService(api);

		const result = await service.ban({}, USER_ID, { reason: "Permanent policy ban" });

		expect(api.adminUpdateUser).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID, data: { banned: true, banExpires: null } },
		});
		expect(api.banUser).toHaveBeenCalledOnce();
		expect(api.banUser).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID, banReason: "Permanent policy ban" },
		});
		expect(api.adminUpdateUser.mock.invocationCallOrder[0]).toBeLessThan(
			api.banUser.mock.invocationCallOrder[0] ?? 0,
		);
		expect(api.unbanUser).not.toHaveBeenCalled();
		expect(result).toMatchObject({ banned: true, banExpiresAt: null });
		expect(coordinator.calls).toEqual([{ scope: "user", resourceId: USER_ID }]);
	});

	it("requires stock user:update permission for the fail-closed stale-expiry correction", async () => {
		const api = createApi({
			getUser: vi.fn(async (_input: unknown) =>
				managedUser({ banned: true, banExpires: EXPIRES_AT }),
			),
			adminUpdateUser: vi.fn(async (_input: unknown) => {
				throw new APIError("FORBIDDEN", {
					code: "YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS",
					message: "You are not allowed to change users.",
				});
			}),
		});
		const { service } = createService(api);

		await expect(service.ban({}, USER_ID)).rejects.toMatchObject({ status: 403 });

		expect(api.adminUpdateUser).toHaveBeenCalledOnce();
		expect(api.banUser).not.toHaveBeenCalled();
		expect(api.unbanUser).not.toHaveBeenCalled();
	});

	it("leaves a temporary target permanently banned when the final re-ban fails", async () => {
		let persisted = managedUser({ banned: true, banExpires: EXPIRES_AT });
		const adminUpdateUser = vi.fn(async (_input: unknown) => {
			persisted = managedUser({ banned: true, banExpires: null });
			return persisted;
		});
		const api = createApi({
			getUser: vi.fn(async (_input: unknown) => persisted),
			adminUpdateUser,
			banUser: vi.fn(async (_input: unknown) => {
				throw new Error("final ban failed");
			}),
		});
		const { service } = createService(api);

		await expect(service.ban({}, USER_ID)).rejects.toThrow("final ban failed");

		expect(persisted).toMatchObject({ banned: true, banExpires: null });
		expect(api.adminUpdateUser).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID, data: { banned: true, banExpires: null } },
		});
		expect(api.unbanUser).not.toHaveBeenCalled();
	});

	it("rejects non-record mutation inputs before calling Better Auth", async () => {
		const { api, service } = createService();

		await expect(
			service.ban({}, USER_ID, [] as unknown as Parameters<typeof service.ban>[2]),
		).rejects.toMatchObject({ status: 400 });
		await expect(
			service.updateProfile(
				{},
				USER_ID,
				new Date() as unknown as Parameters<typeof service.updateProfile>[2],
			),
		).rejects.toMatchObject({ status: 400 });
		expect(api.banUser).not.toHaveBeenCalled();
		expect(api.adminUpdateUser).not.toHaveBeenCalled();
	});

	it("enforces identifier, role, and ban bounds before mutation", async () => {
		const { api, service } = createService();

		await expect(service.get({}, " ")).rejects.toMatchObject({ status: 400 });
		await expect(service.setRoles({}, USER_ID, [])).rejects.toMatchObject({ status: 400 });
		await expect(service.setRoles({}, USER_ID, "admin,user")).rejects.toMatchObject({
			status: 400,
		});
		await expect(service.setRoles({}, USER_ID, "admin\nuser")).rejects.toMatchObject({
			status: 400,
		});
		await expect(service.ban({}, USER_ID, { expiresInSeconds: 0 })).rejects.toMatchObject({
			status: 400,
		});
		await expect(
			service.ban({}, USER_ID, { expiresInSeconds: 365 * 24 * 60 * 60 + 1 }),
		).rejects.toMatchObject({ status: 400 });
		expect(api.getUser).not.toHaveBeenCalled();
		expect(api.setRole).not.toHaveBeenCalled();
		expect(api.banUser).not.toHaveBeenCalled();
	});

	it("returns only active, token-free sessions after a managed-user preflight", async () => {
		const api = createApi({
			listUserSessions: vi.fn(async (_input: unknown) => ({
				sessions: [
					managedSession("older", "older-secret", {
						updatedAt: new Date("2026-01-01T00:00:00.000Z"),
						ipAddress: undefined,
						userAgent: null,
					}),
					managedSession("newer", "newer-secret", {
						updatedAt: new Date("2026-01-03T00:00:00.000Z"),
						impersonatedBy: "admin-id",
					}),
					managedSession("expired", "expired-secret", { expiresAt: EXPIRED_AT }),
				],
			})),
		});
		const { service } = createService(api);

		const result = await service.listSessions({}, USER_ID);

		expect(api.getUser).toHaveBeenCalledBefore(api.listUserSessions);
		expect(result.map(({ id }) => id)).toEqual(["newer", "older"]);
		expect(result[0]?.impersonated).toBe(true);
		expect(result[1]).toMatchObject({ ipAddress: null, userAgent: null, impersonated: false });
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("token");
		expect(serialized).not.toContain("secret");
		expect(serialized).not.toContain("userId");
	});

	it("resolves a target-owned active session id to its private token before revocation", async () => {
		const { api, coordinator, service } = createService();

		await expect(service.revokeSessionById({}, USER_ID, "active-id")).resolves.toEqual({
			success: true,
			revokedSessionId: "active-id",
		});
		expect(api.revokeUserSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { sessionToken: "active-secret" },
		});
		expect(coordinator.calls).toEqual([{ scope: "user", resourceId: USER_ID }]);
	});

	it("projects oversized session metadata without blocking safe-id revocation", async () => {
		const api = createApi({
			listUserSessions: vi.fn(async (_input: unknown) => ({
				sessions: [
					managedSession("active-id", "active-secret", {
						ipAddress: "1".repeat(256),
						userAgent: "u".repeat(1_025),
					}),
				],
			})),
		});
		const { service } = createService(api);

		const sessions = await service.listSessions({}, USER_ID);
		await expect(service.revokeSessionById({}, USER_ID, "active-id")).resolves.toMatchObject({
			success: true,
		});

		expect(sessions[0]).toMatchObject({
			ipAddress: "1".repeat(255),
			userAgent: "u".repeat(1_024),
			redactedFields: ["ipAddress", "userAgent"],
		});
		expect(api.revokeUserSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { sessionToken: "active-secret" },
		});
	});

	it.each(["unknown-id", "expired-id"])(
		"does not reveal or revoke an absent session id (%s)",
		async (sessionId) => {
			const { api, service } = createService();

			await expect(service.revokeSessionById({}, USER_ID, sessionId)).rejects.toMatchObject({
				status: 404,
				response: {
					statusCode: 404,
					code: "SESSION_NOT_FOUND",
					message: "Session not found.",
				},
			});
			expect(api.revokeUserSession).not.toHaveBeenCalled();
		},
	);

	it("preflights the managed user before bulk revocation", async () => {
		const { api, coordinator, service } = createService();

		await expect(service.revokeAllSessions({}, USER_ID)).resolves.toEqual({ success: true });

		expect(api.getUser).toHaveBeenCalledBefore(api.revokeUserSessions);
		expect(api.revokeUserSessions).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: { userId: USER_ID },
		});
		expect(coordinator.calls).toEqual([{ scope: "user", resourceId: USER_ID }]);
	});

	it("rejects an oversized stock session list without disabling bulk revocation", async () => {
		const api = createApi({
			listUserSessions: vi.fn(async (_input: unknown) => ({
				sessions: Array.from({ length: 1_001 }, (_, index) =>
					managedSession(`session-${index}`, `secret-${index}`),
				),
			})),
		});
		const { service } = createService(api);

		await expect(service.listSessions({}, USER_ID)).rejects.toMatchObject({
			status: 500,
			response: { code: "INVALID_BETTER_AUTH_RESPONSE" },
		});
		await expect(service.revokeSessionById({}, USER_ID, "session-0")).rejects.toMatchObject({
			status: 500,
			response: { code: "INVALID_BETTER_AUTH_RESPONSE" },
		});
		await expect(service.revokeAllSessions({}, USER_ID)).resolves.toEqual({ success: true });
		expect(api.revokeUserSession).not.toHaveBeenCalled();
		expect(api.revokeUserSessions).toHaveBeenCalledOnce();
	});

	it("rejects malformed user and session payloads instead of leaking raw data", async () => {
		const malformedUserApi = createApi({
			getUser: vi.fn(async (_input: unknown) => managedUser({ role: undefined })),
		});
		const malformedSessionApi = createApi({
			listUserSessions: vi.fn(async (_input: unknown) => ({
				sessions: [managedSession("foreign", "foreign-secret", { userId: "other-user" })],
			})),
		});

		await expect(createService(malformedUserApi).service.get({}, USER_ID)).rejects.toMatchObject({
			status: 500,
			response: { code: "INVALID_BETTER_AUTH_RESPONSE" },
		});
		await expect(
			createService(malformedSessionApi).service.listSessions({}, USER_ID),
		).rejects.toMatchObject({
			status: 500,
			response: { code: "INVALID_BETTER_AUTH_RESPONSE" },
		});
	});

	it("keeps stock-valid display overflow bounded and explicitly redacted", async () => {
		const { service } = createService(
			createApi({
				getUser: vi.fn(async (_input: unknown) =>
					managedUser({
						name: "n".repeat(257),
						email: `${"e".repeat(400)}@example.com`,
						image: "i".repeat(4_097),
						banReason: "b".repeat(1_025),
					}),
				),
			}),
		);

		const result = await service.get({}, USER_ID);

		expect(result).toMatchObject({
			name: "n".repeat(256),
			email: null,
			image: null,
			banReason: "b".repeat(1_024),
			redactedFields: ["name", "email", "image", "banReason"],
		});
	});

	it.each(["", null, 42, { attackerControlled: true }])(
		"projects an unusable stock profile name as unavailable: %o",
		async (name) => {
			const { service } = createService(
				createApi({ getUser: vi.fn(async (_input: unknown) => managedUser({ name })) }),
			);

			await expect(service.get({}, USER_ID)).resolves.toMatchObject({
				name: null,
				redactedFields: ["name"],
			});
		},
	);

	it("keeps oversized operational identifiers strict", async () => {
		const { service } = createService(
			createApi({
				getUser: vi.fn(async (_input: unknown) => managedUser({ id: "x".repeat(1_025) })),
			}),
		);

		await expect(service.get({}, USER_ID)).rejects.toMatchObject({
			status: 500,
			response: { code: "INVALID_BETTER_AUTH_RESPONSE" },
		});
	});

	it("maps stock Better Auth authorization errors at the shared invocation boundary", async () => {
		const { service } = createService(
			createApi({
				getUser: vi.fn(async () => {
					throw new APIError("FORBIDDEN", {
						code: "YOU_ARE_NOT_ALLOWED_TO_PERFORM_THIS_ACTION",
						message: "You are not allowed to perform this action.",
					});
				}),
			}),
		);

		const error = await service.get({}, USER_ID).catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(HttpException);
		if (!(error instanceof HttpException)) throw error;
		expect(error.getResponse()).toEqual({
			statusCode: 403,
			code: "YOU_ARE_NOT_ALLOWED_TO_PERFORM_THIS_ACTION",
			message: "You are not allowed to perform this action.",
		});
	});

	it("fails clearly when the stock admin plugin API is absent", async () => {
		const api = createApi();
		const { banUser: _missing, ...withoutBanUser } = api;
		const { service } = createService(withoutBanUser as unknown as ReturnType<typeof createApi>);

		await expect(service.get({}, USER_ID)).rejects.toThrow(
			"The Better Auth admin API does not provide 'banUser'.",
		);
	});
});
