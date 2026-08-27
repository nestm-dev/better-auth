import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/**
 * The TypeORM reading of `schema.sql`.
 *
 * Two properties of this file are load-bearing rather than incidental:
 *
 *   * every column carries an explicit `name`, so the camelCase property / snake_case column
 *     split the adapter has to bridge is real here;
 *   * `User.updatedAt` and `Verification.updatedAt` are `@UpdateDateColumn`, which is where
 *     Better Auth's write model and TypeORM's overlap: Better Auth force-materialises
 *     `updatedAt` into every update payload, and the ORM wants to write that column itself.
 *     `update-date-column.spec.ts` pins how TypeORM 1.1 resolves the overlap and shows the
 *     adapter does not depend on the answer.
 *
 * No relations, only scalar foreign keys — decorated entity classes under ESM cannot form
 * import cycles that way, and nothing eager-loads by surprise.
 */

@Entity("user")
export class User {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "name", type: "text" })
	name!: string;

	@Column({ name: "email", type: "text" })
	email!: string;

	@Column({ name: "email_verified", type: "boolean", default: false })
	emailVerified!: boolean;

	@Column({ name: "image", type: "text", nullable: true })
	image!: string | null;

	@Column({ name: "created_at", type: "timestamp", default: () => "now()" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamp", default: () => "now()" })
	updatedAt!: Date;
}

@Entity("session")
export class Session {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "expires_at", type: "timestamp" })
	expiresAt!: Date;

	@Column({ name: "token", type: "text" })
	token!: string;

	@Column({ name: "created_at", type: "timestamp", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "updated_at", type: "timestamp" })
	updatedAt!: Date;

	@Column({ name: "ip_address", type: "text", nullable: true })
	ipAddress!: string | null;

	@Column({ name: "user_agent", type: "text", nullable: true })
	userAgent!: string | null;

	@Column({ name: "user_id", type: "text" })
	userId!: string;

	@Column({ name: "active_organization_id", type: "text", nullable: true })
	activeOrganizationId!: string | null;
}

@Entity("account")
export class Account {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "issuer", type: "text" })
	issuer!: string;

	@Column({ name: "account_id", type: "text" })
	accountId!: string;

	@Column({ name: "provider_id", type: "text" })
	providerId!: string;

	@Column({ name: "user_id", type: "text" })
	userId!: string;

	@Column({ name: "access_token", type: "text", nullable: true })
	accessToken!: string | null;

	@Column({ name: "refresh_token", type: "text", nullable: true })
	refreshToken!: string | null;

	@Column({ name: "id_token", type: "text", nullable: true })
	idToken!: string | null;

	@Column({ name: "access_token_expires_at", type: "timestamp", nullable: true })
	accessTokenExpiresAt!: Date | null;

	@Column({ name: "refresh_token_expires_at", type: "timestamp", nullable: true })
	refreshTokenExpiresAt!: Date | null;

	@Column({ name: "scope", type: "text", nullable: true })
	scope!: string | null;

	@Column({ name: "password", type: "text", nullable: true })
	password!: string | null;

	@Column({ name: "created_at", type: "timestamp", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "updated_at", type: "timestamp" })
	updatedAt!: Date;
}

@Entity("verification")
export class Verification {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "identifier", type: "text" })
	identifier!: string;

	@Column({ name: "value", type: "text" })
	value!: string;

	@Column({ name: "expires_at", type: "timestamp" })
	expiresAt!: Date;

	@Column({ name: "created_at", type: "timestamp", default: () => "now()" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamp", default: () => "now()" })
	updatedAt!: Date;
}

@Entity("organization")
export class Organization {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "name", type: "text" })
	name!: string;

	@Column({ name: "slug", type: "text" })
	slug!: string;

	@Column({ name: "logo", type: "text", nullable: true })
	logo!: string | null;

	@Column({ name: "created_at", type: "timestamp" })
	createdAt!: Date;

	@Column({ name: "metadata", type: "text", nullable: true })
	metadata!: string | null;
}

