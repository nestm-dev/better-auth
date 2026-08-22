/** Compile-time coverage for the stable, token-free session facade. */
import {
	BetterAuthSessionService,
	type BetterAuthSessionBulkRevocationResult,
	type BetterAuthSessionRevocationResult,
	type BetterAuthSessionSummary,
} from "../../src/index.ts";
import type { IncomingHttpHeaders } from "node:http";

declare const service: BetterAuthSessionService;
declare const requestHeaders: IncomingHttpHeaders;

const listed: Promise<readonly BetterAuthSessionSummary[]> = service.list(requestHeaders);
const revoked: Promise<BetterAuthSessionRevocationResult> = service.revokeById(
	requestHeaders,
	"session-id",
);
const revokedOthers: Promise<BetterAuthSessionBulkRevocationResult> =
	service.revokeOthers(requestHeaders);
const revokedAll: Promise<BetterAuthSessionBulkRevocationResult> = service.revokeAll(new Headers());

async function assertSafeSurface(): Promise<void> {
	const summary = (await listed)[0];
	if (summary) {
		const id: string = summary.id;
		const current: boolean = summary.current;
		// @ts-expect-error Tokens must never appear on public summaries.
		const token = summary.token;
		// @ts-expect-error User ids must never appear on public summaries.
		const userId = summary.userId;
		void id;
		void current;
		void token;
		void userId;
	}
}

export { assertSafeSurface, listed, revoked, revokedAll, revokedOthers };
