import { createAuthMiddleware } from "better-auth/api";
import type { Logger } from "@nestjs/common";
import { DATABASE_HOOK_MODELS, DATABASE_HOOK_OPERATIONS } from "../better-auth.constants.ts";
import type { AnyAuth, AuthHookContext } from "../types/auth.types.ts";
import { applyContextPatch, BetterAuthHookRegistry } from "./hook-registry.service.ts";
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
 * `{ headers, response }` wrapper instead of the handler's raw return value —
 * and that wrapper is the ONLY channel carrying headers/cookies the user's
 * middleware set (better-call allocates a fresh Headers per invocation).
 * Split it so both parts can be propagated.
 */
function splitMiddlewareResult(result: unknown): { response: unknown; headers?: Headers } {
	if (
		isPlainObject(result) &&
		result.headers instanceof Headers &&
		Object.keys(result).length <= 2 &&
		("response" in result || Object.keys(result).length === 1)
	) {
		return { response: (result as { response?: unknown }).response, headers: result.headers };
	}
	return { response: result };
}

/**
 * Replays headers from a nested middleware invocation into the dispatcher's
 * own `ctx.responseHeaders` accumulator, which better-auth merges into the
 * final response. `Set-Cookie` is appended (multi-value), everything else set.
 */
function mergeIntoResponseHeaders(ctx: AuthHookContext, headers: Headers | undefined): void {
	if (!headers) return;
	const target = (ctx as { responseHeaders?: Headers }).responseHeaders;
	if (!(target instanceof Headers)) return;
	headers.forEach((value, key) => {
		if (key.toLowerCase() !== "set-cookie") target.set(key, value);
	});
	for (const cookie of headers.getSetCookie()) {
		target.append("set-cookie", cookie);
	}
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
				const { response, headers } = splitMiddlewareResult(
					await userBefore(ctx as AuthHookContext),
				);
				mergeIntoResponseHeaders(ctx as AuthHookContext, headers);
				if (isPlainObject(response)) {
					if ("context" in response) {
						// The user's hook asked for a context merge: apply it and
						// keep going so decorator hooks still run.
						initialContext = response.context as Record<string, unknown>;
						applyContextPatch(ctx, initialContext);
					} else {
						// Any other truthy object short-circuits the endpoint.
						return response;
					}
				}
			}
			return slot.hooks.runBefore(ctx as AuthHookContext, initialContext);
		}),
		after: createAuthMiddleware(async (ctx) => {
			let userResponse: unknown;
			if (userAfter) {
				const { response, headers } = splitMiddlewareResult(
					await userAfter(ctx as AuthHookContext),
				);
				mergeIntoResponseHeaders(ctx as AuthHookContext, headers);
				if (response !== undefined) {
					// Replay better-auth's own after-hook semantics for the
					// consumer's middleware: a defined return replaces `returned`.
					(ctx.context as { returned?: unknown }).returned = response;
					userResponse = response;
				}
			}
			const decoratorResponse = await slot.hooks.runAfter(ctx as AuthHookContext);
			return decoratorResponse !== undefined ? decoratorResponse : userResponse;
		}),
	};
}

function assertDatabaseHooksUsable(
	options: MutableAuthOptions,
	databaseHooks: BetterAuthDatabaseHookRegistry,
): void {
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
