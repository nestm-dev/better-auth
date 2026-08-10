import type { BetterAuthOptions } from "better-auth/types";
import { emailOTP, mcp, organization } from "better-auth/plugins";

import type { ArmContext } from "./harness.ts";

export const MEMBER_EMAIL = "member@example.com";
export const MEMBER_PASSWORD = "member123456";
/**
 * The OTP flow gets its own user on purpose.
 *
 * Verifying an email through a one-time code trips Better Auth's
 * `revokeUnprovenAccountAccess`, which deletes the credential account that was never proven —
 * so a user who signs in by OTP can no longer sign in by password. Reusing the member here
 * would make the invitation flow fail for a reason that has nothing to do with the adapter.
 */
export const OTP_EMAIL = "otp@example.com";
export const OTP_PASSWORD = "otpuser123456";
export const ORG_SLUG = "conformance-org";
export const REDIRECT_URI = "https://example.com/callback";
/** Matches the baseURL `getTestInstance` builds when no port is passed. */
const BASE_URL = "http://localhost:3000";

/** The session refresh window, in seconds. Short enough that a test can sleep past it. */
const UPDATE_AGE_SECONDS = 1;

/**
 * The endpoints `runScenario` drives, and the parts of their results it reads.
 *
 * Better Auth infers `auth.api` from the plugin tuple it was configured with, and that
 * inference does not survive being passed through a helper: annotating the options as
 * `Partial<BetterAuthOptions>` erases the tuple, while leaving the type fully inferred
 * produces something `tsc` refuses to name (TS2883 — it reaches into zod internals).
 *
 * So the plugin surface is declared here instead, at exactly one seam. Call sites stay fully
 * checked against these shapes; what is given up is the compiler noticing if Better Auth
 * changes an endpoint's signature, which the suite would then catch at runtime.
 */
interface ScenarioApi {
	signUpEmail(input: { body: { email: string; password: string; name: string } }): Promise<unknown>;
	getSession(input: { headers: Headers }): Promise<{
		session: { expiresAt: Date | string; token: string };
		user: { id: string };
	} | null>;
	sendVerificationOTP(input: { body: { email: string; type: "sign-in" } }): Promise<unknown>;
	signInEmailOTP(input: {
		body: { email: string; otp: string };
	}): Promise<{ user: { id: string } }>;
	createOrganization(input: {
		body: { name: string; slug: string };
		headers: Headers;
	}): Promise<{ id: string } | null>;
	createInvitation(input: {
		body: { email: string; role: string; organizationId: string };
		headers: Headers;
	}): Promise<{ id: string }>;
	acceptInvitation(input: {
		body: { invitationId: string };
		headers: Headers;
	}): Promise<{ invitation: { status: string } } | null>;
	listOrganizations(input: { headers: Headers }): Promise<{ id: string }[]>;
	getFullOrganization(input: {
		query: { organizationId: string };
		headers: Headers;
	}): Promise<{ members: unknown[] } | null>;
}

export interface ScenarioOptions {
	/** Filled in by the emailOTP plugin's send hook; the OTP never leaves the process. */
	readonly otp: { value: string | null };
	readonly options: Partial<BetterAuthOptions>;
}

/**
 * The Better Auth configuration both arms run.
 *
 * `updateAge` is deliberately tiny so the session-refresh flow can sleep past it rather than
 * manipulate stored rows behind the adapter's back, and `cookieCache` is off so every
 * `getSession` actually reaches the database.
 */
export function scenarioOptions(): ScenarioOptions {
	const otp = { value: null as string | null };
	return {
		otp,
		options: {
			session: {
				expiresIn: 60 * 60 * 24 * 7,
				updateAge: UPDATE_AGE_SECONDS,
				cookieCache: { enabled: false },
			},
			// `storage: "database"` is what puts `rateLimit` in `getAuthTables()`, so the model
			// exists for the bigint and CAS assertions. Enforcement stays OFF here — a 429 in the
			// middle of the organization flow would be noise; `rate-limit.spec.ts` turns it on.
			rateLimit: { enabled: false, storage: "database" },
			plugins: [
				emailOTP({
					sendVerificationOTP: async ({ otp: code }) => {
						otp.value = code;
					},
				}),
				organization(),
				mcp({ loginPage: "/login" }),
			],
		},
	};
}

