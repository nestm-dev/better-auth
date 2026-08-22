import {
	Body,
	Controller,
	Delete,
	Get,
	Headers as RequestHeaders,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
} from "@nestjs/common";
import { betterAuth } from "better-auth";
import { admin as adminPlugin, bearer as bearerPlugin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";

import {
	BetterAuthModule,
	BetterAuthUserManagementRoutePolicy,
	BetterAuthUserManagementService,
} from "../../src/index.ts";
import { bearer, signUpUser, type SignedUpUser } from "../shared/auth-client.ts";
import { createTestApp } from "../shared/test-app.ts";
import { TEST_BASE_URL, TEST_SECRET } from "../shared/test-auth.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";
import { sendRawHttpRequest } from "../shared/raw-http.ts";

const auth = betterAuth({
	baseURL: TEST_BASE_URL,
	secret: TEST_SECRET,
	emailAndPassword: { enabled: true },
	telemetry: { enabled: false },
	plugins: [
		bearerPlugin(),
		adminPlugin({
			defaultRole: "user",
			adminRoles: ["platform_admin"],
			roles: { user: userAc, platform_admin: adminAc },
		}),
	],
});

const STOCK_ADMIN_HTTP_ROUTES = [
	{ method: "post", path: "/admin/set-role" },
	{ method: "get", path: "/admin/get-user" },
	{ method: "post", path: "/admin/create-user" },
	{ method: "post", path: "/admin/update-user" },
	{ method: "get", path: "/admin/list-users" },
	{ method: "post", path: "/admin/list-user-sessions" },
	{ method: "post", path: "/admin/unban-user" },
	{ method: "post", path: "/admin/ban-user" },
	{ method: "post", path: "/admin/impersonate-user" },
	{ method: "post", path: "/admin/stop-impersonating" },
	{ method: "post", path: "/admin/revoke-user-session" },
	{ method: "post", path: "/admin/revoke-user-sessions" },
	{ method: "post", path: "/admin/remove-user" },
	{ method: "post", path: "/admin/set-user-password" },
	{ method: "post", path: "/admin/has-permission" },
] as const;

interface ProfileBody {
	readonly name?: string;
	readonly email?: string;
}

interface RolesBody {
	readonly roles: string | readonly string[];
}

interface BanBody {
	readonly reason?: string;
	readonly expiresInSeconds?: number;
}

@Controller("platform/users")
class UserManagementFacadeController {
	constructor(private readonly users: BetterAuthUserManagementService<typeof auth>) {}

	@Get()
	list(@RequestHeaders() headers: IncomingHttpHeaders) {
		return this.users.list(headers);
	}

	@Get(":userId")
	get(@RequestHeaders() headers: IncomingHttpHeaders, @Param("userId") userId: string) {
		return this.users.get(headers, userId);
	}

	@Patch(":userId/profile")
	updateProfile(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("userId") userId: string,
		@Body() body: ProfileBody,
	) {
		return this.users.updateProfile(headers, userId, body);
	}

	@Patch(":userId/roles")
	setRoles(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("userId") userId: string,
		@Body() body: RolesBody,
	) {
		return this.users.setRoles(headers, userId, body.roles);
	}

	@Post(":userId/ban")
	@HttpCode(HttpStatus.OK)
	ban(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("userId") userId: string,
		@Body() body: BanBody,
	) {
		return this.users.ban(headers, userId, body);
	}

	@Post(":userId/unban")
	@HttpCode(HttpStatus.OK)
	unban(@RequestHeaders() headers: IncomingHttpHeaders, @Param("userId") userId: string) {
		return this.users.unban(headers, userId);
	}

	@Get(":userId/sessions")
	listSessions(@RequestHeaders() headers: IncomingHttpHeaders, @Param("userId") userId: string) {
		return this.users.listSessions(headers, userId);
	}

	@Delete(":userId/sessions/:sessionId")
	revokeSession(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("userId") userId: string,
		@Param("sessionId") sessionId: string,
	) {
		return this.users.revokeSessionById(headers, userId, sessionId);
	}

	@Delete(":userId/sessions")
	revokeAllSessions(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("userId") userId: string,
	) {
		return this.users.revokeAllSessions(headers, userId);
	}
}

async function signInAgain(app: INestApplication, user: SignedUpUser): Promise<string> {
	const response = await request(app.getHttpServer())
		.post("/api/auth/sign-in/email")
		.send({ email: user.email, password: user.password });
	if (response.status !== 200 || typeof response.body?.token !== "string") {
		throw new Error(`sign-in/email failed: ${response.status} ${JSON.stringify(response.body)}`);
	}
	return response.body.token;
}

async function promoteToPlatformAdmin(app: INestApplication, user: SignedUpUser): Promise<string> {
	const context = await auth.$context;
	await context.internalAdapter.updateUser(user.userId, { role: "platform_admin" });
	return signInAgain(app, user);
}

async function getSession(app: INestApplication, token: string) {
	return request(app.getHttpServer()).get("/api/auth/get-session").set(bearer(token));
}

describe(`BetterAuthUserManagementService (${testHttpAdapter})`, () => {
	let app: INestApplication;

	beforeAll(async () => {
		app = await createTestApp({
			forRoot: { auth },
			metadata: {
				controllers: [UserManagementFacadeController],
				imports: [
					BetterAuthModule.forFeature({
						routePolicies: [BetterAuthUserManagementRoutePolicy],
					}),
				],
			},
		});
		await app.listen(0, "127.0.0.1");
	});

	afterAll(async () => {
		await app.close();
	});

	it("lists, reads, profiles, and assigns platform roles through stock admin APIs", async () => {
		const admin = await signUpUser(app);
		const adminToken = await promoteToPlatformAdmin(app, admin);
		const target = await signUpUser(app);

		const listed = await request(app.getHttpServer())
			.get("/platform/users")
			.set(bearer(adminToken));
		expect(listed.status).toBe(200);
		expect(listed.body).toMatchObject({
			users: expect.arrayContaining([
				expect.objectContaining({ id: target.userId, roles: ["user"], banned: false }),
			]),
			total: expect.any(Number),
			limit: 50,
			offset: 0,
		});

		const read = await request(app.getHttpServer())
			.get(`/platform/users/${target.userId}`)
			.set(bearer(adminToken));
		expect(read.status).toBe(200);
		expect(read.body).toMatchObject({
			id: target.userId,
			email: target.email,
			emailVerified: false,
			roles: ["user"],
		});

		const context = await auth.$context;
		await context.internalAdapter.updateUser(target.userId, { emailVerified: true });
		const caseOnly = await request(app.getHttpServer())
			.patch(`/platform/users/${target.userId}/profile`)
			.set(bearer(adminToken))
			.send({ name: "  Same Email Rename  ", email: target.email.toUpperCase() });
		expect(caseOnly.status).toBe(200);
		expect(caseOnly.body).toMatchObject({
			name: "Same Email Rename",
			email: target.email,
			emailVerified: true,
		});
		const updatedEmail = `managed-${target.email}`;
		const profiled = await request(app.getHttpServer())
			.patch(`/platform/users/${target.userId}/profile`)
			.set(bearer(adminToken))
			.send({ name: "  Managed Target  ", email: updatedEmail.toUpperCase() });
		expect(profiled.status).toBe(200);
		expect(profiled.body.name).toBe("Managed Target");
		expect(profiled.body.email).toBe(updatedEmail);
		expect(profiled.body.emailVerified).toBe(false);

		const promoted = await request(app.getHttpServer())
			.patch(`/platform/users/${target.userId}/roles`)
			.set(bearer(adminToken))
			.send({ roles: ["platform_admin"] });
		expect(promoted.status).toBe(200);
		expect(promoted.body.roles).toEqual(["platform_admin"]);

		const deniedCaller = await signUpUser(app);
		const denied = await request(app.getHttpServer())
			.get("/platform/users")
			.set(bearer(deniedCaller.token));
		expect(denied.status).toBe(403);

		for (const route of [
			...STOCK_ADMIN_HTTP_ROUTES,
			{ method: "post", path: "/admin/future/nested-route" } as const,
		]) {
			const rawRequest =
				route.method === "get"
					? request(app.getHttpServer()).get(`/api/auth${route.path}`)
					: request(app.getHttpServer()).post(`/api/auth${route.path}`).send({});
			const raw = await rawRequest.set(bearer(adminToken));
			expect(raw.status, `${route.method.toUpperCase()} ${route.path}`).toBe(403);
			expect(raw.body).toEqual({
				statusCode: 403,
				code: "USER_MANAGEMENT_FACADE_REQUIRED",
				message: "Use the application's user-management endpoints.",
			});
		}
		for (const encodedTarget of [
			"/api/auth/decoy/%2e%2e/admin/list-users",
			"/api/auth/decoy/.%2e/admin/list-users",
			"/api/auth/decoy/%2e./admin/list-users",
			"/api/decoy/%2e%2e/auth/decoy/%2e%2e/admin/list-users",
		]) {
			const raw = await sendRawHttpRequest(app, "GET", encodedTarget, bearer(adminToken));
			expect(raw.status, encodedTarget).toBe(403);
			expect(raw.body, encodedTarget).toEqual({
				statusCode: 403,
				code: "USER_MANAGEMENT_FACADE_REQUIRED",
				message: "Use the application's user-management endpoints.",
			});
		}

		const adjacentPath = await request(app.getHttpServer())
			.get("/api/auth/administrator")
			.set(bearer(adminToken));
		expect(adjacentPath.status).toBe(404);
		expect(adjacentPath.body.code).not.toBe("USER_MANAGEMENT_FACADE_REQUIRED");
	});

	it("round-trips ban state and relies on stock session enforcement", async () => {
		const admin = await signUpUser(app);
		const adminToken = await promoteToPlatformAdmin(app, admin);
		const target = await signUpUser(app);

		const banned = await request(app.getHttpServer())
			.post(`/platform/users/${target.userId}/ban`)
			.set(bearer(adminToken))
			.send({ reason: "Policy violation", expiresInSeconds: 3_600 });
		expect(banned.status).toBe(200);
		expect(banned.body).toMatchObject({
			id: target.userId,
			banned: true,
			banReason: "Policy violation",
			banExpiresAt: expect.any(String),
		});

		const rejectedSignIn = await request(app.getHttpServer())
			.post("/api/auth/sign-in/email")
			.send({ email: target.email, password: target.password });
		expect(rejectedSignIn.status).toBe(403);
		expect(rejectedSignIn.body.code).toBe("BANNED_USER");

		const permanentlyRebanned = await request(app.getHttpServer())
			.post(`/platform/users/${target.userId}/ban`)
			.set(bearer(adminToken))
			.send({ reason: "Permanent policy ban" });
		expect(permanentlyRebanned.status).toBe(200);
		expect(permanentlyRebanned.body).toMatchObject({
			id: target.userId,
			banned: true,
			banReason: "Permanent policy ban",
			banExpiresAt: null,
		});

		const unbanned = await request(app.getHttpServer())
			.post(`/platform/users/${target.userId}/unban`)
			.set(bearer(adminToken));
		expect(unbanned.status).toBe(200);
		expect(unbanned.body).toMatchObject({
			id: target.userId,
			banned: false,
			banReason: null,
			banExpiresAt: null,
		});
		await expect(signInAgain(app, target)).resolves.toEqual(expect.any(String));
	});

	it("rejects a retained session for an active ban and allows it after expiry", async () => {
		const admin = await signUpUser(app);
		const adminToken = await promoteToPlatformAdmin(app, admin);
		const context = await auth.$context;

		await context.internalAdapter.updateUser(admin.userId, {
			banned: true,
			banExpires: new Date(Date.now() + 60_000),
		});
		const denied = await request(app.getHttpServer())
			.get("/platform/users")
			.set(bearer(adminToken));
		expect(denied.status).toBe(403);
		expect(denied.body).toEqual({
			statusCode: 403,
			code: "BANNED_USER",
			message: "User is banned.",
		});

		await context.internalAdapter.updateUser(admin.userId, {
			banExpires: new Date(Date.now() - 60_000),
		});
		const allowed = await request(app.getHttpServer())
			.get("/platform/users")
			.set(bearer(adminToken));
		expect(allowed.status).toBe(200);
	});

	it("lists token-free active sessions and safely revokes one or all by user-owned ids", async () => {
		const admin = await signUpUser(app);
		const adminToken = await promoteToPlatformAdmin(app, admin);
		const target = await signUpUser(app);
		const secondToken = await signInAgain(app, target);
		const thirdToken = await signInAgain(app, target);
		const secondSession = await getSession(app, secondToken);
		const secondSessionId: string = secondSession.body.session.id;

		const listed = await request(app.getHttpServer())
			.get(`/platform/users/${target.userId}/sessions`)
			.set(bearer(adminToken));
		expect(listed.status).toBe(200);
		expect(listed.body).toHaveLength(3);
		expect(listed.body).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: secondSessionId, impersonated: false }),
			]),
		);
		const serialized = JSON.stringify(listed.body);
		expect(serialized).not.toContain("token");
		expect(serialized).not.toContain(target.token);
		expect(serialized).not.toContain(secondToken);
		expect(serialized).not.toContain(thirdToken);

		const revoked = await request(app.getHttpServer())
			.delete(`/platform/users/${target.userId}/sessions/${secondSessionId}`)
			.set(bearer(adminToken));
		expect(revoked.status).toBe(200);
		expect(revoked.body).toEqual({ success: true, revokedSessionId: secondSessionId });
		expect((await getSession(app, secondToken)).body).toBeNull();
		expect((await getSession(app, thirdToken)).body).toMatchObject({
			session: { id: expect.any(String) },
		});

		const unknown = await request(app.getHttpServer())
			.delete(`/platform/users/${target.userId}/sessions/not-a-session`)
			.set(bearer(adminToken));
		expect(unknown.status).toBe(404);
		expect(unknown.body).toEqual({
			statusCode: 404,
			code: "SESSION_NOT_FOUND",
			message: "Session not found.",
		});

		const revokedAll = await request(app.getHttpServer())
			.delete(`/platform/users/${target.userId}/sessions`)
			.set(bearer(adminToken));
		expect(revokedAll.status).toBe(200);
		expect(revokedAll.body).toEqual({ success: true });
		expect((await getSession(app, target.token)).body).toBeNull();
		expect((await getSession(app, thirdToken)).body).toBeNull();
	});

	it("keeps stock-valid hostile display fields manageable through bounded projections", async () => {
		const admin = await signUpUser(app);
		const adminToken = await promoteToPlatformAdmin(app, admin);
		const longEmail = `${"e".repeat(400)}-${process.pid}-${Date.now()}@example.com`;
		const password = "super-secure-password";
		const signedUp = await request(app.getHttpServer()).post("/api/auth/sign-up/email").send({
			email: longEmail,
			password,
			name: "",
		});
		expect(signedUp.status).toBe(200);
		const targetUserId: string = signedUp.body.user.id;
		const targetToken: string = signedUp.body.token;

		const emptyProfile = await request(app.getHttpServer())
			.get(`/platform/users/${targetUserId}`)
			.set(bearer(adminToken));
		expect(emptyProfile.status).toBe(200);
		expect(emptyProfile.body).toMatchObject({
			id: targetUserId,
			name: null,
			email: null,
			redactedFields: ["name", "email"],
		});

		const nonStringProfile = await request(app.getHttpServer())
			.post("/api/auth/update-user")
			.set(bearer(targetToken))
			.send({ name: { attackerControlled: true } });
		expect(nonStringProfile.status).toBe(200);
		const nonStringRead = await request(app.getHttpServer())
			.get(`/platform/users/${targetUserId}`)
			.set(bearer(adminToken));
		expect(nonStringRead.status).toBe(200);
		expect(nonStringRead.body).toMatchObject({
			name: null,
			email: null,
			redactedFields: ["name", "email"],
		});

		const oversizedName = "n".repeat(300);
		const oversizedImage = `https://example.com/${"i".repeat(4_100)}`;
		const oversizedProfile = await request(app.getHttpServer())
			.post("/api/auth/update-user")
			.set(bearer(targetToken))
			.send({ name: oversizedName, image: oversizedImage });
		expect(oversizedProfile.status).toBe(200);

		const projected = await request(app.getHttpServer())
			.get(`/platform/users/${targetUserId}`)
			.set(bearer(adminToken));
		expect(projected.status).toBe(200);
		expect(projected.body).toMatchObject({
			name: "n".repeat(256),
			email: null,
			image: null,
			redactedFields: ["name", "email", "image"],
		});
		const listed = await request(app.getHttpServer())
			.get("/platform/users")
			.set(bearer(adminToken));
		expect(listed.status).toBe(200);
		expect(listed.body.users).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: targetUserId,
					name: "n".repeat(256),
					email: null,
					redactedFields: ["name", "email", "image"],
				}),
			]),
		);

		const oversizedUserAgent = "u".repeat(2_048);
		const signedIn = await request(app.getHttpServer())
			.post("/api/auth/sign-in/email")
			.set("User-Agent", oversizedUserAgent)
			.send({ email: longEmail, password });
		expect(signedIn.status).toBe(200);
		const oversizedAgentToken: string = signedIn.body.token;
		const sessions = await request(app.getHttpServer())
			.get(`/platform/users/${targetUserId}/sessions`)
			.set(bearer(adminToken));
		expect(sessions.status).toBe(200);
		const projectedSession = sessions.body.find(
			(entry: { redactedFields?: readonly string[] }) =>
				entry.redactedFields?.includes("userAgent") === true,
		);
		expect(projectedSession).toMatchObject({
			userAgent: "u".repeat(1_024),
			redactedFields: ["userAgent"],
		});
		expect(JSON.stringify(sessions.body)).not.toContain(oversizedAgentToken);

		const revoked = await request(app.getHttpServer())
			.delete(`/platform/users/${targetUserId}/sessions/${projectedSession.id}`)
			.set(bearer(adminToken));
		expect(revoked.status).toBe(200);
		expect((await getSession(app, oversizedAgentToken)).body).toBeNull();

		const roleUpdated = await request(app.getHttpServer())
			.patch(`/platform/users/${targetUserId}/roles`)
			.set(bearer(adminToken))
			.send({ roles: ["user"] });
		expect(roleUpdated.status).toBe(200);
		expect(roleUpdated.body.redactedFields).toEqual(["name", "email", "image"]);

		const banned = await request(app.getHttpServer())
			.post(`/platform/users/${targetUserId}/ban`)
			.set(bearer(adminToken))
			.send({ reason: "Hostile profile enforcement", expiresInSeconds: 3_600 });
		expect(banned.status).toBe(200);
		expect(banned.body).toMatchObject({
			id: targetUserId,
			banned: true,
			redactedFields: ["name", "email", "image"],
		});
	});
});
