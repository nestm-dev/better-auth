import { Injectable, Scope, UseGuards } from "@nestjs/common";
import {
	MessageBody,
	ConnectedSocket,
	SubscribeMessage,
	WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { AllowAnonymous, BetterAuthGuard, OptionalAuth } from "../../src/index.ts";

interface SessionSocket extends Socket {
	session?: { user?: { id: string; email: string } } | null;
}

@WebSocketGateway()
@UseGuards(BetterAuthGuard)
export class TestGateway {
	@SubscribeMessage("whoami")
	whoami(@ConnectedSocket() client: SessionSocket): { email: string | undefined } {
		return { email: client.session?.user?.email };
	}

	@SubscribeMessage("anonymous-ping")
	@AllowAnonymous()
	anonymousPing(@MessageBody() data: unknown): { pong: unknown } {
		return { pong: data ?? null };
	}

	@SubscribeMessage("optional-ping")
	@OptionalAuth()
	optionalPing(@ConnectedSocket() client: SessionSocket): { authenticated: boolean } {
		return { authenticated: !!client.session };
	}
}

/** Request-scoped gateways are new in Nest 12 — the guard must work there too. */
@WebSocketGateway()
@Injectable({ scope: Scope.REQUEST })
@UseGuards(BetterAuthGuard)
export class RequestScopedGateway {
	@SubscribeMessage("scoped-whoami")
	scopedWhoami(@ConnectedSocket() client: SessionSocket): { email: string | undefined } {
		return { email: client.session?.user?.email };
	}
}
