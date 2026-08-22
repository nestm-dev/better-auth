import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { BetterAuthModuleOptions } from "../interfaces/better-auth-module-options.interface.ts";
import type { AnyAuth, RegisteredAuth } from "../types/auth.types.ts";
import { BETTER_AUTH_MODULE_OPTIONS } from "../better-auth.tokens.ts";
import type { BetterAuthApiHeaders } from "./better-auth-api-invocation.ts";
import { BetterAuthService } from "./better-auth.service.ts";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const MAX_LIST_OFFSET = 1_000_000;
const MAX_IDENTIFIER_LENGTH = 1_024;
const MAX_SEARCH_LENGTH = 256;
const MAX_NAME_LENGTH = 256;
const MAX_EMAIL_LENGTH = 320;
const MAX_ROLE_LENGTH = 128;
const MAX_ROLES = 16;
const MAX_BAN_REASON_LENGTH = 1_024;
const MAX_IMAGE_LENGTH = 4_096;
const MAX_SESSION_TOKEN_LENGTH = 4_096;
const MAX_IP_ADDRESS_LENGTH = 255;
const MAX_USER_AGENT_LENGTH = 1_024;
const MAX_SESSION_RESULTS = 1_000;
const MAX_BAN_SECONDS = 365 * 24 * 60 * 60;

const USER_MANAGEMENT_API_METHODS = [
	"getUser",
	"listUsers",
	"adminUpdateUser",
	"setRole",
	"banUser",
	"unbanUser",
	"listUserSessions",
	"revokeUserSession",
	"revokeUserSessions",
] as const;

type UserManagementApiMethod = (typeof USER_MANAGEMENT_API_METHODS)[number];
type UserManagementApiOperation = (input: unknown) => unknown;

interface UserManagementApi {
	call(method: UserManagementApiMethod, input: unknown): Promise<unknown>;
}

export type BetterAuthManagedUserRedactedField = "name" | "email" | "image" | "banReason";

/** Public, normalized user returned by the Better Auth admin plugin facade. */
export interface BetterAuthManagedUser {
	readonly id: string;
	readonly name: string | null;
	readonly email: string | null;
	readonly emailVerified: boolean;
	readonly image: string | null;
	readonly roles: readonly string[];
	readonly banned: boolean;
	readonly banReason: string | null;
	readonly banExpiresAt: Date | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	/** Display fields projected or omitted to keep this response bounded. */
	readonly redactedFields: readonly BetterAuthManagedUserRedactedField[];
}

export type BetterAuthManagedUserSearchField = "email" | "name";
export type BetterAuthManagedUserSearchOperator = "contains" | "starts_with" | "ends_with";
export type BetterAuthManagedUserSortField = "email" | "name" | "createdAt" | "updatedAt";
export type BetterAuthManagedUserSortDirection = "asc" | "desc";

/** One safe, exact filter supported by stock Better Auth's user list API. */
export type BetterAuthManagedUserListFilter =
	| { readonly field: "role"; readonly value: string }
	| { readonly field: "banned"; readonly value: boolean };

/** Bounded search, filter, sort, and offset pagination for {@link BetterAuthUserManagementService.list}. */
export interface BetterAuthManagedUserListOptions {
	readonly limit?: number | undefined;
	readonly offset?: number | undefined;
	readonly search?: string | undefined;
	readonly searchField?: BetterAuthManagedUserSearchField | undefined;
	readonly searchOperator?: BetterAuthManagedUserSearchOperator | undefined;
	readonly filter?: BetterAuthManagedUserListFilter | undefined;
	readonly sortBy?: BetterAuthManagedUserSortField | undefined;
	readonly sortDirection?: BetterAuthManagedUserSortDirection | undefined;
}

export interface BetterAuthManagedUserPage {
	readonly users: readonly BetterAuthManagedUser[];
	readonly total: number;
	readonly limit: number;
	readonly offset: number;
}

/** Profile fields intentionally safe for an ordinary platform user-management screen. */
export interface BetterAuthManagedUserProfileUpdate {
	readonly name?: string | undefined;
	readonly email?: string | undefined;
}

