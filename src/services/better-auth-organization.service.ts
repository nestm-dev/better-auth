import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { isAPIError } from "better-auth/api";
import type { IncomingHttpHeaders } from "node:http";
import { BETTER_AUTH_MODULE_OPTIONS } from "../better-auth.tokens.ts";
import type { BetterAuthModuleOptions } from "../interfaces/better-auth-module-options.interface.ts";
import type { AnyAuth, RegisteredAuth } from "../types/auth.types.ts";
import type { BetterAuthApiHeaders } from "./better-auth-api-invocation.ts";
import { BetterAuthService } from "./better-auth.service.ts";

const ORGANIZATION_API_METHODS = [
	"getSession",
	"listMembers",
	"updateMemberRole",
	"removeMember",
	"leaveOrganization",
	"listInvitations",
	"createInvitation",
	"cancelInvitation",
	"listUserInvitations",
	"getInvitation",
	"acceptInvitation",
	"rejectInvitation",
] as const;

type OrganizationApiMethod = (typeof ORGANIZATION_API_METHODS)[number];

interface OrganizationApi {
	call(method: OrganizationApiMethod, input: unknown): Promise<unknown>;
}

interface InternalSessionAdapter {
	listSessions(userId: string): Promise<unknown>;
	updateSession(token: string, update: Record<string, unknown>): Promise<unknown>;
}

type OrganizationApiOperation = (input: unknown) => Promise<unknown>;

const MAX_MEMBER_NAME_LENGTH = 256;
const MAX_MEMBER_EMAIL_LENGTH = 320;
const MAX_MEMBER_IMAGE_LENGTH = 4_096;

export type BetterAuthOrganizationMemberUserRedactedField = "name" | "email" | "image";

/** Public, normalized organization member returned by the lifecycle facade. */
export interface BetterAuthOrganizationMember {
	readonly id: string;
	readonly userId: string;
	readonly organizationId: string;
	readonly role: string;
	readonly createdAt: Date;
	readonly user: {
		readonly id: string;
		readonly name: string | null;
		readonly email: string | null;
		readonly image: string | null;
		/** Display fields projected or omitted to keep this response bounded. */
		readonly redactedFields: readonly BetterAuthOrganizationMemberUserRedactedField[];
	};
}

/** Pagination and sorting accepted by {@link BetterAuthOrganizationService.listMembers}. */
export interface BetterAuthOrganizationMemberListOptions {
	readonly limit?: number | undefined;
	readonly offset?: number | undefined;
	readonly sortBy?: string | undefined;
	readonly sortDirection?: "asc" | "desc" | undefined;
}

export interface BetterAuthOrganizationMemberList {
	readonly members: readonly BetterAuthOrganizationMember[];
	readonly total: number;
}

/** Public, normalized Better Auth organization invitation. */
export interface BetterAuthOrganizationInvitation {
	readonly id: string;
	readonly email: string;
	readonly role: string;
	readonly organizationId: string;
	readonly inviterId: string;
	readonly status: "pending" | "accepted" | "rejected" | "canceled";
	readonly expiresAt: Date;
	readonly createdAt: Date;
}

export interface BetterAuthReceivedOrganizationInvitation extends BetterAuthOrganizationInvitation {
	readonly organizationName: string;
}

export interface BetterAuthOrganizationInvitationPreview extends BetterAuthOrganizationInvitation {
	readonly organizationName: string;
	readonly organizationSlug: string;
	readonly inviterEmail: string;
}

export interface BetterAuthOrganizationInvitationAcceptance {
	readonly invitation: BetterAuthOrganizationInvitation;
	readonly member: BetterAuthOrganizationMember;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isOrganizationApiOperation(value: unknown): value is OrganizationApiOperation {
	return typeof value === "function";
}

function isInternalSessionAdapter(value: unknown): value is InternalSessionAdapter {
	return (
		isRecord(value) &&
		typeof value.listSessions === "function" &&
		typeof value.updateSession === "function"
	);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw invalidResponse(`Better Auth returned an invalid ${label}.`);
	return value;
}

function requiredString(record: Record<string, unknown>, field: string, label: string): string {
	const value = record[field];
	if (typeof value !== "string" || value.length === 0) {
		throw invalidResponse(`Better Auth returned an invalid ${label}.${field}.`);
	}
	return value;
}

function requiredDate(record: Record<string, unknown>, field: string, label: string): Date {
	const value = record[field];
	const date =
		value instanceof Date
			? new Date(value.getTime())
			: typeof value === "string" || typeof value === "number"
				? new Date(value)
				: undefined;
	if (!date || Number.isNaN(date.getTime())) {
		throw invalidResponse(`Better Auth returned an invalid ${label}.${field}.`);
	}
	return date;
}

function requiredNonNegativeInteger(
	record: Record<string, unknown>,
	field: string,
	label: string,
): number {
	const value = record[field];
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw invalidResponse(`Better Auth returned an invalid ${label}.${field}.`);
	}
	return value;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw invalidResponse(`Better Auth returned an invalid ${label}.`);
	return value;
}

