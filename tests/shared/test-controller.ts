import { Body, Controller, Get, Post } from "@nestjs/common";
import {
	AllowAnonymous,
	CurrentUser,
	OptionalAuth,
	Roles,
	Session,
	type UserSession,
} from "../../src/index.ts";

@Controller("test")
export class TestController {
	@Get("protected")
	protectedRoute(@Session() session: UserSession): { userId: string } {
		return { userId: session.user.id };
	}

	@Get("public")
	@AllowAnonymous()
	publicRoute(): { public: boolean } {
		return { public: true };
	}

	@Get("public-with-session")
	@AllowAnonymous({ resolveSession: true })
	publicWithSession(@Session() session: UserSession | null): { authenticated: boolean } {
		return { authenticated: session !== null };
	}

	@Get("optional")
	@OptionalAuth()
	optionalRoute(@Session() session: UserSession | null): { authenticated: boolean } {
		return { authenticated: session !== null };
	}

	@Get("current-user")
	currentUser(@CurrentUser() user: { email: string } | null): { email: string | null } {
		return { email: user?.email ?? null };
	}

	@Get("admin")
	@Roles("admin")
	adminRoute(): { admin: boolean } {
		return { admin: true };
	}

	@Post("echo")
	@AllowAnonymous()
	echo(@Body() body: Record<string, unknown>): Record<string, unknown> {
		return body;
	}
}
