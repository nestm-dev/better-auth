import { ConfigurableModuleBuilder } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { BETTER_AUTH_MODULE_OPTIONS } from "./better-auth.tokens.ts";
import { BetterAuthGuard } from "./guards/better-auth.guard.ts";
import type {
	BetterAuthModuleExtras,
	BetterAuthModuleOptions,
} from "./interfaces/better-auth-module-options.interface.ts";

export const {
	ConfigurableModuleClass,
	MODULE_OPTIONS_TOKEN,
	OPTIONS_TYPE,
	ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<BetterAuthModuleOptions>({
	optionsInjectionToken: BETTER_AUTH_MODULE_OPTIONS,
})
	.setClassMethodName("forRoot")
	.setFactoryMethodName("createBetterAuthOptions")
	.setExtras<BetterAuthModuleExtras>(
		{ isGlobal: true, disableGlobalGuard: false },
		(definition, extras) => ({
			...definition,
			global: extras.isGlobal !== false,
			providers: [
				...(definition.providers ?? []),
				...(extras.disableGlobalGuard
					? []
					: [{ provide: APP_GUARD, useClass: BetterAuthGuard }]),
			],
		}),
	)
	.build();

/** Options accepted by `BetterAuthModule.forRoot()` (module options + extras). */
export type BetterAuthForRootOptions = typeof OPTIONS_TYPE;

/** Options accepted by `BetterAuthModule.forRootAsync()`. */
export type BetterAuthForRootAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
