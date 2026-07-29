import type { Logger } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
	BetterAuthCorsOptions,
	BetterAuthModuleOptions,
} from "../interfaces/better-auth-module-options.interface.ts";
import type { AnyAuth } from "../types/auth.types.ts";

/**
 * Returns `true` when the response was fully handled (an answered preflight);
 * `false` lets the auth handler continue.
 */
export type CorsHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

function compileOriginMatcher(patterns: readonly string[]): (origin: string) => boolean {
	const exact = new Set<string>();
	const regexes: RegExp[] = [];
	for (const pattern of patterns) {
		if (pattern.includes("*")) {
			const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
			regexes.push(new RegExp(`^${escaped}$`));
		} else {
			exact.add(pattern.replace(/\/+$/, ""));
		}
	}
	return (origin) =>
		exact.has(origin.replace(/\/+$/, "")) || regexes.some((regex) => regex.test(origin));
}

function appendVary(res: ServerResponse, value: string): void {
	const existing = res.getHeader("Vary");
	if (!existing) {
		res.setHeader("Vary", value);
		return;
	}
	const values = String(existing)
		.split(",")
		.map((entry) => entry.trim());
	if (!values.includes(value) && !values.includes("*")) {
		res.setHeader("Vary", [...values, value].join(", "));
	}
}

/**
 * Builds the basePath-scoped CORS handler shared by both adapters. Nest's
 * `enableCors()` never reaches middie-mounted raw responses on Fastify, so
 * the auth mount handles CORS itself. Returns `null` when disabled or when
 * no origins can be derived.
 */
export function resolveCorsHandler(
	auth: AnyAuth,
	moduleOptions: BetterAuthModuleOptions,
	logger: Logger,
): CorsHandler | null {
	if (moduleOptions.cors === false) return null;
	const corsOptions: BetterAuthCorsOptions = moduleOptions.cors ?? {};

	let origins = corsOptions.origin;
	if (!origins) {
		const trustedOrigins = (auth.options as { trustedOrigins?: unknown }).trustedOrigins;
		if (Array.isArray(trustedOrigins)) {
			origins = trustedOrigins as string[];
		} else if (trustedOrigins) {
			logger.warn(
				"Function-based `trustedOrigins` cannot be used to derive CORS headers for the auth " +
					"routes; configure `cors.origin` explicitly or set `cors: false` to silence this.",
			);
			return null;
		} else {
			return null;
		}
	}
	if (origins.length === 0) return null;

	const matchesOrigin = compileOriginMatcher(origins);
	const credentials = corsOptions.credentials ?? true;
	const methods = (corsOptions.methods ?? ["GET", "POST", "PUT", "DELETE"]).join(", ");
	const allowedHeaders = corsOptions.allowedHeaders?.join(", ");
	const maxAge = corsOptions.maxAge;

	return (req, res) => {
		const origin = req.headers.origin;
		appendVary(res, "Origin");
		if (!origin || !matchesOrigin(origin)) return false;

		res.setHeader("Access-Control-Allow-Origin", origin);
		if (credentials) res.setHeader("Access-Control-Allow-Credentials", "true");

		if (req.method !== "OPTIONS") return false;

		res.setHeader("Access-Control-Allow-Methods", methods);
		const requestedHeaders = req.headers["access-control-request-headers"];
		if (allowedHeaders) {
			res.setHeader("Access-Control-Allow-Headers", allowedHeaders);
		} else if (requestedHeaders) {
			res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
			appendVary(res, "Access-Control-Request-Headers");
		}
		if (maxAge !== undefined) res.setHeader("Access-Control-Max-Age", String(maxAge));
		res.statusCode = 204;
		res.setHeader("Content-Length", "0");
		res.end();
		return true;
	};
}
