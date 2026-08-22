import {
	BetterAuthGuard,
	BetterAuthModule,
	BetterAuthOrganizationControlPlaneRoutePolicy,
	BetterAuthOrganizationService,
	BetterAuthService,
	BetterAuthSessionManagementRoutePolicy,
	BetterAuthSessionService,
	BetterAuthUserManagementRoutePolicy,
	BetterAuthUserManagementService,
	AuthRoutePolicy,
	deny,
	type AnyAuth,
	type BetterAuthInteropOptions,
	type BetterAuthManagedUser,
	type BetterAuthManagedUserRedactedField,
	type BetterAuthManagedUserPage,
	type BetterAuthManagedUserSession,
	type BetterAuthManagedUserSessionRedactedField,
	type BetterAuthManagedUserSessionBulkRevocationResult,
	type BetterAuthManagedUserSessionRevocationResult,
	type BetterAuthOrganizationInvitation,
	type BetterAuthOrganizationInvitationAcceptance,
	type BetterAuthOrganizationInvitationPreview,
	type BetterAuthOrganizationMember,
	type BetterAuthOrganizationMemberList,
	type BetterAuthOrganizationMemberUserRedactedField,
	type BetterAuthReceivedOrganizationInvitation,
	type BetterAuthRoutePolicy,
	type BetterAuthRoutePolicyContext,
	type BetterAuthRoutePolicyHandler,
	type BetterAuthSessionBulkRevocationResult,
	type BetterAuthSessionRevocationResult,
	type BetterAuthSessionRedactedField,
	type BetterAuthSessionSummary,
} from "@nestm/better-auth";
import {
	createTypeormBetterAuthControlPlaneLifecycleCoordinator,
	createTypeormBetterAuthOrganizationLifecycleCoordinator,
	typeormAdapter,
	type TypeormAdapterConfig,
	type TypeormBetterAuthControlPlaneLifecycleCoordinator,
	type TypeormBetterAuthOrganizationLifecycleCoordinator,
} from "@nestm/better-auth/typeorm";
import type { Reflector } from "@nestjs/core";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import type { IncomingHttpHeaders } from "node:http";
import type { DataSource, EntityManager } from "typeorm";

declare const reflector: Reflector;
declare const auth: AnyAuth;
declare const dataSource: DataSource;
declare const scopedManager: EntityManager | undefined;
declare const requestHeaders: IncomingHttpHeaders;

const pluginAuth = betterAuth({ plugins: [organization()] });
declare const pluginService: BetterAuthService<typeof pluginAuth>;
declare const sessionService: BetterAuthSessionService<typeof pluginAuth>;
declare const organizationService: BetterAuthOrganizationService<typeof pluginAuth>;
declare const userManagementService: BetterAuthUserManagementService<typeof pluginAuth>;
const invitationCall = pluginService.invokeApi(requestHeaders, (api, headers) =>
	api.createInvitation({
		body: {
			email: "packed@example.com",
			role: "member",
			organizationId: "packed-organization",
		},
		headers,
	}),
);
const sessionList: Promise<readonly BetterAuthSessionSummary[]> =
	sessionService.list(requestHeaders);
const sessionRevocation: Promise<BetterAuthSessionRevocationResult> = sessionService.revokeById(
	requestHeaders,
	"session-id",
);
const otherSessionRevocation: Promise<BetterAuthSessionBulkRevocationResult> =
	sessionService.revokeOthers(requestHeaders);
const allSessionRevocation: Promise<BetterAuthSessionBulkRevocationResult> =
	sessionService.revokeAll(requestHeaders);
const organizationMembers: Promise<BetterAuthOrganizationMemberList> =
	organizationService.listMembers(requestHeaders, "packed-organization");
const updatedOrganizationMember: Promise<BetterAuthOrganizationMember> =
	organizationService.updateMemberRole(requestHeaders, "packed-organization", "packed-member", [
		"admin",
	]);
declare const organizationMember: BetterAuthOrganizationMember;
const organizationMemberName: string | null = organizationMember.user.name;
const organizationMemberEmail: string | null = organizationMember.user.email;
const organizationMemberRedactions: readonly BetterAuthOrganizationMemberUserRedactedField[] =
	organizationMember.user.redactedFields;
const sentOrganizationInvitation: Promise<BetterAuthOrganizationInvitation> =
	organizationService.invite(requestHeaders, "packed-organization", "packed@example.com", "member");
const receivedOrganizationInvitations: Promise<
	readonly BetterAuthReceivedOrganizationInvitation[]
> = organizationService.listUserInvitations(requestHeaders);
const organizationInvitationPreview: Promise<BetterAuthOrganizationInvitationPreview> =
	organizationService.getInvitation(requestHeaders, "packed-invitation");
const organizationInvitationAcceptance: Promise<BetterAuthOrganizationInvitationAcceptance> =
	organizationService.acceptInvitation(requestHeaders, "packed-invitation");
const managedUsers: Promise<BetterAuthManagedUserPage> = userManagementService.list(
	requestHeaders,
	{
		limit: 25,
		filter: { field: "role", value: "platform_admin" },
	},
);
const managedUser: Promise<BetterAuthManagedUser> = userManagementService.get(
	requestHeaders,
	"packed-user",
);
const managedSessions: Promise<readonly BetterAuthManagedUserSession[]> =
	userManagementService.listSessions(requestHeaders, "packed-user");
const managedSessionRevocation: Promise<BetterAuthManagedUserSessionRevocationResult> =
	userManagementService.revokeSessionById(requestHeaders, "packed-user", "packed-session");
