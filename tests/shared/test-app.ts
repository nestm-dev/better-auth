import { Test } from "@nestjs/testing";
import type { INestApplication, ModuleMetadata, NestApplicationOptions } from "@nestjs/common";
import { BetterAuthModule, type BetterAuthForRootOptions } from "../../src/index.ts";
import { createTestHttpAdapter, initTestApplication } from "./http-adapter.ts";

export interface CreateTestAppOptions {
	forRoot: BetterAuthForRootOptions;
	metadata?: ModuleMetadata;
	appOptions?: NestApplicationOptions;
	globalPrefix?: string;
	initialize?: boolean;
}

export async function createTestApp(options: CreateTestAppOptions): Promise<INestApplication> {
	const moduleRef = await Test.createTestingModule({
		imports: [BetterAuthModule.forRoot(options.forRoot), ...(options.metadata?.imports ?? [])],
		controllers: options.metadata?.controllers ?? [],
		providers: options.metadata?.providers ?? [],
	}).compile();

	const app = moduleRef.createNestApplication(createTestHttpAdapter(), options.appOptions ?? {});
	app.enableShutdownHooks();
	if (options.globalPrefix) app.setGlobalPrefix(options.globalPrefix);
	if (options.initialize === false) return app;
	return initTestApplication(app);
}
