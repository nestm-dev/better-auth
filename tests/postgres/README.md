# TypeORM adapter conformance

A real PostgreSQL suite for `@nestm/better-auth/typeorm`. It is **opt-in and fails closed**:
without `PG_URL` it throws rather than skipping, so a forgotten variable can never be mistaken
for a pass (`require-postgres.ts`). `PG_SKIP=1` is the only way to omit it.

```bash
docker compose up -d postgres
PG_URL=postgresql://nestm:nestm@localhost:55437/nestm_better_auth pnpm run test:postgres
```

## The shape of it

The suite is **differential**. Every flow runs twice — once through
`@better-auth/drizzle-adapter`, once through this one — against a byte-identical copy of one
committed DDL (`schema.sql`), each in its own throwaway Postgres schema
(`ba_<arm>_<pid>_<rand>`). Correctness is then decided by comparing the two, not by comparing
this adapter against assertions this repository wrote about itself.

`getTestInstance`'s own `testWith: "postgres"` path is deliberately unused: it hardcodes port
5432 and a schema it never exposes, so two arms could not be pointed at sibling copies of the
same DDL. Leaving `testWith` unset makes it provision a throwaway in-memory SQLite for its
migration step, while `options.database` — which wins, being spread after the defaults —
carries the adapter under test.

The DDL is transcribed from a production application's migration rather than generated: `text`
primary keys with no default, snake_case columns, naive `timestamp` columns holding UTC
instants. A generated schema would paper over exactly the mismatch that matters, since Better
Auth's field names are camelCase and the columns are not.

## Files

| File                                | What it establishes                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `schema.sql`                        | The 16 auth tables. The fixed point both arms run against.                             |
| `entities.ts` / `drizzle-schema.ts` | The two ORMs' readings of that DDL.                                                    |
| `harness.ts`                        | Per-arm schema provisioning, a **neutral** reader, table capture and normalisation.    |
| `scenario.ts`                       | Every flow, in one deterministic order, driven through Better Auth's public API.       |
| `flows.spec.ts`                     | Each flow behaves correctly — on both arms.                                            |
| `differential.spec.ts`              | After the same flows, all 16 tables are identical across both arms.                    |
| `atomicity.spec.ts`                 | 32-way concurrency on `consumeOne` and `incrementOne`.                                 |
| `timezone.spec.ts`                  | UTC instants round-trip in four process zones, with a counter-proof.                   |
| `rate-limit.spec.ts`                | The database rate limiter, the only production caller of `incrementOne`.               |
| `update-date-column.spec.ts`        | What `@UpdateDateColumn` does to an `UPDATE`, on both paths.                           |
| `adapter-options.spec.ts`           | `select` aliasing, `getManager`, `transaction`, model/field resolution and its errors. |

## Two things worth knowing before editing this

**`drizzle(client)` mutates the postgres.js client it is handed** — it replaces the `timestamp`
type parser with the identity function so it can map dates itself. That is why `harness.ts`
opens a _second_, pristine connection for reading rows back. Reading the differential capture
through the same client would compare a Drizzle-configured reader against a stock one and
report every timestamp as a difference.

**The suite runs with the process in a non-UTC zone** (`TZ=America/Sao_Paulo`, chosen because
it has no DST). On a UTC machine every timezone implementation agrees and the entire class of
bug is invisible, so a UTC-only run would be a weaker test than it appears. The Postgres
_server_ stays on UTC, because `timestamp DEFAULT now()` renders in the server's zone.

## Normalisation

Ids, tokens, secrets, hashes and timestamps differ legitimately between two independent runs,
so `normalizeRow` collapses them to a marker that still carries the JavaScript **type** —
`<string>`, `<date>`, `<null>`. Everything else is compared verbatim. A column that is a
`number` under one adapter and a `string` under the other still fails, which is what catches
`rate_limit.last_request`: `int8` arrives from node-pg as a string, and raw SQL bypasses the
TypeORM `ValueTransformer` that would otherwise fix it.

Rows are ordered by their serialised normalised content, not by primary key — ids are random,
so "ordered by id" is a different order in each arm. The comparison is therefore multiset
equality, which is the right question: no adapter promises an insertion order.