const managedSessionBulkRevocation: Promise<BetterAuthManagedUserSessionBulkRevocationResult> =
	userManagementService.revokeAllSessions(requestHeaders, "packed-user");
declare const managedUserProjection: BetterAuthManagedUser;
const managedName: string | null = managedUserProjection.name;
const managedEmail: string | null = managedUserProjection.email;
const managedRedactions: readonly BetterAuthManagedUserRedactedField[] =
	managedUserProjection.redactedFields;
declare const managedSessionProjection: BetterAuthManagedUserSession;
const managedSessionRedactions: readonly BetterAuthManagedUserSessionRedactedField[] =
	managedSessionProjection.redactedFields;
declare const selfSessionProjection: BetterAuthSessionSummary;
const selfSessionRedactions: readonly BetterAuthSessionRedactedField[] =
	selfSessionProjection.redactedFields;

const functionalRoutePolicy = (({ authPath }) =>
	authPath === "/functional-policy-test"
		? Response.json({ code: "FUNCTIONAL_POLICY" }, { status: 403 })
		: undefined) satisfies BetterAuthRoutePolicy;

// Patch releases must preserve the guard's original two-argument constructor.
const manuallyConstructedGuard = new BetterAuthGuard(reflector, auth);
const interop: BetterAuthInteropOptions = { publicKeys: ["legacy:public", Symbol()] };

const synchronousModule = BetterAuthModule.forRoot({
	options: {
		emailAndPassword: { enabled: true },
	},
	routePolicy: functionalRoutePolicy,
	routePolicyBodyLimit: 1024,
	disableGlobalGuard: true,
});

const asynchronousModule = BetterAuthModule.forRootAsync({
	isGlobal: false,
	inject: ["AUTH_BASE_URL"],
	useFactory: (baseURL: string) => ({
		options: { baseURL },
	}),
});

class PackedRoutePolicy implements BetterAuthRoutePolicyHandler {
	evaluate(context: BetterAuthRoutePolicyContext) {
		return context.method === "POST"
			? deny(403, { code: "PACKED_POLICY" }, { "x-policy": "packed" })
			: undefined;
	}
}
AuthRoutePolicy({ path: "/sign-up/*", methods: ["POST"], order: -10 })(PackedRoutePolicy);
const policyFeature = BetterAuthModule.forFeature({ routePolicies: [PackedRoutePolicy] });
const sessionPolicyFeature = BetterAuthModule.forFeature({
	routePolicies: [BetterAuthSessionManagementRoutePolicy],
});
const organizationPolicyFeature = BetterAuthModule.forFeature({
	routePolicies: [BetterAuthOrganizationControlPlaneRoutePolicy],
});
const userManagementPolicyFeature = BetterAuthModule.forFeature({
	routePolicies: [BetterAuthUserManagementRoutePolicy],
});

// The `./typeorm` subpath ships its own entry, so it needs its own coverage here: without a
// consumer import it would be published untested against its rolled-up declarations.
const typeormConfig: TypeormAdapterConfig = {
	entities: { rateLimit: "RateLimit" },
	getManager: () => scopedManager,
	transaction: true,
};
const databaseAdapter = typeormAdapter(dataSource, typeormConfig);
const defaultedAdapter = typeormAdapter(dataSource);
const organizationLifecycle = createTypeormBetterAuthOrganizationLifecycleCoordinator(dataSource);
const typedOrganizationLifecycle: TypeormBetterAuthOrganizationLifecycleCoordinator =
	organizationLifecycle;
const coordinatedDatabaseAdapter = typeormAdapter(dataSource, {
	getManager: organizationLifecycle.getManager,
	transaction: true,
});
const coordinatedInvitationCall = organizationLifecycle.run(
	"packed-organization",
	() => invitationCall,
);
const controlPlaneLifecycle = createTypeormBetterAuthControlPlaneLifecycleCoordinator(dataSource);
const typedControlPlaneLifecycle: TypeormBetterAuthControlPlaneLifecycleCoordinator =
	controlPlaneLifecycle;
const coordinatedManagedUser = controlPlaneLifecycle.run("user", "packed-user", () => managedUser);

const moduleWithTypeormDatabase = BetterAuthModule.forRoot({
	options: {
		database: typeormAdapter(dataSource, {
			getManager: controlPlaneLifecycle.getManager,
			transaction: true,
		}),
	},
	controlPlaneLifecycle,
});

export {
	asynchronousModule,
	databaseAdapter,
	coordinatedDatabaseAdapter,
	coordinatedInvitationCall,
	coordinatedManagedUser,
	controlPlaneLifecycle,
	defaultedAdapter,
	interop,
	invitationCall,
	managedSessionBulkRevocation,
	managedSessionRedactions,
	managedSessionRevocation,
	managedSessions,
	managedEmail,
	managedName,
	managedRedactions,
	managedUser,
	managedUsers,
	organizationInvitationAcceptance,
	organizationInvitationPreview,
	organizationMember,
	organizationMemberEmail,
	organizationMemberName,
	organizationMemberRedactions,
	organizationMembers,
	organizationPolicyFeature,
	receivedOrganizationInvitations,
	sentOrganizationInvitation,
	sessionList,
	sessionRevocation,
	selfSessionRedactions,
	otherSessionRevocation,
	organizationLifecycle,
	allSessionRevocation,
	manuallyConstructedGuard,
	moduleWithTypeormDatabase,
	policyFeature,
	sessionPolicyFeature,
	synchronousModule,
	typedOrganizationLifecycle,
	typedControlPlaneLifecycle,
	updatedOrganizationMember,
	userManagementPolicyFeature,
};