function basicMember(value: unknown): Omit<BetterAuthOrganizationMember, "user"> {
	const member = requiredRecord(value, "organization member");
	return {
		id: requiredString(member, "id", "organization member"),
		userId: requiredString(member, "userId", "organization member"),
		organizationId: requiredString(member, "organizationId", "organization member"),
		role: requiredString(member, "role", "organization member"),
		createdAt: requiredDate(member, "createdAt", "organization member"),
	};
}

function truncateDisplayString(value: string, maximumLength: number): string {
	let result = value.slice(0, maximumLength);
	const finalCodeUnit = result.charCodeAt(result.length - 1);
	const nextCodeUnit = value.charCodeAt(result.length);
	if (
		finalCodeUnit >= 0xd800 &&
		finalCodeUnit <= 0xdbff &&
		nextCodeUnit >= 0xdc00 &&
		nextCodeUnit <= 0xdfff
	) {
		result = result.slice(0, -1);
	}
	return result;
}

function isFacadeEmail(value: string): boolean {
	const separator = value.indexOf("@");
	if (separator <= 0 || separator !== value.lastIndexOf("@")) return false;

	const localPart = value.slice(0, separator);
	const domain = value.slice(separator + 1);
	if (
		localPart.length > 64 ||
		domain.length === 0 ||
		domain.length > 253 ||
		localPart.startsWith(".") ||
		localPart.endsWith(".") ||
		localPart.includes("..") ||
		!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)
	) {
		return false;
	}

	return domain
		.split(".")
		.every(
			(label) =>
				label.length > 0 &&
				label.length <= 63 &&
				/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
		);
}

function publicMember(value: unknown): BetterAuthOrganizationMember {
	const member = requiredRecord(value, "organization member");
	const normalized = basicMember(member);
	const user = requiredRecord(member.user, "organization member.user");
	const redactedFields: BetterAuthOrganizationMemberUserRedactedField[] = [];
	const sourceName = user.name;
	let name: string | null = typeof sourceName === "string" ? sourceName : null;
	if (typeof sourceName !== "string" || sourceName.length === 0) {
		redactedFields.push("name");
		name = null;
	} else if (sourceName.length > MAX_MEMBER_NAME_LENGTH) {
		redactedFields.push("name");
		name = truncateDisplayString(sourceName, MAX_MEMBER_NAME_LENGTH);
	}
	const sourceEmail = user.email;
	let email: string | null = typeof sourceEmail === "string" ? sourceEmail : null;
	if (
		typeof sourceEmail !== "string" ||
		sourceEmail.length === 0 ||
		sourceEmail.length > MAX_MEMBER_EMAIL_LENGTH ||
		!isFacadeEmail(sourceEmail)
	) {
		redactedFields.push("email");
		email = null;
	}
	const sourceImage = user.image;
	let image: string | null = typeof sourceImage === "string" ? sourceImage : null;
	if (sourceImage !== undefined && sourceImage !== null && typeof sourceImage !== "string") {
		redactedFields.push("image");
		image = null;
	} else if (typeof sourceImage === "string" && sourceImage.length > MAX_MEMBER_IMAGE_LENGTH) {
		redactedFields.push("image");
		image = null;
	}
	return {
		...normalized,
		user: {
			id: requiredString(user, "id", "organization member.user"),
			name,
			email,
			image,
			redactedFields,
		},
	};
}

function invitationStatus(value: unknown): BetterAuthOrganizationInvitation["status"] {
	switch (value) {
		case "pending":
		case "accepted":
		case "rejected":
		case "canceled":
			return value;
	}
	throw invalidResponse("Better Auth returned an invalid organization invitation.status.");
}

