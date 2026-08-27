import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The Drizzle reading of the same `schema.sql`, for the reference arm of the differential.
 *
 * This is the control, not the subject: the suite runs every flow through
 * `@better-auth/drizzle-adapter` against this schema and through the TypeORM adapter against
 * `entities.ts`, then compares the resulting table contents. It exists so "the TypeORM adapter
 * behaves correctly" is decided against a shipped, widely used adapter rather than against
 * assertions this repository wrote about itself.
 */

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at").notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id").notNull(),
		activeOrganizationId: text("active_organization_id"),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		issuer: text("issuer").notNull(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id").notNull(),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at"),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(table) => [
		index("account_userId_idx").on(table.userId),
		uniqueIndex("account_issuer_accountId_uidx").on(table.issuer, table.accountId),
	],
);

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable("organization", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	logo: text("logo"),
	createdAt: timestamp("created_at").notNull(),
	metadata: text("metadata"),
});

export const member = pgTable(
	"member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		userId: text("user_id").notNull(),
		role: text("role").default("member").notNull(),
		createdAt: timestamp("created_at").notNull(),
	},
	(table) => [
		index("member_organizationId_idx").on(table.organizationId),
		index("member_userId_idx").on(table.userId),
	],
);

export const invitation = pgTable(
	"invitation",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		email: text("email").notNull(),
		role: text("role"),
		status: text("status").default("pending").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		inviterId: text("inviter_id").notNull(),
	},
	(table) => [
		index("invitation_organizationId_idx").on(table.organizationId),
		index("invitation_email_idx").on(table.email),
	],
);

export const jwks = pgTable("jwks", {
	id: text("id").primaryKey(),
	publicKey: text("public_key").notNull(),
	privateKey: text("private_key").notNull(),
	createdAt: timestamp("created_at").notNull(),
	expiresAt: timestamp("expires_at"),
	alg: text("alg"),
	crv: text("crv"),
});

export const oauthClient = pgTable(
	"oauth_client",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id").notNull().unique(),
		clientSecret: text("client_secret"),
		clientDiscoveryId: text("client_discovery_id"),
		disabled: boolean("disabled").default(false),
		skipConsent: boolean("skip_consent"),
		enableEndSession: boolean("enable_end_session"),
		subjectType: text("subject_type"),
		scopes: jsonb("scopes").$type<string[]>(),
		clientCredentialsScopes: jsonb("client_credentials_scopes").$type<string[]>().default([]),
		userId: text("user_id"),
		createdAt: timestamp("created_at"),
		updatedAt: timestamp("updated_at"),
		name: text("name"),
		uri: text("uri"),
		icon: text("icon"),
		contacts: jsonb("contacts").$type<string[]>(),
		tos: text("tos"),
		policy: text("policy"),
		softwareId: text("software_id"),
		softwareVersion: text("software_version"),
		softwareStatement: text("software_statement"),
		redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
		postLogoutRedirectUris: jsonb("post_logout_redirect_uris").$type<string[]>(),
		backchannelLogoutUri: text("backchannel_logout_uri"),
		backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
		tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
		applicationType: text("application_type"),
		jwks: text("jwks"),
		jwksUri: text("jwks_uri"),
		grantTypes: jsonb("grant_types").$type<string[]>(),
		responseTypes: jsonb("response_types").$type<string[]>(),
		requirePKCE: boolean("require_pkce"),
		dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
		referenceId: text("reference_id"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	},
	(table) => [index("oauthClient_userId_idx").on(table.userId)],
);

