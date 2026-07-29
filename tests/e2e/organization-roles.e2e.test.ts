import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Controller, Get } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { OrgRoles, RequireActiveOrg, Roles } from "../../src/index.ts";
import { createTestAuth } from "../shared/test-auth.ts";
import { createTestApp } from "../shared/test-app.ts";
import { bearer, signUpUser, type SignedUpUser } from "../shared/auth-client.ts";
import { testHttpAdapter } from "../shared/http-adapter.ts";

@Controller("org")
class OrgController {
	@Get("requires-active")
	@RequireActiveOrg()
	requiresActive(): { ok: boolean } {
		return { ok: true };
	}

	@Get("owner-only")
	@OrgRoles("owner")
	ownerOnly(): { ok: boolean } {
		return { ok: true };
	}

	@Get("member-or-owner")
	@OrgRoles(["member", "owner"])
	memberOrOwner(): { ok: boolean } {
		return { ok: true };
	}

	@Get("system-admin")
	@Roles("admin")
	systemAdmin(): { ok: boolean } {
		return { ok: true };
	}
}

async function createActiveOrganization(
	app: INestApplication,
	user: SignedUpUser,
	slugSuffix: string,
): Promise<string> {
	const created = await request(app.getHttpServer())
		.post("/api/auth/organization/create")
		.set(bearer(user.token))
		.send({ name: `Org ${slugSuffix}`, slug: `org-${slugSuffix}-${process.pid}` });
	expect(created.status).toBe(200);
	const organizationId: string = created.body.id;
	const activated = await request(app.getHttpServer())
		.post("/api/auth/organization/set-active")
		.set(bearer(user.token))
		.send({ organizationId });
	expect(activated.status).toBe(200);
	return organizationId;
}

describe(`organization roles (${testHttpAdapter})`, () => {
	let app: INestApplication;

	beforeAll(async () => {
		app = await createTestApp({
			forRoot: { auth: createTestAuth() },
			metadata: { controllers: [OrgController] },
		});
	});

	afterAll(async () => {
		await app.close();
	});

	it("@RequireActiveOrg rejects a session without an active organization", async () => {
		const user = await signUpUser(app);
		const response = await request(app.getHttpServer())
			.get("/org/requires-active")
			.set(bearer(user.token));
		expect(response.status).toBe(403);
		expect(response.body.message).toBe("Active organization is required");
	});

	it("@RequireActiveOrg allows a session with an active organization", async () => {
		const user = await signUpUser(app);
		await createActiveOrganization(app, user, "active");
		const response = await request(app.getHttpServer())
			.get("/org/requires-active")
			.set(bearer(user.token));
		expect(response.status).toBe(200);
	});

	it("@OrgRoles allows the organization owner", async () => {
		const user = await signUpUser(app);
		await createActiveOrganization(app, user, "owner");
		const response = await request(app.getHttpServer())
			.get("/org/owner-only")
			.set(bearer(user.token));
		expect(response.status).toBe(200);
	});

	it("@OrgRoles implies an active organization", async () => {
		const user = await signUpUser(app);
		const response = await request(app.getHttpServer())
			.get("/org/owner-only")
			.set(bearer(user.token));
		expect(response.status).toBe(403);
	});

	it("@OrgRoles accepts any of the listed roles", async () => {
		const user = await signUpUser(app);
		await createActiveOrganization(app, user, "list");
		const response = await request(app.getHttpServer())
			.get("/org/member-or-owner")
			.set(bearer(user.token));
		expect(response.status).toBe(200);
	});

	it("an organization owner does NOT satisfy @Roles('admin') (role-domain isolation)", async () => {
		const user = await signUpUser(app);
		await createActiveOrganization(app, user, "isolation");
		const response = await request(app.getHttpServer())
			.get("/org/system-admin")
			.set(bearer(user.token));
		expect(response.status).toBe(403);
	});
});
