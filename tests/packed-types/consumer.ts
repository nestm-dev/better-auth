import {
	BetterAuthGuard,
	BetterAuthModule,
	BetterAuthService,
	BetterAuthSessionManagementRoutePolicy,
	BetterAuthSessionService,
	AuthRoutePolicy,
	deny,
	type AnyAuth,
	type BetterAuthInteropOptions,
	type BetterAuthRoutePolicy,
	type BetterAuthRoutePolicyContext,
	type BetterAuthRoutePolicyHandler,
	type BetterAuthSessionBulkRevocationResult,
	type BetterAuthSessionRevocationResult,
	type BetterAuthSessionSummary,
} from "@nestm/better-auth";
import { typeormAdapter, type TypeormAdapterConfig } from "@nestm/better-auth/typeorm";
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

// The `./typeorm` subpath ships its own entry, so it needs its own coverage here: without a
// consumer import it would be published untested against its rolled-up declarations.
const typeormConfig: TypeormAdapterConfig = {
	entities: { rateLimit: "RateLimit" },
	getManager: () => scopedManager,
	transaction: true,
};
const databaseAdapter = typeormAdapter(dataSource, typeormConfig);
const defaultedAdapter = typeormAdapter(dataSource);

const moduleWithTypeormDatabase = BetterAuthModule.forRoot({
	options: { database: databaseAdapter },
});

export {
	asynchronousModule,
	databaseAdapter,
	defaultedAdapter,
	interop,
	invitationCall,
	sessionList,
	sessionRevocation,
	otherSessionRevocation,
	allSessionRevocation,
	manuallyConstructedGuard,
	moduleWithTypeormDatabase,
	policyFeature,
	sessionPolicyFeature,
	synchronousModule,
};
