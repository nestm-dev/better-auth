// oxlint-disable typescript/no-extraneous-class -- empty classes are identity tokens here
import { describe, expect, it } from "vitest";
import {
	deny,
	type BetterAuthRoutePolicyContext,
	type BetterAuthRoutePolicyOptions,
} from "../../src/index.ts";
import { compileRoutePolicyMatcher } from "../../src/policies/route-policy-matcher.ts";
import {
	BetterAuthRoutePolicyRegistry,
	type RoutePolicyEntry,
} from "../../src/policies/route-policy-registry.service.ts";

function makeDuplicateNamedClass() {
	return class DuplicateName {};
}

function context(authPath = "/sign-up/email", method = "POST"): BetterAuthRoutePolicyContext {
	return {
		method,
		url: `/api/auth${authPath}`,
		pathname: `/api/auth${authPath}`,
		authPath,
		headers: new Headers(),
		body: undefined,
		rawBody: undefined,
	};
}

function entry(
	handler: RoutePolicyEntry["handler"],
	// oxlint-disable-next-line typescript/no-unsafe-function-type
	metatype: Function,
	order = 0,
): RoutePolicyEntry {
	return { handler, match: () => true, order, source: { metatype } };
}

describe("compileRoutePolicyMatcher", () => {
	it.each<{
		label: string;
		options: BetterAuthRoutePolicyOptions;
		authPath: string;
		method?: string;
		expected: boolean;
	}>([
		{
			label: "matches an exact path",
			options: { path: "/sign-up/email" },
			authPath: "/sign-up/email",
			expected: true,
		},
		{
			label: "does not extend an exact path",
			options: { path: "/sign-up/email" },
			authPath: "/sign-up/email/extra",
			expected: false,
		},
		{
			label: "matches a prefix root",
			options: { path: "/organization/*" },
			authPath: "/organization",
			expected: true,
		},
		{
			label: "matches a prefix descendant",
			options: { path: "/organization/*" },
			authPath: "/organization/invite-member",
			expected: true,
		},
		{
			label: "does not bleed across a prefix segment",
			options: { path: "/organization/*" },
			authPath: "/organizations",
			expected: false,
		},
		{
			label: "matches a path array",
			options: { path: ["/sign-in/email", "/sign-up/email"] },
			authPath: "/sign-up/email",
			expected: true,
		},
		{
			label: "matches a case-insensitive configured method",
			options: { methods: "post" },
			authPath: "/sign-up/email",
			method: "POST",
			expected: true,
		},
		{
			label: "rejects a different method",
			options: { methods: ["POST"] },
			authPath: "/sign-up/email",
			method: "GET",
			expected: false,
		},
	])("$label", ({ options, authPath, method, expected }) => {
		expect(compileRoutePolicyMatcher(options)(context(authPath, method))).toBe(expected);
	});

	it("resets stateful regular expressions between requests", () => {
		const path = /^\/sign-up\//g;
		const match = compileRoutePolicyMatcher({ path });
		expect(match(context())).toBe(true);
		expect(path.lastIndex).toBe(0);
		expect(match(context())).toBe(true);
		expect(path.lastIndex).toBe(0);
	});

	it("passes the normalized context to predicate matchers", () => {
		const match = compileRoutePolicyMatcher({
			path: (current) => current.headers.get("x-policy") === "yes",
		});
		const current = context();
		current.headers.set("x-policy", "yes");
		expect(match(current)).toBe(true);
	});

	it.each([
		{ options: { path: "sign-up/*" }, message: /paths must start/ },
		{ options: { path: [] }, message: /paths cannot be empty/ },
		{ options: { methods: [] }, message: /methods cannot be empty/ },
		{ options: { methods: "  " }, message: /methods cannot be empty/ },
		{ options: { order: Number.POSITIVE_INFINITY }, message: /order must be a finite number/ },
	] satisfies Array<{ options: BetterAuthRoutePolicyOptions; message: RegExp }>)(
		"rejects invalid matcher metadata: $options",
		({ options, message }) => {
			expect(() => compileRoutePolicyMatcher(options)).toThrow(message);
		},
	);
});

