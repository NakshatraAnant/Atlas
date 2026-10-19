# Runbook

Detailed local hosting guide: `docs/deployment/LOCAL_HOSTING.md`. This page covers the operational essentials.

## Start locally

```bash
npm install
node scripts/atlas.mjs start
```

Then open http://localhost:3000 (or the `WEB_PORT` set in `.env.local`). The first start seeds 120 synthetic companies into `./data` (several minutes). Development accounts are listed in `apps/api/src/seed.ts`. `node scripts/atlas.mjs status | stop | logs | backup | restore` manage it.

During development, two terminals instead:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Before starting the API, `node scripts/atlas.mjs start` runs `npm run pipeline -w @atlas/api`, which catches up missed trading days in order (log: `.atlas/logs/pipeline.log`; logic tested in `catchup.test.ts`). It runs first because the embedded database computes on the API's own thread: a catch-up inside the API leaves it unable to answer for several minutes at 120 companies. With background jobs on, the API also runs the post-close cycle itself after 18:30 IST. Set `ATLAS_BACKGROUND_JOBS=false` to turn both off.

## Seed or rebuild the local database

The database lives in `apps/api/data/pglite` (git-ignored). To rebuild it, move the folder aside (into `backups/`) and run:

```bash
npm run seed
```

Seed settings (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `SYNTHETIC_COMPANIES` | 120 | Size of the synthetic universe for a new seed. The API reads the size from the seeded database. |
| `ATLAS_SEED_MODE` | `auto` | `memory` builds in memory and copies to disk (fast, needs about 3× the DB size in memory); `disk` builds in place; `auto` uses disk above 150 companies. |
| `ATLAS_PIT_BATCH_COMPANIES` | 10 | Companies per point-in-time fundamentals batch in the calculation stage. |
| `ATLAS_QUERY_ROW_BUDGET` | 20000 | Row budget for one market-window query. |
| `ATLAS_PIPELINE_TRACE` | off | `1` logs memory, database size and WAL per pipeline stage. |

Measured on this machine: 40 companies about 3 minutes; 120 companies (memory mode) a few minutes; 602 companies (disk mode) 97 minutes, peak RSS about 960 MB, database 1.7 GB.

## Tests

```bash
npm test                 # unit + API integration (PGlite)
npm run test:postgres    # real PostgreSQL 17 (node-postgres)
npm run test:e2e         # browser journeys on Microsoft Edge
npm run eval             # AI evaluation (stop the API first: PGlite is single-process)
```

## Hosted database (Supabase `project-atlas`)

Project ref `wyknwjdcexisrempmvjr`, URL https://wyknwjdcexisrempmvjr.supabase.co, region `ap-south-1`.

**Access model (verified 19 Oct 2026):** ATLAS uses Supabase only as managed PostgreSQL. The API connects directly with node-postgres through `DATABASE_URL` (session pooler, TLS via `DATABASE_SSL`). Authentication is ATLAS's own (sessions, scrypt, TOTP; ADR-013), not Supabase Auth, and no Supabase client library or publishable key is used. All 151 tables in the 10 ATLAS schemas have RLS on with no policies; `anon` and `authenticated` have no schema usage or table privileges, and the REST API rejects every ATLAS schema (`PGRST106`). User isolation is enforced by the API on the session user id (api.test.ts "user isolation").

To connect the app: put the session-pooler URI in `.env.local` as `DATABASE_URL` with `DATABASE_SSL=require`, run `npm run migrate -w @atlas/api` (expect `"applied":[]` with all eight files under `alreadyApplied`; a checksum mismatch stops it), then decide deliberately whether to load data. Never run the destructive test suites against it.

- Schema changes: add a new numbered file in `apps/api/src/db/migrations`, run `npm test`, then apply the same file to Supabase. Either run `npm run migrate` with `DATABASE_URL` set (preferred), or apply it via the Supabase connector and record its checksum in `ops.schema_migrations`.
- Verify parity: compare `npx tsx scripts/schema-fingerprint.mts` with the same query (`apps/api/src/db/fingerprint.sql`) run on Supabase.
- Check the Supabase security advisor after every schema change. Expected: only INFO "RLS enabled, no policy".

## Backup and recovery

- Local: `node scripts/atlas.mjs backup` / `restore` (see LOCAL_HOSTING.md). Never delete `apps/api/data` without a copy.
- Supabase (free plan): daily backups are managed by Supabase; point-in-time recovery needs a paid plan. Before any destructive production change, take a manual dump and record the recovery path.
- Migrations are forward-only. Never edit an applied migration; the migrator refuses a changed checksum.

## Publish Academy content

1. A subject reviewer checks the lesson against the seven points (see ACADEMY_CURRICULUM.md).
2. An admin (with two-step verification) calls `POST /admin/v1/academy/lessons/:id/versions/:v/publish` with all checks and the reviewer's name.
3. The action is recorded in the audit log.

## Incidents

- API logs are JSON lines on stdout (correlation ids on every request).
- `/healthz` (API) and `/status` (web) show component status.
- Data corrections go in the correction log (`calc.corrections`) and are shown publicly.
