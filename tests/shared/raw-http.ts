import { createConnection } from "node:net";
import type { INestApplication } from "@nestjs/common";

export interface RawHttpResponse {
	readonly body: unknown;
	readonly status: number;
	readonly text: string;
}

function listeningPort(app: INestApplication): number {
	const server: unknown = app.getHttpServer();
	if (typeof server !== "object" || server === null) {
		throw new TypeError("The Nest HTTP server is unavailable.");
	}
	const addressOperation = Reflect.get(server, "address");
	if (typeof addressOperation !== "function") {
		throw new TypeError("The Nest HTTP server does not expose address().");
	}
	const address: unknown = Reflect.apply(addressOperation, server, []);
	if (
		typeof address !== "object" ||
		address === null ||
		!("port" in address) ||
		typeof address.port !== "number"
	) {
		throw new TypeError("The Nest HTTP server is not listening on a TCP port.");
	}
	return address.port;
}

/** Sends a literal origin-form request target without client URL normalization. */
export function sendRawHttpRequest(
	app: INestApplication,
	method: string,
	target: string,
	headers: Readonly<Record<string, string>> = {},
): Promise<RawHttpResponse> {
	const port = listeningPort(app);
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const socket = createConnection({ host: "127.0.0.1", port }, () => {
			const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
			socket.write(
				[
					`${method.toUpperCase()} ${target} HTTP/1.1`,
					"Host: 127.0.0.1",
					"Connection: close",
					...headerLines,
					"",
					"",
				].join("\r\n"),
			);
		});
		socket.setTimeout(5_000, () => {
			socket.destroy(new Error("Timed out waiting for the raw HTTP response."));
		});
		socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		socket.on("error", reject);
		socket.on("end", () => {
			const response = Buffer.concat(chunks).toString("utf8");
			const boundary = response.indexOf("\r\n\r\n");
			if (boundary < 0) {
				reject(new TypeError("The raw HTTP response has no header boundary."));
				return;
			}
			const head = response.slice(0, boundary);
			const text = response.slice(boundary + 4);
			const statusText = head.split("\r\n", 1)[0]?.split(" ", 3)[1];
			const status = Number(statusText);
			if (!Number.isInteger(status)) {
				reject(new TypeError("The raw HTTP response has an invalid status line."));
				return;
			}
			let body: unknown = text;
			if (text.length > 0) {
				try {
					body = JSON.parse(text) as unknown;
				} catch {
					// Keep non-JSON responses as text.
				}
			}
			resolve({ body, status, text });
		});
	});
}