describe("BetterAuthRoutePolicyRegistry", () => {
	it("runs the functional callback first, then providers by order, and stops at denial", async () => {
		const registry = new BetterAuthRoutePolicyRegistry();
		class Late {}
		class First {}
		class Denier {}
		const events: string[] = [];
		registry.register(entry(() => void events.push("late"), Late, 20));
		registry.register(entry(() => void events.push("first"), First, -10));
		registry.register(
			entry(() => {
				events.push("deny");
				return deny(403, { code: "DENIED" }, { "x-policy": "registry" });
			}, Denier),
		);

		const response = await registry.run(context(), () => {
			events.push("functional");
		});

		expect(events).toEqual(["functional", "first", "deny"]);
		expect(response?.status).toBe(403);
		expect(response?.headers.get("x-policy")).toBe("registry");
		expect(await response?.json()).toEqual({ code: "DENIED" });
	});

	it("keeps equal-order registration stable and supports Web Response results", async () => {
		const registry = new BetterAuthRoutePolicyRegistry();
		class A {}
		class B {}
		const events: string[] = [];
		registry.register(entry(() => void events.push("a"), A));
		registry.register(
			entry(() => {
				events.push("b");
				return new Response(null, { status: 409 });
			}, B),
		);
		expect((await registry.run(context()))?.status).toBe(409);
		expect(events).toEqual(["a", "b"]);
	});

	it("deduplicates the same class identity but keeps same-named classes distinct", async () => {
		const registry = new BetterAuthRoutePolicyRegistry();
		class Same {}
		const events: string[] = [];
		registry.register(entry(() => void events.push("same:first"), Same));
		registry.register(entry(() => void events.push("same:duplicate"), Same));
		registry.register(entry(() => void events.push("name:first"), makeDuplicateNamedClass()));
		registry.register(entry(() => void events.push("name:second"), makeDuplicateNamedClass()));
		await registry.run(context());
		expect(events).toEqual(["same:first", "name:first", "name:second"]);
	});

	it("propagates errors and does not run later providers", async () => {
		const registry = new BetterAuthRoutePolicyRegistry();
		class Bad {}
		class Later {}
		let laterCalls = 0;
		registry.register(
			entry(() => {
				throw new Error("policy failed");
			}, Bad),
		);
		registry.register(entry(() => void (laterCalls += 1), Later));
		await expect(registry.run(context())).rejects.toThrow("policy failed");
		expect(laterCalls).toBe(0);
	});

	it("fails closed on unsupported provider return values", async () => {
		const registry = new BetterAuthRoutePolicyRegistry();
		class Invalid {}
		registry.register(entry(() => false, Invalid));
		await expect(registry.run(context())).rejects.toThrow(/must return void/);
	});

	it("clear resets registrations and deduplication state", async () => {
		const registry = new BetterAuthRoutePolicyRegistry();
		class Policy {}
		let calls = 0;
		const policy = entry(() => void (calls += 1), Policy);
		registry.register(policy);
		registry.clear();
		registry.register(policy);
		await registry.run(context());
		expect(registry.size).toBe(1);
		expect(calls).toBe(1);
	});

	it("does not truncate the active policy snapshot when the registry is cleared", async () => {
		const registry = new BetterAuthRoutePolicyRegistry();
		class ClearingPolicy {}
		class LaterPolicy {}
		const events: string[] = [];
		registry.register(
			entry(() => {
				events.push("clear");
				registry.clear();
			}, ClearingPolicy),
		);
		registry.register(entry(() => void events.push("later"), LaterPolicy));
		await registry.run(context());
		expect(events).toEqual(["clear", "later"]);
		expect(registry.size).toBe(0);
	});
});
