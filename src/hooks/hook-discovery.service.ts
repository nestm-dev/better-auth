import { Injectable } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper.js";
import { AfterHook, BeforeHook, Hook } from "../decorators/hook.decorators.ts";
import { DatabaseHook, DatabaseHookMethod } from "../decorators/database-hook.decorators.ts";
import type { HookClassOptions } from "../decorators/hook.decorators.ts";
import { compileHookMatcher } from "./hook-matcher.ts";
import { BetterAuthHookRegistry } from "./hook-registry.service.ts";
import { BetterAuthDatabaseHookRegistry } from "./database-hook-registry.service.ts";
import type { AuthHookContext } from "../types/auth.types.ts";

/**
 * Scans the whole container for `@Hook()` / `@DatabaseHook()` provider
 * classes and registers their decorated methods in the registries. Runs once
 * from `BetterAuthModule.onModuleInit`.
 *
 * Nest's discovery index links a class to only ONE `createDecorator` key, so
 * a class carrying both `@Hook()` and `@DatabaseHook()` shows up under a
 * single `getProviders({ metadataKey })` query. The wrapper set is therefore
 * the union of both queries, and the metadata itself (which survives on the
 * class for both keys) decides which method families to scan.
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
		const wrappers = new Set<InstanceWrapper>([
			...this.discovery.getProviders({ metadataKey: Hook.KEY }),
			...this.discovery.getProviders({ metadataKey: DatabaseHook.KEY }),
		]);
		for (const wrapper of wrappers) {
			const metatype = wrapper.metatype;
			if (!metatype) continue;
			const hookOptions = Reflect.getMetadata(Hook.KEY, metatype) as HookClassOptions | undefined;
			const databaseHookOptions = Reflect.getMetadata(DatabaseHook.KEY, metatype) as
				HookClassOptions | undefined;
			if (hookOptions === undefined && databaseHookOptions === undefined) continue;
			const instance = this.resolveInstance(wrapper);
			if (hookOptions !== undefined) {
				this.scanRequestHookMethods(wrapper, instance, hookOptions);
			}
			if (databaseHookOptions !== undefined) {
				this.scanDatabaseHookMethods(wrapper, instance, databaseHookOptions);
			}
		}
	}

	private resolveInstance(wrapper: InstanceWrapper): object {
		const { instance, metatype } = wrapper;
		if (instance && typeof instance === "object") return instance as object;
		throw new Error(
			`Hook class '${metatype?.name ?? wrapper.name}' could not be instantiated statically. ` +
				`Hook classes must be singleton-scoped (no request/transient scope).`,
		);
	}

	private scanRequestHookMethods(
		wrapper: InstanceWrapper,
		instance: object,
		classOptions: HookClassOptions,
	): void {
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

	private scanDatabaseHookMethods(
		wrapper: InstanceWrapper,
		instance: object,
		classOptions: HookClassOptions,
	): void {
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
