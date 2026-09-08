---
"@nestm/better-auth": minor
---

Allow applications to resolve an organization per authenticated request without changing the shared login session. Organization role and permission guards use the resolved selection and expose it to downstream tenant admission. Configured resolvers never fall back to the session selection.
