import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { APIError } from "better-auth/api";
import type { AnyAuth, RegisteredAuth } from "../types/auth.types.ts";
import type { BetterAuthApiHeaders } from "./better-auth-api-invocation.ts";
import { BetterAuthService } from "./better-auth.service.ts";

const MAX_SESSION_IDENTIFIER_LENGTH = 1_024;
const MAX_SESSION_TOKEN_LENGTH = 4_096;
const MAX_IP_ADDRESS_LENGTH = 255;
const MAX_USER_AGENT_LENGTH = 1_024;

export type BetterAuthSessionRedactedField = "ipAddress" | "userAgent";

/** Token-free session information safe to return from an application API. */
export interface BetterAuthSessionSummary {
	readonly id: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly expiresAt: Date;
	readonly ipAddress: string | null;
	readonly userAgent: string | null;
	readonly current: boolean;
	/** Display metadata truncated to keep this response bounded. */
	readonly redactedFields: readonly BetterAuthSessionRedactedField[];
}

/** Result of revoking one caller-owned session by its public-safe identifier. */
export interface BetterAuthSessionRevocationResult {
	readonly status: boolean;
	readonly revokedSessionId: string;
	readonly revokedCurrentSession: boolean;
}

/** Result of a bulk session revocation operation. */
export interface BetterAuthSessionBulkRevocationResult {
	readonly status: boolean;
}

interface CoreSessionApi {
	getSession(input: {
		headers: Headers;
		query: { disableCookieCache: boolean; disableRefresh: boolean };
	}): unknown;
	listSessions(input: { headers: Headers }): unknown;
	revokeSession(input: { body: { token: string }; headers: Headers }): unknown;
	revokeOtherSessions(input: { headers: Headers }): unknown;
	revokeSessions(input: { headers: Headers }): unknown;
}

interface PrivateSessionRecord {
	readonly id: string;
	readonly token: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly expiresAt: Date;
	readonly ipAddress: string | null;
	readonly userAgent: string | null;
	readonly redactedFields: readonly BetterAuthSessionRedactedField[];
}

interface OwnedSessions {
	readonly currentSessionId: string;
	readonly sessions: readonly PrivateSessionRecord[];
}

