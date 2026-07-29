import { createAuthMiddleware } from "better-auth/api";
import type { Logger } from "@nestjs/common";
import { DATABASE_HOOK_MODELS, DATABASE_HOOK_OPERATIONS } from "../better-auth.constants.ts";
import type { AnyAuth, AuthHookContext } from "../types/auth.types.ts";
import { BetterAuthHookRegistry } from "./hook-registry.service.ts";
import { BetterAuthDatabaseHookRegistry } from "./database-hook-registry.service.ts";
import type { DatabaseHookFn } from "./database-hook-registry.service.ts";

/**
 * Slot stored on the auth context. Dispatchers and database-hook wrappers
 * read the registries through it at request time, so re-installing (a second
 * Nest app over the same auth instance, HMR, repeated TestingModules) only
 * swaps the slot contents — hooks always run against the live app's
 * registries and are never chained twice.
 */
const DISPATCH_SLOT = Symbol("better_auth:dispatch_slot");

interface DispatchSlot {
	hooks: BetterAuthHookRegistry;
	databaseHooks: BetterAuthDatabaseHookRegistry;
}

type HookMiddleware = (ctx: AuthHookContext) => Promise<unknown>;

interface MutableAuthOptions {
	hooks?: { before?: HookMiddleware; after?: HookMiddleware };
	databaseHooks?: Record<
		string,
		Record<string, { before?: DatabaseHookFn; after?: DatabaseHookFn } | undefined> | undefined
	>;
}

interface SlotHolder {
	[DISPATCH_SLOT]?: DispatchSlot;
	options?: MutableAuthOptions;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * A `createAuthMiddleware` function invoked with the live dispatch context
 * (which carries better-call's `returnHeaders` flag) resolves to a
 * `{ headers, response }` wrapper instead of the handler's raw return value.
 * Unwrap it so the hook protocol (context-merge vs short-circuit) is applied
 * to what the user's handler actually returned; headers set through `ctx`
 * propagate via the shared context object regardless.
 */
function unwrapMiddlewareResult(result: unknown): unknown {
	if (
		isPlainObject(result) &&
		result.headers instanceof Headers &&
		Object.keys(result).length <= 2 &&
		("response" in result || Object.keys(result).length === 1)
	) {
		return (result as { response?: unknown }).response;
	}
	return result;
}

function buildDispatchers(
	userBefore: HookMiddleware | undefined,
	userAfter: HookMiddleware | undefined,
	slot: DispatchSlot,
): { before: HookMiddleware; after: HookMiddleware } {
	return {
		before: createAuthMiddleware(async (ctx) => {
			let initialContext: Record<string, unknown> | undefined;
			if (userBefore) {
				const result = unwrapMiddlewareResult(await userBefore(ctx as AuthHookContext));
				if (isPlainObject(result)) {
					if ("context" in result) {
						// The user's hook asked for a context merge: apply it and
						// keep going so decorator hooks still run.
						initialContext = result.context as Record<string, unknown>;
						Object.assign(ctx as unknown as Record<string, unknown>, initialContext);
					} else {
						// Any other truthy object short-circuits the endpoint.
						return result;
					}
				}
			}
			return slot.hooks.runBefore(ctx as AuthHookContext, initialContext);
		}),
		after: createAuthMiddleware(async (ctx) => {
			if (userAfter) await userAfter(ctx as AuthHookContext);
			return slot.hooks.runAfter(ctx as AuthHookContext);
		}),
	};
}

function assertDatabaseHooksUsable(
	options: MutableAuthOptions,
	databaseHooks: BetterAuthDatabaseHookRegistry,
): asserts options is MutableAuthOptions & {
	databaseHooks: NonNullable<MutableAuthOptions["databaseHooks"]>;
} {
	if (!options.databaseHooks && databaseHooks.size > 0) {
		throw new Error(
			"@DatabaseHook providers were found, but the better-auth instance was created without " +
				"a `databaseHooks` object, so they can never fire (better-auth captures that object " +
				"at init). Add `databaseHooks: {}` to your betterAuth(...) options, or use " +
				"BetterAuthModule.forRoot({ options }) which handles this for you.",
		);
	}
}

/**
 * Installs a single stable before/after dispatcher pair on the auth
 * instance's resolved context, plus wrappers on every `databaseHooks` node.
 * The dispatchers consult the registries through {@link DISPATCH_SLOT} at
 * request time, so this can run before/after discovery in any order, never
 * mutates the consumer's own options object, and is idempotent per auth
 * context (re-installation swaps registries instead of chaining).
 */
export async function installHookDispatchers(
	auth: AnyAuth,
	hooks: BetterAuthHookRegistry,
	databaseHooks: BetterAuthDatabaseHookRegistry,
	logger: Logger,
): Promise<void> {
	// Awaiting $context also converts a bad database/config into a clean
	// bootstrap failure instead of an unhandled rejection on first request.
	const ctx = (await auth.$context) as SlotHolder;
	const options: MutableAuthOptions = ctx.options ?? (ctx.options = {});

	const existingSlot = ctx[DISPATCH_SLOT];
	if (existingSlot) {
		assertDatabaseHooksUsable(options, databaseHooks);
		existingSlot.hooks = hooks;
		existingSlot.databaseHooks = databaseHooks;
		return;
	}

	assertDatabaseHooksUsable(options, databaseHooks);
	const slot: DispatchSlot = { hooks, databaseHooks };
	ctx[DISPATCH_SLOT] = slot;

	const dispatchers = buildDispatchers(options.hooks?.before, options.hooks?.after, slot);
	try {
		options.hooks = dispatchers;
	} catch {
		// ctx.options is frozen (upstream change): fall back to mutating the
		// nested hooks object on the consumer's options, which better-auth
		// shares by reference — but that object must exist.
		const nested = (auth.options as MutableAuthOptions | undefined)?.hooks;
		if (!nested || typeof nested !== "object") {
			throw new Error(
				"Better Auth's resolved options are frozen and the instance was created without a " +
					"`hooks` object, so NestJS hook providers cannot be installed. Add `hooks: {}` to " +
					"your betterAuth(...) options, or use BetterAuthModule.forRoot({ options }).",
			);
		}
		nested.before = dispatchers.before;
		nested.after = dispatchers.after;
		logger.warn(
			"Better Auth's resolved options are frozen; hook dispatchers were installed on the " +
				"consumer options' `hooks` object instead.",
		);
	}

	const databaseHooksRoot = options.databaseHooks;
	if (!databaseHooksRoot) return;
	for (const model of DATABASE_HOOK_MODELS) {
		for (const operation of DATABASE_HOOK_OPERATIONS) {
			const modelNode = (databaseHooksRoot[model] ??= {});
			const node = (modelNode[operation] ??= {});
			const originalBefore = node.before;
			const originalAfter = node.after;
			node.before = (data, hookCtx) =>
				slot.databaseHooks.runBefore(model, operation, data, hookCtx, originalBefore);
			node.after = (record, hookCtx) =>
				slot.databaseHooks.runAfter(model, operation, record, hookCtx, originalAfter);
		}
	}
}
