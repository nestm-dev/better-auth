---
"@nestm/better-auth": minor
---

Constrain Better Auth compatibility to stable `1.7.2` through the 1.7 release line and add
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