const CORE_SESSION_API_METHODS = [
	"getSession",
	"listSessions",
	"revokeSession",
	"revokeOtherSessions",
	"revokeSessions",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function coreSessionApi(value: unknown): CoreSessionApi {
	if (!isRecord(value)) {
		throw new TypeError("The Better Auth server API is unavailable.");
	}
	for (const method of CORE_SESSION_API_METHODS) {
		if (typeof value[method] !== "function") {
			throw new TypeError(`The Better Auth server API does not provide '${method}'.`);
		}
	}

	const invoke = (method: (typeof CORE_SESSION_API_METHODS)[number], input: unknown): unknown => {
		const candidate = value[method];
		if (typeof candidate !== "function") {
			// Re-check in case a mutable plugin API changes after the initial validation.
			throw new TypeError(`The Better Auth server API does not provide '${method}'.`);
		}
		const result: unknown = Reflect.apply(candidate, value, [input]);
		return result;
	};

	return {
		getSession: (input) => invoke("getSession", input),
		listSessions: (input) => invoke("listSessions", input),
		revokeSession: (input) => invoke("revokeSession", input),
		revokeOtherSessions: (input) => invoke("revokeOtherSessions", input),
		revokeSessions: (input) => invoke("revokeSessions", input),
	};
}

function requiredString(
	record: Record<string, unknown>,
	field: string,
	maximumLength: number,
): string {
	const value = record[field];
	if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
		throw new TypeError(`Better Auth returned an invalid session '${field}'.`);
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
	if (value === null || value === undefined) return { redacted: false, value: null };
	if (typeof value !== "string") return { redacted: true, value: null };
	return value.length > maximumLength
		? { redacted: true, value: truncateDisplayString(value, maximumLength) }
		: { redacted: false, value };
}

function requiredDate(record: Record<string, unknown>, field: string): Date {
	const value = record[field];
	let date: Date;
	if (value instanceof Date) date = new Date(value.getTime());
	else if (typeof value === "string") date = new Date(value);
	else if (typeof value === "number") date = new Date(value);
	else throw new TypeError(`Better Auth returned an invalid session '${field}'.`);
	if (Number.isNaN(date.getTime())) {
		throw new TypeError(`Better Auth returned an invalid session '${field}'.`);
	}
	return date;
}

function privateSession(value: unknown): PrivateSessionRecord {
	if (!isRecord(value)) throw new TypeError("Better Auth returned an invalid session.");
	const redactedFields: BetterAuthSessionRedactedField[] = [];
	const ipAddress = projectedOptionalString(value, "ipAddress", MAX_IP_ADDRESS_LENGTH);
	if (ipAddress.redacted) redactedFields.push("ipAddress");
	const userAgent = projectedOptionalString(value, "userAgent", MAX_USER_AGENT_LENGTH);
	if (userAgent.redacted) redactedFields.push("userAgent");
	return {
		id: requiredString(value, "id", MAX_SESSION_IDENTIFIER_LENGTH),
		token: requiredString(value, "token", MAX_SESSION_TOKEN_LENGTH),
		createdAt: requiredDate(value, "createdAt"),
		updatedAt: requiredDate(value, "updatedAt"),
		expiresAt: requiredDate(value, "expiresAt"),
		ipAddress: ipAddress.value,
		userAgent: userAgent.value,
		redactedFields,
	};
}

function currentSessionId(value: unknown): string | undefined {
	if (value === null) return undefined;
	if (!isRecord(value) || !isRecord(value.session)) {
		throw new TypeError("Better Auth returned an invalid current session.");
	}
	return requiredString(value.session, "id", MAX_SESSION_IDENTIFIER_LENGTH);
}

function privateSessions(value: unknown): readonly PrivateSessionRecord[] {
	if (!Array.isArray(value)) {
		throw new TypeError("Better Auth returned an invalid session list.");
	}
	return value.map(privateSession);
}

function revocationStatus(value: unknown): boolean {
	if (!isRecord(value) || typeof value.status !== "boolean") {
		throw new TypeError("Better Auth returned an invalid session revocation result.");
	}
	return value.status;
}

function sessionNotFound(): HttpException {
	return new HttpException(
		{
			statusCode: HttpStatus.NOT_FOUND,
			code: "SESSION_NOT_FOUND",
			message: "Session not found.",
		},
		HttpStatus.NOT_FOUND,
	);
}

function invalidSessionId(): HttpException {
	return new HttpException(
		{
			statusCode: HttpStatus.BAD_REQUEST,
			code: "INVALID_SESSION_ID",
			message: "Session id must be a non-empty string.",
		},
		HttpStatus.BAD_REQUEST,
	);
}

/**
 * Application-facing session management over Better Auth's token-oriented API.
 * Tokens remain private to this service and are never present in its results.
 */
@Injectable()
export class BetterAuthSessionService<TAuth extends AnyAuth = RegisteredAuth> {
	constructor(private readonly betterAuth: BetterAuthService<TAuth>) {}

	/** List the caller's active sessions without exposing bearer tokens or user ids. */
	async list(headers: BetterAuthApiHeaders): Promise<readonly BetterAuthSessionSummary[]> {
		const owned = await this.readOwnedSessions(headers);
		return owned.sessions.map((session) => ({
			id: session.id,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			expiresAt: session.expiresAt,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent,
			current: session.id === owned.currentSessionId,
			redactedFields: session.redactedFields,
		}));
	}

	/**
	 * Revoke one of the caller's sessions by id. Unknown and foreign ids share
	 * the same response so this method does not become a session-id oracle.
	 */
	async revokeById(
		headers: BetterAuthApiHeaders,
		sessionId: string,
	): Promise<BetterAuthSessionRevocationResult> {
		if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
			throw invalidSessionId();
		}

		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = coreSessionApi(untypedApi);
			const owned = await this.readOwnedSessionsWithApi(api, normalizedHeaders);
			const target = owned.sessions.find((session) => session.id === sessionId);
			if (!target) throw sessionNotFound();

			const result = await api.revokeSession({
				body: { token: target.token },
				headers: normalizedHeaders,
			});
			return {
				status: revocationStatus(result),
				revokedSessionId: target.id,
				revokedCurrentSession: target.id === owned.currentSessionId,
			};
		});
	}

	/** Revoke every caller-owned session except the session making this request. */
	async revokeOthers(
		headers: BetterAuthApiHeaders,
	): Promise<BetterAuthSessionBulkRevocationResult> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const result = await coreSessionApi(untypedApi).revokeOtherSessions({
				headers: normalizedHeaders,
			});
			return { status: revocationStatus(result) };
		});
	}

	/** Revoke every caller-owned session, including the session making this request. */
	async revokeAll(headers: BetterAuthApiHeaders): Promise<BetterAuthSessionBulkRevocationResult> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const result = await coreSessionApi(untypedApi).revokeSessions({
				headers: normalizedHeaders,
			});
			return { status: revocationStatus(result) };
		});
	}

	private readOwnedSessions(headers: BetterAuthApiHeaders): Promise<OwnedSessions> {
		return this.betterAuth.invokeApi(headers, (untypedApi: unknown, normalizedHeaders) =>
			this.readOwnedSessionsWithApi(coreSessionApi(untypedApi), normalizedHeaders),
		);
	}

	private async readOwnedSessionsWithApi(
		api: CoreSessionApi,
		headers: Headers,
	): Promise<OwnedSessions> {
		const currentResult = await api.getSession({
			headers,
			query: { disableCookieCache: true, disableRefresh: true },
		});
		const currentId = currentSessionId(currentResult);
		if (!currentId) {
			throw new APIError("UNAUTHORIZED", {
				code: "UNAUTHORIZED",
				message: "Unauthorized.",
			});
		}

		const sessions = privateSessions(await api.listSessions({ headers }));
		return { currentSessionId: currentId, sessions };
	}
}
