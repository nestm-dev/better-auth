import { Injectable, Scope } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper.js";
import { AuthRoutePolicy } from "../decorators/route-policy.decorator.ts";
import type { BetterAuthRoutePolicyContext, BetterAuthRoutePolicyOptions } from "./route-policy.ts";
import { compileRoutePolicyMatcher } from "./route-policy-matcher.ts";
import { BetterAuthRoutePolicyRegistry } from "./route-policy-registry.service.ts";

interface PolicyInstance {
	evaluate?: (context: BetterAuthRoutePolicyContext) => unknown;
}

function readPolicyOptions(metatype: object): BetterAuthRoutePolicyOptions | undefined {
	const metadata: unknown = Reflect.getMetadata(AuthRoutePolicy.KEY, metatype);
	if (metadata === undefined) return undefined;
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
		throw new TypeError("@AuthRoutePolicy metadata must be an options object.");
	}
	return metadata;
}

/** Discovers singleton `@AuthRoutePolicy` providers and registers them once. */
@Injectable()
export class BetterAuthRoutePolicyDiscoveryService {
	constructor(
		private readonly discovery: DiscoveryService,
		private readonly policies: BetterAuthRoutePolicyRegistry,
	) {}

	scan(): void {
		for (const wrapper of this.discovery.getProviders({ metadataKey: AuthRoutePolicy.KEY })) {
			const metatype = wrapper.metatype;
			if (!metatype) continue;
			const options = readPolicyOptions(metatype);
			if (options === undefined) continue;
			const instance = this.resolveInstance(wrapper);
			const evaluate = (instance as PolicyInstance).evaluate;
			if (typeof evaluate !== "function") {
				throw new Error(
					`@AuthRoutePolicy class '${metatype.name}' must implement evaluate(context).`,
				);
			}
			this.policies.register({
				handler: (context) => evaluate.call(instance, context),
				match: compileRoutePolicyMatcher(options),
				order: options.order ?? 0,
				source: { metatype },
			});
		}
	}

	private resolveInstance(wrapper: InstanceWrapper): object {
		const { metatype } = wrapper;
		const instance: unknown = wrapper.instance;
		const scope = wrapper.scope ?? Scope.DEFAULT;
		if (scope !== Scope.DEFAULT || !wrapper.isDependencyTreeStatic()) {
			throw new Error(
				`Route policy '${metatype?.name ?? wrapper.name}' must be singleton-scoped ` +
					"and cannot depend on request-scoped providers.",
			);
		}
		if (instance && typeof instance === "object") return instance;
		throw new Error(
			`Route policy '${metatype?.name ?? wrapper.name}' could not be instantiated statically.`,
		);
	}
}
