import { HttpException, HttpStatus } from "@nestjs/common";
import { isAPIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";

/** Header shapes accepted by Better Auth server-side API invocations. */
export type BetterAuthApiHeaders = Headers | IncomingHttpHeaders;

/** Stable Nest response body produced for a Better Auth API error. */
export interface BetterAuthApiErrorResponse {
	readonly statusCode: number;
	readonly code: string;
	readonly message: string;
}

/** Convert Node/Nest request headers to the Web Headers shape Better Auth requires. */
export function normalizeBetterAuthHeaders(headers: BetterAuthApiHeaders): Headers {
	return headers instanceof Headers ? new Headers(headers) : fromNodeHeaders(headers);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function httpErrorStatus(statusCode: unknown): number {
	return typeof statusCode === "number" &&
		Number.isInteger(statusCode) &&
		statusCode >= 100 &&
		statusCode <= 599
		? statusCode
		: HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * Translate a Better Auth `APIError` into a Nest exception without exposing its
 * arbitrary body fields (notably `cause`). Non-Better-Auth errors are left for
 * the application's own exception pipeline.
 */
export function mapBetterAuthApiError(error: unknown): HttpException | undefined {
	if (!isAPIError(error)) return undefined;

	const statusCode = httpErrorStatus(error.statusCode);
	const body = error.body;
	const code =
		nonEmptyString(body?.code) ??
		nonEmptyString(error.status) ??
		(statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "BETTER_AUTH_ERROR");
	const message =
		nonEmptyString(body?.message) ?? nonEmptyString(error.message) ?? "Better Auth request failed.";
	const response: BetterAuthApiErrorResponse = { statusCode, code, message };

	return new HttpException(response, statusCode, { cause: error });
}
