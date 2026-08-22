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
import { bearer as bearerPlugin, organization } from "better-auth/plugins";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import {
	BetterAuthModule,
	BetterAuthOrganizationControlPlaneRoutePolicy,
	BetterAuthOrganizationService,
} from "../../src/index.ts";
import { bearer, signUpUser, type SignedUpUser } from "../shared/auth-client.ts";
import { createTestApp } from "../shared/test-app.ts";
import { TEST_BASE_URL, TEST_SECRET } from "../shared/test-auth.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";
import type { IncomingHttpHeaders } from "node:http";

const auth = betterAuth({
	baseURL: TEST_BASE_URL,
	secret: TEST_SECRET,
	emailAndPassword: { enabled: true },
	telemetry: { enabled: false },
	plugins: [bearerPlugin(), organization({ requireEmailVerificationOnInvitation: false })],
});

interface InvitationBody {
	readonly email: string;
	readonly role: string | readonly string[];
}

interface MemberRoleBody {
	readonly role: string | readonly string[];
}

@Controller()
class OrganizationFacadeController {
	constructor(private readonly organizations: BetterAuthOrganizationService<typeof auth>) {}

	@Get("organizations/:organizationId/members")
	listMembers(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("organizationId") organizationId: string,
	) {
		return this.organizations.listMembers(headers, organizationId);
	}

	@Patch("organizations/:organizationId/members/:memberId/role")
	updateMemberRole(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("organizationId") organizationId: string,
		@Param("memberId") memberId: string,
		@Body() body: MemberRoleBody,
	) {
		return this.organizations.updateMemberRole(headers, organizationId, memberId, body.role);
	}

	@Delete("organizations/:organizationId/members/:memberId")
	removeMember(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("organizationId") organizationId: string,
		@Param("memberId") memberId: string,
	) {
		return this.organizations.removeMember(headers, organizationId, memberId);
	}

	@Post("organizations/:organizationId/invitations")
	@HttpCode(HttpStatus.OK)
	invite(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("organizationId") organizationId: string,
		@Body() body: InvitationBody,
	) {
		return this.organizations.invite(headers, organizationId, body.email, body.role);
	}

	@Get("organizations/:organizationId/invitations")
	listInvitations(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("organizationId") organizationId: string,
	) {
		return this.organizations.listInvitations(headers, organizationId);
	}

	@Post("organizations/:organizationId/invitations/:invitationId/resend")
	@HttpCode(HttpStatus.OK)
	resendInvitation(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("organizationId") organizationId: string,
		@Param("invitationId") invitationId: string,
	) {
		return this.organizations.resendInvitation(headers, organizationId, invitationId);
	}

	@Post("organizations/:organizationId/invitations/:invitationId/cancel")
	@HttpCode(HttpStatus.OK)
	cancelInvitation(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("organizationId") organizationId: string,
		@Param("invitationId") invitationId: string,
	) {
		return this.organizations.cancelInvitation(headers, organizationId, invitationId);
	}

	@Get("account/organization-invitations")
	listUserInvitations(@RequestHeaders() headers: IncomingHttpHeaders) {
		return this.organizations.listUserInvitations(headers);
	}

	@Get("account/organization-invitations/:invitationId")
	getInvitation(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("invitationId") invitationId: string,
	) {
		return this.organizations.getInvitation(headers, invitationId);
	}

	@Post("account/organization-invitations/:invitationId/accept")
	@HttpCode(HttpStatus.OK)
	acceptInvitation(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("invitationId") invitationId: string,
	) {
		return this.organizations.acceptInvitation(headers, invitationId);
	}

	@Post("account/organization-invitations/:invitationId/reject")
	@HttpCode(HttpStatus.OK)
	rejectInvitation(
		@RequestHeaders() headers: IncomingHttpHeaders,
		@Param("invitationId") invitationId: string,
	) {
		return this.organizations.rejectInvitation(headers, invitationId);
	}
}

async function createOrganization(
	app: INestApplication,
	owner: SignedUpUser,
	suffix: string,
): Promise<string> {
	const response = await request(app.getHttpServer())
		.post("/api/auth/organization/create")
		.set(bearer(owner.token))
		.send({ name: `Organization ${suffix}`, slug: `organization-${suffix}-${owner.userId}` });
	if (response.status !== 200 || typeof response.body?.id !== "string") {
		throw new Error(
			`organization/create failed: ${response.status} ${JSON.stringify(response.body)}`,
		);
	}
	return response.body.id;
}

async function verifyEmail(user: SignedUpUser): Promise<void> {
	const context = await auth.$context;
	await context.internalAdapter.updateUser(user.userId, { emailVerified: true });
}

async function expireInvitation(invitationId: string): Promise<void> {
	const context = await auth.$context;
	await context.adapter.update({
		model: "invitation",
		where: [{ field: "id", value: invitationId }],
		update: { expiresAt: new Date(0) },
	});
}

