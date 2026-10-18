# Master execution state

**Read this first when resuming.** Then `git status`, `git log --oneline -10`, `npm install`, `npm test`.
Do not trust any "passed" claim below until the tests rerun on your machine.

_Last updated: 19 Oct 2026, end of session 3._

## Current position

| Item | State |
|---|---|
| Current phase | Phase 5 (Academy foundation) **done for module 1**; next: fix the embedded-DB memory ceiling, then Phase 6 |
| Next task | See `NEXT_ACTIONS.md` item 1 |
| Git branch | `feat/atlas-mvp` (local only; no remote, B-GH-01) |
| Last verified commit | the commit that adds this file (see `git log -1`); previous: `8e80570` |
| Local startup | **Verified 19 Oct 2026** with a fresh 40-company seed: API + web dev servers, sign-in, Academy catalogue → course → readiness check → result → enrol → lesson with order-book lab → quiz → mastery. Background-job catch-up at 40 companies not yet exercised. |
| Supabase | `project-atlas`, ref `wyknwjdcexisrempmvjr`, `ap-south-1`, free plan, ACTIVE_HEALTHY. Migrations 001–006 applied; fingerprint `cf903493041bedc1db60c4847c37d52e` (2438 lines) identical to local. No data yet: app connection needs the DB password (B-SB-01). |
| GitHub | Not created (B-GH-01). |

## Verified this session (automated tests that ran)

- `npm test`: **217 passed** (36 shared + 181 API), **8 skipped** (real-PostgreSQL suite, B-PG-01), 0 failed.
- `npm run typecheck` (all workspaces): pass. `npm run build -w @atlas/web`: pass (5 Academy routes).
- `npm run check:secrets`: pass.
- Supabase security advisor: INFO-only (intended deny-by-default RLS).

## Built this session

| Area | Files |
|---|---|
| Supabase + deny-by-default RLS | migrations 004, 005; `test/rls.test.ts`; `src/db/fingerprint.sql`; `scripts/schema-fingerprint.mts` |
| DB TLS config | `DATABASE_SSL`, `DATABASE_CA_CERT` in `config.ts`, `db.ts` |
| Real-PostgreSQL test suite (opt-in) | `test/postgres.integration.test.ts` |
| Academy schema | migration 006 (`acad` schema) |
| Academy engine, curriculum, sync, API | `src/modules/academy/{engine,curriculum,service,routes}.ts` |
| Academy tests | `test/academy-engine.test.ts` (16), `test/academy.test.ts` (14) |
| Lab simulations | `packages/shared/src/learning-sims.ts` + tests (9) |
| Academy web | `apps/web/app/app/academy/**`, `components/academy.tsx`, styles in `globals.css` |
| Docs | `docs/{ARCHITECTURE,SECURITY_AND_PRIVACY,DATA_RIGHTS_AND_PROVIDERS,ACADEMY_CURRICULUM,TESTING_AND_ACCEPTANCE,RUNBOOK,KNOWN_LIMITATIONS,REQUIREMENT_TRACEABILITY,DECISIONS,PROJECT_STATUS}.md`, execution ledger |

## Database migrations

| Migration | Local | Supabase |
|---|---|---|
| 001_schema, 002_reference_extras, 003_billing_notices | applied | applied |
| 004_rls_deny_by_default | applied | applied |
| 005_supabase_hardening | applied | applied |
| 006_academy | applied | applied |

## Defects found this session

| Defect | Status |
|---|---|
| Curriculum sync not idempotent (jsonb key order) | fixed, tested |
| Full 120-company seed crashes PGlite (WASM memory) in the calc stage; daily catch-up crashed an older 268 MB DB | mitigated (default 40, ADR-017); root fix open |
| Earlier local DB had no users (its seed had crashed before user creation) | moved to `backups/api-data-before-session3-2026-10-19`, reseeded |

## Environment variables (names only; see `.env.example`)

`NODE_ENV, DATABASE_URL, DATABASE_SSL, DATABASE_CA_CERT, PGLITE_DIR, API_PORT, WEB_ORIGIN, APP_SECRET, OBJECT_STORE_DIR, EMAIL_TRANSPORT, AI_PROVIDER, ANTHROPIC_API_KEY, AI_MODEL, AI_COST_BUDGET_INR_PER_ANSWER, PAYMENT_GATEWAY, RAZORPAY_*, SANDBOX_WEBHOOK_SECRET, GST_RATE, SUPPLIER_STATE_CODE, SUPPLIER_GSTIN, GOOGLE_CLIENT_*, ALLOW_SYNTHETIC_DATA, ACADEMY_SHOW_DRAFTS, LOG_LEVEL, TRUST_PROXY, RATE_LIMIT_MULTIPLIER, SYNTHETIC_COMPANIES, ATLAS_BACKGROUND_JOBS, TEST_DATABASE_URL (tests only)`

## Outstanding security issues

- node-postgres path untested (B-PG-01). Per-route rate limits not directly tested. No pen test (B-SEC-01).

## Outstanding data-rights issues

- No licensed data; provider scorecard is a template with no verified entries (`docs/DATA_RIGHTS_AND_PROVIDERS.md`).
- Academy content is AI-drafted and unreviewed (shown as draft locally; production refuses to serve it).
