import { Inject, Injectable } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import { BETTER_AUTH_INSTANCE } from "../better-auth.tokens.ts";
import type { AnyAuth, AuthContextOf, RegisteredAuth, UserSession } from "../types/auth.types.ts";

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

	async getSession(headers: Headers | IncomingHttpHeaders): Promise<UserSession<TAuth> | null> {
		const webHeaders = headers instanceof Headers ? headers : fromNodeHeaders(headers);
		const session = await (this.auth as AnyAuth).api.getSession({ headers: webHeaders });
		return (session ?? null) as UserSession<TAuth> | null;
	}
}