export async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

export const UPDATE_AGE_SLEEP_MS = UPDATE_AGE_SECONDS * 1000 + 250;

export interface ScenarioResult {
	ownerId: string;
	memberId: string;
	firstSessionToken: string;
	refreshedSessionExpiry: number;
	initialSessionExpiry: number;
	otpUserId: string;
	organizationId: string;
	invitationId: string;
	invitationStatus: string;
	memberOrganizationIds: string[];
	memberCount: number;
	fullOrganizationMemberCount: number;
	clientId: string;
	hasAccessToken: boolean;
	sortedMemberUserIds: string[];
	pagedOrganizationSlugs: string[];
	pagedPastEndIsEmpty: boolean;
}

/**
 * Every flow, in one deterministic order, driven purely through Better Auth's public API.
 *
 * Both arms run this identically. Nothing here reaches for the adapter directly — the point is
 * that a real application's traffic, not a hand-picked set of adapter calls, is what the two
 * implementations are compared on.
 */
export async function runScenario(
	context: ArmContext,
	scenario: ScenarioOptions,
): Promise<ScenarioResult> {
	const { auth, signInWithTestUser, signInWithUser } = context.auth;
	const api = auth.api as unknown as ScenarioApi;

	// --- sign-up ---------------------------------------------------------------------------
	await api.signUpEmail({
		body: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD, name: "Member User" },
	});
	await api.signUpEmail({
		body: { email: OTP_EMAIL, password: OTP_PASSWORD, name: "OTP User" },
	});

	// --- sign-in + session -----------------------------------------------------------------
	const owner = await signInWithTestUser();
	const initialSession = await api.getSession({ headers: owner.headers });
	if (!initialSession) throw new Error("expected a session after sign-in");
	const initialSessionExpiry = new Date(initialSession.session.expiresAt).getTime();

	// --- session refresh past updateAge ----------------------------------------------------
	await sleep(UPDATE_AGE_SLEEP_MS);
	const refreshed = await api.getSession({ headers: owner.headers });
	if (!refreshed) throw new Error("expected a session after refresh");
	const refreshedSessionExpiry = new Date(refreshed.session.expiresAt).getTime();

	// --- email OTP (consumeOne on `verification`) -------------------------------------------
	scenario.otp.value = null;
	await api.sendVerificationOTP({ body: { email: OTP_EMAIL, type: "sign-in" } });
	const code = scenario.otp.value;
	if (!code) throw new Error("emailOTP did not deliver a code");
	const otpSignIn = await api.signInEmailOTP({ body: { email: OTP_EMAIL, otp: code } });

	// --- organization: create / invite / accept / list ---------------------------------------
	const org = await api.createOrganization({
		body: { name: "Conformance Org", slug: ORG_SLUG },
		headers: owner.headers,
	});
	if (!org) throw new Error("expected an organization");

	const invitation = await api.createInvitation({
		body: { email: MEMBER_EMAIL, role: "member", organizationId: org.id },
		headers: owner.headers,
	});

	const member = await signInWithUser(MEMBER_EMAIL, MEMBER_PASSWORD);
	const accepted = await api.acceptInvitation({
		body: { invitationId: invitation.id },
		headers: member.headers,
	});

	const memberOrganizations = await api.listOrganizations({ headers: member.headers });
	const fullOrganization = await api.getFullOrganization({
		query: { organizationId: org.id },
		headers: owner.headers,
	});

	// `count`, `sortBy`, `limit` and `offset` are not reachable from a plugin route with enough
	// control to pin their behaviour, so they are exercised through the adapter the factory
	// built — still the public contract, and identical for both arms.
	const db = context.auth.db;
	const memberCount = await db.count({
		model: "member",
		where: [{ field: "organizationId", value: org.id }],
	});
	const sortedMembers = await db.findMany<{ userId: string }>({
		model: "member",
		where: [{ field: "organizationId", value: org.id }],
		sortBy: { field: "userId", direction: "asc" },
		limit: 10,
	});
	const pagedOrganizations = await db.findMany<{ slug: string }>({
		model: "organization",
		sortBy: { field: "slug", direction: "asc" },
		limit: 1,
		offset: 0,
	});
	const pagedPastEnd = await db.findMany<{ slug: string }>({
		model: "organization",
		sortBy: { field: "slug", direction: "asc" },
		limit: 1,
		offset: 50,
	});

	// --- MCP OAuth: register / authorize / token ---------------------------------------------
	const registered = await auth
		.handler(
			new Request(`${BASE_URL}/api/auth/mcp/register`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					redirect_uris: [REDIRECT_URI],
					client_name: "Conformance Client",
					grant_types: ["authorization_code"],
					response_types: ["code"],
					token_endpoint_auth_method: "client_secret_post",
				}),
			}),
		)
		.then(async (response) => {
			const payload = (await response.json()) as { client_id?: string; client_secret?: string };
			if (!payload.client_id || !payload.client_secret) {
				throw new Error(
					`mcp client registration failed (${response.status}): ${JSON.stringify(payload)}`,
				);
			}
			return payload as { client_id: string; client_secret: string };
		});

	// `/mcp/authorize` refuses anything without a real `ctx.request` (it has to re-read the raw
	// query string to build the login redirect), so the OAuth leg goes through the HTTP handler
	// rather than `api.*`. That is also the more faithful exercise: it is the path a real
	// MCP client takes.
	const authorizeUrl = new URL(`${BASE_URL}/api/auth/mcp/authorize`);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("client_id", registered.client_id);
	authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
	authorizeUrl.searchParams.set("scope", "openid profile");
	authorizeUrl.searchParams.set("state", "conformance-state");

	const authorizeResponse = await auth.handler(
		new Request(authorizeUrl, { headers: owner.headers }),
	);
	const location = authorizeResponse.headers.get("location");
	if (!location) {
		throw new Error(
			`mcp authorize did not redirect (${authorizeResponse.status}): ${await authorizeResponse.text()}`,
		);
	}
	const authorizationCode = new URL(location).searchParams.get("code");
	if (!authorizationCode) {
		throw new Error(
			`mcp authorize returned no code: ${location} (registered=${JSON.stringify(registered)})`,
		);
	}

	const tokenResponse = await auth
		.handler(
			new Request(`${BASE_URL}/api/auth/mcp/token`, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code: authorizationCode,
					redirect_uri: REDIRECT_URI,
					client_id: registered.client_id,
					client_secret: registered.client_secret,
				}),
			}),
		)
		.then(async (response) => {
			const payload = (await response.json()) as { access_token?: string };
			if (!payload.access_token) {
				throw new Error(
					`mcp token exchange failed (${response.status}): ${JSON.stringify(payload)}`,
				);
			}
			return payload as { access_token: string };
		});

	return {
		ownerId: initialSession.user.id,
		memberId: otpSignIn.user.id,
		firstSessionToken: initialSession.session.token,
		initialSessionExpiry,
		refreshedSessionExpiry,
		otpUserId: otpSignIn.user.id,
		organizationId: org.id,
		invitationId: invitation.id,
		invitationStatus: accepted?.invitation.status ?? "missing",
		memberOrganizationIds: memberOrganizations.map((entry) => entry.id),
		memberCount,
		fullOrganizationMemberCount: fullOrganization?.members.length ?? -1,
		clientId: registered.client_id,
		hasAccessToken: tokenResponse.access_token.length > 0,
		sortedMemberUserIds: sortedMembers.map((entry) => entry.userId),
		pagedOrganizationSlugs: pagedOrganizations.map((entry) => entry.slug),
		pagedPastEndIsEmpty: pagedPastEnd.length === 0,
	};
}
