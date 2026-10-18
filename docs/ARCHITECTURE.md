# Architecture

## Shape

```
Browser ──same-origin──▶ Next.js web (apps/web, :3000) ──rewrite /v1, /admin/v1──▶ Fastify API (apps/api, :4000) ──▶ PostgreSQL
                                                                                          │                         ├─ local: PGlite (WASM) in apps/api/data/pglite
                                                                                          │                         └─ hosted: Supabase project-atlas (ap-south-1)
                                                                                          └─ in-process jobs: scheduler, backtests, outbox, billing, retention
```

- TypeScript end to end (ADR-008). Monorepo with npm workspaces: `packages/shared` (formatting, content rules, plans, learning simulations), `apps/api`, `apps/web`.
- One database interface over two drivers (`apps/api/src/db/db.ts`): PGlite for dev/tests, node-postgres for managed PostgreSQL. Types are normalised identically.
- Forward-only, checksummed SQL migrations (`apps/api/src/db/migrations`, `migrate.ts`). The same files are applied to Supabase; parity is checked with `src/db/fingerprint.sql`.
- The API is the only database client. Supabase is used as managed PostgreSQL with deny-by-default RLS (ADR-012). Authentication is ATLAS's own (ADR-013).

## Schemas

| Schema | Purpose |
|---|---|
| `ref` | companies, securities, identifiers over time, exchanges, calendars, sources, **licences and field-level rights** |
| `market` | EOD prices (partitioned by year), corporate actions, adjusted price cache, index levels, quarantine, revisions |
| `fund` | financial periods (basis, versioned restatements, filed_at for point-in-time), values with source refs, shareholding |
| `disc` | announcements, insider trades |
| `calc` | metric definitions (versioned), metric values with input hashes and refs, daily security/market/sector calcs, briefings, data snapshots, quality issues, corrections |
| `bt` | strategy templates, cost tables, backtest runs (snapshot, engine and cost versions, results hash), trades |
| `ai` | conversations, messages, claims with evidence, tool calls (fields sent/withheld), feedback, eval cases/runs |
| `app` | users, sessions, consents, plans/entitlements, billing, watchlists, notes, workspaces, screens, hypotheses, alerts, exports, support, analytics |
| `ops` | ingestion runs, job queue, feature flags (legal gate), audit log (append-only, hash chain), costs, incidents |
| `acad` | Academy: versioned courses, lessons, question bank; diagnostic and quiz attempts pinned to versions; mastery; review schedule |

## API modules (`apps/api/src/modules`)

auth, accounts, billing, companies, screener, market, calc, fundamentals, provenance, research (data/lab/workspace routes), backtest, ai, alerts, analytics, content (help, methodology, PRD learning path), **academy**, exports, notify, ops, admin, ref.

## Data pipeline (`apps/api/src/pipeline`)

Vendor adapter (synthetic today) → raw store with checksum dedupe → quality checks → quarantine → corporate-action adjustment → point-in-time fundamentals → metrics → market breadth/sectors/regimes → briefing with number checks and holds. Runs as a daily cycle from the in-process scheduler.

## Academy

Authoring source (`modules/academy/curriculum.ts`) → `syncCurriculum` (idempotent, versioning) → `acad.*` → API (`modules/academy/routes.ts`) → web (`apps/web/app/app/academy`). Pure engine (`engine.ts`) for selection, grading, readiness, mastery and review. Lab simulations live in `packages/shared/src/learning-sims.ts`.

## Key invariants

- Synthetic data is labelled and refused in production.
- Every displayed financial value carries provenance (source, filing, licence) and a labelled basis.
- Rights fail closed.
- Learner records pin content versions; published content requires a recorded review.
- Users can only reach their own rows (session user id in every query); the admin console needs admin + two-step verification; admin actions are audited.
