/** Compile-time coverage for the normalized organization lifecycle facade. */
import {
	BetterAuthOrganizationService,
	type BetterAuthOrganizationInvitation,
	type BetterAuthOrganizationInvitationAcceptance,
	type BetterAuthOrganizationInvitationPreview,
	type BetterAuthOrganizationMember,
	type BetterAuthOrganizationMemberList,
	type BetterAuthReceivedOrganizationInvitation,
} from "../../src/index.ts";
import type { IncomingHttpHeaders } from "node:http";

declare const service: BetterAuthOrganizationService;
declare const headers: IncomingHttpHeaders;

const members: Promise<BetterAuthOrganizationMemberList> = service.listMembers(
	headers,
	"organization-id",
	{ limit: 20, offset: 0, sortDirection: "asc" },
);
const updated: Promise<BetterAuthOrganizationMember> = service.updateMemberRole(
	headers,
	"organization-id",
	"member-id",
	["admin"],
);
const removed: Promise<BetterAuthOrganizationMember> = service.removeMember(
	headers,
	"organization-id",
	"member-id",
);
const left: Promise<BetterAuthOrganizationMember> = service.leave(headers, "organization-id");
const sent: Promise<BetterAuthOrganizationInvitation> = service.invite(
	headers,
	"organization-id",
	"invitee@example.com",
	"member",
);
const resent: Promise<BetterAuthOrganizationInvitation> = service.resendInvitation(
	headers,
	"organization-id",
	"invitation-id",
);
const canceled: Promise<BetterAuthOrganizationInvitation> = service.cancelInvitation(
	headers,
	"organization-id",
	"invitation-id",
);
const received: Promise<readonly BetterAuthReceivedOrganizationInvitation[]> =
	service.listUserInvitations(headers);
const preview: Promise<BetterAuthOrganizationInvitationPreview> = service.getInvitation(
	headers,
	"invitation-id",
);
const accepted: Promise<BetterAuthOrganizationInvitationAcceptance> = service.acceptInvitation(
	headers,
	"invitation-id",
);
const rejected: Promise<BetterAuthOrganizationInvitation> = service.rejectInvitation(
	headers,
	"invitation-id",
);

async function assertSafeOrganizationSurface(): Promise<void> {
	const firstMember = (await members).members[0];
	if (firstMember) {
		const email: string = firstMember.user.email;
		// @ts-expect-error Public member users never expose password material.
		const password = firstMember.user.password;
		void email;
		void password;
	}
	const invitation = await sent;
	// @ts-expect-error Public invitations never expose a session token.
	const token = invitation.token;
	void token;
}

export {
	accepted,
	assertSafeOrganizationSurface,
	canceled,
	left,
	preview,
	received,
	rejected,
	removed,
	resent,
	sent,
	updated,
};