export const oauthResource = pgTable("oauth_resource", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull().unique(),
	name: text("name").notNull(),
	accessTokenTtl: integer("access_token_ttl"),
	refreshTokenTtl: integer("refresh_token_ttl"),
	signingAlgorithm: text("signing_algorithm"),
	signingKeyId: text("signing_key_id"),
	allowedScopes: jsonb("allowed_scopes").$type<string[]>(),
	customClaims: jsonb("custom_claims").$type<Record<string, unknown>>(),
	dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
	disabled: boolean("disabled").default(false),
	createdAt: timestamp("created_at"),
	updatedAt: timestamp("updated_at"),
	policyVersion: integer("policy_version").default(1),
	metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

export const oauthClientResource = pgTable(
	"oauth_client_resource",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id").notNull(),
		resourceId: text("resource_id").notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at"),
	},
	(table) => [
		index("oauthClientResource_clientId_idx").on(table.clientId),
		index("oauthClientResource_resourceId_idx").on(table.resourceId),
		uniqueIndex("oauthClientResource_clientId_resourceId_uidx").on(
			table.clientId,
			table.resourceId,
		),
	],
);

export const oauthRefreshToken = pgTable(
	"oauth_refresh_token",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		clientId: text("client_id").notNull(),
		sessionId: text("session_id"),
		userId: text("user_id").notNull(),
		referenceId: text("reference_id"),
		authorizationCodeId: text("authorization_code_id"),
		resources: jsonb("resources").$type<string[]>(),
		requestedUserInfoClaims: jsonb("requested_user_info_claims").$type<string[]>(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").notNull(),
		revoked: timestamp("revoked"),
		rotatedAt: timestamp("rotated_at"),
		rotationReplayResponse: text("rotation_replay_response"),
		rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
		authTime: timestamp("auth_time"),
		confirmation: jsonb("confirmation").$type<Record<string, unknown>>(),
		scopes: jsonb("scopes").$type<string[]>().notNull(),
	},
	(table) => [
		index("oauthRefreshToken_clientId_idx").on(table.clientId),
		index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
		index("oauthRefreshToken_userId_idx").on(table.userId),
		index("oauthRefreshToken_authorizationCodeId_idx").on(table.authorizationCodeId),
	],
);

export const oauthAccessToken = pgTable(
	"oauth_access_token",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		clientId: text("client_id").notNull(),
		sessionId: text("session_id"),
		userId: text("user_id"),
		referenceId: text("reference_id"),
		authorizationCodeId: text("authorization_code_id"),
		resources: jsonb("resources").$type<string[]>(),
		requestedUserInfoClaims: jsonb("requested_user_info_claims").$type<string[]>(),
		refreshId: text("refresh_id"),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").notNull(),
		revoked: timestamp("revoked"),
		confirmation: jsonb("confirmation").$type<Record<string, unknown>>(),
		scopes: jsonb("scopes").$type<string[]>().notNull(),
	},
	(table) => [
		index("oauthAccessToken_clientId_idx").on(table.clientId),
		index("oauthAccessToken_sessionId_idx").on(table.sessionId),
		index("oauthAccessToken_userId_idx").on(table.userId),
		index("oauthAccessToken_authorizationCodeId_idx").on(table.authorizationCodeId),
		index("oauthAccessToken_refreshId_idx").on(table.refreshId),
	],
);

export const oauthConsent = pgTable(
	"oauth_consent",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id").notNull(),
		userId: text("user_id"),
		referenceId: text("reference_id"),
		resources: jsonb("resources").$type<string[]>(),
		requestedUserInfoClaims: jsonb("requested_user_info_claims").$type<string[]>(),
		scopes: jsonb("scopes").$type<string[]>().notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(table) => [
		index("oauthConsent_clientId_idx").on(table.clientId),
		index("oauthConsent_userId_idx").on(table.userId),
	],
);

export const oauthClientAssertion = pgTable("oauth_client_assertion", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
});

export const rateLimit = pgTable("rate_limit", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique(),
	count: integer("count").notNull(),
	lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const drizzleSchema = {
	user,
	session,
	account,
	verification,
	organization,
	member,
	invitation,
	jwks,
	oauthClient,
	oauthResource,
	oauthClientResource,
	oauthRefreshToken,
	oauthAccessToken,
	oauthConsent,
	oauthClientAssertion,
	rateLimit,
};
