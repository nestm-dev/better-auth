import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
	// No `bodyParser: false` needed — the module recovers request bodies for
	// the auth routes automatically.
	const app = await NestFactory.create(AppModule);
	await app.listen(3000);
	console.log("Listening on http://localhost:3000 — auth at /api/auth/*");
}

void bootstrap();
