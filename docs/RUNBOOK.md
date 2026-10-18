# Runbook

Detailed local hosting guide: `docs/deployment/LOCAL_HOSTING.md`. This page covers the operational essentials.

## Start locally

```bash
npm install
node scripts/atlas.mjs start
```

Then open http://localhost:3000. Development accounts are listed in `apps/api/src/seed.ts`.

During development, two terminals instead:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Known issue: with background jobs on, the daily catch-up can crash the embedded database (see `KNOWN_LIMITATIONS.md`). Workaround: set `ATLAS_BACKGROUND_JOBS=false` for the API process.

## Seed or rebuild the local database

The database lives in `apps/api/data/pglite` (git-ignored). To rebuild it, move the folder aside (into `backups/`) and run:

```bash
npm run seed
```

The default universe is 40 synthetic companies (plus a few extra listings), verified in session 3 (155 s). 120 crashed the embedded engine (`memory access out of bounds`); see KNOWN_LIMITATIONS.md.

## Hosted database (Supabase `project-atlas`)

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
