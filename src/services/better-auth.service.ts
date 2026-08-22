import { Inject, Injectable } from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";
import { BETTER_AUTH_INSTANCE } from "../better-auth.tokens.ts";
import type { AnyAuth, AuthContextOf, RegisteredAuth, UserSession } from "../types/auth.types.ts";
import {
	mapBetterAuthApiError,
	normalizeBetterAuthHeaders,
	type BetterAuthApiHeaders,
} from "./better-auth-api-invocation.ts";

/** A plugin-aware Better Auth server API operation. */
export type BetterAuthApiInvocation<TAuth extends AnyAuth, TResult> = (
	api: TAuth["api"],
	headers: Headers,
) => TResult;

/**
 * Typed accessor for the better-auth instance. Inject it anywhere; for
 * plugin-aware typing either augment `BetterAuthTypeRegistry` once or use the
 * explicit generic: `BetterAuthService<typeof auth>`.
 */
@Injectable()
export class BetterAuthService<TAuth extends AnyAuth = RegisteredAuth> {
	constructor(@Inject(BETTER_AUTH_INSTANCE) private readonly auth: TAuth) {}

	get instance(): TAuth {
		return this.auth;
	}

	get api(): TAuth["api"] {
		return this.auth.api;
	}

	get options(): TAuth["options"] {
		return this.auth.options;
	}

	context(): Promise<AuthContextOf<TAuth>> {
		return this.auth.$context as Promise<AuthContextOf<TAuth>>;
	}

	/**
	 * Invoke a plugin-aware Better Auth server endpoint from a Nest service or
	 * controller. Node request headers are normalized to Web Headers and Better
	 * Auth API errors are translated to stable Nest HTTP exceptions.
	 */
	async invokeApi<TResult>(
		headers: BetterAuthApiHeaders,
		invoke: BetterAuthApiInvocation<TAuth, TResult>,
	): Promise<Awaited<TResult>> {
		try {
			return await invoke(this.auth.api, normalizeBetterAuthHeaders(headers));
		} catch (error: unknown) {
			const mapped = mapBetterAuthApiError(error);
			if (mapped) throw mapped;
			throw error;
		}
	}

	async getSession(headers: Headers | IncomingHttpHeaders): Promise<UserSession<TAuth> | null> {
		const webHeaders = normalizeBetterAuthHeaders(headers);
		const session = await (this.auth as AnyAuth).api.getSession({ headers: webHeaders });
		return (session ?? null) as UserSession<TAuth> | null;
	}
}
