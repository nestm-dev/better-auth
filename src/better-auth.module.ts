import { Inject, Logger, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import type {
	DynamicModule,
	MiddlewareConsumer,
	NestModule,
	OnApplicationShutdown,
	OnModuleInit,
	Type,
} from "@nestjs/common";
import { ConfigurableModuleClass } from "./better-auth.module-definition.ts";
import {
	BETTER_AUTH_BASE_PATH,
	BETTER_AUTH_INSTANCE,
	BETTER_AUTH_MODULE_OPTIONS,
} from "./better-auth.tokens.ts";
import { betterAuthInstanceProvider } from "./providers/auth-instance.provider.ts";
import { BetterAuthService } from "./services/better-auth.service.ts";
import { BetterAuthGuard } from "./guards/better-auth.guard.ts";
import { BetterAuthHookRegistry } from "./hooks/hook-registry.service.ts";
import { BetterAuthDatabaseHookRegistry } from "./hooks/database-hook-registry.service.ts";
import { BetterAuthHookDiscoveryService } from "./hooks/hook-discovery.service.ts";
import { installHookDispatchers } from "./hooks/hook-installer.ts";
import { BetterAuthMountService } from "./mount/mount.service.ts";
import { resolveAuthBasePath } from "./mount/base-path.ts";
import { Hook } from "./decorators/hook.decorators.ts";
import { DatabaseHook } from "./decorators/database-hook.decorators.ts";
import type { BetterAuthFeatureOptions } from "./interfaces/better-auth-feature-options.interface.ts";
import type { BetterAuthModuleOptions } from "./interfaces/better-auth-module-options.interface.ts";
import type { AnyAuth } from "./types/auth.types.ts";

/** Host module for hook classes registered via `BetterAuthModule.forFeature`. */
@Module({})
export class BetterAuthFeatureModule {}

function assertHookClass(candidate: Type<unknown>): void {
	const isHook =
		Reflect.getMetadata(Hook.KEY, candidate) !== undefined ||
		Reflect.getMetadata(DatabaseHook.KEY, candidate) !== undefined;
	if (!isHook) {
		throw new Error(
			`BetterAuthModule.forFeature: '${candidate?.name ?? String(candidate)}' is not decorated ` +
				"with @Hook() or @DatabaseHook().",
		);
	}
}

@Module({
	imports: [DiscoveryModule],
	providers: [
		betterAuthInstanceProvider,
		{
			provide: BETTER_AUTH_BASE_PATH,
			inject: [BETTER_AUTH_INSTANCE, BETTER_AUTH_MODULE_OPTIONS],
			useFactory: (auth: AnyAuth, options: BetterAuthModuleOptions) =>
				resolveAuthBasePath(auth, options.basePath),
		},
		BetterAuthService,
		BetterAuthGuard,
		BetterAuthHookRegistry,
		BetterAuthDatabaseHookRegistry,
		BetterAuthHookDiscoveryService,
		BetterAuthMountService,
	],
	exports: [
		BETTER_AUTH_INSTANCE,
		BETTER_AUTH_MODULE_OPTIONS,
		BETTER_AUTH_BASE_PATH,
		BetterAuthService,
		BetterAuthGuard,
		BetterAuthHookRegistry,
		BetterAuthDatabaseHookRegistry,
	],
})
export class BetterAuthModule
	extends ConfigurableModuleClass
	implements NestModule, OnModuleInit, OnApplicationShutdown
{
	private readonly logger = new Logger("BetterAuthModule");

	constructor(
		private readonly mountService: BetterAuthMountService,
		private readonly hookDiscovery: BetterAuthHookDiscoveryService,
		private readonly hooks: BetterAuthHookRegistry,
		private readonly databaseHooks: BetterAuthDatabaseHookRegistry,
		@Inject(BETTER_AUTH_INSTANCE) private readonly auth: AnyAuth,
	) {
		super();
	}

	/**
	 * Kept as a NestModule so Nest treats the module as middleware-aware; the
	 * actual mount happens in onModuleInit — which runs after
	 * MiddlewareConsumer middleware registration, so consumer-registered
	 * middleware (request-context, logging, ...) still executes for auth
	 * routes, while remaining ahead of the 404/exception layer.
	 */
	configure(_consumer: MiddlewareConsumer): void {
		// intentionally empty — see onModuleInit
	}

	async onModuleInit(): Promise<void> {
		this.mountService.mount();
		this.hookDiscovery.scan();
		await installHookDispatchers(this.auth, this.hooks, this.databaseHooks, this.logger);
	}

	async onApplicationShutdown(): Promise<void> {
		this.hooks.clear();
		this.databaseHooks.clear();
		await (this.auth.$context as Promise<unknown>).catch(() => undefined);
	}

	/**
	 * Registers `@Hook()` / `@DatabaseHook()` classes as providers. Purely
	 * ergonomic — hook classes listed in any module's `providers` array are
	 * discovered identically (and that is the right place for hooks that
	 * inject feature-local providers).
	 */
	static forFeature(options: BetterAuthFeatureOptions = {}): DynamicModule {
		const hookClasses = options.hooks ?? [];
		for (const hookClass of hookClasses) assertHookClass(hookClass);
		return {
			module: BetterAuthFeatureModule,
			imports: options.imports ?? [],
			providers: [...hookClasses],
			exports: [...hookClasses],
		};
	}
}
