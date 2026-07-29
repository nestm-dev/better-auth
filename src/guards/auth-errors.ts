import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { loadOptionalModule, type AuthContextKind } from "../utils/execution-context.util.ts";

type WsExceptionCtor = new (error: string | object) => Error;

let wsExceptionCtor: WsExceptionCtor | undefined;

async function getWsException(): Promise<WsExceptionCtor> {
	if (!wsExceptionCtor) {
		try {
			const mod = await loadOptionalModule("@nestjs/websockets");
			wsExceptionCtor = mod.WsException as WsExceptionCtor;
		} catch {
			throw new Error(
				"@nestjs/websockets is required for WebSocket execution contexts. " +
					"Install it: npm install @nestjs/websockets @nestjs/platform-socket.io",
			);
		}
	}
	return wsExceptionCtor;
}

export type AuthErrorStatus = "UNAUTHORIZED" | "FORBIDDEN";

/**
 * Builds the right exception type for the execution context: HTTP/GraphQL get
 * Nest HTTP exceptions, WS gets `WsException`, RPC gets a plain error.
 */
export async function createAuthError(
	kind: AuthContextKind,
	status: AuthErrorStatus,
	message?: string,
): Promise<Error> {
	if (kind === "ws") {
		const WsException = await getWsException();
		return new WsException(message ?? status);
	}
	if (kind === "rpc") {
		return new Error(message ?? status);
	}
	return status === "UNAUTHORIZED"
		? new UnauthorizedException(message)
		: new ForbiddenException(message);
}
