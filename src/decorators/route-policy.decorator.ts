import { DiscoveryService } from "@nestjs/core";
import type { BetterAuthRoutePolicyOptions } from "../policies/route-policy.ts";

/**
 * Marks a singleton Nest provider as an HTTP-only better-auth route policy.
 * The provider must implement `BetterAuthRoutePolicyHandler`.
 */
export const AuthRoutePolicy = DiscoveryService.createDecorator<
	BetterAuthRoutePolicyOptions | undefined
>();