function publicInvitation(value: unknown): BetterAuthOrganizationInvitation {
	const invitation = requiredRecord(value, "organization invitation");
	return {
		id: requiredString(invitation, "id", "organization invitation"),
		email: requiredString(invitation, "email", "organization invitation"),
		role: requiredString(invitation, "role", "organization invitation"),
		organizationId: requiredString(invitation, "organizationId", "organization invitation"),
		inviterId: requiredString(invitation, "inviterId", "organization invitation"),
		status: invitationStatus(invitation.status),
		expiresAt: requiredDate(invitation, "expiresAt", "organization invitation"),
		createdAt: requiredDate(invitation, "createdAt", "organization invitation"),
	};
}

function receivedInvitation(value: unknown): BetterAuthReceivedOrganizationInvitation {
	const invitation = requiredRecord(value, "received organization invitation");
	return {
		...publicInvitation(invitation),
		organizationName: requiredString(
			invitation,
			"organizationName",
			"received organization invitation",
		),
	};
}

function invitationPreview(value: unknown): BetterAuthOrganizationInvitationPreview {
	const invitation = requiredRecord(value, "organization invitation preview");
	return {
		...publicInvitation(invitation),
		organizationName: requiredString(
			invitation,
			"organizationName",
			"organization invitation preview",
		),
		organizationSlug: requiredString(
			invitation,
			"organizationSlug",
			"organization invitation preview",
		),
		inviterEmail: requiredString(invitation, "inviterEmail", "organization invitation preview"),
	};
}

function organizationApi(value: unknown): OrganizationApi {
	const record = requiredRecord(value, "organization server API");
	for (const method of ORGANIZATION_API_METHODS) {
		if (typeof record[method] !== "function") {
			throw new TypeError(`The Better Auth organization API does not provide '${method}'.`);
		}
	}
	return {
		call: async (method, input) => {
			const operation = record[method];
			if (!isOrganizationApiOperation(operation)) {
				throw new TypeError(`The Better Auth organization API does not provide '${method}'.`);
			}
			return operation(input);
		},
	};
}

function invalidResponse(message: string): HttpException {
	return new HttpException(
		{ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: "INVALID_BETTER_AUTH_RESPONSE", message },
		HttpStatus.INTERNAL_SERVER_ERROR,
	);
}

function invitationNotFound(): HttpException {
	return new HttpException(
		{
			statusCode: HttpStatus.NOT_FOUND,
			code: "INVITATION_NOT_FOUND",
			message: "Invitation not found.",
		},
		HttpStatus.NOT_FOUND,
	);
}

function accountInvitationNotFound(): HttpException {
	return new HttpException(
		{
			statusCode: HttpStatus.BAD_REQUEST,
			code: "INVITATION_NOT_FOUND",
			message: "Invitation not found.",
		},
		HttpStatus.BAD_REQUEST,
	);
}

function isStockInvitationNotFound(error: unknown): boolean {
	if (!isAPIError(error) || error.statusCode !== 400) return false;
	const body: unknown = error.body;
	const code = isRecord(body) ? body.code : undefined;
	if (code === "INVITATION_NOT_FOUND") return true;
	const bodyMessage = isRecord(body) ? body.message : undefined;
	const message = typeof bodyMessage === "string" ? bodyMessage : error.message;
	return (
		message
			.trim()
			.toLowerCase()
			.replace(/[.!]+$/, "") === "invitation not found"
	);
}