export interface BetterAuthManagedUserBanOptions {
	readonly reason?: string | undefined;
	/**
	 * Positive seconds, bounded to one year. Omit to let the Better Auth admin
	 * plugin apply its configured `defaultBanExpiresIn` (no expiry by stock default).
	 */
	readonly expiresInSeconds?: number | undefined;
}

export type BetterAuthManagedUserSessionRedactedField = "ipAddress" | "userAgent";

/** Token-free active session information for a managed user. */
export interface BetterAuthManagedUserSession {
	readonly id: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly expiresAt: Date;
	readonly ipAddress: string | null;
	readonly userAgent: string | null;
	readonly impersonated: boolean;
	/** Display metadata truncated to keep this response bounded. */
	readonly redactedFields: readonly BetterAuthManagedUserSessionRedactedField[];
}

export interface BetterAuthManagedUserSessionRevocationResult {
	readonly success: boolean;
	readonly revokedSessionId: string;
}

export interface BetterAuthManagedUserSessionBulkRevocationResult {
	readonly success: boolean;
}

interface PrivateManagedUserSession extends BetterAuthManagedUserSession {
	readonly token: string;
}

interface NormalizedListOptions {
	readonly limit: number;
	readonly offset: number;
	readonly query: Record<string, unknown>;
}

interface NormalizedProfileUpdate {
	readonly name?: string;
	readonly email?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isInputRecord(value: unknown): value is Record<string, unknown> {
	return isRecord(value) && !Array.isArray(value) && !(value instanceof Date);
}

function containsControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

function invalidInput(code: string, message: string): HttpException {
	return new HttpException(
		{ statusCode: HttpStatus.BAD_REQUEST, code, message },
		HttpStatus.BAD_REQUEST,
	);
}

function invalidResponse(message: string): HttpException {
	return new HttpException(
		{
			statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
			code: "INVALID_BETTER_AUTH_RESPONSE",
			message,
		},
		HttpStatus.INTERNAL_SERVER_ERROR,
	);
}

function sessionNotFound(): HttpException {
	return new HttpException(
		{ statusCode: HttpStatus.NOT_FOUND, code: "SESSION_NOT_FOUND", message: "Session not found." },
		HttpStatus.NOT_FOUND,
	);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw invalidResponse(`Better Auth returned an invalid ${label}.`);
	return value;
}

function requiredString(
	record: Record<string, unknown>,
	field: string,
	label: string,
	maximumLength: number,
): string {
	const value = record[field];
	if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
		throw invalidResponse(`Better Auth returned an invalid ${label}.${field}.`);
	}
	return value;
}

function truncateDisplayString(value: string, maximumLength: number): string {
	let result = value.slice(0, maximumLength);
	const finalCodeUnit = result.charCodeAt(result.length - 1);
	const nextCodeUnit = value.charCodeAt(result.length);
	if (
		finalCodeUnit >= 0xd800 &&
		finalCodeUnit <= 0xdbff &&
		nextCodeUnit >= 0xdc00 &&
		nextCodeUnit <= 0xdfff
	) {
		result = result.slice(0, -1);
	}
	return result;
}

function projectedOptionalString(
	record: Record<string, unknown>,
	field: string,
	maximumLength: number,
): { readonly redacted: boolean; readonly value: string | null } {
	const value = record[field];
	if (value === undefined || value === null) return { redacted: false, value: null };
	if (typeof value !== "string") return { redacted: true, value: null };
	return value.length > maximumLength
		? { redacted: true, value: truncateDisplayString(value, maximumLength) }
		: { redacted: false, value };
}

function requiredBoolean(record: Record<string, unknown>, field: string, label: string): boolean {
	const value = record[field];
	if (typeof value !== "boolean") {
		throw invalidResponse(`Better Auth returned an invalid ${label}.${field}.`);
	}
	return value;
}

function requiredDate(record: Record<string, unknown>, field: string, label: string): Date {
	const value = record[field];
	const date =
		value instanceof Date
			? new Date(value.getTime())
			: typeof value === "string" || typeof value === "number"
				? new Date(value)
				: undefined;
	if (!date || Number.isNaN(date.getTime())) {
		throw invalidResponse(`Better Auth returned an invalid ${label}.${field}.`);
	}
	return date;
}