@Entity("member")
export class Member {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "organization_id", type: "text" })
	organizationId!: string;

	@Column({ name: "user_id", type: "text" })
	userId!: string;

	@Column({ name: "role", type: "text", default: "member" })
	role!: string;

	@Column({ name: "created_at", type: "timestamp" })
	createdAt!: Date;
}

@Entity("invitation")
export class Invitation {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "organization_id", type: "text" })
	organizationId!: string;

	@Column({ name: "email", type: "text" })
	email!: string;

	@Column({ name: "role", type: "text", nullable: true })
	role!: string | null;

	@Column({ name: "status", type: "text", default: "pending" })
	status!: string;

	@Column({ name: "expires_at", type: "timestamp" })
	expiresAt!: Date;

	@Column({ name: "created_at", type: "timestamp", default: () => "now()" })
	createdAt!: Date;

	@Column({ name: "inviter_id", type: "text" })
	inviterId!: string;
}

@Entity("jwks")
export class Jwks {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "public_key", type: "text" })
	publicKey!: string;

	@Column({ name: "private_key", type: "text" })
	privateKey!: string;

	@Column({ name: "created_at", type: "timestamp" })
	createdAt!: Date;

	@Column({ name: "expires_at", type: "timestamp", nullable: true })
	expiresAt!: Date | null;

	@Column({ name: "alg", type: "text", nullable: true })
	alg!: string | null;

	@Column({ name: "crv", type: "text", nullable: true })
	crv!: string | null;
}

@Entity("oauth_client")
export class OauthClient {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "client_id", type: "text" })
	clientId!: string;

	@Column({ name: "client_secret", type: "text", nullable: true })
	clientSecret!: string | null;

	@Column({ name: "client_discovery_id", type: "text", nullable: true })
	clientDiscoveryId!: string | null;

	@Column({ name: "disabled", type: "boolean", nullable: true, default: false })
	disabled!: boolean | null;

	@Column({ name: "skip_consent", type: "boolean", nullable: true })
	skipConsent!: boolean | null;

	@Column({ name: "enable_end_session", type: "boolean", nullable: true })
	enableEndSession!: boolean | null;

	@Column({ name: "subject_type", type: "text", nullable: true })
	subjectType!: string | null;

	@Column({ name: "scopes", type: "jsonb", nullable: true })
	scopes!: string[] | null;

	@Column({
		name: "client_credentials_scopes",
		type: "jsonb",
		nullable: true,
		default: () => "'[]'::jsonb",
	})
	clientCredentialsScopes!: string[] | null;

	@Column({ name: "user_id", type: "text", nullable: true })
	userId!: string | null;

	@Column({ name: "created_at", type: "timestamp", nullable: true })
	createdAt!: Date | null;

	@Column({ name: "updated_at", type: "timestamp", nullable: true })
	updatedAt!: Date | null;

	@Column({ name: "name", type: "text", nullable: true })
	name!: string | null;

	@Column({ name: "uri", type: "text", nullable: true })
	uri!: string | null;

	@Column({ name: "icon", type: "text", nullable: true })
	icon!: string | null;

	@Column({ name: "contacts", type: "jsonb", nullable: true })
	contacts!: string[] | null;

	@Column({ name: "tos", type: "text", nullable: true })
	tos!: string | null;

	@Column({ name: "policy", type: "text", nullable: true })
	policy!: string | null;

	@Column({ name: "software_id", type: "text", nullable: true })
	softwareId!: string | null;

	@Column({ name: "software_version", type: "text", nullable: true })
	softwareVersion!: string | null;

	@Column({ name: "software_statement", type: "text", nullable: true })
	softwareStatement!: string | null;

	@Column({ name: "redirect_uris", type: "jsonb" })
	redirectUris!: string[];

	@Column({ name: "post_logout_redirect_uris", type: "jsonb", nullable: true })
	postLogoutRedirectUris!: string[] | null;

	@Column({ name: "backchannel_logout_uri", type: "text", nullable: true })
	backchannelLogoutUri!: string | null;

	@Column({ name: "backchannel_logout_session_required", type: "boolean", nullable: true })
	backchannelLogoutSessionRequired!: boolean | null;

	@Column({ name: "token_endpoint_auth_method", type: "text", nullable: true })
	tokenEndpointAuthMethod!: string | null;

	@Column({ name: "application_type", type: "text", nullable: true })
	applicationType!: string | null;

	@Column({ name: "jwks", type: "text", nullable: true })
	jwks!: string | null;

	@Column({ name: "jwks_uri", type: "text", nullable: true })
	jwksUri!: string | null;

	@Column({ name: "grant_types", type: "jsonb", nullable: true })
	grantTypes!: string[] | null;

	@Column({ name: "response_types", type: "jsonb", nullable: true })
	responseTypes!: string[] | null;

	@Column({ name: "require_pkce", type: "boolean", nullable: true })
	requirePKCE!: boolean | null;

	@Column({ name: "dpop_bound_access_tokens", type: "boolean", nullable: true, default: false })
	dpopBoundAccessTokens!: boolean | null;

	@Column({ name: "reference_id", type: "text", nullable: true })
	referenceId!: string | null;

	@Column({ name: "metadata", type: "jsonb", nullable: true })
	metadata!: Record<string, unknown> | null;
}

