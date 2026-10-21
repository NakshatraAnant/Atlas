# Master execution state

**Read this first when resuming.** Then `git status`, `git log --oneline -10`, `npm install`, `npm test`.
Do not trust any "passed" claim below until the tests rerun on your machine.

_Last updated: 22 Oct 2026, session 7 (recovery). Latest audit: `RECOVERY_2026-10-22.md`._

## Current position

| Item | State |
|---|---|
| Current phase | Phases 0–9 done for the local, synthetic-data build; see `PHASE_STATUS.md` and `RELEASE_READINESS.md` |
| Next task | See `NEXT_ACTIONS.md` |
| Git branch | `feat/atlas-mvp` (local only; no remote, B-GH-01) |
| Last verified commit | see `git log -1` (session 4 commits: d56bd1d → the commit that adds this file) |
| Local startup | Verified in session 4: `node scripts/atlas.mjs start` on an empty `./data` seeds 120 companies and starts API + web (see TEST_RESULTS.md) |
| Supabase | `project-atlas`, ref `wyknwjdcexisrempmvjr`, `ap-south-1`, free plan. Migrations 001–008 applied; fingerprint `99a30a294b137941ea3956be016bbc16` (2547 lines) identical to local. Every table RLS-enabled, no permissive policies. No app data yet: the app connection needs the DB password (B-SB-01). |
| GitHub | Not created (B-GH-01). Exact commands are in `BLOCKERS.md`. |

## Built in session 4

| Area | Files |
|---|---|
| Root fix for the embedded-engine crash (ADR-018) | `modules/fundamentals/pit.ts` (batched PIT), `pipeline/calc/{daily,metrics,market}.ts`, `cli/seed.ts` (disk mode), `db/db.ts`, `pipeline/context.ts` (trace) |
| Daily catch-up | `test/catchup.test.ts` |
| PRD gaps | HOM-03 `modules/market/investigate.ts`; BKT-02 rule builder `modules/backtest/rules.ts` + `components/rule-builder.tsx`; ADM-06 CMS `modules/content/cms.ts` |
| Academy completion | four courses (29 lessons, 87 quiz questions, 17 labs incl. 3D DCF surface), 7 games, 4 capstones, completion records; migration 007 |
| User datasets | CSV price upload: `modules/datasets/*`, migration 008, `/app/research/datasets` |
| Testing | financial golden set (59), Playwright e2e (8 + restart), real-PostgreSQL suite via embedded-postgres, AI policy regressions |
| AI assistant | null (never zero) evidence for missing values (ADR-019); prediction / off-topic / unknown-company policy (ADR-020) |
| Security | fastify 5.12.5; secret scan; Next 16.4.2; `npm audit --omit=dev` 0 advisories |
| Docs | README, KNOWN_LIMITATIONS, TESTING_AND_ACCEPTANCE, RUNBOOK, REQUIREMENT_TRACEABILITY (per-ID audit), ACADEMY_CURRICULUM, RELEASE_READINESS |

## Database migrations

| Migration | Local | Supabase |
|---|---|---|
| 001–006 | applied | applied |
| 007_academy_capstones_games | applied | applied |
| 008_user_datasets | applied | applied |
| 009_learning_engine | applied | applied (20 Oct 2026; fingerprint 6e8838fb… / 2580 lines on both) |

## Defects found and fixed in session 4

- PGlite crash at 120+ companies (unbounded PIT load; in-memory seed hitting the 4 GB WASM ceiling; unbounded market window).
- Sector aggregate float-order nondeterminism (≤ 1e-9).
- Diagnostic retake could repeat a just-seen question.
- Completion endpoint omitted the record; Build-the-Business game solvable at defaults.
- Assistant page crashed in current Edge (`useEffect` returning a Promise).
- Assistant evidence recorded `0` for missing metric values; prediction questions with company names were answered.
- Fastify/cookie typing regression. Corrected an earlier audit claim (postcss under Next was missing from the lockfile, not fixed).

## Environment variables (names only; see `.env.example`)

`NODE_ENV, DATABASE_URL, DATABASE_SSL, DATABASE_CA_CERT, PGLITE_DIR, API_PORT, WEB_PORT, WEB_ORIGIN, APP_SECRET, OBJECT_STORE_DIR, EMAIL_TRANSPORT, AI_PROVIDER, ANTHROPIC_API_KEY, AI_MODEL, AI_COST_BUDGET_INR_PER_ANSWER, PAYMENT_GATEWAY, RAZORPAY_*, SANDBOX_WEBHOOK_SECRET, GST_RATE, SUPPLIER_STATE_CODE, SUPPLIER_GSTIN, GOOGLE_CLIENT_*, ALLOW_SYNTHETIC_DATA, ACADEMY_SHOW_DRAFTS, LOG_LEVEL, TRUST_PROXY, RATE_LIMIT_MULTIPLIER, SYNTHETIC_COMPANIES, ATLAS_SEED_MODE, ATLAS_PIT_BATCH_COMPANIES, ATLAS_QUERY_ROW_BUDGET, ATLAS_PIPELINE_TRACE, ATLAS_BACKGROUND_JOBS, TEST_DATABASE_URL (tests only)`

## Outstanding security issues

- No independent pen test (B-SEC-01). Per-route rate limits are not directly tested. Dev-only tooling advisories (vitest/vite/esbuild chain) remain; they are not shipped.

## Outstanding data-rights issues

- No licensed data; the provider scorecard is a template with no verified entries (`docs/DATA_RIGHTS_AND_PROVIDERS.md`).
- Academy content is AI-drafted and unreviewed. It is shown as draft locally, and production refuses to serve it.
