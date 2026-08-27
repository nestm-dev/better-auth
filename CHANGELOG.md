# @nestm/better-auth

## 0.1.0-alpha.9

### Minor Changes

- e79856d: Constrain Better Auth compatibility to stable `1.7.2` through the 1.7 release line and add
  Microsoft Entra ID plus generic OAuth/OIDC flow coverage.
  
  Move MCP conformance coverage to the standalone `@better-auth/mcp` package, implement Better
  Auth 1.7's required atomic adapter primitives directly, and follow the 1.7 social-provider
  account identity and issuer contracts.
  
  Permission decorators now always evaluate the authenticated caller; the unsafe shared `role`
  option has been removed. Stateful regular-expression hook matchers are repeatable, and the
  TypeORM adapter now accepts only the standard PostgreSQL driver instead of advertising
  incompatible Aurora PostgreSQL and CockroachDB query-result shapes.
  
  The Nest peers now target stable NestJS 12, and the optional GraphQL peer targets the compatible
  `@nestjs/graphql` 14 line. The development graph also resolves the current Nest and test-tooling
  releases while retaining the audited Nano ID 3.3.18 override.

## 0.1.0-alpha.8

### Minor Changes

- 32f4c44: Allow the TypeORM adapter's Better Auth transactions to join an application-owned transaction
  returned by `getManager`. This keeps auth mutations atomic with audit and outbox writes made
  through the same scoped manager, while retaining `dataSource.transaction()` as the fallback.
- 32f4c44: Add a plugin-aware `BetterAuthService.invokeApi()` boundary for application-owned Nest
  controllers. It normalizes Node request headers to Web Headers, preserves endpoint result types,
  and translates Better Auth API errors into stable Nest HTTP exceptions.
- 56b4467: Add a stock-Better-Auth-compatible platform user-management facade with bounded user queries and
  profile/role/ban mutations, token-free active session summaries, safe owned-session-id revocation,
  and an opt-in policy closing the raw admin HTTP namespace. Generalize the TypeORM organization
  lifecycle coordinator into one namespaced organization/user/platform control-plane coordinator
  while preserving the organization-only API. Canonicalize raw request targets before auth mount and
  policy matching so encoded dot segments cannot bypass protected routes, and dual-acquire legacy
  plus namespaced organization advisory locks for safe rolling upgrades. The guard now rejects
  retained sessions for actively banned users while respecting valid expired bans, and expiry-omitted
  re-bans no longer retain a previous temporary expiry. Stock-valid hostile profile and session
  display fields are projected into explicit bounded/redacted outputs instead of blocking admin
  enforcement or safe session revocation. Organization member identity fields use the same bounded,
  explicit projection so hostile profile display data cannot block role changes or removals.
- 32f4c44: Add `BetterAuthSessionService`, an injectable application-facing session facade with token-free
  summaries, authoritative current-session detection, strict caller-owned id revocation, and bulk
  revocation helpers. Add an opt-in `BetterAuthSessionManagementRoutePolicy` that blocks Better
  Auth's raw token-bearing HTTP session endpoints once an application facade is mounted.
- 6a14f6a: Add a stock-Better-Auth-compatible organization control plane with normalized member and
  invitation results, ID-bound invitation resend, serialized lifecycle mutations, and raw-route
  policy enforcement. Add a PostgreSQL TypeORM coordinator that shares one application-owned
  transaction and organization advisory lock with the Better Auth adapter. Active-organization
  guards now bypass cookie caches and verify live membership before authorizing a request.
- d906e39: Add a reusable, fail-closed Nest `MutationOriginGuard` with strict trusted-origin canonicalization and Fetch Metadata fallback for state-changing controller routes.

### Patch Changes

- d906e39: Make the TypeORM adapter accept validated structural DataSource, metadata, and manager capabilities
  so linked-workspace consumers do not need casts when TypeORM is installed at multiple physical
  paths.

## 0.1.0-alpha.7

### Minor Changes

- a71a12f: Add ordered, DI-backed HTTP route-policy providers through `@AuthRoutePolicy()` and
  `BetterAuthModule.forFeature({ routePolicies })`, including exact/prefix/list/RegExp/predicate
  matching and structured `deny()` responses. The existing functional `routePolicy` option remains
  supported and runs first for backward compatibility. Untouched policy body recovery is capped by
  the configurable `routePolicyBodyLimit` (1 MiB by default) and returns 413 when exceeded.

## 0.1.0-alpha.6

### Minor Changes

- af93872: Add a TypeORM database adapter, exported from the new `./typeorm` subpath.

  `typeormAdapter(dataSource, config?)` backs Better Auth with a TypeORM `DataSource` on
  PostgreSQL, resolving models and fields through `EntityMetadata` (`rateLimit` → `class
RateLimit` → table `rate_limit`, `userId` → column `user_id`) with an `entities` override for
  anything ambiguous. It implements `consumeOne` and `incrementOne` natively as single-statement
  compare-and-swaps, and takes a `getManager` hook so auth writes can join a surrounding unit of
  work.

  The adapter owns the `timestamp`-column timezone contract end to end — binding dates as
  ISO-8601 UTC and reading them back through `AT TIME ZONE 'UTC'` — so it is correct on any
  machine without `pg.defaults.parseInputDatesAsUTC` or a custom OID 1114 parser, and without
  mutating process-global driver state.

  `typeorm` is an optional peer (`^1.1.0`), which raises `engines.node` to `>=22.13`.

## 0.1.0-alpha.5

### Patch Changes

- 1ebb22a: Let `BetterAuthGuard` honor foreign public-route metadata through
  `interop.publicKeys`, removing the need for application wrapper guards when
  another framework owns a public endpoint.

## 0.1.0-alpha.4

### Patch Changes

- 018c34f: Export a plugin-aware `BetterAuthRequestState` contract and make the resolved-session request marker interoperable across duplicate package copies.

## 0.1.0-alpha.3

### Patch Changes

- 1be0ba3: Declare `BetterAuthModule.forRoot()` and `forRootAsync()` explicitly so their public signatures remain available in the rolled-up package declarations.

## 0.1.0-alpha.2

### Minor Changes

- Add an adapter-independent `routePolicy` option that can inspect normalized auth HTTP requests and short-circuit them with a Web `Response` before middleware and better-auth execute.

## 0.1.0-alpha.1

### Minor Changes

- 1bca5a8: Initial release: BetterAuthModule.forRoot/forRootAsync/forFeature for NestJS 12 (ESM), guard + decorators, DI-powered hooks, automatic body recovery (no bodyParser:false), basePath-scoped CORS.
