# ATLAS changelog

## Session 9 (23 Oct 2026): research platform, Indian equity data path, progress, reliability

Commits on `feat/atlas-mvp`: `77abb9c`, `d79b6f4` and the session-9 completion commit (see `git log`).

### Added
- **Migration 011** (`equity`, `research` schemas; learning-event kinds). RLS deny-by-default; included in the schema fingerprint and RLS tests.
- **Indian equity reference data** (`apps/api/src/modules/equity`): EODHD and Alpha Vantage adapters with typed error categories (auth, entitlement, rate limit, network, malformed), validated idempotent import with dry run, raw and adjusted series, corrections kept in `price_revisions`, quarantine, provider health, daily incremental refresh; **Indian equities** page (`/app/equities`).
- **Research hub** (`/app/research-hub`) and API (`apps/api/src/modules/research`): workbench, screener and factor ranks, portfolios with risk/attribution and stress scenarios, rolling-correlation regimes, walk-forward backtests, event studies, regimes, data integrity with cross-source reconciliation and confirmed findings, discovery rules, notebook (notes, hypotheses with frozen thesis, journal) with Markdown export, report builder with Markdown export, alerts with de-duplication, cooldown and in-app notifications, saved views.
- **Shared analytics** (`packages/shared/src/research-analytics.ts`): calendar alignment, Sharpe/Sortino, portfolios, covariance stress, walk-forward, correlation shifts, discovery helpers.
- **Progress** (`learn-engine-2`): research XP from `research.activity` (3 per kind per day), ranks gated on mastery and practices, 11 research achievements, research missions, skill map; progress page sections.
- **Operations**: `node scripts/atlas.mjs verify-backup` (restore drill into a temporary folder + integrity check + API readiness on port 4100); `npm run test:all` (unit + real PostgreSQL).
- **Docs**: `docs/equity/SOURCE_CAPABILITY_MATRIX.md`, `docs/research/METHODS.md`, `docs/GAMIFICATION.md`, `docs/DATABASE.md`, this changelog, the master execution status and resume checkpoint.

### Fixed
- Video e2e test waited a fixed 2 s after `play()`; now waits for observed progress (bounded, with diagnostics), seeks near the end and waits for `ended`. Passed in two full runs under concurrent load.
- Instrument resolver could pick a stopped (stale) crypto series as default; now prefers current series (regression test).
- Notebook source links accepted `javascript:` URLs; now http(s) only (test).

### Tests added
- `apps/api/test/equity.test.ts` (13), `apps/api/test/research.test.ts` (25), `packages/shared/test/research-analytics.test.ts` (14), PostgreSQL concurrency tests (4), e2e `research-hub.spec.ts` (5).
