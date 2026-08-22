import { Reflector } from "@nestjs/core";
import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host";
import { describe, expect, it, vi } from "vitest";

import { AllowAnonymous, BetterAuthGuard, type AnyAuth } from "../../src/index.ts";

class ProtectedController {
	read(this: void): void {}

	@AllowAnonymous({ resolveSession: true })
	publicWithSession(this: void): void {}
}

function executionContext(handler = ProtectedController.prototype.read): ExecutionContextHost {
	const context = new ExecutionContextHost(
		[{ headers: { authorization: "Bearer retained-session" } }],
		ProtectedController,
		handler,
	);
	context.setType("http");
	return context;
}

function authWithUser(user: Record<string, unknown>): AnyAuth {
	return {
		handler: async (_request: Request) => new Response(),
		api: {
			getSession: vi.fn(async (_input: unknown) => ({
				session: { id: "retained-session" },
				user: { id: "user-id", ...user },
			})),
		},
		options: {},
		$context: Promise.resolve({}),
		$Infer: { Session: {} },
		$ERROR_CODES: {},
	} satisfies AnyAuth;
}

describe("BetterAuthGuard active-ban enforcement", () => {
	it.each([
		{ label: "no expiry", banExpires: null },
		{ label: "a future expiry", banExpires: new Date(Date.now() + 60_000) },
		{ label: "an invalid expiry", banExpires: "not-a-date" },
	])("rejects a retained session for a banned user with $label", async ({ banExpires }) => {
		const auth = authWithUser({ banned: true, banExpires });
		const guard = new BetterAuthGuard(new Reflector(), auth);

		await expect(guard.canActivate(executionContext())).rejects.toMatchObject({
			status: 403,
			response: {
				statusCode: 403,
				code: "BANNED_USER",
				message: "User is banned.",
			},
		});
		expect(auth.api.getSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: { disableCookieCache: true },
		});
	});

	it("allows a retained session once its ban expiry is strictly in the past", async () => {
		const guard = new BetterAuthGuard(
			new Reflector(),
			authWithUser({ banned: true, banExpires: new Date(Date.now() - 60_000) }),
		);

		await expect(guard.canActivate(executionContext())).resolves.toBe(true);
	});

	it("allows an unbanned user even when a stale ban expiry remains", async () => {
		const guard = new BetterAuthGuard(
			new Reflector(),
			authWithUser({ banned: false, banExpires: new Date(Date.now() + 60_000) }),
		);

		await expect(guard.canActivate(executionContext())).resolves.toBe(true);
	});

	it("denies an active banned identity on @AllowAnonymous({ resolveSession: true })", async () => {
		const guard = new BetterAuthGuard(
			new Reflector(),
			authWithUser({ banned: true, banExpires: new Date(Date.now() + 60_000) }),
		);

		await expect(
			guard.canActivate(executionContext(ProtectedController.prototype.publicWithSession)),
		).rejects.toMatchObject({
			status: 403,
			response: { code: "BANNED_USER" },
		});
	});
});
