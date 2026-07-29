import { Injectable, Logger } from "@nestjs/common";
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

function mergeHeaders(base: unknown, extra: unknown): unknown {
	if (base instanceof Headers && extra instanceof Headers) {
		const merged = new Headers(base);
		extra.forEach((value, key) => merged.set(key, value));
		return merged;
	}
	return extra ?? base;
}

/**
 * Shallow-merges hook `{ context }` patches the way better-auth chains them,
 * with `Headers` instances unioned instead of replaced.
 */
export function mergeHookContext(
	base: Record<string, unknown> | undefined,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	if (!base) return { ...patch };
	const merged: Record<string, unknown> = { ...base, ...patch };
	if ("headers" in base && "headers" in patch) {
		merged.headers = mergeHeaders(base.headers, patch.headers);
	}
	return merged;
}

/**
 * Holds every discovered `@BeforeHook`/`@AfterHook` method and replays
 * better-auth's hook protocol over them at request time:
 *
 * - before: `{ context }` merges and continues, any other truthy object
 *   short-circuits the endpoint, falsy continues;
 * - after: a defined return value replaces `ctx.context.returned`.
 *
 * Execution is strictly sequential (hooks may mutate `ctx` or throw
 * `APIError`), ordered by `order` then registration order.
 */
@Injectable()
export class BetterAuthHookRegistry {
	private readonly logger = new Logger("BetterAuthHooks");
	private readonly entries: Record<HookPhase, StoredHookEntry[]> = { before: [], after: [] };
	private readonly seen = new Set<string>();
	private seq = 0;

	register(phase: HookPhase, entry: AuthHookEntry): void {
		const key = `${phase}:${entry.source.metatype.name}:${entry.source.methodName}`;
		if (this.seen.has(key)) {
			this.logger.warn(
				`Duplicate hook registration ignored: ${entry.source.metatype.name}#${entry.source.methodName} ` +
					`is provided by more than one module; it will run once.`,
			);
			return;
		}
		this.seen.add(key);
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
					Object.assign(ctx as unknown as Record<string, unknown>, patch);
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
			const result = await entry.handler(ctx);
			if (result !== undefined) {
				(ctx.context as { returned?: unknown }).returned = result;
				last = result;
			}
		}
		return last;
	}
}