function optionalDate(record: Record<string, unknown>, field: string, label: string): Date | null {
	const value = record[field];
	if (value === undefined || value === null) return null;
	return requiredDate(record, field, label);
}

function requiredNonNegativeInteger(
	record: Record<string, unknown>,
	field: string,
	label: string,
): number {
	const value = record[field];
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw invalidResponse(`Better Auth returned an invalid ${label}.${field}.`);
	}
	return value;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw invalidResponse(`Better Auth returned an invalid ${label}.`);
	return value;
}

function requireIdentifier(value: string, label: "user" | "session"): string {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.length > MAX_IDENTIFIER_LENGTH
	) {
		throw invalidInput(
			label === "user" ? "INVALID_USER_ID" : "INVALID_SESSION_ID",
			`${label === "user" ? "User" : "Session"} id must be a non-empty string no longer than ${MAX_IDENTIFIER_LENGTH} characters.`,
		);
	}
	return value;
}

function storedRoles(value: string): readonly string[] {
	const roles = value.split(",").map((role) => role.trim());
	if (
		roles.length === 0 ||
		roles.length > MAX_ROLES ||
		roles.some(
			(role) =>
				role.length === 0 || role.length > MAX_ROLE_LENGTH || containsControlCharacter(role),
		)
	) {
		throw invalidResponse("Better Auth returned an invalid managed user.role.");
	}
	return [...new Set(roles)];
}

function inputRoles(value: string | readonly string[]): readonly string[] {
	const candidates = typeof value === "string" ? [value] : value;
	if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > MAX_ROLES) {
		throw invalidInput("INVALID_ROLES", `Roles must contain between 1 and ${MAX_ROLES} values.`);
	}
	const roles = candidates.map((candidate) => {
		if (typeof candidate !== "string") {
			throw invalidInput("INVALID_ROLES", "Every role must be a string.");
		}
		const role = candidate.trim();
		if (
			role.length === 0 ||
			role.length > MAX_ROLE_LENGTH ||
			role.includes(",") ||
			containsControlCharacter(role)
		) {
			throw invalidInput(
				"INVALID_ROLES",
				`Every role must be non-empty, comma/control-character-free, and no longer than ${MAX_ROLE_LENGTH} characters.`,
			);
		}
		return role;
	});
	return [...new Set(roles)];
}

function isFacadeEmail(value: string): boolean {
	const separator = value.indexOf("@");
	if (separator <= 0 || separator !== value.lastIndexOf("@")) return false;

	const localPart = value.slice(0, separator);
	const domain = value.slice(separator + 1);
	if (
		localPart.length > 64 ||
		domain.length === 0 ||
		domain.length > 253 ||
		localPart.startsWith(".") ||
		localPart.endsWith(".") ||
		localPart.includes("..") ||
		!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)
	) {
		return false;
	}

	return domain
		.split(".")
		.every(
			(label) =>
				label.length > 0 &&
				label.length <= 63 &&
				/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
		);
}

