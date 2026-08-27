---
"@nestm/better-auth": minor
---

Add a TypeORM database adapter, exported from the new `./typeorm` subpath.

`typeormAdapter(dataSource, config?)` backs Better Auth with a TypeORM `DataSource` on
PostgreSQL, resolving models and fields through `EntityMetadata` (`rateLimit` → `class
RateLimit` → table `rate_limit`, `userId` → column `user_id`) with an `entities` override for
anything ambiguous. It implements `consumeOne` and `incrementOne` natively as single-statement
compare-and-swaps, and takes a `getManager` hook so auth writes can join a surrounding unit of
work.

The adapter owns the `timestamp`-column timezone contract end to end — binding dates as
ISO-8601 UTC and reading them back through `AT TIME ZONE 'UTC'` — so it is correct on any
machine without `pg.defaults.parseInputDatesAsUTC` or a custom OID 1114 parser, and without
mutating process-global driver state.

`typeorm` is an optional peer (`^1.1.0`), which raises `engines.node` to `>=22.13`.
