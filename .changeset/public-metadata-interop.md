---
"@nestm/better-auth": patch
---

Let `BetterAuthGuard` honor foreign public-route metadata through
`interop.publicKeys`, removing the need for application wrapper guards when
another framework owns a public endpoint.