function publicUser(value: unknown): BetterAuthManagedUser {
	const user = requiredRecord(value, "managed user");
	const redactedFields: BetterAuthManagedUserRedactedField[] = [];
	const bannedValue = user.banned;
	if (typeof bannedValue !== "boolean" && bannedValue !== null) {
		throw invalidResponse("Better Auth returned an invalid managed user.banned.");
	}
	const sourceName = user.name;
	let name: string | null = typeof sourceName === "string" ? sourceName : null;
	if (typeof sourceName !== "string" || sourceName.length === 0) {
		redactedFields.push("name");
		name = null;
	} else if (sourceName.length > MAX_NAME_LENGTH) {
		redactedFields.push("name");
		name = truncateDisplayString(sourceName, MAX_NAME_LENGTH);
	}
	const sourceEmail = user.email;
	let email: string | null = typeof sourceEmail === "string" ? sourceEmail : null;
	if (
		typeof sourceEmail !== "string" ||
		sourceEmail.length === 0 ||
		sourceEmail.length > MAX_EMAIL_LENGTH ||
		!isFacadeEmail(sourceEmail)
	) {
		redactedFields.push("email");
		email = null;
	}
	const image = projectedOptionalString(user, "image", MAX_IMAGE_LENGTH);
	if (image.redacted) redactedFields.push("image");
	const banReason = projectedOptionalString(user, "banReason", MAX_BAN_REASON_LENGTH);
	if (banReason.redacted) redactedFields.push("banReason");
	return {
		id: requiredString(user, "id", "managed user", MAX_IDENTIFIER_LENGTH),
		name,
		email,
		emailVerified: requiredBoolean(user, "emailVerified", "managed user"),
		image: image.redacted ? null : image.value,
		roles: storedRoles(
			requiredString(user, "role", "managed user", MAX_ROLES * (MAX_ROLE_LENGTH + 1)),
		),
		banned: bannedValue === true,
		banReason: banReason.value,
		banExpiresAt: optionalDate(user, "banExpires", "managed user"),
		createdAt: requiredDate(user, "createdAt", "managed user"),
		updatedAt: requiredDate(user, "updatedAt", "managed user"),
		redactedFields,
	};
}

function privateSession(value: unknown, expectedUserId: string): PrivateManagedUserSession {
	const session = requiredRecord(value, "managed user session");
	const redactedFields: BetterAuthManagedUserSessionRedactedField[] = [];
	const userId = requiredString(session, "userId", "managed user session", MAX_IDENTIFIER_LENGTH);
	if (userId !== expectedUserId) {
		throw invalidResponse("Better Auth returned a session for the wrong managed user.");
	}
	const impersonatedBy = session.impersonatedBy;
	if (
		impersonatedBy !== undefined &&
		impersonatedBy !== null &&
		(typeof impersonatedBy !== "string" ||
			impersonatedBy.length === 0 ||
			impersonatedBy.length > MAX_IDENTIFIER_LENGTH)
	) {
		throw invalidResponse("Better Auth returned an invalid managed user session.impersonatedBy.");
	}
	const ipAddress = projectedOptionalString(session, "ipAddress", MAX_IP_ADDRESS_LENGTH);
	if (ipAddress.redacted) redactedFields.push("ipAddress");
	const userAgent = projectedOptionalString(session, "userAgent", MAX_USER_AGENT_LENGTH);
	if (userAgent.redacted) redactedFields.push("userAgent");
	return {
		id: requiredString(session, "id", "managed user session", MAX_IDENTIFIER_LENGTH),
		token: requiredString(session, "token", "managed user session", MAX_SESSION_TOKEN_LENGTH),
		createdAt: requiredDate(session, "createdAt", "managed user session"),
		updatedAt: requiredDate(session, "updatedAt", "managed user session"),
		expiresAt: requiredDate(session, "expiresAt", "managed user session"),
		ipAddress: ipAddress.value,
		userAgent: userAgent.value,
		impersonated: typeof impersonatedBy === "string",
		redactedFields,
	};
}

function publicSession(session: PrivateManagedUserSession): BetterAuthManagedUserSession {
	return {
		id: session.id,
		createdAt: new Date(session.createdAt.getTime()),
		updatedAt: new Date(session.updatedAt.getTime()),
		expiresAt: new Date(session.expiresAt.getTime()),
		ipAddress: session.ipAddress,
		userAgent: session.userAgent,
		impersonated: session.impersonated,
		redactedFields: session.redactedFields,
	};
}

function successResult(value: unknown, label: string): boolean {
	const result = requiredRecord(value, label);
	if (typeof result.success !== "boolean") {
		throw invalidResponse(`Better Auth returned an invalid ${label}.success.`);
	}
	return result.success;
}

function userManagementApi(value: unknown): UserManagementApi {
	const record = requiredRecord(value, "user-management server API");
	for (const method of USER_MANAGEMENT_API_METHODS) {
		if (typeof record[method] !== "function") {
			throw new TypeError(`The Better Auth admin API does not provide '${method}'.`);
		}
	}
	return {
		call: async (method, input) => {
			const operation = record[method];
			if (typeof operation !== "function") {
				throw new TypeError(`The Better Auth admin API does not provide '${method}'.`);
			}
			return await Reflect.apply(operation as UserManagementApiOperation, record, [input]);
		},
	};
}

