// oxlint-disable typescript/no-extraneous-class -- empty classes are identity tokens here
import { describe, expect, it } from "vitest";
import { APIError } from "better-auth/api";
import { BetterAuthHookRegistry, mergeHookContext, resolveAuthBasePath } from "../../src/index.ts";
import type { AnyAuth, AuthHookContext } from "../../src/index.ts";

function ctx(path = "/x"): AuthHookContext {
	return { path, context: {} } as unknown as AuthHookContext;
}

// oxlint-disable-next-line typescript/no-unsafe-function-type
function entry(handler: (c: AuthHookContext) => unknown, metatype: Function, method = "m") {
	return {
		handler,
		match: () => true,
		order: 0,
		source: { metatype, methodName: method },
	};
}

describe("mergeHookContext", () => {
	it("deep-merges nested patches instead of wiping sibling keys", () => {
		const merged = mergeHookContext(
			{ body: { email: "a@b.c", flags: { a: true } } },
			{ body: { flags: { b: true } } },
		);
		expect(merged).toEqual({ body: { email: "a@b.c", flags: { a: true, b: true } } });
	});

	it("replaces arrays wholesale (defu semantics)", () => {
		const merged = mergeHookContext({ body: { tags: ["a", "b"] } }, { body: { tags: ["c"] } });
		expect(merged).toEqual({ body: { tags: ["c"] } });
	});

	it("unions Headers instead of replacing", () => {
		const merged = mergeHookContext(
			{ headers: new Headers({ "x-a": "1" }) },
			{ headers: new Headers({ "x-b": "2" }) },
		);
		const headers = merged.headers as Headers;
		expect(headers.get("x-a")).toBe("1");
		expect(headers.get("x-b")).toBe("2");
	});
});

describe("BetterAuthHookRegistry", () => {
	it("keeps two same-named classes distinct (identity-based dedupe)", async () => {
		const registry = new BetterAuthHookRegistry();
		const makeClass = () => {
			// Two distinct classes that share the name "Dup".
			return class Dup {};
		};
		const calls: string[] = [];
		registry.register(
			"before",
			entry(() => void calls.push("first"), makeClass()),
		);
		registry.register(
			"before",
			entry(() => void calls.push("second"), makeClass()),
		);
		await registry.runBefore(ctx());
		expect(calls).toEqual(["first", "second"]);
	});

	it("dedupes true duplicates of the same class", async () => {
		const registry = new BetterAuthHookRegistry();
		class Same {}
		const calls: string[] = [];
		registry.register(
			"before",
			entry(() => void calls.push("a"), Same),
		);
		registry.register(
			"before",
			entry(() => void calls.push("b"), Same),
		);
		await registry.runBefore(ctx());
		expect(calls).toEqual(["a"]);
	});

	it("later {context} patches deep-merge with earlier ones", async () => {
		const registry = new BetterAuthHookRegistry();
		class A {}
		class B {}
		registry.register(
			"before",
			entry(() => ({ context: { body: { a: 1 } } }), A),
		);
		registry.register(
			"before",
			entry(() => ({ context: { body: { b: 2 } } }), B),
		);
		const result = (await registry.runBefore(ctx())) as {
			context: { body: Record<string, number> };
		};
		expect(result.context.body).toEqual({ a: 1, b: 2 });
	});

	it("an after-hook APIError becomes the response without aborting later hooks", async () => {
		const registry = new BetterAuthHookRegistry();
		class Thrower {}
		class Follower {}
		const calls: string[] = [];
		registry.register(
			"after",
			entry(() => {
				calls.push("thrower");
				throw new APIError("BAD_REQUEST", { message: "nope" });
			}, Thrower),
		);
		registry.register(
			"after",
			entry(() => void calls.push("follower"), Follower),
		);
		const hookCtx = ctx();
		const last = await registry.runAfter(hookCtx);
		expect(calls).toEqual(["thrower", "follower"]);
		expect(last).toBeInstanceOf(APIError);
		expect((hookCtx.context as { returned?: unknown }).returned).toBeInstanceOf(APIError);
	});

	it("non-APIError after-hook exceptions still propagate", async () => {
		const registry = new BetterAuthHookRegistry();
		class Bad {}
		registry.register(
			"after",
			entry(() => {
				throw new TypeError("boom");
			}, Bad),
		);
		await expect(registry.runAfter(ctx())).rejects.toThrow("boom");
	});
});

describe("resolveAuthBasePath", () => {
	const authWith = (options: Record<string, unknown>): AnyAuth => ({ options }) as AnyAuth;

	it("ignores BETTER_AUTH_URL when a baseURL is configured (better-auth precedence)", () => {
		process.env.BETTER_AUTH_URL = "http://env.example.com/env-path";
		try {
			expect(resolveAuthBasePath(authWith({ baseURL: "http://app.example.com" }))).toBe(
				"/api/auth",
			);
		} finally {
			delete process.env.BETTER_AUTH_URL;
		}
	});

	it("uses BETTER_AUTH_URL's path when no baseURL is configured", () => {
		process.env.BETTER_AUTH_URL = "http://env.example.com/env-path";
		try {
			expect(resolveAuthBasePath(authWith({}))).toBe("/env-path");
		} finally {
			delete process.env.BETTER_AUTH_URL;
		}
	});

	it("prefers the path embedded in baseURL over basePath", () => {
		expect(
			resolveAuthBasePath(
				authWith({ baseURL: "http://app.example.com/custom", basePath: "/ignored" }),
			),
		).toBe("/custom");
	});
});
