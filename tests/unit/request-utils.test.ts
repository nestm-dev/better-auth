import { describe, expect, it } from "vitest";

import { canonicalizeRequestTarget, matchesBasePath } from "../../src/mount/request-utils.ts";

describe("request target canonicalization", () => {
	it.each(["%2e%2e", ".%2e", "%2e."])(
		"normalizes the encoded dot segment %s with WHATWG URL semantics",
		(segment) => {
			const target = canonicalizeRequestTarget({
				url: `/api/auth/decoy/${segment}/admin/list-users?limit=1`,
			});

			expect(target).toEqual({
				url: `/api/auth/decoy/${segment}/admin/list-users?limit=1`,
				pathname: "/api/auth/admin/list-users",
			});
			expect(matchesBasePath(target?.pathname ?? "", "/api/auth")).toBe(true);
		},
	);

	it("uses the Node request URL that the downstream bridge receives", () => {
		expect(
			canonicalizeRequestTarget({
				url: "/api/auth/sign-in/email",
				originalUrl: "/stale/original-url",
			}),
		).toMatchObject({ pathname: "/api/auth/sign-in/email" });
	});

	it.each([{}, { url: "" }, { url: 42 }])("rejects an unusable request target: %o", (request) => {
		expect(canonicalizeRequestTarget(request)).toBeUndefined();
	});

	it("keeps base-path matching segment-safe after normalization", () => {
		expect(matchesBasePath("/api/auth", "/api/auth")).toBe(true);
		expect(matchesBasePath("/api/auth/admin/list-users", "/api/auth")).toBe(true);
		expect(matchesBasePath("/api/authentication", "/api/auth")).toBe(false);
	});
});