function boundedInteger(
	value: number | undefined,
	defaultValue: number,
	minimum: number,
	maximum: number,
	field: string,
): number {
	const normalized = value ?? defaultValue;
	if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
		throw invalidInput(
			"INVALID_USER_LIST_OPTIONS",
			`${field} must be an integer between ${minimum} and ${maximum}.`,
		);
	}
	return normalized;
}

function normalizedListOptions(options: BetterAuthManagedUserListOptions): NormalizedListOptions {
	const input = options;
	if (!isInputRecord(options)) {
		throw invalidInput("INVALID_USER_LIST_OPTIONS", "User list options must be an object.");
	}
	const allowedKeys = new Set([
		"limit",
		"offset",
		"search",
		"searchField",
		"searchOperator",
		"filter",
		"sortBy",
		"sortDirection",
	]);
	if (Object.keys(options).some((key) => !allowedKeys.has(key))) {
		throw invalidInput("INVALID_USER_LIST_OPTIONS", "User list options contain an unknown field.");
	}

	const limit = boundedInteger(input.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT, "limit");
	const offset = boundedInteger(input.offset, 0, 0, MAX_LIST_OFFSET, "offset");
	const sortBy = input.sortBy ?? "email";
	const sortDirection = input.sortDirection ?? "asc";
	if (!["email", "name", "createdAt", "updatedAt"].includes(sortBy)) {
		throw invalidInput("INVALID_USER_LIST_OPTIONS", "sortBy is unsupported.");
	}
	if (sortDirection !== "asc" && sortDirection !== "desc") {
		throw invalidInput("INVALID_USER_LIST_OPTIONS", "sortDirection must be 'asc' or 'desc'.");
	}

	const query: Record<string, unknown> = { limit, offset, sortBy, sortDirection };
	if (input.search !== undefined) {
		if (typeof input.search !== "string") {
			throw invalidInput("INVALID_USER_LIST_OPTIONS", "search must be a string.");
		}
		const search = input.search.trim();
		if (search.length === 0 || search.length > MAX_SEARCH_LENGTH) {
			throw invalidInput(
				"INVALID_USER_LIST_OPTIONS",
				`search must be non-empty and no longer than ${MAX_SEARCH_LENGTH} characters.`,
			);
		}
		const searchField = input.searchField ?? "email";
		const searchOperator = input.searchOperator ?? "contains";
		if (searchField !== "email" && searchField !== "name") {
			throw invalidInput("INVALID_USER_LIST_OPTIONS", "searchField is unsupported.");
		}
		if (!["contains", "starts_with", "ends_with"].includes(searchOperator)) {
			throw invalidInput("INVALID_USER_LIST_OPTIONS", "searchOperator is unsupported.");
		}
		query.searchValue = searchField === "email" ? search.toLowerCase() : search;
		query.searchField = searchField;
		query.searchOperator = searchOperator;
	} else if (input.searchField !== undefined || input.searchOperator !== undefined) {
		throw invalidInput(
			"INVALID_USER_LIST_OPTIONS",
			"searchField and searchOperator require search.",
		);
	}

	if (input.filter !== undefined) {
		const filter = input.filter;
		if (!isInputRecord(filter)) {
			throw invalidInput("INVALID_USER_LIST_OPTIONS", "filter must be an object.");
		}
		if (Object.keys(filter).some((key) => key !== "field" && key !== "value")) {
			throw invalidInput("INVALID_USER_LIST_OPTIONS", "filter contains an unknown field.");
		}
		if (filter.field === "role") {
			if (typeof filter.value !== "string") {
				throw invalidInput("INVALID_USER_LIST_OPTIONS", "A role filter requires a string value.");
			}
			const [role] = inputRoles(filter.value);
			query.filterField = "role";
			query.filterValue = role;
		} else if (filter.field === "banned") {
			if (typeof filter.value !== "boolean") {
				throw invalidInput(
					"INVALID_USER_LIST_OPTIONS",
					"A banned filter requires a boolean value.",
				);
			}
			query.filterField = "banned";
			query.filterValue = filter.value;
		} else {
			throw invalidInput("INVALID_USER_LIST_OPTIONS", "filter.field is unsupported.");
		}
		query.filterOperator = "eq";
	}

	return { limit, offset, query };
}

