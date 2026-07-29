import { Controller, Get, Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import {
	createTestHttpAdapter,
	initTestApplication,
	testHttpAdapter,
} from "../shared/http-adapter.ts";

@Injectable()
class SmokeDep {
	value(): string {
		return "dep-value";
	}
}

// Deliberately no @Inject(): proves emitDecoratorMetadata works end-to-end
// through the vitest transform on this toolchain.
@Injectable()
class SmokeService {
	constructor(private readonly dep: SmokeDep) {}
	hello(): string {
		return this.dep.value();
	}
}

@Controller()
class SmokeController {
	constructor(private readonly service: SmokeService) {}

	@Get("/smoke")
	smoke(): { ok: boolean; value: string } {
		return { ok: true, value: this.service.hello() };
	}
}

@Module({
	controllers: [SmokeController],
	providers: [SmokeDep, SmokeService],
})
class SmokeModule {}

describe(`smoke (${testHttpAdapter})`, () => {
	let app: INestApplication;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [SmokeModule],
		}).compile();
		app = moduleRef.createNestApplication(createTestHttpAdapter());
		await initTestApplication(app);
	});

	afterAll(async () => {
		await app.close();
	});

	it("boots a Nest 12 app with constructor DI and serves a route", async () => {
		const res = await request(app.getHttpServer()).get("/smoke");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true, value: "dep-value" });
	});

	it("emits design:paramtypes for decorated classes", () => {
		const paramTypes = Reflect.getMetadata("design:paramtypes", SmokeService);
		expect(paramTypes).toEqual([SmokeDep]);
	});
});