@Entity("oauth_resource")
export class OauthResource {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "identifier", type: "text" })
	identifier!: string;

	@Column({ name: "name", type: "text" })
	name!: string;

	@Column({ name: "access_token_ttl", type: "int", nullable: true })
	accessTokenTtl!: number | null;

	@Column({ name: "refresh_token_ttl", type: "int", nullable: true })
	refreshTokenTtl!: number | null;

	@Column({ name: "signing_algorithm", type: "text", nullable: true })
	signingAlgorithm!: string | null;

	@Column({ name: "signing_key_id", type: "text", nullable: true })
	signingKeyId!: string | null;

	@Column({ name: "allowed_scopes", type: "jsonb", nullable: true })
	allowedScopes!: string[] | null;

	@Column({ name: "custom_claims", type: "jsonb", nullable: true })
	customClaims!: Record<string, unknown> | null;

	@Column({
		name: "dpop_bound_access_tokens_required",
		type: "boolean",
		nullable: true,
		default: false,
	})
	dpopBoundAccessTokensRequired!: boolean | null;

	@Column({ name: "disabled", type: "boolean", nullable: true, default: false })
	disabled!: boolean | null;

	@Column({ name: "created_at", type: "timestamp", nullable: true })
	createdAt!: Date | null;

	@Column({ name: "updated_at", type: "timestamp", nullable: true })
	updatedAt!: Date | null;

	@Column({ name: "policy_version", type: "int", nullable: true, default: 1 })
	policyVersion!: number | null;

	@Column({ name: "metadata", type: "jsonb", nullable: true })
	metadata!: Record<string, unknown> | null;
}

@Entity("oauth_client_resource")
export class OauthClientResource {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "client_id", type: "text" })
	clientId!: string;

	@Column({ name: "resource_id", type: "text" })
	resourceId!: string;

	@Column({ name: "metadata", type: "jsonb", nullable: true })
	metadata!: Record<string, unknown> | null;

	@Column({ name: "created_at", type: "timestamp", nullable: true })
	createdAt!: Date | null;
}

@Entity("oauth_refresh_token")
export class OauthRefreshToken {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "token", type: "text" })
	token!: string;

	@Column({ name: "client_id", type: "text" })
	clientId!: string;

	@Column({ name: "session_id", type: "text", nullable: true })
	sessionId!: string | null;

	@Column({ name: "user_id", type: "text" })
	userId!: string;

	@Column({ name: "reference_id", type: "text", nullable: true })
	referenceId!: string | null;

	@Column({ name: "authorization_code_id", type: "text", nullable: true })
	authorizationCodeId!: string | null;

	@Column({ name: "resources", type: "jsonb", nullable: true })
	resources!: string[] | null;

	@Column({ name: "requested_user_info_claims", type: "jsonb", nullable: true })
	requestedUserInfoClaims!: string[] | null;

	@Column({ name: "expires_at", type: "timestamp" })
	expiresAt!: Date;

	@Column({ name: "created_at", type: "timestamp" })
	createdAt!: Date;

	@Column({ name: "revoked", type: "timestamp", nullable: true })
	revoked!: Date | null;

	@Column({ name: "rotated_at", type: "timestamp", nullable: true })
	rotatedAt!: Date | null;

	@Column({ name: "rotation_replay_response", type: "text", nullable: true })
	rotationReplayResponse!: string | null;

	@Column({ name: "rotation_replay_expires_at", type: "timestamp", nullable: true })
	rotationReplayExpiresAt!: Date | null;

	@Column({ name: "auth_time", type: "timestamp", nullable: true })
	authTime!: Date | null;

	@Column({ name: "confirmation", type: "jsonb", nullable: true })
	confirmation!: Record<string, unknown> | null;

	@Column({ name: "scopes", type: "jsonb" })
	scopes!: string[];
}

