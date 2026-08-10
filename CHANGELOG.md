# @nestm/better-auth

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