function normalizedProfileUpdate(
	update: BetterAuthManagedUserProfileUpdate,
): NormalizedProfileUpdate {
	const input = update;
	if (!isInputRecord(update)) {
		throw invalidInput("INVALID_USER_PROFILE_UPDATE", "Profile update must be an object.");
	}
	if (Object.keys(update).some((key) => key !== "name" && key !== "email")) {
		throw invalidInput("INVALID_USER_PROFILE_UPDATE", "Profile update contains an unknown field.");
	}
	const data: { name?: string; email?: string } = {};
	if (input.name !== undefined) {
		if (typeof input.name !== "string") {
			throw invalidInput("INVALID_USER_PROFILE_UPDATE", "name must be a string.");
		}
		const name = input.name.trim();
		if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
			throw invalidInput(
				"INVALID_USER_PROFILE_UPDATE",
				`name must be non-empty and no longer than ${MAX_NAME_LENGTH} characters.`,
			);
		}
		data.name = name;
	}
	if (input.email !== undefined) {
		if (typeof input.email !== "string") {
			throw invalidInput("INVALID_USER_PROFILE_UPDATE", "email must be a string.");
		}
		const email = input.email.trim().toLowerCase();
		if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !isFacadeEmail(email)) {
			throw invalidInput(
				"INVALID_USER_PROFILE_UPDATE",
				`email must use a valid address syntax and be no longer than ${MAX_EMAIL_LENGTH} characters.`,
			);
		}
		data.email = email;
	}
	if (Object.keys(data).length === 0) {
		throw invalidInput(
			"INVALID_USER_PROFILE_UPDATE",
			"At least one profile field must be provided.",
		);
	}
	return data;
}

function normalizedBanOptions(options: BetterAuthManagedUserBanOptions): {
	readonly reason?: string;
	readonly expiresInSeconds?: number;
} {
	const input = options;
	if (!isInputRecord(options)) {
		throw invalidInput("INVALID_BAN_OPTIONS", "Ban options must be an object.");
	}
	if (Object.keys(options).some((key) => key !== "reason" && key !== "expiresInSeconds")) {
		throw invalidInput("INVALID_BAN_OPTIONS", "Ban options contain an unknown field.");
	}
	let reason: string | undefined;
	if (input.reason !== undefined) {
		if (typeof input.reason !== "string") {
			throw invalidInput("INVALID_BAN_OPTIONS", "Ban reason must be a string.");
		}
		reason = input.reason.trim();
		if (reason.length === 0 || reason.length > MAX_BAN_REASON_LENGTH) {
			throw invalidInput(
				"INVALID_BAN_OPTIONS",
				`Ban reason must be non-empty and no longer than ${MAX_BAN_REASON_LENGTH} characters.`,
			);
		}
	}
	let expiresInSeconds: number | undefined;
	if (input.expiresInSeconds !== undefined) {
		expiresInSeconds = input.expiresInSeconds;
		if (
			!Number.isSafeInteger(expiresInSeconds) ||
			expiresInSeconds <= 0 ||
			expiresInSeconds > MAX_BAN_SECONDS
		) {
			throw invalidInput(
				"INVALID_BAN_OPTIONS",
				`Ban expiry must be an integer between 1 and ${MAX_BAN_SECONDS} seconds.`,
			);
		}
	}
	return {
		...(reason === undefined ? {} : { reason }),
		...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
	};
}

/**
 * Application-facing platform user management over Better Auth's stock admin
 * plugin. Public results are runtime-validated, list inputs are bounded, and
 * bearer session tokens never cross this service boundary.
 */
