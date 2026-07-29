# @nestm/better-auth

[Better Auth](https://better-auth.com) integration for **NestJS 12** — ESM-only, Express & Fastify.

- `BetterAuthModule.forRoot / forRootAsync / forFeature` built on `ConfigurableModuleBuilder`
- Pass a pre-built `betterAuth()` instance **or** raw `BetterAuthOptions` (the module builds the instance, enabling fully DI-driven config)
- **No `bodyParser: false` required** — request bodies are recovered automatically
- Global `BetterAuthGuard` with `@AllowAnonymous`, `@OptionalAuth`, `@Roles`, `@OrgRoles`, `@RequireActiveOrg`, `@UserHasPermission`, `@MemberHasPermission`
- `@Session()` / `@CurrentUser()` parameter decorators, `@InjectBetterAuth()`
- Class-based hooks with full NestJS DI: `@Hook` + `@BeforeHook`/`@AfterHook`, `@DatabaseHook` + `@BeforeCreate`/`@AfterUpdate`/…, discovered anywhere in your module graph — **no `hooks: {}` pre-declaration needed**
- Works with every better-auth plugin; plugin types flow into `@Session()` and `BetterAuthService`

## Requirements

- **NestJS 12** (`^12.0.0-alpha.5`, on the `next` npm tag) — this package is ESM-only, matching Nest 12's ESM-first direction
- **Node >= 22.12**
- **better-auth >= 1.6 < 2**

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
pnpm add @nestm/better-auth better-auth
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

| Option               | Mode   | Description                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`               | option | Pre-built `betterAuth()` instance (best type inference).                                                                                                                                                                                                                                                             |
| `options`            | option | Raw `BetterAuthOptions`; the module calls `betterAuth()` itself and pre-seeds `hooks`/`databaseHooks`.                                                                                                                                                                                                               |
| `basePath`           | option | Override the mount path only (for edge cases like proxy rewrites) — better-auth's router still uses its own config, so to actually move the endpoints set better-auth's `basePath`/`baseURL`. Default mirrors better-auth: path inside `baseURL` → (`BETTER_AUTH_URL` when no `baseURL`) → `basePath` → `/api/auth`. |
| `cors`               | option | `false` to disable, or `{ origin, credentials, methods, allowedHeaders, maxAge }`. Defaults to array `trustedOrigins`.                                                                                                                                                                                               |
| `middleware`         | option | `(req, res, run) => …` wrapper around the auth handler — for MikroORM `RequestContext` / AsyncLocalStorage setups.                                                                                                                                                                                                   |
| `isGlobal`           | extra  | Default `true`.                                                                                                                                                                                                                                                                                                      |
| `disableGlobalGuard` | extra  | Skip the automatic `APP_GUARD` registration.                                                                                                                                                                                                                                                                         |

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
- Authorization is fail-closed: a class-level `@AllowAnonymous`/`@OptionalAuth` is ignored on
  handlers that declare their own `@Roles`/`@OrgRoles`/`@RequireActiveOrg`/permission
  requirements (a handler-level `@AllowAnonymous` still wins).
- WebSocket gateways need `@UseGuards(BetterAuthGuard)` explicitly (Nest's `APP_GUARD` does
  not cover gateways). The guard understands http, ws, and rpc contexts; GraphQL is wired but
  currently **experimental** (the `@nestjs/graphql` v12-compatible stack is not yet stable).

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

## Body parsing

Unlike previous NestJS integrations, **you do not need `bodyParser: false`**. The mount
recovers the body in three tiers: untouched stream → `req.rawBody` (byte-exact) → re-serialize
the parsed body. If you use signature-verifying plugins (Stripe/Polar-style webhooks mounted
under better-auth), boot with Nest's own raw-body option for byte-exact payloads:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

`bodyParser: false` continues to work if you prefer it.

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

## Limitations

- Auth routes bypass Nest's router pipeline: guards, interceptors, and exception filters do
  not run for `/api/auth/*` (functional/`MiddlewareConsumer` middleware **does** run).
  Customize via better-auth hooks instead.
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
