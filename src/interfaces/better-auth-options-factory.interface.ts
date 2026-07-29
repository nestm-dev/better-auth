import type { BetterAuthModuleOptions } from "./better-auth-module-options.interface.ts";

/**
 * Implement this interface to provide module options via
 * `forRootAsync({ useClass })` / `forRootAsync({ useExisting })`.
 */
export interface BetterAuthOptionsFactory {
	createBetterAuthOptions(): Promise<BetterAuthModuleOptions> | BetterAuthModuleOptions;
}
