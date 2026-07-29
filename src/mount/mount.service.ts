import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { toNodeHandler } from "better-auth/node";
import { BETTER_AUTH_BASE_PATH, BETTER_AUTH_INSTANCE, BETTER_AUTH_MODULE_OPTIONS } from "../better-auth.tokens.ts";
import type { BetterAuthModuleOptions } from "../interfaces/better-auth-module-options.interface.ts";
import type { AnyAuth } from "../types/auth.types.ts";
import { recoverBody } from "./body-recovery.ts";
import { resolveCorsHandler } from "./cors.ts";
import {
	getNodeRequest,
	getNodeResponse,
	matchesBasePath,
	type AdapterRequest,
	type AdapterResponse,
} from "./request-utils.ts";

/**
 * Mounts the better-auth Node handler as a raw, basePath-scoped adapter
 * middleware. A raw `use()` mount is invisible to Nest's router, so global
 * prefixes and versioning never affect it, and auth routes bypass the Nest
 * pipeline entirely (guards/interceptors/filters do not run for them).
 */
@Injectable()
export class BetterAuthMountService {
	private readonly logger = new Logger("BetterAuthModule");
	private mounted = false;

	constructor(
		@Optional() private readonly adapterHost: HttpAdapterHost | undefined,
		@Inject(BETTER_AUTH_INSTANCE) private readonly auth: AnyAuth,
		@Inject(BETTER_AUTH_MODULE_OPTIONS) private readonly options: BetterAuthModuleOptions,
		@Inject(BETTER_AUTH_BASE_PATH) private readonly basePath: string,
	) {}

	mount(): void {
		if (this.mounted) return;
		const httpAdapter = this.adapterHost?.httpAdapter;
		if (!httpAdapter) {
			this.logger.warn(
				"No HTTP adapter available (application context?) — the Better Auth handler was not mounted.",
			);
			return;
		}

		const handler = toNodeHandler(this.auth);
		const cors = resolveCorsHandler(this.auth, this.options, this.logger);
		const wrap = this.options.middleware;
		const basePath = this.basePath;

		httpAdapter.use(
			(req: AdapterRequest, res: AdapterResponse, next: (error?: unknown) => void) => {
				if (!matchesBasePath(req, basePath)) {
					next();
					return;
				}
				const nodeReq = getNodeRequest(req);
				const nodeRes = getNodeResponse(res);
				if (cors?.(nodeReq, nodeRes)) return;
				recoverBody(req, nodeReq);
				const run = () => handler(nodeReq, nodeRes);
				try {
					const result = wrap ? wrap(req, res, run) : run();
					void Promise.resolve(result).catch((error: unknown) => next(error));
				} catch (error) {
					next(error);
				}
			},
		);
		this.mounted = true;
		this.logger.log(`Better Auth mounted at '${basePath}'`);
	}
}
