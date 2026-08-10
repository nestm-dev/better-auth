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

@Entity("oauth_application")
export class OauthApplication {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "name", type: "text", nullable: true })
	name!: string | null;

	@Column({ name: "icon", type: "text", nullable: true })
	icon!: string | null;

	@Column({ name: "metadata", type: "text", nullable: true })
	metadata!: string | null;

	@Column({ name: "client_id", type: "text", nullable: true })
	clientId!: string | null;

	@Column({ name: "client_secret", type: "text", nullable: true })
	clientSecret!: string | null;

	@Column({ name: "redirect_urls", type: "text", nullable: true })
	redirectUrls!: string | null;

	@Column({ name: "type", type: "text", nullable: true })
	type!: string | null;

	@Column({ name: "disabled", type: "boolean", nullable: true, default: false })
	disabled!: boolean | null;

	@Column({ name: "user_id", type: "text", nullable: true })
	userId!: string | null;

	@Column({ name: "created_at", type: "timestamp", nullable: true })
	createdAt!: Date | null;

	@Column({ name: "updated_at", type: "timestamp", nullable: true })
	updatedAt!: Date | null;
}

@Entity("oauth_access_token")
export class OauthAccessToken {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "access_token", type: "text", nullable: true })
	accessToken!: string | null;

	@Column({ name: "refresh_token", type: "text", nullable: true })
	refreshToken!: string | null;

	@Column({ name: "access_token_expires_at", type: "timestamp", nullable: true })
	accessTokenExpiresAt!: Date | null;

	@Column({ name: "refresh_token_expires_at", type: "timestamp", nullable: true })
	refreshTokenExpiresAt!: Date | null;

	@Column({ name: "client_id", type: "text", nullable: true })
	clientId!: string | null;

	@Column({ name: "user_id", type: "text", nullable: true })
	userId!: string | null;

	@Column({ name: "scopes", type: "text", nullable: true })
	scopes!: string | null;

	@Column({ name: "created_at", type: "timestamp", nullable: true })
	createdAt!: Date | null;

	@Column({ name: "updated_at", type: "timestamp", nullable: true })
	updatedAt!: Date | null;
}

@Entity("oauth_consent")
export class OauthConsent {
	@PrimaryColumn({ name: "id", type: "text" })
	id!: string;

	@Column({ name: "client_id", type: "text", nullable: true })
	clientId!: string | null;

	@Column({ name: "user_id", type: "text", nullable: true })
	userId!: string | null;

	@Column({ name: "scopes", type: "text", nullable: true })
	scopes!: string | null;

	@Column({ name: "created_at", type: "timestamp", nullable: true })
	createdAt!: Date | null;

	@Column({ name: "updated_at", type: "timestamp", nullable: true })
	updatedAt!: Date | null;

	@Column({ name: "consent_given", type: "boolean", nullable: true })
	consentGiven!: boolean | null;
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
	OauthApplication,
	OauthAccessToken,
	OauthConsent,
	RateLimit,
];
