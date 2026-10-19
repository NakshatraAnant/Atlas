# Session log

## Session 1 — 18 Oct 2026

- Read all six source documents (PRD ×2 identical by md5, Technical Build Blueprint, Customer Validation Plan, 24-Month Financial Model, HTML prototype).
- Baseline: empty folder; Node 24 only (no Python/WSL/Docker engine). Chose TypeScript modular monolith (ADR-008).
- Built: shared package (formatting, content rules, plans), schema v1 (128 tables), migrations, registry and rights, synthetic vendor, ingestion with §5.3 checks, adjustment, indicators, PIT fundamentals, metrics, market breadth/sectors/regimes, briefing, alerts, daily cycle and scheduler.
- Verified: 30-company history load in ~29 s; daily cycles produce briefings; number-check hold path exercised (found and fixed digits in index names being read as claims).
- Paused at user request (18 Oct 2026). API complete and type-checks; 90 unit/pipeline tests pass; HTTP integration suite (test/api.test.ts) was mid-run after fixing a test rate-limit and TOTP clock issue. Web app (apps/web) scaffolding started: Next config, tsconfig, design-system CSS. Next: confirm api.test.ts results, build web pages, then docs/traceability and release reports.

## Session 2 — 18 Oct 2026 (reconstructed from commits)

- Fixed gateway-call-inside-transaction deadlock; 147 API tests passed (5a493ed). Built the Next.js web app for all core workflows, bulk ingestion, loopback origin check, local hosting script (b14ea9f). Seed in memory, AI eval suite, CI workflow (d88b77f).

## Session 3 — 19 Oct 2026

- Re-baselined: 148 API + 27 shared tests pass.
- Created Supabase project `project-atlas` (ap-south-1, free, $0). Applied migrations 001–003 plus new 004 (deny-by-default RLS) and 005 (advisor hardening). Proved schema parity with a catalog fingerprint.
- Added `DATABASE_SSL`/`DATABASE_CA_CERT`, RLS tests, an opt-in real-PostgreSQL integration suite.
- GitHub blocked (no connector/CLI). Docker blocked (no WSL). Supabase DB password needed for app connection.
- Created the execution ledger (MASTER_EXECUTION_STATE, PHASE_STATUS, DECISION_LOG, TEST_RESULTS, NEXT_ACTIONS, BLOCKERS).
- Academy foundation: migration 006, engine, curriculum (4 courses, 48 diagnostic questions, MARKET DECODER module 1), API, web, labs. Found and fixed a non-idempotent curriculum sync.
- Local verification exposed that the default 120-company seed crashes PGlite (and has likely never completed); defaulted to 40 (ADR-017), reseeded, verified the Academy journey in the browser.
- 217 tests pass, 8 skipped. Web build passes.

## Session 4 — 19 Oct 2026

- Root-caused and fixed the PGlite crash (ADR-018): batched point-in-time loading, a market-window row budget, a disk seed mode above 150 companies. Seeds of 40, 120 and 602 companies complete; catch-up is tested.
- Closed PRD gaps: HOM-03 (worth investigating), BKT-02 (rule builder), ADM-06 (content management).
- Completed the Academy: 4 courses, 29 lessons, 17 labs including a 3D DCF surface, 7 games, 4 capstones and completion records (migration 007).
- Added user CSV price datasets (migration 008).
- Testing: financial golden set (59/59), Playwright e2e on Edge (8/8 plus restart), real PostgreSQL 17 via embedded-postgres (8/8; B-PG-01 resolved).
- AI evaluation: fixed prediction/off-topic/unknown-company policy and a fabricated-zero evidence bug (ADR-019/020). 580 cases pass the gate.
- Fixed a diagnostic retake repetition and an assistant crash in current Edge.
- The audit review found that the earlier "0 production vulnerabilities" was a lockfile artefact. 2 build-time postcss advisories via Next 15 are accepted; the fix is Next 16.
- Launcher first run on an empty `./data`: 120 companies, healthy in 6 min 5 s; checked in the browser.
- Supabase: migrations 001–008 checksums match local; 151 tables in the 10 ATLAS schemas, all RLS-enabled (corrected: an earlier count of 102 used an incomplete schema list).
- Still blocked: GitHub (B-GH-01), app→Supabase password (B-SB-01).

## Session 4, continued — 19 Oct 2026: Next 16 merge and local launch

- Fast-forwarded `feat/atlas-mvp` to `81a8e5c` (Next 16.4.2). The diff was reviewed: only next, its SWC binaries and postcss changed in the lockfile, plus `tsconfig`. Production audit: 0 vulnerabilities.
- Architecture confirmed: direct PostgreSQL via `DATABASE_URL` plus ATLAS's own auth. Supabase Auth and client libraries are not used and were not added. `.env.local` has no `DATABASE_URL`, so the app runs on embedded PGlite.
- Supabase verified read-only: schema, triggers and migrations identical to local; RLS on all 151 tables; no anon/authenticated access; REST rejects ATLAS schemas.
- Launched on http://localhost:3000. Found and fixed a startup stall (catch-up inside the API blocked requests for ~3.3 min): added the missing `pipeline` CLI and run it from the launcher before the API starts.
- Removed the dead `traceability` script (its file never existed). Fixed research-summary wording ("little changed" / "fell") and a doubled separator in note metadata.
- Verified in the browser and over HTTP: auth boundary, write → restart → persistence, live cross-user isolation (404).
