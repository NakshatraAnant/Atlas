# ATLAS changelog

## Session 13, part 3 (11 Nov 2026, evening): Academy 3D and journeys, data audit, sharing, zod 4

### Added
- **3D chart analysis on real stored data** in the Academy:
  - NIFTY 50 holding-period returns (Market Decoder).
  - Brent moving-average parameter surface, in-sample against out-of-sample (Signal Engineer).
  - The WTI futures curve month by month, and US crude stocks by week and year (Commodity Markets Decoder).
- **The Market Architect DCF surface** is rebuilt on the same engine. It renders on demand instead of continuously, and adds axes, a cursor and a table.
- **Shared 3D chart engine** (`chart3d.tsx`): gaps stay open, ridgelines, a zero plane, hover or slider read-outs, a rise-in and an in-/out-of-sample morph, tables and CSV, and provenance for every chart. API: `/v1/academy/charts/:id`.
- **Learner journeys:**
  - A course journey map with modules as stations and lessons as stops (done, up next), feature chips (3D, Lab, Video, Practice) and a progress ring.
  - A lesson progress bar and a completion moment that leads to the next lesson.
  - Progress rings and a staggered entrance on the Academy index. All motion respects reduced-motion settings.
- **Sharing:** `scripts/share.mjs` (start, status, stop) for a Cloudflare quick tunnel. It updates `WEB_ORIGIN` and the message file.
- **Auto-start:** `scripts/autostart/ATLAS.cmd`, to copy into the Windows Startup folder.
- **Data audit:** `reports/ATLAS_DATA_AUDIT.md`.

### Fixed
- **3D runtime:** a negative first frame step could run animations backwards and make values explode. Steps are now clamped to between 0 and 0.1 s. This affected every animated 3D scene.
- **Sharpe ratio of constant returns:** it was about 10^16 from floating-point noise and is now "not defined". Fixed in shared analytics and the Academy charts.
- **Crypto asset analytics** now disclose flagged extreme moves included in drawdown and volatility.
- **zod 3 → 4.6.7** removes advisory GHSA-mrhx-c7xc-m3w5 (`npm audit --omit=dev`: 0 vulnerabilities). Object defaults use `prefault` to keep zod 3 behaviour.
- **Academy index copy** now says three tracks and nine courses. The course page no longer shows the capstone twice.

## Session 13, part 2 (11 Nov 2026): defects, onboarding, charts, ninth video, walkthrough

### Fixed
- **Home "could not be loaded" under load:** `/v1/commodities` reads one windowed query instead of 31 six-year reads; `/v1/macro` one query instead of one per series; `/v1/academy/me` rebuilds the XP ledger only when its sources change; crypto overview volatility reads about 400 days. Parallel Home load 4.9 s → 2.4 s. The web client retries a read once when the proxy (not the API) fails.
- **Ctrl+K with Caps Lock** now opens search.
- **Signed-out navigation** no longer lists demo sections on a real-data install.
- **Favicon** added (removes a console 404 on every page); the signed-out session check answers 200 instead of 401 (`/v1/me?optional=1`).
- **Greeting** says "afternoon" between 12:00 and 17:00.
- `npm run test:web` works, and `npm test` includes the web tests.
- Walkthrough recorder: CSRF token re-read after sign-in, stall guard, plot measured before dragging, palette check before typing, chapter label moved clear of the header.

### Added
- **First-run welcome** on Home: choose markets, follow two series, try search; dismissible, restorable from Settings (`display_prefs.tour_done`).
- **One chart everywhere** on real-data pages: `MiniLine` now renders TsChart (ranges, hover, zoom, CSV, table); the workbench uses TsChart with a shared axis for same-unit series.
- **COMMODITY MARKETS DECODER introduction video** (`cm-intro`, 141.6 s, captions and transcript). The eight existing videos were not re-rendered (checksums unchanged).
- Tests: commodity list known answers, macro list equality, ledger-cache rebuild rules, display-preference validation, session check, web retry rule (5).

## Session 13 (5 Nov 2026): recovery, verification, performance, walkthrough

### Fixed
- **API stalls and proxy 500s:** the crypto scheduler's `lastRuns()` ran a correlated subquery per row of `crypto.ingestion_jobs` every 30 s. Rewritten linearly (12 ms vs 9,573 ms on 8,000 rows). Live page latency max 0.63 s (was up to 33.8 s).
- **Index pages used a stale adjusted series** (NIFTY 50 showed 22 Oct instead of 4 Nov). Indices always use as-traded levels; a lagging adjusted series is never used for shares; the basis and reason are shown.
- **Home commodity moves show units.**
- **Daily macro series** read only the 10-year display window from the database.

### Added
- Session-12 work (search palette, macro explorer, follows, Settings, TsChart, QA crawler, walkthrough recorder), verified and committed. The uncommitted snapshot is preserved on `checkpoint/session12-wip-20261105`.
- Walkthrough scenes for portfolios, walk-forward, notebook and reports, lesson video and notifications.
- Reports in `reports/`: audit, coverage, licensing register, UX, bugs, security, tracker, executive and final release.
- Regression tests: `crypto-scheduler.test.ts` and two stale-series cases in `equity.test.ts`.

### Operations
- Diagnosed the outage: a Windows restart (3 Nov) ended the launcher processes. The runbook now says how to start after a reboot.

## Session 11 (23 Oct 2026): production execution, real-data mode

### Added
- **Shared durable provider gate** (`lib/providerGate.ts`, migration 014): provider state, request log, pause and auto-resume with a single health-check probe; used by FRED, the FRED CSV fallback, EIA, CoinGecko and data.gov.in; EODHD outcomes mirrored.
- **Macro module** (`modules/macro`, `/app/macro`): 18 FRED series with vintages, revisions and year-on-year change.
- **FRED API** for commodity series (vintages); **EIA paging**; natural-gas storage series; WTI futures marked discontinued.
- **CoinGecko monthly pacing** (Demo: 10,000/month).
- **data.gov.in mandi adapter** (needs your key).
- **Freshness model** (`lib/freshness.ts`).
- **Real-data mode:**
  - navigation shows only working modules;
  - real Home, public landing, Status and Data sources pages;
  - Academy tasks on demo pages marked unavailable;
  - demo pipeline not scheduled.
- **Admin → Data providers** (backend-enforced).
- **Supervisor** that restarts a crashed API; fatal-error logging.
- **Docs:** `docs/ATLAS_*.md`.

### Fixed
- Customer responses no longer include quota ledgers, request logs, raw provider errors or budgets.
- The evening equity refresh was blocked by an attempt made earlier the same day, before the session was final (found live).
- The market overview "as of" date was empty when only indices are tracked.
- The FRED CSV fallback was blocked by the gate without an API key.
- Request-log timestamps used the run's start time.
- Commodity rows imported before the FRED API key lacked vintages (now backfilled).
- The public Status page reported only the demo pipeline.


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