@Injectable()
export class BetterAuthUserManagementService<TAuth extends AnyAuth = RegisteredAuth> {
	constructor(
		private readonly betterAuth: BetterAuthService<TAuth>,
		@Inject(BETTER_AUTH_MODULE_OPTIONS)
		private readonly moduleOptions: BetterAuthModuleOptions,
	) {}

	async get(headers: BetterAuthApiHeaders, userIdInput: string): Promise<BetterAuthManagedUser> {
		const userId = requireIdentifier(userIdInput, "user");
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) =>
			this.readUser(userManagementApi(untypedApi), normalizedHeaders, userId),
		);
	}

	async list(
		headers: BetterAuthApiHeaders,
		options: BetterAuthManagedUserListOptions = {},
	): Promise<BetterAuthManagedUserPage> {
		const normalized = normalizedListOptions(options);
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const result = requiredRecord(
				await userManagementApi(untypedApi).call("listUsers", {
					headers: normalizedHeaders,
					query: normalized.query,
				}),
				"managed user list",
			);
			const users = requiredArray(result.users, "managed user list.users");
			if (users.length > normalized.limit) {
				throw invalidResponse("Better Auth returned more managed users than the requested limit.");
			}
			return {
				users: users.map(publicUser),
				total: requiredNonNegativeInteger(result, "total", "managed user list"),
				limit: normalized.limit,
				offset: normalized.offset,
			};
		});
	}

	async updateProfile(
		headers: BetterAuthApiHeaders,
		userIdInput: string,
		update: BetterAuthManagedUserProfileUpdate,
	): Promise<BetterAuthManagedUser> {
		const userId = requireIdentifier(userIdInput, "user");
		const data = normalizedProfileUpdate(update);
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = userManagementApi(untypedApi);
			return this.runUserMutation(userId, async () => {
				const current = await this.readUser(api, normalizedHeaders, userId);
				const changedData: Record<string, unknown> = {};
				if (
					data.name !== undefined &&
					(current.name === null ||
						current.redactedFields.includes("name") ||
						data.name !== current.name)
				) {
					changedData.name = data.name;
				}
				if (
					data.email !== undefined &&
					(current.email === null || data.email !== current.email.toLowerCase())
				) {
					changedData.email = data.email;
					// Better Auth's stock adminUpdateUser does not reset this when the
					// email changes, so the safe facade must do so atomically.
					changedData.emailVerified = false;
				}
				if (Object.keys(changedData).length === 0) return current;
				return publicUser(
					await api.call("adminUpdateUser", {
						headers: normalizedHeaders,
						body: { userId, data: changedData },
					}),
				);
			});
		});
	}

	async setRoles(
		headers: BetterAuthApiHeaders,
		userIdInput: string,
		rolesInput: string | readonly string[],
	): Promise<BetterAuthManagedUser> {
		const userId = requireIdentifier(userIdInput, "user");
		const roles = inputRoles(rolesInput);
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = userManagementApi(untypedApi);
			return this.runUserMutation(userId, async () => {
				const result = requiredRecord(
					await api.call("setRole", {
						headers: normalizedHeaders,
						body: { userId, role: roles.length === 1 ? roles[0] : [...roles] },
					}),
					"managed user role update",
				);
				return publicUser(result.user);
			});
		});
	}

	async ban(
		headers: BetterAuthApiHeaders,
		userIdInput: string,
		options: BetterAuthManagedUserBanOptions = {},
	): Promise<BetterAuthManagedUser> {
		const userId = requireIdentifier(userIdInput, "user");
		const normalized = normalizedBanOptions(options);
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = userManagementApi(untypedApi);
			return this.runUserMutation(userId, async () => {
				const current = await this.readUser(api, normalizedHeaders, userId);
				const body = {
					userId,
					...(normalized.reason === undefined ? {} : { banReason: normalized.reason }),
					...(normalized.expiresInSeconds === undefined
						? {}
						: { banExpiresIn: normalized.expiresInSeconds }),
				};
				const callBan = async (): Promise<Record<string, unknown>> =>
					requiredRecord(
						await api.call("banUser", {
							headers: normalizedHeaders,
							body,
						}),
						"managed user ban",
					);

				if (normalized.expiresInSeconds === undefined && current.banExpiresAt !== null) {
					// Stock Better Auth 1.6.26 preserves a previous banExpires when
					// banUser omits it. Clear it while keeping the target banned first:
					// if the final ban fails, the account remains fail-closed.
					await api.call("adminUpdateUser", {
						headers: normalizedHeaders,
						body: { userId, data: { banned: true, banExpires: null } },
					});
				}
				const result = await callBan();
				return publicUser(result.user);
			});
		});
	}

	async unban(headers: BetterAuthApiHeaders, userIdInput: string): Promise<BetterAuthManagedUser> {
		const userId = requireIdentifier(userIdInput, "user");
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = userManagementApi(untypedApi);
			return this.runUserMutation(userId, async () => {
				const result = requiredRecord(
					await api.call("unbanUser", {
						headers: normalizedHeaders,
						body: { userId },
					}),
					"managed user unban",
				);
				return publicUser(result.user);
			});
		});
	}

	async listSessions(
		headers: BetterAuthApiHeaders,
		userIdInput: string,
	): Promise<readonly BetterAuthManagedUserSession[]> {
		const userId = requireIdentifier(userIdInput, "user");
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = userManagementApi(untypedApi);
			await this.readUser(api, normalizedHeaders, userId);
			const now = Date.now();
			return (await this.readPrivateSessions(api, normalizedHeaders, userId))
				.filter((session) => session.expiresAt.getTime() > now)
				.toSorted(
					(left, right) =>
						right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
				)
				.map(publicSession);
		});
	}

	async revokeSessionById(
		headers: BetterAuthApiHeaders,
		userIdInput: string,
		sessionIdInput: string,
	): Promise<BetterAuthManagedUserSessionRevocationResult> {
		const userId = requireIdentifier(userIdInput, "user");
		const sessionId = requireIdentifier(sessionIdInput, "session");
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = userManagementApi(untypedApi);
			return this.runUserMutation(userId, async () => {
				const now = Date.now();
				const target = (await this.readPrivateSessions(api, normalizedHeaders, userId)).find(
					(session) => session.id === sessionId && session.expiresAt.getTime() > now,
				);
				if (!target) throw sessionNotFound();
				const result = await api.call("revokeUserSession", {
					headers: normalizedHeaders,
					body: { sessionToken: target.token },
				});
				return {
					success: successResult(result, "managed user session revocation"),
					revokedSessionId: target.id,
				};
			});
		});
	}

	async revokeAllSessions(
		headers: BetterAuthApiHeaders,
		userIdInput: string,
	): Promise<BetterAuthManagedUserSessionBulkRevocationResult> {
		const userId = requireIdentifier(userIdInput, "user");
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = userManagementApi(untypedApi);
			return this.runUserMutation(userId, async () => {
				await this.readUser(api, normalizedHeaders, userId);
				const result = await api.call("revokeUserSessions", {
					headers: normalizedHeaders,
					body: { userId },
				});
				return { success: successResult(result, "managed user session bulk revocation") };
			});
		});
	}

	private readUser(
		api: UserManagementApi,
		headers: Headers,
		userId: string,
	): Promise<BetterAuthManagedUser> {
		return api
			.call("getUser", { headers, query: { id: userId } })
			.then((value) => publicUser(value));
	}

	private async readPrivateSessions(
		api: UserManagementApi,
		headers: Headers,
		userId: string,
	): Promise<readonly PrivateManagedUserSession[]> {
		const result = requiredRecord(
			await api.call("listUserSessions", { headers, body: { userId } }),
			"managed user session list",
		);
		const sessions = requiredArray(result.sessions, "managed user session list.sessions");
		if (sessions.length > MAX_SESSION_RESULTS) {
			throw invalidResponse(
				`Better Auth returned more than ${MAX_SESSION_RESULTS} managed user sessions.`,
			);
		}
		return sessions.map((session) => privateSession(session, userId));
	}

	private runUserMutation<T>(userId: string, operation: () => Promise<T>): Promise<T> {
		return this.moduleOptions.controlPlaneLifecycle?.run("user", userId, operation) ?? operation();
	}
}
