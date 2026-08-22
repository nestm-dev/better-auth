import { describe, expect, it } from "vitest";
import {
	canonicalizeTrustedMutationOrigin,
	canonicalizeTrustedMutationOrigins,
} from "../../src/index.ts";

describe("trusted mutation origins", () => {
	it("canonicalizes and de-duplicates exact HTTPS origins", () => {
		expect(
			canonicalizeTrustedMutationOrigins([
				"https://Studio.EXAMPLE.com:443/",
				"https://studio.example.com",
				"https://studio.example.com:8443",
			]),
		).toEqual(["https://studio.example.com", "https://studio.example.com:8443"]);
	});

	it.each([
		"null",
		"ftp://studio.example.com",
		"https://user:secret@studio.example.com",
		"https://studio.example.com/path",
		"https://studio.example.com?token=value",
		"https://studio.example.com#fragment",
		" https://studio.example.com",
	])("rejects a non-origin value: %s", (origin) => {
		expect(() => canonicalizeTrustedMutationOrigin(origin)).toThrow();
	});

	it("rejects HTTP by default and permits only explicit loopback HTTP", () => {
		expect(() => canonicalizeTrustedMutationOrigin("http://127.0.0.1:5173")).toThrow();
		expect(
			canonicalizeTrustedMutationOrigins(
				["http://localhost:5173", "http://127.27.4.9:5173", "http://[::1]:5173"],
				{ allowLoopbackHttp: true },
			),
		).toEqual(["http://localhost:5173", "http://127.27.4.9:5173", "http://[::1]:5173"]);
		expect(() =>
			canonicalizeTrustedMutationOrigin("http://studio.example.com", {
				allowLoopbackHttp: true,
			}),
		).toThrow();
	});

	it("requires a non-empty trust set", () => {
		expect(() => canonicalizeTrustedMutationOrigins([])).toThrow(
			"requires at least one trusted origin",
		);
	});
});
