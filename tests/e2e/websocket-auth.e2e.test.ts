import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { INestApplication } from "@nestjs/common";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { signUpUser } from "../shared/auth-client.ts";
import { TestGateway } from "../shared/test-gateway.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

function connect(port: number, token?: string): Socket {
	return io(`http://127.0.0.1:${port}`, {
		transports: ["websocket"],
		forceNew: true,
		...(token ? { extraHeaders: { Authorization: `Bearer ${token}` } } : {}),
	});
}

function emitWithAck(socket: Socket, event: string, data?: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), 5000);
		socket.once("exception", (error: unknown) => {
			clearTimeout(timeout);
			reject(new Error(`ws exception: ${JSON.stringify(error)}`));
		});
		socket.emit(event, data, (response: unknown) => {
			clearTimeout(timeout);
			resolve(response);
		});
	});
}

function expectException(socket: Socket, event: string, data?: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`timeout waiting for exception on '${event}'`)),
			5000,
		);
		socket.once("exception", (error: unknown) => {
			clearTimeout(timeout);
			resolve(error);
		});
		socket.emit(event, data, () => {
			clearTimeout(timeout);
			reject(new Error(`'${event}' unexpectedly succeeded`));
		});
	});
}

describe(`websocket auth (${testHttpAdapter})`, () => {
	let app: INestApplication;
	let port: number;
	let token: string;
	let email: string;
	const sockets: Socket[] = [];

	beforeAll(async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { providers: [TestGateway] },
		});
		await app.listen(0);
		const address = app.getHttpServer().address();
		port = typeof address === "object" && address ? address.port : 0;
		const user = await signUpUser(app);
		token = user.token;
		email = user.email;
	});

	afterAll(async () => {
		for (const socket of sockets) socket.disconnect();
		await app.close();
	});

	it("allows anonymous events decorated with @AllowAnonymous", async () => {
		const socket = connect(port);
		sockets.push(socket);
		const response = await emitWithAck(socket, "anonymous-ping", { hello: "ws" });
		expect(response).toEqual({ pong: { hello: "ws" } });
	});

	it("rejects protected events without credentials", async () => {
		const socket = connect(port);
		sockets.push(socket);
		const error = await expectException(socket, "whoami");
		expect(JSON.stringify(error)).toContain("UNAUTHORIZED");
	});

	it("allows protected events with a bearer token in the handshake", async () => {
		const socket = connect(port, token);
		sockets.push(socket);
		const response = (await emitWithAck(socket, "whoami")) as { email: string };
		expect(response.email).toBe(email);
	});

	it("supports @OptionalAuth on gateway events", async () => {
		const anonymousSocket = connect(port);
		sockets.push(anonymousSocket);
		expect(await emitWithAck(anonymousSocket, "optional-ping")).toEqual({
			authenticated: false,
		});

		const authedSocket = connect(port, token);
		sockets.push(authedSocket);
		expect(await emitWithAck(authedSocket, "optional-ping")).toEqual({ authenticated: true });
	});

	it("rejects an invalid bearer token", async () => {
		const socket = connect(port, "not-a-real-token");
		sockets.push(socket);
		const error = await expectException(socket, "whoami");
		expect(JSON.stringify(error)).toContain("UNAUTHORIZED");
	});
});
