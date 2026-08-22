---
"@nestm/better-auth": minor
---

Add `BetterAuthSessionService`, an injectable application-facing session facade with token-free
summaries, authoritative current-session detection, strict caller-owned id revocation, and bulk
revocation helpers. Add an opt-in `BetterAuthSessionManagementRoutePolicy` that blocks Better
Auth's raw token-bearing HTTP session endpoints once an application facade is mounted.
