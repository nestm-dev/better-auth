import { Inject } from "@nestjs/common";
import { BETTER_AUTH_INSTANCE } from "../better-auth.tokens.ts";

/**
 * Injects the better-auth instance. Equivalent to
 * `@Inject(BETTER_AUTH_INSTANCE)`; type the parameter with `RegisteredAuth`
 * or `typeof auth`.
 */
export function InjectBetterAuth(): ParameterDecorator & PropertyDecorator {
	return Inject(BETTER_AUTH_INSTANCE);
}
