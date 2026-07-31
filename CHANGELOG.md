# @nestm/better-auth

## 0.1.0-alpha.2

### Minor Changes

- Add an adapter-independent `routePolicy` option that can inspect normalized auth HTTP requests and short-circuit them with a Web `Response` before middleware and better-auth execute.

## 0.1.0-alpha.1

### Minor Changes

- 1bca5a8: Initial release: BetterAuthModule.forRoot/forRootAsync/forFeature for NestJS 12 (ESM), guard + decorators, DI-powered hooks, automatic body recovery (no bodyParser:false), basePath-scoped CORS.
