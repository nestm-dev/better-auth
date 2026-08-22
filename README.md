# @nestm/better-auth

[Better Auth](https://better-auth.com) integration for **NestJS 12** — ESM-only, Express & Fastify.

- `BetterAuthModule.forRoot / forRootAsync / forFeature` built on `ConfigurableModuleBuilder`
- Pass a pre-built `betterAuth()` instance **or** raw `BetterAuthOptions` (the module builds the instance, enabling fully DI-driven config)
- **No `bodyParser: false` required** — request bodies are recovered automatically
- Global `BetterAuthGuard` with `@AllowAnonymous`, `@OptionalAuth`, `@Roles`, `@OrgRoles`, `@RequireActiveOrg`, `@UserHasPermission`, `@MemberHasPermission`
- `@Session()` / `@CurrentUser()` parameter decorators, `@InjectBetterAuth()`
- Class-based hooks with full NestJS DI: `@Hook` + `@BeforeHook`/`@AfterHook`, `@DatabaseHook` + `@BeforeCreate`/`@AfterUpdate`/…, discovered anywhere in your module graph — **no `hooks: {}` pre-declaration needed**
- Composable HTTP route policies with full NestJS DI: `@AuthRoutePolicy({ path, methods, order })`
- Works with every better-auth plugin; plugin types flow into `@Session()` and `BetterAuthService`

## Requirements

- **NestJS 12** (`^12.0.0-alpha.5`, on the `next` npm tag) — this package is ESM-only, matching Nest 12's ESM-first direction
- **Node >= 22.13** (raised from 22.12 by the optional `typeorm` peer, which declares `^20.19 || ^22.13 || >=24.11`)
- **better-auth >= 1.6.26 < 1.7.0-0** (the conformance suite runs against stock `1.6.26`)

> **Nest 12 alpha peer-dependency note:** the current `12.0.0-alpha.*` packages still declare
> `^11.0.0` peers on their own siblings, so plain `npm install` fails with `ERESOLVE`.
> With **pnpm**, add to `pnpm-workspace.yaml`:
>
> ```yaml
> peerDependencyRules:
>   allowedVersions:
>     "@nestjs/common": "12"
>     "@nestjs/core": "12"
>     "@nestjs/platform-express": "12"
> ```
>
> With **npm**, use `--legacy-peer-deps` (or `overrides`) until the alphas fix their peers.

## Install

```bash
pnpm add @nestm/better-auth@alpha better-auth@1.6.26
```

## Quick start

```ts
// auth.ts
import { betterAuth } from "better-auth";

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL,
	secret: process.env.BETTER_AUTH_SECRET,
	emailAndPassword: { enabled: true },
});
```

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { BetterAuthModule } from "@nestm/better-auth";
import { auth } from "./auth.js";

@Module({
	imports: [BetterAuthModule.forRoot({ auth })],
})
export class AppModule {}
```

```ts
// main.ts — nothing special needed. No bodyParser: false. No CORS glue.
const app = await NestFactory.create(AppModule);
await app.listen(3000);
```

Better Auth now serves `/api/auth/*` (or whatever your `baseURL`/`basePath` resolve to), and
every controller route is protected by `BetterAuthGuard` unless marked otherwise.

### Options mode (module builds the instance)

```ts
BetterAuthModule.forRoot({
	options: {
		emailAndPassword: { enabled: true },
		plugins: [admin(), organization()],
	},
});
```

### forRootAsync (DI-driven config)

```ts
BetterAuthModule.forRootAsync({
	imports: [ConfigModule],
	inject: [ConfigService],
	useFactory: (config: ConfigService) => ({
		options: {
			baseURL: config.get("BETTER_AUTH_URL"),
			secret: config.get("BETTER_AUTH_SECRET"),
			emailAndPassword: { enabled: true },
		},
	}),
});
```

`useClass`/`useExisting` are supported via the `BetterAuthOptionsFactory` interface
(`createBetterAuthOptions()`).

### Module options

| Option                  | Mode   | Description                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`                  | option | Pre-built `betterAuth()` instance (best type inference).                                                                                                                                                                                                                                                             |
| `options`               | option | Raw `BetterAuthOptions`; the module calls `betterAuth()` itself and pre-seeds `hooks`/`databaseHooks`.                                                                                                                                                                                                               |
| `basePath`              | option | Override the mount path only (for edge cases like proxy rewrites) — better-auth's router still uses its own config, so to actually move the endpoints set better-auth's `basePath`/`baseURL`. Default mirrors better-auth: path inside `baseURL` → (`BETTER_AUTH_URL` when no `baseURL`) → `basePath` → `/api/auth`. |
| `cors`                  | option | `false` to disable, or `{ origin, credentials, methods, allowedHeaders, maxAge }`. Defaults to array `trustedOrigins`.                                                                                                                                                                                               |
| `routePolicy`           | option | Functional HTTP policy. It runs after auth-route CORS/body recovery and before DI route policies, `middleware`, or better-auth. Return a Web `Response` to short-circuit.                                                                                                                                            |
| `routePolicyBodyLimit`  | option | Maximum bytes buffered from an untouched request stream for policy body inspection. Default `1_048_576` (1 MiB); oversized requests receive `413 PAYLOAD_TOO_LARGE`.                                                                                                                                                 |
| `middleware`            | option | `(req, res, run) => …` wrapper around the auth handler — for MikroORM `RequestContext` / AsyncLocalStorage setups.                                                                                                                                                                                                   |
| `interop.publicKeys`    | option | Metadata keys from other guards that mean public. Their presence skips session lookup with the same handler-level authorization override as `@AllowAnonymous()`.                                                                                                                                                     |
| `organizationLifecycle` | option | Optional organization-scoped serialization boundary used by `BetterAuthOrganizationService` mutations. Without it the service still validates and normalizes stock Better Auth results, but does not serialize concurrent lifecycle changes.                                                                         |
| `isGlobal`              | extra  | Default `true`.                                                                                                                                                                                                                                                                                                      |
| `disableGlobalGuard`    | extra  | Skip the automatic `APP_GUARD` registration.                                                                                                                                                                                                                                                                         |

## Guard & decorators

```ts
@Controller("cats")
export class CatsController {
	@Get() // protected by default (global guard)
	findAll(@Session() session: UserSession) {}

	@Get("public")
	@AllowAnonymous() // never hits the auth backend (@Public is an alias)
	publicRoute() {}

	@Get("feed")
	@OptionalAuth() // session resolved, null when anonymous
	feed(@Session() session: UserSession | null) {}

	@Get("admin")
	@Roles("admin") // user.role, admin plugin
	adminOnly() {}

	@Get("org-settings")
	@OrgRoles(["owner", "admin"]) // active-organization member role (implies @RequireActiveOrg)
	orgSettings() {}

	@Get("users")
	@UserHasPermission({ permissions: { user: ["list"] } }) // admin plugin access control
	listUsers() {}

	@Post("projects")
	@MemberHasPermission({ permissions: { project: ["create"] } }) // organization plugin
	createProject(@CurrentUser() user: AuthUser) {}
}
```

Notes:

- `@AllowAnonymous()` **skips the session lookup entirely** (no auth-backend round trip per
  public request). Use `@AllowAnonymous({ resolveSession: true })` if you still want
  `@Session()` populated.
- `@Roles` and `@OrgRoles` are deliberately separate domains: an organization owner does not
  pass `@Roles('admin')`.
- `session.activeOrganizationId` is a tenant selector, not proof of current membership or a
  database-isolation boundary; Better Auth guards, hooks, and route policies do not scope domain
  queries. When composing with
  [`@nestm/tenant`](https://github.com/nestm-dev/tenant#secure-quick-start), keep the adapter in the
  application: set `disableGlobalGuard: true` and `disableAutomaticGuard: true`, then explicitly
  run `BetterAuthGuard` → `TenantGuard` → permissions (or use one composite guard), resolve only
  from the guard-populated session with `CallbackTenantResolver`—without a client header
  fallback—and re-check `(organizationId, userId)` membership in `TenantAccessPolicy` on every
  request.
- Authorization is fail-closed: a class-level `@AllowAnonymous`/`@OptionalAuth` is ignored on
  handlers that declare their own `@Roles`/`@OrgRoles`/`@RequireActiveOrg`/permission
  requirements (a handler-level `@AllowAnonymous` still wins).
- `interop.publicKeys` lets one global guard honor another package's public-route decorator
  without an application wrapper guard. Handler-level Better Auth requirements still override a
  class-level foreign marker; a foreign marker placed on the handler itself is explicit and wins.
- WebSocket gateways need `@UseGuards(BetterAuthGuard)` explicitly (Nest's `APP_GUARD` does
  not cover gateways). The guard understands http, ws, and rpc contexts; GraphQL is wired but
  currently **experimental** (the `@nestjs/graphql` v12-compatible stack is not yet stable).

### State-changing controller origins

Cookie-authenticated controller routes also need a CSRF boundary. Register the exported
`MutationOriginGuard` as an application guard with an exact origin allowlist:

```ts
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { MUTATION_ORIGIN_GUARD_OPTIONS, MutationOriginGuard } from "@nestm/better-auth";

@Module({
	providers: [
		{
			provide: MUTATION_ORIGIN_GUARD_OPTIONS,
			useValue: { trustedOrigins: ["https://studio.example.com"] },
		},
		MutationOriginGuard,
		{ provide: APP_GUARD, useExisting: MutationOriginGuard },
	],
})
export class SecurityModule {}
```

For `POST`, `PUT`, `PATCH`, `DELETE`, and other non-safe HTTP methods, the guard requires either
an exact trusted canonical `Origin` or `Sec-Fetch-Site: same-origin`. Invalid, repeated, opaque
(`null`), non-HTTP, or untrusted origins fail with `403`; malformed Fetch Metadata also fails
closed. `GET`, `HEAD`, and `OPTIONS` are unaffected. An explicitly trusted cross-site origin wins
over `Sec-Fetch-Site: cross-site`, which permits a deliberately separate browser frontend.

Trusted origins must use HTTPS. Local development may opt into plain HTTP with
`allowLoopbackHttp: true`; this accepts only `localhost`, `*.localhost`, `127.0.0.0/8`, and
`[::1]`. The guard affects Nest HTTP controller routes, while mounted Better Auth endpoints keep
Better Auth's own origin validation.

## Hooks with NestJS DI

Hook classes are regular providers — inject anything. They are discovered anywhere in your
module graph; `BetterAuthModule.forFeature` is optional sugar.

```ts
@Hook()
@Injectable()
export class SignUpHooks {
	constructor(private readonly mailer: MailerService) {}

	@BeforeHook("/sign-up/email") // exact path; '/organization/*' = prefix; RegExp/predicate too
	async validate(ctx: AuthHookContext) {
		if (!ctx.body?.email?.endsWith("@example.com")) {
			throw new APIError("BAD_REQUEST", { message: "Only @example.com emails allowed" });
		}
	}

	@AfterHook({ path: "/sign-up/email", order: 10 })
	async welcome(ctx: AuthHookContext) {
		const session = ctx.context.newSession;
		if (session) await this.mailer.sendWelcome(session.user.email);
	}
}

@DatabaseHook()
@Injectable()
export class UserAudit {
	@BeforeCreate("user")
	stamp(user: Record<string, unknown>) {
		return { data: { source: "nest-app" } }; // merged into the record
	}

	@AfterUpdate("user")
	audit(user: Record<string, unknown>) {}
}
```

Register them in any module's `providers`, or:

```ts
@Module({
	imports: [
		BetterAuthModule.forFeature({
			hooks: [SignUpHooks, UserAudit],
			imports: [MailerModule], // modules whose exports the hooks inject
		}),
	],
})
export class UsersModule {}
```

Semantics (mirroring better-auth exactly):

- Before hooks run sequentially (your `options.hooks`/instance hooks first, then decorator
  hooks by `order`); returning `{ context }` deep-merges, any other object short-circuits the
  endpoint, `APIError` aborts. Headers/cookies set by your own `options.hooks` middleware are
  preserved.
- After hooks: a defined return value replaces the response; a thrown `APIError` becomes the
  response without aborting the remaining after hooks.
- Database before-hooks fold `{ data }` returns and abort on `false`.
- Hooks also fire for server-side `auth.api.*` calls, and your hooks run before plugin hooks.
- **Instance mode + `@DatabaseHook`**: better-auth captures `databaseHooks` at init, so the
  instance must be created with at least `databaseHooks: {}` — the module throws an
  actionable error otherwise. Options mode handles this automatically. Request hooks need no
  pre-declaration in either mode.

## Typed sessions & services

```ts
// Once, app-wide (recommended):
declare module "@nestm/better-auth" {
	interface BetterAuthTypeRegistry {
		auth: typeof auth; // or InferAuth<typeof authOptions> in options mode
	}
}

// Now UserSession, AuthUser, BetterAuthService, @Session() etc. are plugin-aware
// everywhere, with no generic parameters.
```

Or per-site: `UserSession<typeof auth>`, `BetterAuthService<typeof auth>`. In options mode,
`defineBetterAuthOptions()` preserves plugin literal types for `InferAuth`. If you use many
plugins and compile times matter, prefer instance mode — `typeof auth` is already
materialized.

`BetterAuthService` exposes `.instance`, `.api`, `.options`, `.context()` and
`.getSession(headers)`. The raw instance is injectable via `@InjectBetterAuth()` or the
`BETTER_AUTH_INSTANCE` token; the resolved mount path via `BETTER_AUTH_BASE_PATH`.

For application-owned controller facades, use `invokeApi()` instead of converting Nest request
headers and mapping Better Auth errors in every service:

```ts
import { Headers as RequestHeaders } from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";

async invite(
	@RequestHeaders() requestHeaders: IncomingHttpHeaders,
	body: InviteMemberDto,
) {
	return this.auth.invokeApi(requestHeaders, (api, headers) =>
		api.createInvitation({ body, headers }),
	);
}
```

The callback receives the plugin-aware `auth.api` and a Web `Headers` copy. Its exact return type
is preserved. Better Auth `APIError`s become Nest `HttpException`s with
`{ statusCode, code, message }`; arbitrary body fields such as `cause` are not exposed, and
non-Better-Auth failures continue through the application's exception pipeline unchanged.

`invokeApi()` does not sanitize successful endpoint payloads. For session management, inject
`BetterAuthSessionService` instead. Its `list()` result contains only the session `id`, dates,
nullable IP address and user agent, plus an authoritative `current` flag. Better Auth's bearer
tokens and user ids never cross the service boundary:

```ts
@Controller("account/sessions")
export class AccountSessionsController {
	constructor(private readonly sessions: BetterAuthSessionService) {}

	@Get()
	list(@RequestHeaders() headers: IncomingHttpHeaders) {
		return this.sessions.list(headers);
	}

	@Delete(":sessionId")
	revoke(@RequestHeaders() headers: IncomingHttpHeaders, @Param("sessionId") sessionId: string) {
		return this.sessions.revokeById(headers, sessionId);
	}
}
```

`revokeById(headers, sessionId)` accepts only a session owned by the authenticated caller and
returns the same `SESSION_NOT_FOUND` response for missing and foreign ids. `revokeOthers(headers)`
keeps the current session; `revokeAll(headers)` includes it. All four methods accept Web `Headers`
or Nest/Node request headers and translate Better Auth API errors through `invokeApi()`.

Once the application facade is mounted, opt in to the supplied route policy so clients cannot
reach Better Auth's token-bearing session routes directly:

```ts
BetterAuthModule.forFeature({
	routePolicies: [BetterAuthSessionManagementRoutePolicy],
});
```

This blocks `/list-sessions`, `/revoke-session`, `/revoke-other-sessions`, and
`/revoke-sessions` at the Better Auth HTTP mount. Server-side calls made by
`BetterAuthSessionService` remain available.

### Organization control plane

`BetterAuthOrganizationService` is the application-facing lifecycle facade for the stock
Better Auth organization plugin. It lists, updates, removes, and leaves memberships; lists,
creates, resends by invitation id, and cancels organization invitations; and lists, previews,
accepts, or rejects the authenticated account's invitations. Returned members always include a
validated public user projection, and returned invitations are runtime-validated before crossing
the service boundary. In particular, `updateMemberRole()` re-reads the joined member because stock
Better Auth 1.6.26 returns a bare member at runtime despite its joined-user response type.

Every lifecycle mutation passes through the optional `organizationLifecycle` coordinator. The
service by itself is a compatibility and normalization layer; without a coordinator it does not
serialize concurrent requests. For cross-process PostgreSQL serialization and database atomicity,
use the supplied TypeORM coordinator and give its exact `getManager` function to the Better Auth
adapter so both execute inside the same transaction and organization advisory lock:

```ts
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import {
	createTypeormBetterAuthOrganizationLifecycleCoordinator,
	typeormAdapter,
} from "@nestm/better-auth/typeorm";

const organizationLifecycle = createTypeormBetterAuthOrganizationLifecycleCoordinator(dataSource);

const auth = betterAuth({
	database: typeormAdapter(dataSource, {
		transaction: true,
		getManager: organizationLifecycle.getManager,
	}),
	plugins: [organization()],
});

BetterAuthModule.forRoot({ auth, organizationLifecycle });
```

After the application's organization and account facade controllers are mounted, opt in to the
raw-route policy:

```ts
BetterAuthModule.forFeature({
	routePolicies: [BetterAuthOrganizationControlPlaneRoutePolicy],
});
```

That policy closes the corresponding raw organization/member/invitation HTTP paths, including
the reserved `/organization/resend-invitation` path. It does not affect server-side calls.
Calling `BetterAuthService`, the injected Better Auth instance, or `auth.api.*` directly bypasses
the lifecycle coordinator, so code that needs the guarantee must use
`BetterAuthOrganizationService`. Cross-process atomicity therefore requires all three pieces: the
PostgreSQL coordinator, the adapter wired to that same coordinator's `getManager`, and the opt-in
raw-route policy preventing clients from taking an uncoordinated HTTP path for those lifecycle
operations.

The transaction covers database mutations only. Invitation email delivery, application/Better
Auth hook side effects, secondary storage, and client cookie caches cannot be committed or rolled
back atomically with PostgreSQL. After remove/leave, matching database or secondary-storage
session selectors are cleared best-effort after commit; a cleanup failure does not turn an already
committed membership mutation into an apparent failure, and an already-issued signed cookie cache
may remain stale until refreshed.

HTTP adapters and application request augmentations can extend `BetterAuthRequestState` instead
of recreating Better Auth's plugin-aware `session` and `user` fields. Its resolved-session marker
uses the global symbol registry so guards and decorators remain compatible across duplicate package
copies.

## Body parsing

Unlike previous NestJS integrations, **you do not need `bodyParser: false`**. The mount
recovers the body in three tiers: untouched stream → `req.rawBody` (byte-exact) → re-serialize
the parsed body. If you use signature-verifying plugins (Stripe/Polar-style webhooks mounted
under better-auth), boot with Nest's own raw-body option for byte-exact payloads:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

`bodyParser: false` continues to work if you prefer it.

## Route policy

Route policies are singleton Nest providers for HTTP endpoint allowlists, self-service sign-up
switches, and request-shape rules that must run before better-auth. They can inject application
services and are discovered anywhere in the module graph. A path string is exact unless it ends
in `/*`; arrays, regular expressions, predicates, method filters, and explicit ordering are also
supported.

Each policy receives a normalized context containing `method`, `url`, `pathname`, `authPath`,
Web `headers`, parsed `body`, and byte-exact `rawBody` when it is recoverable.

```ts
@AuthRoutePolicy({ path: "/sign-up/*", order: -10 })
@Injectable()
export class DisableSelfSignupPolicy implements BetterAuthRoutePolicyHandler {
	evaluate() {
		return deny(403, {
			code: "SIGN_UP_DISABLED",
			message: "Self-service sign-up is disabled.",
		});
	}
}

@AuthRoutePolicy({
	path: "/organization/accept-invitation",
	methods: "POST",
})
@Injectable()
export class RejectInvitationResendPolicy implements BetterAuthRoutePolicyHandler {
	evaluate({ body }: BetterAuthRoutePolicyContext) {
		if (typeof body === "object" && body !== null && "resend" in body && Boolean(body.resend)) {
			return deny(400, {
				code: "BAD_REQUEST",
				message: "Resending is not allowed on this route.",
			});
		}
	}
}

@Module({
	imports: [
		BetterAuthModule.forFeature({
			routePolicies: [DisableSelfSignupPolicy, RejectInvitationResendPolicy],
		}),
	],
})
export class AuthPolicyModule {}
```

`deny(status, body, headers?)` creates a JSON response; a policy may instead return a Web
`Response`, or return nothing to let evaluation continue. The first denial or returned `Response`
wins. Policies with lower `order` run first, with stable registration order for ties. Providers
must be singleton scoped and cannot depend on request-scoped providers. Pass dependency modules
through `forFeature({ imports: [...] })`, or list a decorated policy in your own module's
`providers` array.

When an adapter has not parsed the body yet, policy recovery buffers at most
`routePolicyBodyLimit` bytes (1 MiB by default). Requests over the limit receive a 413 response
before any policy or module middleware runs.

The existing functional option remains supported and runs first for compatibility:

```ts
BetterAuthModule.forRoot({
	auth,
	routePolicy: ({ authPath }) =>
		authPath === "/functional-disabled-route"
			? Response.json({ code: "DISABLED" }, { status: 403 })
			: undefined,
});
```

The complete ordering is CORS → body recovery → functional `routePolicy` → DI policies →
`middleware` → better-auth. An answered CORS preflight never reaches policies. Returned responses
are written directly at the raw auth mount, so Nest guards, interceptors, and exception filters do
not rewrite them. Thrown or rejected errors are forwarded to the HTTP adapter's error path.
Server-side `auth.api.*` calls do not pass through route policies.

Use a route policy for HTTP-only enforcement, unknown mounted paths, or raw-body checks. Use a
Better Auth `@BeforeHook` when the same rule must also apply to server-side `auth.api.*` calls and
needs Better Auth's hook context/cookie protocol.

## CORS

CORS for the auth routes is handled by the module itself (Nest's `enableCors()` cannot reach
raw-mounted responses on Fastify). Origins default to your `trustedOrigins` array; configure
`cors: { origin: [...] }` explicitly (wildcards like `https://*.example.com` supported), or
`cors: false` to take over yourself. Function-based `trustedOrigins` cannot be mirrored — the
module warns and skips CORS in that case.

## RouterModule & global prefixes

The better-auth handler is mounted as a raw adapter middleware, **outside Nest's router** —
`setGlobalPrefix()` and versioning never affect it, with zero configuration.
`RouterModule.register()` has no effect on controller-less modules like this one; to move the
auth endpoints, set better-auth's `basePath`/`baseURL` (or the module's `basePath` override)
instead.

## TypeORM database adapter

A Better Auth database adapter backed by a TypeORM `DataSource`, shipped from the `./typeorm`
subpath. It exists because no TypeORM adapter exists anywhere else — `@better-auth/typeorm-adapter`
is a 404 on npm — so a TypeORM application had to keep a second ORM alive purely for auth.

```bash
pnpm add typeorm  # optional peer, only needed if you use this subpath
```

```ts
import { typeormAdapter } from "@nestm/better-auth/typeorm";

BetterAuthModule.forRootAsync({
	inject: [DataSource],
	useFactory: (dataSource: DataSource) => ({
		options: { database: typeormAdapter(dataSource, { transaction: true }) },
	}),
});
```

`typeorm` is an **optional** peer and the built entry imports it only as a type — nothing is
loaded at runtime, so installing this package without TypeORM stays free.

The adapter's public boundary is a library-owned structural capability contract rather than
TypeORM's nominal `DataSource` class. A linked workspace can therefore pass its own compatible
`DataSource` directly even when the package manager resolves TypeORM at a second physical path.
The adapter validates the metadata and manager capabilities it consumes at runtime; no consumer
cast or shared-module-path workaround is required.

### Requirements

- PostgreSQL. The adapter emits SQL directly and is verified against TypeORM's `postgres`,
  `aurora-postgres` and `cockroachdb` drivers; any other driver is rejected at construction
  with a message naming it, rather than failing later on the first write.
- Entities registered on the `DataSource` for every Better Auth model in use.

### How models and fields are resolved

Better Auth speaks camelCase model and field names (`rateLimit`, `userId`); your database
almost certainly does not. Resolution goes through `EntityMetadata`, so it already reflects
`@Column({ name })`, naming strategies and inheritance:

| Better Auth | tries                                                                    | example                                              |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| model       | `entities` override → entity class name → table name → snake_cased model | `rateLimit` → `class RateLimit` → table `rate_limit` |
| field       | property name → column name → snake_cased field                          | `userId` → property `userId` → column `user_id`      |

An unresolvable name throws immediately, listing the candidates it saw. Ambiguity is never
guessed:

```ts
typeormAdapter(dataSource, { entities: { rateLimit: ThrottleBucket } });
```

### Options

| Option        | Default              | Purpose                                                                                                             |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `entities`    | `{}`                 | Explicit model → entity mapping.                                                                                    |
| `getManager`  | `dataSource.manager` | Supplies a scoped `EntityManager`; a defined value also lets Better Auth join the application's active transaction. |
| `transaction` | `false`              | Enables Better Auth's `transaction()`; joins `getManager()` or opens `dataSource.transaction()`.                    |
| `usePlural`   | `false`              | Appends `s` to model names during resolution.                                                                       |
| `debugLogs`   | `false`              | Forwarded to the adapter factory.                                                                                   |

Enable `transaction` in production so Better Auth's multi-step user/account/session writes are
atomic. When the application already owns a transaction through `getManager`, the adapter joins
it instead of opening a competing transaction. That allows an application audit or outbox write
using the same scoped manager to commit or roll back with the Better Auth mutation.

`getManager` is resolved **per statement**, not once at construction — an adapter is built at
application boot, long before any request context exists:

```ts
typeormAdapter(dataSource, { getManager: () => unitOfWork.getStore()?.manager });
```

Returning `undefined` falls back to `dataSource.manager` for ordinary statements and makes
`transaction()` open `dataSource.transaction()`. Returning a manager while `transaction` is
enabled explicitly means that manager already belongs to the application's active unit of work;
the Better Auth callback pins it for every inner statement. Do not return a non-transactional
manager from the hook merely as a permanent replacement for `dataSource.manager`.

### Timezones — this adapter owns the concern

**Short version: you do not need `pg.defaults.parseInputDatesAsUTC`, and you do not need a
custom type parser for OID 1114. The adapter is correct on any machine, in any zone, with or
without them.**

Every Better Auth timestamp column is `timestamp` WITHOUT time zone holding a UTC instant, and
session and OTP expiry are wall-clock comparisons against it. node-pg's defaults are
offset-dependent in _both_ directions: a JS `Date` bind parameter is rendered with the process's
LOCAL offset, which Postgres then truncates when casting to `timestamp`, and a bare `timestamp`
column is parsed back as LOCAL. Neither fails loudly — sessions just expire early or late by the
machine's offset. On a UTC machine the bug is invisible, which is why CI does not catch it.

The adapter closes both halves itself, per statement, **without mutating any process-global
driver state**:

- **writes** bind a `Date` as an ISO-8601 UTC string (`2026-03-04T05:06:07.000Z`), so the
  intent is in the text. Cast to `timestamp` it keeps the UTC wall-clock; cast to `timestamptz`
  it resolves to the same instant.
- **reads** project naive timestamp columns as `col AT TIME ZONE 'UTC'`, which yields a
  zone-qualified value the driver cannot misread. Columns already declared `timestamptz` are
  left alone.

Setting `pg.defaults` would have been the smaller diff and the wrong call: it is a process-wide
mutation of a module the adapter does not own, and it would silently change every other query in
the host application, including ones belonging to other data sources.

The one thing outside the adapter's reach is a column DEFAULT: `created_at timestamp DEFAULT
now()` renders in the **server's** zone, so keep the database on UTC. Better Auth supplies
`createdAt` explicitly for every model, so the default is only a backstop.

### Divergences from `@better-auth/drizzle-adapter`

The conformance suite runs every flow through both adapters against the same DDL and asserts the
resulting rows are identical, so these are the deliberate differences that remain:

- **`supportsUUIDs: false`** (Drizzle: `true` on Postgres). With `true` _and_
  `advanced.database.generateId: "uuid"`, Better Auth stops emitting an `id` and expects the
  column to default one — which `id text PRIMARY KEY` does not do, so every insert fails. `false`
  keeps id generation in Better Auth. If your primary key really is `uuid DEFAULT
gen_random_uuid()`, express that with `generateId: false`.
- **`supportsJSON: false`, `supportsArrays: false`** (Drizzle: `true` on Postgres). Better Auth's
  own schema has no `json`, `string[]` or `number[]` field, so this only affects additional
  fields you declare. `false` serialises them to strings, which a `text` column accepts; `true`
  requires `jsonb`/`text[]` DDL.
- **Stronger `consumeOne` / `incrementOne`.** Both are single statements that repeat the guard
  _outside_ the `IN (SELECT ... LIMIT 1)` subquery. Postgres's EvalPlanQual re-checks the outer
  qualification against the newest row version when a blocked writer unblocks; a guard that lives
  only in the subquery is re-evaluated against a stale snapshot. This is not theoretical —
  `tests/postgres/atomicity.spec.ts` puts 32 concurrent racers against a `count < 10` guard, and
  the Drizzle adapter admits all 32 where this one admits exactly 10. Both agree when the calls
  are sequential, which is what isolates it to the race.
- **Native joins are not supported.** `experimental.joins` throws rather than silently returning
  empty relations; leave it off and the factory resolves relations with follow-up queries.

### What the conformance suite proves

`pnpm run test:postgres` runs sign-up/sign-in, session refresh past `updateAge`, email-OTP,
organization create/invite/accept/list, MCP OAuth register/authorize/token, and database-backed
rate limiting through **both** adapters, in per-arm Postgres schemas built from one committed
DDL — then captures all 11 tables and asserts they match column-for-column, including each
value's JavaScript type. It runs with the process in a non-UTC zone by default, because that is
the only way the timezone class of bug is visible.

## Limitations

- Auth routes bypass Nest's router pipeline: guards, interceptors, and exception filters do
  not run for `/api/auth/*` (functional/`MiddlewareConsumer` middleware **does** run).
  Customize with `routePolicy` or better-auth hooks instead.
- Root mounting (`basePath: '/'`) is rejected at bootstrap — it would swallow every
  application route.
- With `isGlobal: false`, other modules' `onModuleInit` hooks may run before the auth mount
  and hook installation complete; don't call your own auth endpoints from `onModuleInit`.
- Sharing one `auth` instance across two _concurrently live_ Nest apps is unsupported (hook
  dispatch follows the most recently initialized app); sequential apps — e.g. repeated
  testing modules — are fully supported.
- On Fastify, responses for auth routes are written to the raw socket — Fastify `onResponse`
  hooks and reply-based logging do not observe them.
- GraphQL context support is wired but untested against Nest 12 (upstream `@nestjs/graphql`
  v12 support is still settling) — treat as experimental.
- One copy of this package per app: tokens are unique symbols.

## License

BSD-3-Clause © nestm
