# Contributing

## Setup

```bash
corepack enable
pnpm install
```

Node >= 22.13 required.

## Workflow

```bash
pnpm run check           # oxlint + prettier + tsc --noEmit
pnpm run test            # full e2e matrix: express + fastify
pnpm run test:express    # one adapter
pnpm run test:postgres   # TypeORM adapter conformance (needs Postgres, see below)
pnpm run build           # tsdown → dist/
pnpm run verify:pack     # build + publint
```

The Postgres suite is opt-in and **fails closed** — it will not silently skip because a URL
was forgotten:

```bash
docker compose up -d postgres
PG_URL=postgresql://nestm:nestm@localhost:55437/nestm_better_auth pnpm run test:postgres
```

Set `PG_SKIP=1` to deliberately omit it. See `tests/postgres/README.md` for what it proves.

Every change needs a changeset: `pnpm changeset`.

## Ground rules

- ESM-only, NestJS 12-only. No CJS escape hatches.
- `experimentalDecorators` + `emitDecoratorMetadata` are load-bearing. Never enable
  `verbatimModuleSyntax`, never introduce circular imports in `src/`, and never switch the
  build to an esbuild-based bundler (it silently drops decorator metadata — CI greps
  `design:paramtypes` in the output to catch this).
- Everything public is exported from `src/index.ts`; `tests/unit/exports.test.ts` keeps it
  honest.
- Tests are e2e-first and must pass on both adapters.
