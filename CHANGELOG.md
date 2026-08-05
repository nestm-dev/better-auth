# @nestm/better-auth

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
