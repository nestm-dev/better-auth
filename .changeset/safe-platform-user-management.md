---
"@nestm/better-auth": minor
---

Add a stock-Better-Auth-compatible platform user-management facade with bounded user queries and
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
