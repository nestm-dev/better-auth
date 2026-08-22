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
	code?: string,
): Promise<Error> {
	const statusCode = status === "UNAUTHORIZED" ? 401 : 403;
	const structuredError = code ? { statusCode, code, message: message ?? status } : undefined;
	if (kind === "ws") {
		const WsException = await getWsException();
		return new WsException(structuredError ?? message ?? status);
	}
	if (kind === "rpc") {
		return structuredError
			? Object.assign(new Error(structuredError.message), structuredError)
			: new Error(message ?? status);
	}
	return status === "UNAUTHORIZED"
		? new UnauthorizedException(structuredError ?? message)
		: new ForbiddenException(structuredError ?? message);
}
