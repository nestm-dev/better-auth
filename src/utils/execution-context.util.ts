import type { ExecutionContext } from "@nestjs/common";

export type AuthContextKind = "http" | "graphql" | "ws" | "rpc";

/**
 * Imports an optional peer at runtime without letting the compiler resolve the
 * specifier (the peer may not be installed).
 */
export async function loadOptionalModule(name: string): Promise<Record<string, unknown>> {
	return import(/* @vite-ignore */ name) as Promise<Record<string, unknown>>;
}

interface GqlExecutionContextLike {
	create(context: ExecutionContext): { getContext(): { req?: unknown } };
}

let gqlExecutionContext: GqlExecutionContextLike | undefined;

export function resolveContextKind(context: ExecutionContext): AuthContextKind {
	return context.getType<AuthContextKind>();
}

/**
 * Returns the transport-level "request" object for the current execution
 * context: the HTTP request, the GraphQL context's `req`, or the WS client
 * (whose `handshake.headers` carry the auth headers).
 */
// oxlint-disable-next-line typescript/no-explicit-any -- adapter/transport request shapes are untyped by design
export async function getRequestFromContext(context: ExecutionContext): Promise<any> {
	const kind = resolveContextKind(context);
	if (kind === "graphql") {
		if (!gqlExecutionContext) {
			try {
				const mod = await loadOptionalModule("@nestjs/graphql");
				gqlExecutionContext = mod.GqlExecutionContext as GqlExecutionContextLike;
			} catch {
				throw new Error(
					"@nestjs/graphql is required for GraphQL execution contexts. " +
						"Install it: npm install @nestjs/graphql graphql",
				);
			}
		}
		return gqlExecutionContext.create(context).getContext().req;
	}
	if (kind === "ws") {
		return context.switchToWs().getClient();
	}
	return context.switchToHttp().getRequest();
}
