import { betterAuth } from "better-auth";
import type { FactoryProvider } from "@nestjs/common";
import { BETTER_AUTH_INSTANCE, BETTER_AUTH_MODULE_OPTIONS } from "../better-auth.tokens.ts";
import type { BetterAuthModuleOptions } from "../interfaces/better-auth-module-options.interface.ts";
import type { AnyAuth } from "../types/auth.types.ts";

export const betterAuthInstanceProvider: FactoryProvider<AnyAuth> = {
	provide: BETTER_AUTH_INSTANCE,
	inject: [BETTER_AUTH_MODULE_OPTIONS],
	useFactory: (moduleOptions: BetterAuthModuleOptions): AnyAuth => {
		if (moduleOptions.auth) {
			return moduleOptions.auth;
		}
		if (!moduleOptions.options) {
			throw new Error(
				"BetterAuthModule requires either `auth` (a pre-built betterAuth() instance) " +
					"or `options` (raw BetterAuthOptions) in forRoot/forRootAsync.",
			);
		}
		// Pre-seed `hooks`/`databaseHooks`: better-auth captures the
		// `databaseHooks` reference at init time, so it must exist before
		// betterAuth() is called for decorator database hooks to ever fire.
		return betterAuth({
			...moduleOptions.options,
			hooks: moduleOptions.options.hooks ?? {},
			databaseHooks: moduleOptions.options.databaseHooks ?? {},
		}) as AnyAuth;
	},
};
