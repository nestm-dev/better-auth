import { Injectable, Logger } from "@nestjs/common";
import type {
	BetterAuthRoutePolicy,
	BetterAuthRoutePolicyContext,
	BetterAuthRoutePolicyDenial,
} from "./route-policy.ts";
import type { CompiledRoutePolicyMatcher } from "./route-policy-matcher.ts";

export interface RoutePolicyEntry {
	handler: (context: BetterAuthRoutePolicyContext) => unknown;
	match: CompiledRoutePolicyMatcher;
	order: number;
	source: {
		// oxlint-disable-next-line typescript/no-unsafe-function-type
		metatype: Function;
	};
}

interface StoredRoutePolicyEntry extends RoutePolicyEntry {
	seq: number;
}

function isDenial(value: unknown): value is BetterAuthRoutePolicyDenial {
	return (
		typeof value === "object" &&
		value !== null &&
		"effect" in value &&
		value.effect === "deny" &&
		"status" in value &&
		typeof value.status === "number"
	);
}

function denialResponse(denial: BetterAuthRoutePolicyDenial): Response {
	const init: ResponseInit = { status: denial.status, headers: denial.headers };
	return denial.body === undefined ? new Response(null, init) : Response.json(denial.body, init);
}

function asDenial(value: unknown): BetterAuthRoutePolicyDenial {
	if (!isDenial(value)) {
		throw new TypeError(
			"@AuthRoutePolicy.evaluate() must return void, a Web Response, or deny(status, body).",
		);
	}
	return value;
}

/** Ordered, identity-deduplicated registry of DI-backed HTTP route policies. */
@Injectable()
export class BetterAuthRoutePolicyRegistry {
	private readonly logger = new Logger("BetterAuthRoutePolicies");
	private readonly entries: StoredRoutePolicyEntry[] = [];
	// Dedupe on class identity, not class name.
	// oxlint-disable-next-line typescript/no-unsafe-function-type
	private readonly seen = new Set<Function>();
	private seq = 0;

	register(entry: RoutePolicyEntry): void {
		if (this.seen.has(entry.source.metatype)) {
			this.logger.warn(
				`Duplicate route-policy registration ignored: ${entry.source.metatype.name} is provided ` +
					"by more than one module; it will run once.",
			);
			return;
		}
		this.seen.add(entry.source.metatype);
		this.entries.push({ ...entry, seq: this.seq++ });
		this.entries.sort((a, b) => a.order - b.order || a.seq - b.seq);
	}

	get size(): number {
		return this.entries.length;
	}

	clear(): void {
		this.entries.length = 0;
		this.seen.clear();
		this.seq = 0;
	}

	/**
	 * Runs the functional callback first, then matching provider policies in order.
	 * The first denial/Response wins; abstentions continue; errors propagate.
	 */
	async run(
		context: BetterAuthRoutePolicyContext,
		functional?: BetterAuthRoutePolicy,
	): Promise<Response | undefined> {
		const entries = [...this.entries];
		const functionalResponse = await functional?.(context);
		if (functionalResponse instanceof Response) return functionalResponse;

		for (const entry of entries) {
			if (!entry.match(context)) continue;
			const result = await entry.handler(context);
			if (result === undefined) continue;
			if (result instanceof Response) return result;
			return denialResponse(asDenial(result));
		}
		return undefined;
	}
}