async function inviteThroughFacade(
	app: INestApplication,
	owner: SignedUpUser,
	organizationId: string,
	invitee: SignedUpUser,
) {
	return request(app.getHttpServer())
		.post(`/organizations/${organizationId}/invitations`)
		.set(bearer(owner.token))
		.send({ email: invitee.email, role: "member" });
}

describe(`BetterAuthOrganizationService (${testHttpAdapter})`, () => {
	let app: INestApplication;

	beforeAll(async () => {
		app = await createTestApp({
			forRoot: { auth },
			metadata: {
				controllers: [OrganizationFacadeController],
				imports: [
					BetterAuthModule.forFeature({
						routePolicies: [BetterAuthOrganizationControlPlaneRoutePolicy],
					}),
				],
			},
		});
	});

	afterAll(async () => {
		await app.close();
	});

	it("hydrates role updates and reconciles every active session after removal", async () => {
		const owner = await signUpUser(app);
		const invitee = await signUpUser(app);
		await verifyEmail(invitee);
		const organizationId = await createOrganization(app, owner, "member-lifecycle");

		const invited = await inviteThroughFacade(app, owner, organizationId, invitee);
		expect(invited.status).toBe(200);

		const resent = await request(app.getHttpServer())
			.post(`/organizations/${organizationId}/invitations/${invited.body.id}/resend`)
			.set(bearer(owner.token));
		expect(resent.status).toBe(200);
		expect(resent.body.id).toBe(invited.body.id);

		const accepted = await request(app.getHttpServer())
			.post(`/account/organization-invitations/${invited.body.id}/accept`)
			.set(bearer(invitee.token));
		expect(accepted.status).toBe(200);
		expect(accepted.body.member.user).toMatchObject({
			id: invitee.userId,
			email: invitee.email,
		});

		const updated = await request(app.getHttpServer())
			.patch(`/organizations/${organizationId}/members/${accepted.body.member.id}/role`)
			.set(bearer(owner.token))
			.send({ role: "admin" });
		expect(updated.status).toBe(200);
		expect(updated.body).toMatchObject({
			id: accepted.body.member.id,
			role: "admin",
			user: { id: invitee.userId, email: invitee.email },
		});

		const removed = await request(app.getHttpServer())
			.delete(`/organizations/${organizationId}/members/${accepted.body.member.id}`)
			.set(bearer(owner.token));
		expect(removed.status).toBe(200);
		expect(removed.body.user.email).toBe(invitee.email);

		const session = await request(app.getHttpServer())
			.get("/api/auth/get-session")
			.set(bearer(invitee.token));
		expect(session.status).toBe(200);
		expect(session.body.session.activeOrganizationId).toBeNull();
	});

	it("replaces expired resends and expired same-email re-invites on stock 1.6.26", async () => {
		const owner = await signUpUser(app);
		const firstInvitee = await signUpUser(app);
		const secondInvitee = await signUpUser(app);
		const organizationId = await createOrganization(app, owner, "expired-invitations");

		const first = await inviteThroughFacade(app, owner, organizationId, firstInvitee);
		expect(first.status).toBe(200);
		await expireInvitation(first.body.id);

		const replacement = await request(app.getHttpServer())
			.post(`/organizations/${organizationId}/invitations/${first.body.id}/resend`)
			.set(bearer(owner.token));
		expect(replacement.status).toBe(200);
		expect(replacement.body.id).not.toBe(first.body.id);
		expect(replacement.body.email).toBe(firstInvitee.email);

		const second = await inviteThroughFacade(app, owner, organizationId, secondInvitee);
		expect(second.status).toBe(200);
		await expireInvitation(second.body.id);

		const reinvited = await inviteThroughFacade(app, owner, organizationId, secondInvitee);
		expect(reinvited.status).toBe(200);
		expect(reinvited.body.id).not.toBe(second.body.id);
		const listed = await request(app.getHttpServer())
			.get(`/organizations/${organizationId}/invitations`)
			.set(bearer(owner.token));
		expect(listed.status).toBe(200);
		expect(
			listed.body.find((candidate: { id: string }) => candidate.id === second.body.id)?.status,
		).toBe("canceled");
		expect(
			listed.body.find((candidate: { id: string }) => candidate.id === reinvited.body.id)?.status,
		).toBe("pending");
	});

	it("keeps hostile stock-valid member profiles role-changeable and removable", async () => {
		const owner = await signUpUser(app);
		const organizationId = await createOrganization(app, owner, "hostile-member-profile");
		const email = `${"e".repeat(400)}-${process.pid}-${Date.now()}@example.com`;
		const password = "super-secure-password";
		const signedUp = await request(app.getHttpServer()).post("/api/auth/sign-up/email").send({
			email,
			password,
			name: "",
		});
		expect(signedUp.status).toBe(200);
		const member: SignedUpUser = {
			email,
			password,
			name: "",
			token: signedUp.body.token,
			userId: signedUp.body.user.id,
		};
		await verifyEmail(member);

		const invited = await inviteThroughFacade(app, owner, organizationId, member);
		expect(invited.status).toBe(200);
		const accepted = await request(app.getHttpServer())
			.post(`/account/organization-invitations/${invited.body.id}/accept`)
			.set(bearer(member.token));
		expect(accepted.status).toBe(200);
		expect(accepted.body.member.user).toEqual({
			id: member.userId,
			name: null,
			email: null,
			image: null,
			redactedFields: ["name", "email"],
		});

		const oversizedName = "n".repeat(300);
		const oversizedImage = `https://example.com/${"i".repeat(4_100)}`;
		const updatedProfile = await request(app.getHttpServer())
			.post("/api/auth/update-user")
			.set(bearer(member.token))
			.send({ name: oversizedName, image: oversizedImage });
		expect(updatedProfile.status).toBe(200);

		const updatedRole = await request(app.getHttpServer())
			.patch(`/organizations/${organizationId}/members/${accepted.body.member.id}/role`)
			.set(bearer(owner.token))
			.send({ role: "admin" });
		expect(updatedRole.status).toBe(200);
		expect(updatedRole.body).toMatchObject({
			id: accepted.body.member.id,
			role: "admin",
			user: {
				id: member.userId,
				name: "n".repeat(256),
				email: null,
				image: null,
				redactedFields: ["name", "email", "image"],
			},
		});

		const removed = await request(app.getHttpServer())
			.delete(`/organizations/${organizationId}/members/${accepted.body.member.id}`)
			.set(bearer(owner.token));
		expect(removed.status).toBe(200);
		expect(removed.body.user).toEqual(updatedRole.body.user);

		const listed = await request(app.getHttpServer())
			.get(`/organizations/${organizationId}/members`)
			.set(bearer(owner.token));
		expect(listed.status).toBe(200);
		expect(
			listed.body.members.some(
				(candidate: { readonly userId?: unknown }) => candidate.userId === member.userId,
			),
		).toBe(false);
	});

	it("keeps terminal invitation transitions terminal and blocks raw control-plane routes", async () => {
		const owner = await signUpUser(app);
		const rejecter = await signUpUser(app);
		const cancelTarget = await signUpUser(app);
		await verifyEmail(rejecter);
		const organizationId = await createOrganization(app, owner, "terminal-invitations");

		const rejectable = await inviteThroughFacade(app, owner, organizationId, rejecter);
		const rejected = await request(app.getHttpServer())
			.post(`/account/organization-invitations/${rejectable.body.id}/reject`)
			.set(bearer(rejecter.token));
		expect(rejected.status).toBe(200);
		expect(rejected.body.status).toBe("rejected");
		const rejectedAgain = await request(app.getHttpServer())
			.post(`/account/organization-invitations/${rejectable.body.id}/reject`)
			.set(bearer(rejecter.token));
		expect(rejectedAgain.status).toBe(400);
		expect(rejectedAgain.body).toEqual({
			statusCode: 400,
			code: "INVITATION_NOT_FOUND",
			message: "Invitation not found.",
		});

		const cancelable = await inviteThroughFacade(app, owner, organizationId, cancelTarget);
		const canceled = await request(app.getHttpServer())
			.post(`/organizations/${organizationId}/invitations/${cancelable.body.id}/cancel`)
			.set(bearer(owner.token));
		expect(canceled.status).toBe(200);
		expect(canceled.body.status).toBe("canceled");
		const canceledAgain = await request(app.getHttpServer())
			.post(`/organizations/${organizationId}/invitations/${cancelable.body.id}/cancel`)
			.set(bearer(owner.token));
		expect(canceledAgain.status).toBe(404);

		const rawOrganization = await request(app.getHttpServer())
			.get(`/api/auth/organization/list-members?organizationId=${organizationId}`)
			.set(bearer(owner.token));
		const rawAccount = await request(app.getHttpServer())
			.post("/api/auth/organization/accept-invitation")
			.set(bearer(rejecter.token))
			.send({ invitationId: rejectable.body.id });
		const futureRawResend = await request(app.getHttpServer())
			.post("/api/auth/organization/resend-invitation")
			.set(bearer(owner.token))
			.send({ invitationId: "future-id" });

		for (const response of [rawOrganization, rawAccount, futureRawResend]) {
			expect(response.status).toBe(403);
			expect(response.body).toEqual({
				statusCode: 403,
				code: "ORGANIZATION_CONTROL_PLANE_FACADE_REQUIRED",
				message: "Use the application's organization control-plane endpoints.",
			});
		}
	});
});
