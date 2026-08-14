import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { isIP } from "node:net";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

/** Injection token consumed by {@link MutationOriginGuard}. */
export const MUTATION_ORIGIN_GUARD_OPTIONS = Symbol.for(
	"@nestm/better-auth:mutation-origin-guard-options",
);

export interface MutationOriginGuardOptions {
	/** Exact browser origins allowed to submit state-changing requests. */
	readonly trustedOrigins: readonly string[];
	/**
	 * Permit plain HTTP only for loopback hosts (`localhost`, `*.localhost`,
	 * `127.0.0.0/8`, and `[::1]`). Intended for explicitly configured local
	 * development origins. Defaults to `false`.
	 */
	readonly allowLoopbackHttp?: boolean;
}

export interface MutationOriginCanonicalizationOptions {
	readonly allowLoopbackHttp?: boolean;
}

interface MutationHttpRequest {
	readonly method?: string;
	readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

type HeaderValue =
	| { readonly kind: "missing" }
	| { readonly kind: "invalid" }
	| { readonly kind: "present"; readonly value: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FETCH_SITES = new Set(["cross-site", "same-origin", "same-site", "none"]);

function isLoopbackHost(hostname: string): boolean {
	const normalized =
		hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
	const lowercase = normalized.toLowerCase();
	if (lowercase === "localhost" || lowercase.endsWith(".localhost")) return true;

	const ipVersion = isIP(lowercase);
	if (ipVersion === 4) return lowercase.split(".")[0] === "127";
	return ipVersion === 6 && lowercase === "::1";
}

function parseHttpOrigin(
	origin: string,
	options: MutationOriginCanonicalizationOptions,
	requireCanonical: boolean,
): string {
	if (origin.length === 0 || origin !== origin.trim() || origin.toLowerCase() === "null") {
		throw new Error("Origin must be a non-empty HTTP(S) origin.");
	}

	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		throw new Error("Origin must be a valid absolute URL.");
	}

	if (
		(url.protocol !== "https:" && url.protocol !== "http:") ||
		url.origin === "null" ||
		url.username !== "" ||
		url.password !== "" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error(
			"Origin must be an HTTP(S) origin without credentials, path, query, or fragment.",
		);
	}

	if (
		url.protocol === "http:" &&
		(options.allowLoopbackHttp !== true || !isLoopbackHost(url.hostname))
	) {
		throw new Error(
			"Origin must use HTTPS; plain HTTP is limited to explicitly allowed loopback origins.",
		);
	}

	const canonical = url.origin;
	if (requireCanonical && canonical !== origin) {
		throw new Error("Origin header is not in canonical serialized-origin form.");
	}
	return canonical;
}

/**
 * Validates and serializes one exact trusted origin. Host case, default ports,
 * and a trailing root slash are normalized through the platform URL parser.
 */
export function canonicalizeTrustedMutationOrigin(
	origin: string,
	options: MutationOriginCanonicalizationOptions = {},
): string {
	return parseHttpOrigin(origin, options, false);
}

/** Validates, canonicalizes, and de-duplicates an exact trusted-origin list. */
export function canonicalizeTrustedMutationOrigins(
	origins: readonly string[],
	options: MutationOriginCanonicalizationOptions = {},
): readonly string[] {
	const canonical = [
		...new Set(origins.map((origin) => canonicalizeTrustedMutationOrigin(origin, options))),
	];
	if (canonical.length === 0) {
		throw new Error("MutationOriginGuard requires at least one trusted origin.");
	}
	return canonical;
}

function readHeader(request: MutationHttpRequest, name: string): HeaderValue {
	const value = request.headers?.[name];
	if (value === undefined) return { kind: "missing" };
	if (typeof value !== "string" || value.length === 0) return { kind: "invalid" };
	return { kind: "present", value };
}

/**
 * Rejects unverifiable state-changing browser requests before controller code
 * runs. Safe HTTP methods and non-HTTP Nest execution contexts are unaffected.
 */
@Injectable()
export class MutationOriginGuard implements CanActivate {
	readonly #allowLoopbackHttp: boolean;
	readonly #trustedOrigins: ReadonlySet<string>;

	constructor(
		@Inject(MUTATION_ORIGIN_GUARD_OPTIONS)
		options: MutationOriginGuardOptions,
	) {
		this.#allowLoopbackHttp = options.allowLoopbackHttp === true;
		this.#trustedOrigins = new Set(
			canonicalizeTrustedMutationOrigins(options.trustedOrigins, {
				allowLoopbackHttp: this.#allowLoopbackHttp,
			}),
		);
	}

	canActivate(context: ExecutionContext): boolean {
		if (context.getType() !== "http") return true;

		const request = context.switchToHttp().getRequest<MutationHttpRequest>();
		const method = request.method;
		if (method === undefined || method.length === 0) return this.reject();
		if (SAFE_METHODS.has(method)) return true;

		const origin = readHeader(request, "origin");
		const fetchSite = readHeader(request, "sec-fetch-site");
		if (origin.kind === "invalid" || fetchSite.kind === "invalid") return this.reject();
		if (fetchSite.kind === "present" && !FETCH_SITES.has(fetchSite.value)) {
			return this.reject();
		}

		if (origin.kind === "present") {
			let canonical: string;
			try {
				canonical = parseHttpOrigin(
					origin.value,
					{ allowLoopbackHttp: this.#allowLoopbackHttp },
					true,
				);
			} catch {
				return this.reject();
			}
			if (!this.#trustedOrigins.has(canonical)) return this.reject();
			return true;
		}

		if (fetchSite.kind === "present" && fetchSite.value === "same-origin") return true;
		return this.reject();
	}

	private reject(): never {
		throw new ForbiddenException("Mutation request origin could not be verified.");
	}
}
