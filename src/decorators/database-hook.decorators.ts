import { DiscoveryService, Reflector } from "@nestjs/core";
import { METADATA_KEY } from "../better-auth.constants.ts";
import type {
	DatabaseHookModel,
	DatabaseHookOperation,
	DatabaseHookPhase,
} from "../better-auth.constants.ts";
import type { HookClassOptions } from "./hook.decorators.ts";

/**
 * Marks a provider class as a better-auth database-hook container. Its
 * methods decorated with `@BeforeCreate`/`@AfterUpdate`/... are discovered at
 * bootstrap and wired into the auth instance. Must be singleton-scoped.
 */
export const DatabaseHook = DiscoveryService.createDecorator<HookClassOptions | undefined>();

export interface DatabaseHookMethodMetadata {
	model: DatabaseHookModel;
	operation: DatabaseHookOperation;
	phase: DatabaseHookPhase;
	order?: number;
}

export interface DatabaseHookMethodOptions {
	order?: number;
}

/**
 * The underlying reflectable decorator for database-hook methods; use the
 * `@BeforeCreate(model)` style helpers instead.
 */
export const DatabaseHookMethod = Reflector.createDecorator<DatabaseHookMethodMetadata>({
	key: METADATA_KEY.databaseHook,
});

function databaseHookDecorator(operation: DatabaseHookOperation, phase: DatabaseHookPhase) {
	return (model: DatabaseHookModel, options?: DatabaseHookMethodOptions): MethodDecorator =>
		DatabaseHookMethod({ model, operation, phase, ...options });
}

export const BeforeCreate = databaseHookDecorator("create", "before");
export const AfterCreate = databaseHookDecorator("create", "after");
export const BeforeUpdate = databaseHookDecorator("update", "before");
export const AfterUpdate = databaseHookDecorator("update", "after");
export const BeforeDelete = databaseHookDecorator("delete", "before");
export const AfterDelete = databaseHookDecorator("delete", "after");
