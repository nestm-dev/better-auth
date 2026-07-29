import { Injectable } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper.js";
import { AfterHook, BeforeHook, Hook } from "../decorators/hook.decorators.ts";
import { DatabaseHook, DatabaseHookMethod } from "../decorators/database-hook.decorators.ts";
import { compileHookMatcher } from "./hook-matcher.ts";
import { BetterAuthHookRegistry } from "./hook-registry.service.ts";
import { BetterAuthDatabaseHookRegistry } from "./database-hook-registry.service.ts";
import type { AuthHookContext } from "../types/auth.types.ts";

/**
 * Scans the whole container for `@Hook()` / `@DatabaseHook()` provider
 * classes and registers their decorated methods in the registries. Runs once
 * from `BetterAuthModule.onModuleInit`.
 */
@Injectable()
export class BetterAuthHookDiscoveryService {
	constructor(
		private readonly discovery: DiscoveryService,
		private readonly metadataScanner: MetadataScanner,
		private readonly reflector: Reflector,
		private readonly hooks: BetterAuthHookRegistry,
		private readonly databaseHooks: BetterAuthDatabaseHookRegistry,
	) {}

	scan(): void {
		this.scanRequestHooks();
		this.scanDatabaseHooks();
	}

	private resolveInstance(wrapper: InstanceWrapper, kind: string): object | undefined {
		const { instance, metatype } = wrapper;
		if (instance && typeof instance === "object") return instance as object;
		throw new Error(
			`${kind} class '${metatype?.name ?? wrapper.name}' could not be instantiated statically. ` +
				`Hook classes must be singleton-scoped (no request/transient scope).`,
		);
	}

	private scanRequestHooks(): void {
		for (const wrapper of this.discovery.getProviders({ metadataKey: Hook.KEY })) {
			const instance = this.resolveInstance(wrapper, "@Hook");
			if (!instance) continue;
			const classOptions = this.discovery.getMetadataByDecorator(Hook, wrapper) ?? {};
			const prototype = Object.getPrototypeOf(instance) as Record<
				string,
				(ctx: AuthHookContext) => unknown
			>;
			for (const methodName of this.metadataScanner.getAllMethodNames(prototype)) {
				const methodRef = prototype[methodName];
				if (typeof methodRef !== "function") continue;
				for (const [phase, decorator] of [
					["before", BeforeHook],
					["after", AfterHook],
				] as const) {
					const methodOptions = this.reflector.get(decorator, methodRef);
					if (!methodOptions) continue;
					this.hooks.register(phase, {
						handler: (ctx) => methodRef.apply(instance, [ctx]),
						match: compileHookMatcher(methodOptions.path),
						order: methodOptions.order ?? classOptions.order ?? 0,
						source: { metatype: wrapper.metatype ?? instance.constructor, methodName },
					});
				}
			}
		}
	}

	private scanDatabaseHooks(): void {
		for (const wrapper of this.discovery.getProviders({ metadataKey: DatabaseHook.KEY })) {
			const instance = this.resolveInstance(wrapper, "@DatabaseHook");
			if (!instance) continue;
			const classOptions = this.discovery.getMetadataByDecorator(DatabaseHook, wrapper) ?? {};
			const prototype = Object.getPrototypeOf(instance) as Record<
				string,
				(data: unknown, ctx: unknown) => unknown
			>;
			for (const methodName of this.metadataScanner.getAllMethodNames(prototype)) {
				const methodRef = prototype[methodName];
				if (typeof methodRef !== "function") continue;
				const metadata = this.reflector.get(DatabaseHookMethod, methodRef);
				if (!metadata) continue;
				this.databaseHooks.register(metadata.model, metadata.operation, metadata.phase, {
					handler: (data, ctx) => methodRef.apply(instance, [data, ctx]),
					order: metadata.order ?? classOptions.order ?? 0,
					source: { metatype: wrapper.metatype ?? instance.constructor, methodName },
				});
			}
		}
	}
}
