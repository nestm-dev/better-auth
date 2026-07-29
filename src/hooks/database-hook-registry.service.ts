import { Injectable, Logger } from "@nestjs/common";
import type {
	DatabaseHookModel,
	DatabaseHookOperation,
	DatabaseHookPhase,
} from "../better-auth.constants.ts";

/**
 * Signature of a database-hook method / user-declared better-auth
 * `databaseHooks` function. `before` may return `false` (abort), `{ data }`
 * (merge into the record) or nothing; `after` return values are ignored.
 */
export type DatabaseHookFn = (data: unknown, ctx: unknown) => unknown;

export interface DatabaseHookEntry {
	handler: DatabaseHookFn;
	order: number;
	source: {
		// oxlint-disable-next-line typescript/no-unsafe-function-type
		metatype: Function;
		methodName: string;
	};
}

interface StoredDatabaseHookEntry extends DatabaseHookEntry {
	seq: number;
}

function nodeKey(
	model: DatabaseHookModel,
	operation: DatabaseHookOperation,
	phase: DatabaseHookPhase,
): string {
	return `${model}:${operation}:${phase}`;
}

/**
 * Holds every discovered `@BeforeCreate`/`@AfterUpdate`/... method and
 * replays better-auth's database-hook folding semantics: `before` hooks run
 * sequentially, `false` aborts the operation, `{ data }` returns accumulate
 * into the record; `after` hooks run sequentially for side effects.
 */
@Injectable()
export class BetterAuthDatabaseHookRegistry {
	private readonly logger = new Logger("BetterAuthDatabaseHooks");
	private readonly nodes = new Map<string, StoredDatabaseHookEntry[]>();
	private readonly seen = new Set<string>();
	private seq = 0;

	register(
		model: DatabaseHookModel,
		operation: DatabaseHookOperation,
		phase: DatabaseHookPhase,
		entry: DatabaseHookEntry,
	): void {
		const dedupeKey = `${nodeKey(model, operation, phase)}:${entry.source.metatype.name}:${entry.source.methodName}`;
		if (this.seen.has(dedupeKey)) {
			this.logger.warn(
				`Duplicate database-hook registration ignored: ${entry.source.metatype.name}#${entry.source.methodName} ` +
					`is provided by more than one module; it will run once.`,
			);
			return;
		}
		this.seen.add(dedupeKey);
		const key = nodeKey(model, operation, phase);
		const list = this.nodes.get(key) ?? [];
		list.push({ ...entry, seq: this.seq++ });
		list.sort((a, b) => a.order - b.order || a.seq - b.seq);
		this.nodes.set(key, list);
	}

	get size(): number {
		let total = 0;
		for (const list of this.nodes.values()) total += list.length;
		return total;
	}

	clear(): void {
		this.nodes.clear();
		this.seen.clear();
		this.seq = 0;
	}

	private list(
		model: DatabaseHookModel,
		operation: DatabaseHookOperation,
		phase: DatabaseHookPhase,
	): readonly StoredDatabaseHookEntry[] {
		return this.nodes.get(nodeKey(model, operation, phase)) ?? [];
	}

	/**
	 * Runs the user's original `before` hook (when present) followed by the
	 * registered decorator hooks, folding `{ data }` returns. Returns `false`
	 * to abort, `{ data }` when the record was modified, else `undefined`.
	 */
	async runBefore(
		model: DatabaseHookModel,
		operation: DatabaseHookOperation,
		data: unknown,
		ctx: unknown,
		original: DatabaseHookFn | undefined,
	): Promise<unknown> {
		let record = data;
		let modified = false;

		const fold = async (fn: DatabaseHookFn): Promise<boolean> => {
			const result = await fn(record, ctx);
			if (result === false) return false;
			if (
				typeof result === "object" &&
				result !== null &&
				"data" in (result as Record<string, unknown>)
			) {
				record = {
					...(record as Record<string, unknown>),
					...(result as { data: Record<string, unknown> }).data,
				};
				modified = true;
			}
			return true;
		};

		if (original && !(await fold(original))) return false;
		for (const entry of this.list(model, operation, "before")) {
			if (!(await fold(entry.handler))) return false;
		}
		return modified ? { data: record } : undefined;
	}

	/** Runs the user's original `after` hook (when present) then the registered hooks. */
	async runAfter(
		model: DatabaseHookModel,
		operation: DatabaseHookOperation,
		record: unknown,
		ctx: unknown,
		original: DatabaseHookFn | undefined,
	): Promise<void> {
		if (original) await original(record, ctx);
		for (const entry of this.list(model, operation, "after")) {
			await entry.handler(record, ctx);
		}
	}
}
