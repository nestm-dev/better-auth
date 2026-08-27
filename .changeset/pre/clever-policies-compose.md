---
"@nestm/better-auth": minor
---

Add ordered, DI-backed HTTP route-policy providers through `@AuthRoutePolicy()` and
`BetterAuthModule.forFeature({ routePolicies })`, including exact/prefix/list/RegExp/predicate
matching and structured `deny()` responses. The existing functional `routePolicy` option remains
supported and runs first for backward compatibility. Untouched policy body recovery is capped by
the configurable `routePolicyBodyLimit` (1 MiB by default) and returns 413 when exceeded.