@Entity("oauth_access_token")
export class OauthAccessToken {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "token", type: "text" })
	token!: string;

	@Column({ name: "client_id", type: "text" })
	clientId!: string;

	@Column({ name: "session_id", type: "text", nullable: true })
	sessionId!: string | null;

	@Column({ name: "user_id", type: "text", nullable: true })
	userId!: string | null;

	@Column({ name: "reference_id", type: "text", nullable: true })
	referenceId!: string | null;

	@Column({ name: "authorization_code_id", type: "text", nullable: true })
	authorizationCodeId!: string | null;

	@Column({ name: "resources", type: "jsonb", nullable: true })
	resources!: string[] | null;

	@Column({ name: "requested_user_info_claims", type: "jsonb", nullable: true })
	requestedUserInfoClaims!: string[] | null;

	@Column({ name: "refresh_id", type: "text", nullable: true })
	refreshId!: string | null;

	@Column({ name: "expires_at", type: "timestamp" })
	expiresAt!: Date;

	@Column({ name: "created_at", type: "timestamp" })
	createdAt!: Date;

	@Column({ name: "revoked", type: "timestamp", nullable: true })
	revoked!: Date | null;

	@Column({ name: "confirmation", type: "jsonb", nullable: true })
	confirmation!: Record<string, unknown> | null;

	@Column({ name: "scopes", type: "jsonb" })
	scopes!: string[];
}

@Entity("oauth_consent")
export class OauthConsent {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "client_id", type: "text" })
	clientId!: string;

	@Column({ name: "user_id", type: "text", nullable: true })
	userId!: string | null;

	@Column({ name: "reference_id", type: "text", nullable: true })
	referenceId!: string | null;

	@Column({ name: "resources", type: "jsonb", nullable: true })
	resources!: string[] | null;

	@Column({ name: "requested_user_info_claims", type: "jsonb", nullable: true })
	requestedUserInfoClaims!: string[] | null;

	@Column({ name: "scopes", type: "jsonb" })
	scopes!: string[];

	@Column({ name: "created_at", type: "timestamp" })
	createdAt!: Date;

	@Column({ name: "updated_at", type: "timestamp" })
	updatedAt!: Date;
}

@Entity("oauth_client_assertion")
export class OauthClientAssertion {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "expires_at", type: "timestamp" })
	expiresAt!: Date;
}

/**
 * `rateLimit` -> `RateLimit` -> `rate_limit` is the model-resolution case that needs both
 * fallback tiers, and `lastRequest` is the `bigint` node-pg returns as a string.
 *
 * The `bigint` column carries NO TypeORM `ValueTransformer` on purpose: raw SQL bypasses
 * transformers entirely, so a transformer here would hide whether the adapter's own
 * `customTransformOutput` is doing the coercion.
 */
@Entity("rate_limit")
export class RateLimit {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "key", type: "text" })
	key!: string;

	@Column({ name: "count", type: "int" })
	count!: number;

	@Column({ name: "last_request", type: "bigint" })
	lastRequest!: string;
}

export const AUTH_ENTITIES = [
	User,
	Session,
	Account,
	Verification,
	Organization,
	Member,
	Invitation,
	Jwks,
	OauthClient,
	OauthResource,
	OauthClientResource,
	OauthRefreshToken,
	OauthAccessToken,
	OauthConsent,
	OauthClientAssertion,
	RateLimit,
];
