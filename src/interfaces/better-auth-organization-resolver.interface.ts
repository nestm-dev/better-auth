import type { ExecutionContext } from "@nestjs/common";

/** Authenticated request input; selecting an organization never grants membership. */
export interface BetterAuthOrganizationResolutionContext {
	readonly request: unknown;
	readonly context: ExecutionContext;
}

/** Optional application selection policy, independent of the shared login session. */
export interface BetterAuthOrganizationResolver {
	resolve(
		input: BetterAuthOrganizationResolutionContext,
	): string | null | undefined | Promise<string | null | undefined>;
}
