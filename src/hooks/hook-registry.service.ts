import { Injectable, Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import type { AuthHookContext } from "../types/auth.types.ts";
import type { CompiledHookMatcher } from "./hook-matcher.ts";

export type HookPhase = "before" | "after";

export interface AuthHookEntry {
	handler: (ctx: AuthHookContext) => unknown;
	match: CompiledHookMatcher;
	order: number;
	source: {
		// oxlint-disable-next-line typescript/no-unsafe-function-type
		metatype: Function;
		methodName: string;
	};
}

interface StoredHookEntry extends AuthHookEntry {
	seq: number;
}

function isPlainResult(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** Deep merge where `patch` wins at conflicting leaves and arrays are replaced wholesale (defu-style). */
function deepMerge(
	patch: Record<string, unknown>,
	base: Record<string, unknown>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		const existing = merged[key];
		merged[key] =
			isPlainRecord(value) && isPlainRecord(existing) ? deepMerge(value, existing) : value;
	}
	return merged;
}

function mergeHeaders(base: unknown, extra: unknown): unknown {
	if (base instanceof Headers && extra instanceof Headers) {
		const merged = new Headers(base);
		extra.forEach((value, key) => merged.set(key, value));
		return merged;
	}
	return extra ?? base;
}

/**
 * Merges hook `{ context }` patches the way better-auth chains them: a deep
 * merge (later patch wins at leaves, arrays replaced, no recursion into class
 * instances) with `headers` unioned instead of replaced.
 */
export function mergeHookContext(
	base: Record<string, unknown> | undefined,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	if (!base) return { ...patch };
	const { headers: patchHeaders, ...patchRest } = patch;
	const { headers: baseHeaders, ...baseRest } = base;
	const merged = deepMerge(patchRest, baseRest);
	const headers = mergeHeaders(baseHeaders, patchHeaders);
	if (headers !== undefined) merged.headers = headers;
	return merged;
}

/**
 * Applies a `{ context }` patch onto the live hook context so subsequent
 * hooks in the chain observe it, using the same deep-merge semantics as
 * {@link mergeHookContext}.
 */
export function applyContextPatch(ctx: unknown, patch: Record<string, unknown>): void {
	const target = ctx as Record<string, unknown>;
	for (const [key, value] of Object.entries(patch)) {
		if (key === "headers") {
			target[key] = mergeHeaders(target[key], value);
			continue;
		}
		const existing = target[key];
		target[key] =
			isPlainRecord(value) && isPlainRecord(existing) ? deepMerge(value, existing) : value;
	}
}

/**
 * Holds every discovered `@BeforeHook`/`@AfterHook` method and replays
 * better-auth's hook protocol over them at request time:
 *
 * - before: `{ context }` merges and continues, any other truthy object
 *   short-circuits the endpoint, falsy continues, `APIError` aborts;
 * - after: a defined return value replaces `ctx.context.returned`; a thrown
 *   `APIError` becomes the response and the remaining after hooks still run.
 *
 * Execution is strictly sequential (hooks may mutate `ctx`), ordered by
 * `order` then registration order.
 */
@Injectable()
export class BetterAuthHookRegistry {
	private readonly logger = new Logger("BetterAuthHooks");
	private readonly entries: Record<HookPhase, StoredHookEntry[]> = { before: [], after: [] };
	// Dedupe on class identity (not name — two distinct classes may share one).
	// oxlint-disable-next-line typescript/no-unsafe-function-type
	private readonly seen = new Map<Function, Set<string>>();
	private seq = 0;

	register(phase: HookPhase, entry: AuthHookEntry): void {
		const methods = this.seen.get(entry.source.metatype) ?? new Set<string>();
		const key = `${phase}:${entry.source.methodName}`;
		if (methods.has(key)) {
			this.logger.warn(
				`Duplicate hook registration ignored: ${entry.source.metatype.name}#${entry.source.methodName} ` +
					`is provided by more than one module; it will run once.`,
			);
			return;
		}
		methods.add(key);
		this.seen.set(entry.source.metatype, methods);
		const stored: StoredHookEntry = { ...entry, seq: this.seq++ };
		const list = this.entries[phase];
		list.push(stored);
		list.sort((a, b) => a.order - b.order || a.seq - b.seq);
	}

	list(phase: HookPhase): readonly AuthHookEntry[] {
		return this.entries[phase];
	}

	get size(): number {
		return this.entries.before.length + this.entries.after.length;
	}

	clear(): void {
		this.entries.before = [];
		this.entries.after = [];
		this.seen.clear();
		this.seq = 0;
	}

	async runBefore(
		ctx: AuthHookContext,
		initialContext?: Record<string, unknown>,
	): Promise<unknown> {
		let merged = initialContext;
		for (const entry of this.entries.before) {
			if (!entry.match(ctx)) continue;
			const result = await entry.handler(ctx);
			if (isPlainResult(result)) {
				if ("context" in result) {
					const patch = result.context as Record<string, unknown>;
					merged = mergeHookContext(merged, patch);
					// Make the change visible to subsequent hooks in this chain,
					// mirroring better-auth's inter-hook context propagation.
					applyContextPatch(ctx, patch);
					continue;
				}
				return result;
			}
		}
		return merged ? { context: merged } : undefined;
	}

	async runAfter(ctx: AuthHookContext): Promise<unknown> {
		let last: unknown;
		for (const entry of this.entries.after) {
			if (!entry.match(ctx)) continue;
			let result: unknown;
			try {
				result = await entry.handler(ctx);
			} catch (error) {
				if (error instanceof APIError) {
					// Mirror better-auth: an after-hook APIError becomes the
					// response but does not abort the remaining after hooks.
					result = error;
				} else {
					throw error;
				}
			}
			if (result !== undefined) {
				(ctx.context as { returned?: unknown }).returned = result;
				last = result;
			}
		}
		return last;
	}
}
