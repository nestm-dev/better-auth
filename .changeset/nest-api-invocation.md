---
"@nestm/better-auth": minor
---

Add a plugin-aware `BetterAuthService.invokeApi()` boundary for application-owned Nest
controllers. It normalizes Node request headers to Web Headers, preserves endpoint result types,
and translates Better Auth API errors into stable Nest HTTP exceptions.
