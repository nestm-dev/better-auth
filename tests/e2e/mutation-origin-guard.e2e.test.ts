import { Controller, Get, Post } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { MUTATION_ORIGIN_GUARD_OPTIONS, MutationOriginGuard } from "../../src/index.ts";
import { createTestApp } from "../shared/test-app.ts";
import { createTestAuth } from "../shared/test-auth.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

const TRUSTED_ORIGIN = "https://studio.example.com";

@Controller("mutation-origin")
class MutationOriginController {
	@Get()
	read(): { readonly ok: true } {
		return { ok: true };
	}

	@Post()
	write(): { readonly ok: true } {
		return { ok: true };
	}
}

describe(`MutationOriginGuard (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		await app?.close();
	});

	async function createApp(): Promise<INestApplication> {
		return createTestApp({
			forRoot: { auth: createTestAuth(), disableGlobalGuard: true },
			metadata: {
				controllers: [MutationOriginController],
				providers: [
					{
						provide: MUTATION_ORIGIN_GUARD_OPTIONS,
						useValue: { trustedOrigins: [TRUSTED_ORIGIN] },
					},
					MutationOriginGuard,
					{ provide: APP_GUARD, useExisting: MutationOriginGuard },
				],
			},
		});
	}

	it("does not affect safe methods", async () => {
		app = await createApp();
		await request(app.getHttpServer()).get("/mutation-origin").expect(200, { ok: true });
	});

	it("accepts an exact trusted Origin", async () => {
		app = await createApp();
		await request(app.getHttpServer())
			.post("/mutation-origin")
			.set("Origin", TRUSTED_ORIGIN)
			.set("Sec-Fetch-Site", "cross-site")
			.expect(201, { ok: true });
	});

	it("accepts same-origin Fetch Metadata when Origin is absent", async () => {
		app = await createApp();
		await request(app.getHttpServer())
			.post("/mutation-origin")
			.set("Sec-Fetch-Site", "same-origin")
			.expect(201, { ok: true });
	});

	it.each([
		{ label: "both signals are absent", headers: {} },
		{ label: "Origin is null", headers: { Origin: "null" } },
		{ label: "Origin is not HTTP", headers: { Origin: "file://local" } },
		{ label: "Origin is not trusted", headers: { Origin: "https://evil.example.com" } },
		{ label: "Origin is not canonical", headers: { Origin: `${TRUSTED_ORIGIN}/` } },
		{
			label: "Fetch Metadata is cross-site without Origin",
			headers: { "Sec-Fetch-Site": "cross-site" },
		},
		{ label: "Fetch Metadata is malformed", headers: { "Sec-Fetch-Site": "unknown" } },
	])("rejects when $label", async ({ headers }) => {
		app = await createApp();
		const response = await request(app.getHttpServer())
			.post("/mutation-origin")
			.set(headers)
			.expect(403);
		expect(response.body.message).toBe("Mutation request origin could not be verified.");
	});
});
