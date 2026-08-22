---
"@nestm/better-auth": minor
---

Allow the TypeORM adapter's Better Auth transactions to join an application-owned transaction
returned by `getManager`. This keeps auth mutations atomic with audit and outbox writes made
through the same scoped manager, while retaining `dataSource.transaction()` as the fallback.
