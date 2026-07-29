import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { uniqueUser } from "./test-auth.ts";

export interface SignedUpUser {
	email: string;
	password: string;
	name: string;
	token: string;
	userId: string;
}

/** Signs a user up through the mounted handler and returns a bearer token. */
export async function signUpUser(
	app: INestApplication,
	basePath = "/api/auth",
): Promise<SignedUpUser> {
	const user = uniqueUser();
	const response = await request(app.getHttpServer())
		.post(`${basePath}/sign-up/email`)
		.send({ email: user.email, password: user.password, name: user.name });
	if (response.status !== 200) {
		throw new Error(
			`sign-up/email failed: ${response.status} ${JSON.stringify(response.body)}`,
		);
	}
	const token: string | undefined = response.body?.token;
	if (!token) throw new Error("sign-up/email returned no session token");
	return { ...user, token, userId: response.body.user?.id };
}

export function bearer(token: string): { Authorization: string } {
	return { Authorization: `Bearer ${token}` };
}
