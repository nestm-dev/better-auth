/** Compile-time coverage for plugin-aware server API invocation inference. */
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { BetterAuthService } from "../../src/index.ts";
import type { IncomingHttpHeaders } from "node:http";

const auth = betterAuth({ plugins: [organization()] });
declare const service: BetterAuthService<typeof auth>;
declare const requestHeaders: IncomingHttpHeaders;

const invitation = service.invokeApi(requestHeaders, (api, headers) =>
	api.createInvitation({
		body: {
			email: "invitee@example.com",
			role: "member",
			organizationId: "organization-id",
		},
		headers,
	}),
);

const sessions = service.invokeApi(new Headers(), (api, headers) => api.listSessions({ headers }));

async function assertInferredResults(): Promise<void> {
	const created = await invitation;
	const invitationId: string = created.id;
	const activeSessions = await sessions;
	const sessionId: string | undefined = activeSessions[0]?.id;
	void invitationId;
	void sessionId;
}

export { assertInferredResults, invitation, sessions };
