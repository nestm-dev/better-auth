import { Controller, Get, SetMetadata } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";

import { OptionalAuth, Roles } from "../../src/index.ts";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

const FOREIGN_PUBLIC = "test:foreign-public";
const SECOND_FOREIGN_PUBLIC = "test:second-foreign-public";

@Controller("interop")
@SetMetadata(FOREIGN_PUBLIC, true)
class InteropController {
	@Get("open")
	open(): { ok: true } {
		return { ok: true };
	}

	@Get("guarded")
	@Roles("admin")
	guarded(): { ok: true } {
		return { ok: true };
	}

	@Get("explicit-open")
	@Roles("admin")
	@SetMetadata(FOREIGN_PUBLIC, true)
	explicitOpen(): { ok: true } {
		return { ok: true };
	}

	@Get("explicit-open-second-key")
	@Roles("admin")
	@SetMetadata(SECOND_FOREIGN_PUBLIC, true)
	explicitOpenSecondKey(): { ok: true } {
		return { ok: true };
	}

	@Get("explicit-open-with-optional")
	@OptionalAuth()
	@SetMetadata(SECOND_FOREIGN_PUBLIC, true)
	explicitOpenWithOptional(): { ok: true } {
		return { ok: true };
	}
}

describe(`public metadata interop (${testHttpAdapter})`, () => {
	let app: INestApplication;
	let auth: ReturnType<typeof createTestAuth>;

	beforeAll(async () => {
		auth = createTestAuth();
		app = await createTestApp({
			forRoot: {
				auth,
				interop: { publicKeys: [FOREIGN_PUBLIC, SECOND_FOREIGN_PUBLIC] },
			},
			metadata: { controllers: [InteropController] },
		});
	});

	afterAll(async () => {
		await app.close();
	});

	it("serves a foreign-public route without resolving a session", async () => {
		const getSession = vi.spyOn(auth.api, "getSession");

		await request(app.getHttpServer()).get("/interop/open").expect(200, { ok: true });

		expect(getSession).not.toHaveBeenCalled();
		getSession.mockRestore();
	});

	it("lets a handler-level auth requirement override a class-level foreign marker", async () => {
		await request(app.getHttpServer()).get("/interop/guarded").expect(401);
	});

	it("lets a handler-level foreign marker explicitly override that requirement", async () => {
		await request(app.getHttpServer()).get("/interop/explicit-open").expect(200, { ok: true });
	});

	it("checks every key for a handler-level marker before inherited markers", async () => {
		await request(app.getHttpServer())
			.get("/interop/explicit-open-second-key")
			.expect(200, { ok: true });
	});

	it("keeps an explicit foreign-public handler from resolving an optional session", async () => {
		const getSession = vi.spyOn(auth.api, "getSession");

		await request(app.getHttpServer())
			.get("/interop/explicit-open-with-optional")
			.expect(200, { ok: true });

		expect(getSession).not.toHaveBeenCalled();
		getSession.mockRestore();
	});
});
