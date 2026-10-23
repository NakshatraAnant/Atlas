# ATLAS changelog

## Session 10, continued (23 Oct 2026): live EODHD, commodities, Academy commodities track

### Added
- **Live EODHD integration** with your rotated key (`.env.local`, canonical name `EODHD_API_TOKEN`): Indian indices NIFTY 50, SENSEX and NIFTY BANK.
- **Commodities** (migration 013, `modules/commodity`, `/app/commodities`):
  - 25 FRED series (EIA daily spot, IMF monthly);
  - optional EIA inventories and WTI futures by contract position;
  - spreads and cracks, seasonality, term structure, correlations, provenance;
  - daily series in the Research hub.
- **Shared** `commodity-analytics.ts` (frequency-aware returns, seasonality, spreads, term structure, inventory z-score).
- **Academy**: COMMODITY MARKETS DECODER (Track 3 · Commodities); skill area "Commodity markets".
- **E2E**: `e2e/commodities.spec.ts`.

### Fixed
- Same-day provisional EODHD rows (served 15 minutes after the close) are no longer stored; stored ones are withdrawn with history kept.
- EODHD holiday filler rows (flat, zero volume) are quarantined, not stored.
- Indices are no longer labelled as total-return series.
- Validation no longer spends calls on corporate actions for indices.
- Percentage returns across zero or negative prices are refused in the shared alignment helper.
- Commodity imports use set-based inserts (one-minute imports were found on the live run).
- Interrupted jobs are marked failed at start-up.
- Network error messages are redacted.
- An empty commodity series now states its source (found by e2e).

## Session 10 (23 Oct 2026): Indian equity data on a free plan, zero-dummy-data audit

### Added
- **Migration 012**:
  - quota ledger (`equity.quota_days`) and request log (`equity.provider_requests`);
  - tracked universe with priorities and retry times;
  - symbol-mapping verification with effective dates;
  - source-labelled exchange calendar, provider corporate actions, refresh runs;
  - private `research.user_fundamentals`.
- **Quota-aware EODHD pipeline** (`modules/equity/quota.ts`, `operations.ts`):
  - purpose budgets 12/2/2/2/2, each call charged before it is sent by one atomic `UPDATE`;
  - free usage check (`/api/user`) reconciled with ATLAS's own count;
  - 402 stops the day, a 401 circuit lasts until restart, 403/404 wait 7 days, network errors 6 hours, and nothing is retried in a loop;
  - pacing for the 20-requests-per-minute limit;
  - refresh at 08:00/20:30 IST with expected-session logic;
  - holiday calendar via the validation budget, plus no-session days inferred from stored data;
  - splits/dividends with a split-consistency check.
- **Config**: `EODHD_API_KEY` alias, `EODHD_DAILY_LIMIT`, `EODHD_QUOTA_BUDGETS` (validated), `EQUITY_REFRESH`.
- **API**:
  - `/v1/equity/market`, `/v1/equity/explorer` (screening filters that count exclusions), richer `/v1/equity/instruments/:ex/:sym` (metrics, indicators, relative strength, gaps, risk, missing sessions, revisions, split checks), `/v1/equity/calendar`;
  - administration of the universe, refresh, usage check and calendar;
  - `/v1/research/fundamentals*` (CSV preview/import/ratios/delete).
- **Shared**:
  - `technical-indicators.ts` (EMA, RSI, MACD, momentum, rolling returns, relative strength, gaps, 52-week range);
  - session-calendar mode in `backtestSma`/`walkForward`, so the Research hub walk-forward now accepts equities.
- **Web**:
  - Indian equities page with Market overview / Explorer and screen / Data operations, and a quota strip;
  - instrument research page `/app/equities/[exchange]/[symbol]`;
  - statement import page `/app/equities/statements`.
- **Demo mode made explicit**:
  - `ALLOW_SYNTHETIC_DATA=false` now runs (`NoVendor`) and demo-only API sections answer 403;
  - demo pages carry a persistent banner and "(demo)" in navigation;
  - `/v1/me.demo_mode`.
- **Docs**: `docs/equity/INDIAN_EQUITY_DATA_RUNBOOK.md`.

### Fixed
- Account erasure did not delete Research hub data, crypto watchlist/notes or uploaded price files (sessions 8–9 tables): now erased (test).
- Provider-reported usage could have been under-counted after a usage check (ATLAS calls made after the report were not added): the ledger now records ATLAS's own count at report time (found by a test).
- An incremental import with no newer rows was a failure; it is now a normal "no new rows" result.
- `ALLOW_SYNTHETIC_DATA=` (empty, as in a copied `.env.example`) would have failed config validation; the real `.env.example` is now loaded in a test.

### Tests added
- `apps/api/test/equity-ops.test.ts` (25), `research-data.test.ts` (7), `packages/shared/test/technical-indicators.test.ts` (12), config (1), updated walk-forward test; e2e: Indian equities tabs, statement import, demo banner.

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
