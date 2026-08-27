import { Controller, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import {
	createTestHttpAdapter,
	initTestApplication,
	testHttpAdapter,
} from "../shared/http-adapter.ts";

interface UploadedFileValue {
	originalname: string;
	size: number;
}

@Controller("dependency-upload")
class MulterOverrideController {
	@Post()
	@UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 } }))
	upload(@UploadedFile() file: UploadedFileValue): UploadedFileValue {
		return { originalname: file.originalname, size: file.size };
	}
}

describe.skipIf(testHttpAdapter !== "express")("Multer security override (express)", () => {
	let app: INestApplication;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			controllers: [MulterOverrideController],
		}).compile();
		app = moduleRef.createNestApplication(createTestHttpAdapter());
		await initTestApplication(app);
	});

	afterAll(async () => {
		await app.close();
	});

	it("accepts a normal in-memory upload through Nest's interceptor", async () => {
		const response = await request(app.getHttpServer())
			.post("/dependency-upload")
			.attach("file", Buffer.from("secure"), "sample.txt");

		expect(response.status).toBe(201);
		expect(response.body).toEqual({ originalname: "sample.txt", size: 6 });
	});

	it("preserves Nest's file-size exception mapping", async () => {
		const response = await request(app.getHttpServer())
			.post("/dependency-upload")
			.attach("file", Buffer.alloc(9), "too-large.txt");

		expect(response.status).toBe(413);
		expect(response.body).toMatchObject({ statusCode: 413 });
	});
});
