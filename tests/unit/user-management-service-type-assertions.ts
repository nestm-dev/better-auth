/** Compile-time coverage for the normalized platform user-management facade. */
import {
	BetterAuthUserManagementService,
	type BetterAuthManagedUser,
	type BetterAuthManagedUserPage,
	type BetterAuthManagedUserSession,
	type BetterAuthManagedUserSessionBulkRevocationResult,
	type BetterAuthManagedUserSessionRevocationResult,
} from "../../src/index.ts";
import type { IncomingHttpHeaders } from "node:http";

declare const service: BetterAuthUserManagementService;
declare const headers: IncomingHttpHeaders;

const listed: Promise<BetterAuthManagedUserPage> = service.list(headers, {
	limit: 20,
	offset: 40,
	search: "user@example.com",
	searchField: "email",
	searchOperator: "contains",
	filter: { field: "role", value: "platform_admin" },
	sortBy: "createdAt",
	sortDirection: "desc",
});
const read: Promise<BetterAuthManagedUser> = service.get(headers, "user-id");
const updated: Promise<BetterAuthManagedUser> = service.updateProfile(headers, "user-id", {
	name: "Updated User",
	email: "updated@example.com",
});
const roleUpdated: Promise<BetterAuthManagedUser> = service.setRoles(headers, "user-id", [
	"platform_admin",
]);
const banned: Promise<BetterAuthManagedUser> = service.ban(headers, "user-id", {
	reason: "Policy violation",
	expiresInSeconds: 3_600,
});
const unbanned: Promise<BetterAuthManagedUser> = service.unban(headers, "user-id");
const sessions: Promise<readonly BetterAuthManagedUserSession[]> = service.listSessions(
	headers,
	"user-id",
);
const revoked: Promise<BetterAuthManagedUserSessionRevocationResult> = service.revokeSessionById(
	headers,
	"user-id",
	"session-id",
);
const revokedAll: Promise<BetterAuthManagedUserSessionBulkRevocationResult> =
	service.revokeAllSessions(headers, "user-id");

async function assertSafeUserManagementSurface(): Promise<void> {
	const user = await read;
	const roles: readonly string[] = user.roles;
	const name: string | null = user.name;
	const email: string | null = user.email;
	const redactedFields: readonly ("name" | "email" | "image" | "banReason")[] = user.redactedFields;
	// @ts-expect-error The safe profile mutation does not expose verification state.
	await service.updateProfile(headers, user.id, { emailVerified: true });

	const [session] = await sessions;
	if (session) {
		const sessionId: string = session.id;
		const sessionRedactedFields: readonly ("ipAddress" | "userAgent")[] = session.redactedFields;
		// @ts-expect-error Managed session tokens stay private to the facade.
		const token = session.token;
		void sessionId;
		void sessionRedactedFields;
		void token;
	}
	void roles;
	void name;
	void email;
	void redactedFields;
}

export {
	assertSafeUserManagementSurface,
	banned,
	listed,
	read,
	revoked,
	revokedAll,
	roleUpdated,
	unbanned,
	updated,
};
