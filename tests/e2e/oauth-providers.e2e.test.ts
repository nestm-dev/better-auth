import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { genericOAuth, microsoftEntraId } from "better-auth/plugins";
import type { INestApplication } from "@nestjs/common";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";
import type { MicrosoftEntraIDProfile } from "better-auth/social-providers";

describe(`OAuth providers (${testHttpAdapter})`, () => {
	let app: INestApplication;

	afterEach(async () => {
		vi.restoreAllMocks();
		await app?.close();
	});

	it("mounts the built-in Microsoft Entra social-provider flow", async () => {
		const tokenFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					access_token: "microsoft-access-token",
					refresh_token: "microsoft-refresh-token",
					id_token: "microsoft-id-token",
					expires_in: 3600,
					token_type: "Bearer",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth({
					socialProviders: {
						microsoft: {
							clientId: "microsoft-client-id",
							clientSecret: "microsoft-client-secret",
							tenantId: "contoso-tenant",
							prompt: "select_account",
							getUserInfo: async () => ({
								user: {
									email: "microsoft-user@example.com",
									name: "Microsoft User",
									emailVerified: true,
								},
								data: {
									oid: "microsoft-subject",
									tid: "contoso-tenant",
									iss: "https://login.microsoftonline.com/contoso-tenant/v2.0",
								} as MicrosoftEntraIDProfile,
							}),
						},
					},
				}),
			},
		});

		const agent = request.agent(app.getHttpServer());
		const response = await agent.post("/api/auth/sign-in/social").send({
			provider: "microsoft",
			callbackURL: "http://localhost:3000/dashboard",
			disableRedirect: true,
		});

		expect(response.status).toBe(200);
		expect(response.body.redirect).toBe(false);
		const authorizationURL = new URL(String(response.body.url));
		expect(authorizationURL.origin).toBe("https://login.microsoftonline.com");
		expect(authorizationURL.pathname).toBe("/contoso-tenant/oauth2/v2.0/authorize");
		expect(authorizationURL.searchParams.get("client_id")).toBe("microsoft-client-id");
		expect(authorizationURL.searchParams.get("prompt")).toBe("select_account");
		expect(authorizationURL.searchParams.get("redirect_uri")).toBe(
			"http://localhost:3000/api/auth/callback/microsoft",
		);
		expect(authorizationURL.searchParams.get("state")).toBeTruthy();

		const callback = await agent
			.get("/api/auth/callback/microsoft")
			.query({
				code: "microsoft-authorization-code",
				state: authorizationURL.searchParams.get("state"),
			})
			.redirects(0);
		expect(callback.status).toBe(302);
		expect(callback.headers.location).toBe("http://localhost:3000/dashboard");
		expect(tokenFetch).toHaveBeenCalledOnce();

		const session = await agent.get("/api/auth/get-session");
		expect(session.status).toBe(200);
		expect(session.body.user).toMatchObject({
			email: "microsoft-user@example.com",
			name: "Microsoft User",
		});

		const accounts = await agent.get("/api/auth/list-accounts");
		expect(accounts.status).toBe(200);
		expect(accounts.body).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					accountId: "microsoft-subject",
					providerId: "microsoft",
				}),
			]),
		);
	});

	it("mounts Better Auth's Microsoft Entra generic-OAuth helper", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					issuer: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
					authorization_endpoint:
						"https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/authorize",
					token_endpoint:
						"https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token",
					userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
					jwks_uri:
						"https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/discovery/v2.0/keys",
					id_token_signing_alg_values_supported: ["RS256"],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth({
					plugins: [
						genericOAuth({
							config: [
								microsoftEntraId({
									clientId: "entra-client-id",
									clientSecret: "entra-client-secret",
									tenantId: "11111111-2222-3333-4444-555555555555",
									pkce: true,
								}),
							],
						}),
					],
				}),
			},
		});

		const response = await request(app.getHttpServer()).post("/api/auth/sign-in/social").send({
			provider: "microsoft-entra-id",
			callbackURL: "http://localhost:3000/dashboard",
			disableRedirect: true,
		});

		expect(response.status).toBe(200);
		expect(response.body.redirect).toBe(false);
		const authorizationURL = new URL(String(response.body.url));
		expect(authorizationURL.origin).toBe("https://login.microsoftonline.com");
		expect(authorizationURL.pathname).toBe(
			"/11111111-2222-3333-4444-555555555555/oauth2/v2.0/authorize",
		);
		expect(authorizationURL.searchParams.get("redirect_uri")).toBe(
			"http://localhost:3000/api/auth/callback/microsoft-entra-id",
		);
		expect(authorizationURL.searchParams.get("scope")).toBe("openid profile email");
		expect(authorizationURL.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorizationURL.searchParams.get("code_challenge")).toBeTruthy();
	});

	it("completes a generic OAuth callback and persists the provider account", async () => {
		app = await createTestApp({
			forRoot: {
				auth: createTestAuth({
					plugins: [
						genericOAuth({
							config: [
								{
									providerId: "corporate-oidc",
									clientId: "corporate-client-id",
									clientSecret: "corporate-client-secret",
									authorizationUrl: "https://identity.example.test/oauth2/authorize",
									tokenUrl: "https://identity.example.test/oauth2/token",
									scopes: ["openid", "profile", "email"],
									pkce: true,
									getToken: async ({ code, codeVerifier }) => {
										expect(code).toBe("entra-authorization-code");
										expect(codeVerifier).toBeTruthy();
										return {
											accessToken: "entra-access-token",
											refreshToken: "entra-refresh-token",
										};
									},
									getUserInfo: async ({ accessToken }) => {
										expect(accessToken).toBe("entra-access-token");
										return {
											id: "entra-object-id",
											email: "entra-user@example.com",
											name: "Entra User",
											emailVerified: true,
										};
									},
								},
							],
						}),
					],
				}),
			},
		});

		const agent = request.agent(app.getHttpServer());
		const start = await agent.post("/api/auth/sign-in/social").send({
			provider: "corporate-oidc",
			callbackURL: "http://localhost:3000/dashboard",
			disableRedirect: true,
		});
		expect(start.status).toBe(200);

		const state = new URL(String(start.body.url)).searchParams.get("state");
		expect(state).toBeTruthy();
		const callback = await agent
			.get("/api/auth/callback/corporate-oidc")
			.query({ code: "entra-authorization-code", state })
			.redirects(0);
		expect(callback.status).toBe(302);
		expect(callback.headers.location).toBe("http://localhost:3000/dashboard");

		const session = await agent.get("/api/auth/get-session");
		expect(session.status).toBe(200);
		expect(session.body.user).toMatchObject({
			email: "entra-user@example.com",
			name: "Entra User",
		});

		const accounts = await agent.get("/api/auth/list-accounts");
		expect(accounts.status).toBe(200);
		expect(accounts.body).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					accountId: "entra-object-id",
					providerId: "corporate-oidc",
				}),
			]),
		);
	});
});
