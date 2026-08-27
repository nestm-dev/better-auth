---
"@nestm/better-auth": minor
---

Add a stock-Better-Auth-compatible organization control plane with normalized member and
invitation results, ID-bound invitation resend, serialized lifecycle mutations, and raw-route
policy enforcement. Add a PostgreSQL TypeORM coordinator that shares one application-owned
transaction and organization advisory lock with the Better Auth adapter. Active-organization
guards now bypass cookie caches and verify live membership before authorizing a request.
