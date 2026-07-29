import { Controller, Get } from "@nestjs/common";
import {
	AllowAnonymous,
	CurrentUser,
	OptionalAuth,
	Session,
	type UserSession,
} from "@concepta/nestjs-better-auth";
import type { auth } from "./auth.js";

type AppSession = UserSession<typeof auth>;

@Controller()
export class AppController {
	@Get()
	@AllowAnonymous()
	index(): { hello: string } {
		return { hello: "world" };
	}

	@Get("me")
	me(@Session() session: AppSession): AppSession["user"] {
		return session.user;
	}

	@Get("maybe-me")
	@OptionalAuth()
	maybeMe(@CurrentUser() user: AppSession["user"] | null): { email: string | null } {
		return { email: user?.email ?? null };
	}
}