function memberNotFound(): HttpException {
	return new HttpException(
		{ statusCode: HttpStatus.NOT_FOUND, code: "MEMBER_NOT_FOUND", message: "Member not found." },
		HttpStatus.NOT_FOUND,
	);
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Reusable Nest-facing organization control plane over Better Auth's stock
 * organization plugin. Every mutation is coordinated by organization, while
 * all public results are runtime-validated and normalized.
 */
@Injectable()
export class BetterAuthOrganizationService<TAuth extends AnyAuth = RegisteredAuth> {
	private readonly logger = new Logger(BetterAuthOrganizationService.name);

	constructor(
		private readonly betterAuth: BetterAuthService<TAuth>,
		@Inject(BETTER_AUTH_MODULE_OPTIONS)
		private readonly moduleOptions: BetterAuthModuleOptions,
	) {}

	async listMembers(
		headers: BetterAuthApiHeaders,
		organizationId: string,
		options: BetterAuthOrganizationMemberListOptions = {},
	): Promise<BetterAuthOrganizationMemberList> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const result = requiredRecord(
				await organizationApi(untypedApi).call("listMembers", {
					headers: normalizedHeaders,
					query: { organizationId, ...options },
				}),
				"organization member list",
			);
			return {
				members: requiredArray(result.members, "organization member list.members").map(
					publicMember,
				),
				total: requiredNonNegativeInteger(result, "total", "organization member list"),
			};
		});
	}

	async updateMemberRole(
		headers: BetterAuthApiHeaders,
		organizationId: string,
		memberId: string,
		role: string | readonly string[],
	): Promise<BetterAuthOrganizationMember> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = organizationApi(untypedApi);
			return this.runMutation(organizationId, async () => {
				await api.call("updateMemberRole", {
					headers: normalizedHeaders,
					body: { organizationId, memberId, role: Array.isArray(role) ? [...role] : role },
				});
				return this.readJoinedMember(api, normalizedHeaders, organizationId, memberId);
			});
		});
	}

	async removeMember(
		headers: BetterAuthApiHeaders,
		organizationId: string,
		memberId: string,
	): Promise<BetterAuthOrganizationMember> {
		const member = await this.betterAuth.invokeApi(
			headers,
			async (untypedApi: unknown, normalizedHeaders) => {
				const api = organizationApi(untypedApi);
				return this.runMutation(organizationId, async () => {
					const existing = await this.readJoinedMember(
						api,
						normalizedHeaders,
						organizationId,
						memberId,
					);
					await api.call("removeMember", {
						headers: normalizedHeaders,
						body: { organizationId, memberIdOrEmail: memberId },
					});
					return existing;
				});
			},
		);
		await this.clearOrganizationSelections(member.userId, organizationId);
		return member;
	}

	async leave(
		headers: BetterAuthApiHeaders,
		organizationId: string,
	): Promise<BetterAuthOrganizationMember> {
		const member = await this.betterAuth.invokeApi(
			headers,
			async (untypedApi: unknown, normalizedHeaders) => {
				const api = organizationApi(untypedApi);
				return this.runMutation(organizationId, async () => {
					const session = requiredRecord(
						await api.call("getSession", {
							headers: normalizedHeaders,
							query: { disableCookieCache: true, disableRefresh: true },
						}),
						"session",
					);
					const user = requiredRecord(session.user, "session.user");
					const userId = requiredString(user, "id", "session.user");
					const existing = await this.readJoinedMemberByUserId(
						api,
						normalizedHeaders,
						organizationId,
						userId,
					);
					await api.call("leaveOrganization", {
						headers: normalizedHeaders,
						body: { organizationId },
					});
					return existing;
				});
			},
		);
		await this.clearOrganizationSelections(member.userId, organizationId);
		return member;
	}

	async listInvitations(
		headers: BetterAuthApiHeaders,
		organizationId: string,
	): Promise<readonly BetterAuthOrganizationInvitation[]> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) =>
			this.readOrganizationInvitations(
				organizationApi(untypedApi),
				normalizedHeaders,
				organizationId,
			),
		);
	}

	async invite(
		headers: BetterAuthApiHeaders,
		organizationId: string,
		email: string,
		role: string | readonly string[],
	): Promise<BetterAuthOrganizationInvitation> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = organizationApi(untypedApi);
			return this.runMutation(organizationId, async () => {
				const normalizedEmail = normalizeEmail(email);
				const now = Date.now();
				const expiredPendingInvitations = (
					await this.readOrganizationInvitations(api, normalizedHeaders, organizationId)
				).filter(
					(candidate) =>
						candidate.status === "pending" &&
						candidate.expiresAt.getTime() <= now &&
						normalizeEmail(candidate.email) === normalizedEmail,
				);
				for (const invitation of expiredPendingInvitations) {
					await this.cancelPendingInvitation(api, normalizedHeaders, invitation);
				}
				return publicInvitation(
					await api.call("createInvitation", {
						headers: normalizedHeaders,
						body: {
							email: normalizedEmail,
							organizationId,
							role: Array.isArray(role) ? [...role] : role,
						},
					}),
				);
			});
		});
	}

	async resendInvitation(
		headers: BetterAuthApiHeaders,
		organizationId: string,
		invitationId: string,
	): Promise<BetterAuthOrganizationInvitation> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = organizationApi(untypedApi);
			return this.runMutation(organizationId, async () => {
				const invitations = await this.readOrganizationInvitations(
					api,
					normalizedHeaders,
					organizationId,
				);
				const invitation = invitations.find((candidate) => candidate.id === invitationId);
				if (!invitation || invitation.status !== "pending") throw invitationNotFound();

				const body = {
					email: invitation.email,
					organizationId,
					role: invitation.role,
				};
				const now = Date.now();
				if (invitation.expiresAt.getTime() <= now) {
					await this.cancelPendingInvitation(api, normalizedHeaders, invitation);
					return publicInvitation(
						await api.call("createInvitation", { headers: normalizedHeaders, body }),
					);
				}

				const matchingLiveInvitations = invitations.filter(
					(candidate) =>
						candidate.status === "pending" &&
						candidate.expiresAt.getTime() > now &&
						normalizeEmail(candidate.email) === normalizeEmail(invitation.email),
				);
				if (matchingLiveInvitations.length !== 1) {
					throw invalidResponse(
						"Better Auth returned ambiguous pending invitations for the requested recipient.",
					);
				}
				const resent = publicInvitation(
					await api.call("createInvitation", {
						headers: normalizedHeaders,
						body: { ...body, resend: true },
					}),
				);
				if (resent.id !== invitationId) {
					throw invalidResponse("Better Auth resent a different invitation than requested.");
				}
				return resent;
			});
		});
	}

	async cancelInvitation(
		headers: BetterAuthApiHeaders,
		organizationId: string,
		invitationId: string,
	): Promise<BetterAuthOrganizationInvitation> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = organizationApi(untypedApi);
			return this.runMutation(organizationId, async () => {
				const invitation = (
					await this.readOrganizationInvitations(api, normalizedHeaders, organizationId)
				).find((candidate) => candidate.id === invitationId);
				if (!invitation || invitation.status !== "pending") throw invitationNotFound();
				return this.cancelPendingInvitation(api, normalizedHeaders, invitation);
			});
		});
	}

	async listUserInvitations(
		headers: BetterAuthApiHeaders,
	): Promise<readonly BetterAuthReceivedOrganizationInvitation[]> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) =>
			requiredArray(
				await organizationApi(untypedApi).call("listUserInvitations", {
					headers: normalizedHeaders,
				}),
				"received organization invitation list",
			).map(receivedInvitation),
		);
	}

	async getInvitation(
		headers: BetterAuthApiHeaders,
		invitationId: string,
	): Promise<BetterAuthOrganizationInvitationPreview> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) =>
			invitationPreview(
				await organizationApi(untypedApi).call("getInvitation", {
					headers: normalizedHeaders,
					query: { id: invitationId },
				}),
			),
		);
	}

	async acceptInvitation(
		headers: BetterAuthApiHeaders,
		invitationId: string,
	): Promise<BetterAuthOrganizationInvitationAcceptance> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = organizationApi(untypedApi);
			const preview = await this.readMutationInvitationPreview(
				api,
				normalizedHeaders,
				invitationId,
			);
			return this.runMutation(preview.organizationId, async () => {
				const lockedPreview = await this.readMutationInvitationPreview(
					api,
					normalizedHeaders,
					invitationId,
				);
				if (lockedPreview.organizationId !== preview.organizationId) {
					throw accountInvitationNotFound();
				}
				const accepted = requiredRecord(
					await api.call("acceptInvitation", {
						headers: normalizedHeaders,
						body: { invitationId },
					}),
					"organization invitation acceptance",
				);
				const invitation = publicInvitation(accepted.invitation);
				const member = basicMember(accepted.member);
				return {
					invitation,
					member: await this.readJoinedMember(
						api,
						normalizedHeaders,
						invitation.organizationId,
						member.id,
					),
				};
			});
		});
	}

	async rejectInvitation(
		headers: BetterAuthApiHeaders,
		invitationId: string,
	): Promise<BetterAuthOrganizationInvitation> {
		return this.betterAuth.invokeApi(headers, async (untypedApi: unknown, normalizedHeaders) => {
			const api = organizationApi(untypedApi);
			const preview = await this.readMutationInvitationPreview(
				api,
				normalizedHeaders,
				invitationId,
			);
			return this.runMutation(preview.organizationId, async () => {
				const lockedPreview = await this.readMutationInvitationPreview(
					api,
					normalizedHeaders,
					invitationId,
				);
				if (lockedPreview.organizationId !== preview.organizationId) {
					throw accountInvitationNotFound();
				}
				const rejected = requiredRecord(
					await api.call("rejectInvitation", {
						headers: normalizedHeaders,
						body: { invitationId },
					}),
					"organization invitation rejection",
				);
				return publicInvitation(rejected.invitation);
			});
		});
	}

	private runMutation<T>(organizationId: string, operation: () => Promise<T>): Promise<T> {
		return (
			this.moduleOptions.controlPlaneLifecycle?.run("organization", organizationId, operation) ??
			this.moduleOptions.organizationLifecycle?.run(organizationId, operation) ??
			operation()
		);
	}

	private async readOrganizationInvitations(
		api: OrganizationApi,
		headers: Headers,
		organizationId: string,
	): Promise<readonly BetterAuthOrganizationInvitation[]> {
		return requiredArray(
			await api.call("listInvitations", { headers, query: { organizationId } }),
			"organization invitation list",
		).map(publicInvitation);
	}

	private async readMutationInvitationPreview(
		api: OrganizationApi,
		headers: Headers,
		invitationId: string,
	): Promise<BetterAuthOrganizationInvitationPreview> {
		try {
			return invitationPreview(
				await api.call("getInvitation", {
					headers,
					query: { id: invitationId },
				}),
			);
		} catch (error: unknown) {
			if (isStockInvitationNotFound(error)) throw accountInvitationNotFound();
			throw error;
		}
	}

	private async cancelPendingInvitation(
		api: OrganizationApi,
		headers: Headers,
		invitation: BetterAuthOrganizationInvitation,
	): Promise<BetterAuthOrganizationInvitation> {
		const canceled = publicInvitation(
			await api.call("cancelInvitation", {
				headers,
				body: { invitationId: invitation.id },
			}),
		);
		if (
			canceled.id !== invitation.id ||
			canceled.organizationId !== invitation.organizationId ||
			canceled.status !== "canceled"
		) {
			throw invalidResponse("Better Auth returned an invalid canceled invitation.");
		}
		return canceled;
	}

	private async readJoinedMember(
		api: OrganizationApi,
		headers: Headers,
		organizationId: string,
		memberId: string,
	): Promise<BetterAuthOrganizationMember> {
		return this.readSingleJoinedMember(api, headers, organizationId, "id", memberId);
	}

	private async readJoinedMemberByUserId(
		api: OrganizationApi,
		headers: Headers,
		organizationId: string,
		userId: string,
	): Promise<BetterAuthOrganizationMember> {
		return this.readSingleJoinedMember(api, headers, organizationId, "userId", userId);
	}

	private async readSingleJoinedMember(
		api: OrganizationApi,
		headers: Headers,
		organizationId: string,
		filterField: "id" | "userId",
		filterValue: string,
	): Promise<BetterAuthOrganizationMember> {
		const result = requiredRecord(
			await api.call("listMembers", {
				headers,
				query: { organizationId, limit: 1, offset: 0, filterField, filterValue },
			}),
			"organization member list",
		);
		const members = requiredArray(result.members, "organization member list.members");
		if (members.length !== 1) throw memberNotFound();
		return publicMember(members[0]);
	}

	private async clearOrganizationSelections(userId: string, organizationId: string): Promise<void> {
		try {
			const adapter = await this.internalSessionAdapter();
			const sessions = requiredArray(await adapter.listSessions(userId), "internal session list");
			const matchingTokens = sessions.flatMap((value) => {
				if (!isRecord(value) || value.activeOrganizationId !== organizationId) return [];
				const token = value.token;
				return typeof token === "string" && token.length > 0 ? [token] : [];
			});
			const settled = await Promise.allSettled(
				matchingTokens.map((token) => adapter.updateSession(token, { activeOrganizationId: null })),
			);
			const failures = settled.filter((result) => result.status === "rejected").length;
			if (failures > 0) {
				this.logger.warn(
					`Organization membership committed, but ${failures} session selection(s) could not be cleared.`,
				);
			}
		} catch (error: unknown) {
			this.logger.warn(
				`Organization membership committed, but session selections could not be reconciled: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private async internalSessionAdapter(): Promise<InternalSessionAdapter> {
		const context: unknown = await this.betterAuth.context();
		const contextRecord = requiredRecord(context, "auth context");
		const adapter: unknown = contextRecord.internalAdapter;
		if (!isInternalSessionAdapter(adapter)) {
			throw new TypeError("The Better Auth internal session adapter is unavailable.");
		}
		return adapter;
	}
}

/** Node/Nest header alias retained for discoverable controller signatures. */
export type BetterAuthOrganizationRequestHeaders = Headers | IncomingHttpHeaders;
