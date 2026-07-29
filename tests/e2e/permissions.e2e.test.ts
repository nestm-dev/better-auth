import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Controller, Get } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { MemberHasPermission, UserHasPermission } from "../../src/index.ts";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { bearer, signUpUser } from "../shared/auth-client.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

@Controller("perm")
class PermissionController {
	// Admin-plugin default access control: the admin role can list users.
	@Get("list-users")
	@UserHasPermission({ permissions: { user: ["list"] } })
	listUsers(): { ok: boolean } {
		return { ok: true };
	}

	// Organization-plugin default access control: only owner/admin can update
	// the organization.
	@Get("update-org")
	@MemberHasPermission({ permissions: { organization: ["update"] } })
	updateOrg(): { ok: boolean } {
		return { ok: true };
	}
}

describe(`permissions (${testHttpAdapter})`, () => {
	let app: INestApplication;
	let auth: ReturnType<typeof createTestAuth>;

	beforeAll(async () => {
		auth = createTestAuth();
		app = await createTestApp({
			forRoot: { auth },
			metadata: { controllers: [PermissionController] },
		});
	});

	afterAll(async () => {
		await app.close();
	});

	it("@UserHasPermission denies a regular user", async () => {
		const user = await signUpUser(app);
		const response = await request(app.getHttpServer())
			.get("/perm/list-users")
			.set(bearer(user.token));
		expect(response.status).toBe(403);
		expect(response.body.message).toBe("Insufficient permissions");
	});

	it("@UserHasPermission allows an admin user", async () => {
		const user = await signUpUser(app);
		const ctx = await auth.$context;
		await ctx.internalAdapter.updateUser(user.userId, { role: "admin" });
		const response = await request(app.getHttpServer())
			.get("/perm/list-users")
			.set(bearer(user.token));
		expect(response.status).toBe(200);
	});

	it("@MemberHasPermission allows the organization owner", async () => {
		const user = await signUpUser(app);
		const created = await request(app.getHttpServer())
			.post("/api/auth/organization/create")
			.set(bearer(user.token))
			.send({ name: "Perm Org", slug: `perm-org-${process.pid}` });
		expect(created.status).toBe(200);
		await request(app.getHttpServer())
			.post("/api/auth/organization/set-active")
			.set(bearer(user.token))
			.send({ organizationId: created.body.id });
		const response = await request(app.getHttpServer())
			.get("/perm/update-org")
			.set(bearer(user.token));
		expect(response.status).toBe(200);
	});

	it("@MemberHasPermission denies without an active organization", async () => {
		const user = await signUpUser(app);
		const response = await request(app.getHttpServer())
			.get("/perm/update-org")
			.set(bearer(user.token));
		expect(response.status).toBe(403);
	});

	it("permission checks reject unauthenticated requests with 401", async () => {
		const response = await request(app.getHttpServer()).get("/perm/list-users");
		expect(response.status).toBe(401);
	});
});
