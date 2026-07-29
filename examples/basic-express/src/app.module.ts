import { Module } from "@nestjs/common";
import { BetterAuthModule } from "@nestm/better-auth";
import { auth } from "./auth.js";
import { AppController } from "./app.controller.js";

@Module({
	imports: [BetterAuthModule.forRoot({ auth })],
	controllers: [AppController],
})
export class AppModule {}
