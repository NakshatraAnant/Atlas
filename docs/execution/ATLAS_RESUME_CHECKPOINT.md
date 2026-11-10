# ATLAS resume checkpoint

Updated: 2026-11-11, session 13. The earlier session notes below are kept for history.

## Session 13 state (5 Nov 2026) — read this first

- **Branch** `feat/atlas-mvp`. Session-13 commits begin at `63520ea` (session-12 work verified and committed); performance fix `1243f25`. The session-12 uncommitted snapshot is preserved on branch `checkpoint/session12-wip-20261105` (75e69a6).
- **Database** `./data/pglite`. Migrations 001–015 are applied (015 `series_follows` applied today). Backup before today's changes: `backups/atlas-backup-2026-11-05_07-08-47.tar.gz` (restore drill passed).
- **Outage cause:** a Windows restart on 3 Nov ended the launcher's processes. There is no OS service; run `node scripts/atlas.mjs start` after a reboot.
- **Reports** for this session are in `reports/` (tracker: `reports/ATLAS_MASTER_EXECUTION_TRACKER.md`).
- **Walkthrough:** `scripts/walkthrough/record.mts` writes `artifacts/ATLAS_COMPLETE_PRODUCT_WALKTHROUGH.mp4` (git-ignored); notes in `artifacts/ATLAS_RECORDING_NOTES.md`. Take 1 (stalled macro scene) is kept at `.atlas/walkthrough-take1-stalled.mp4` for comparison.
- **Session 13 complete (11 Nov 2026).** All work is committed on `feat/atlas-mvp`. Final walkthrough: take 5, verified (`artifacts/ATLAS_RECORDING_NOTES.md`). Tests on 11 Nov: 687 passed (`reports/ATLAS_FINAL_RELEASE_REPORT.md`).
- **Next exact actions:**
  1. Your decisions on data licences (licensing register).
  2. The zod 4 migration, as its own change.
  3. Optionally, a Windows logon task to start ATLAS after a reboot.
  4. Server PostgreSQL before any multi-user use.
- **Earlier next actions (5 Nov, done on 11 Nov except licences):** (1) a first-run onboarding tour (initiative 23); (2) TsChart for the remaining charts (26); (3) decide on paid data licences (see the licensing register); (4) optionally, a Windows logon task to start ATLAS.

## Session 11 state (production mandate)
- Migrations 001–014 applied. Real-data mode on (`ALLOW_SYNTHETIC_DATA=false` in `.env.local`).
- Keys configured: EODHD, FRED, EIA, CoinGecko Demo. Not configured: data.gov.in (mandi), Alpha Vantage.
- Backup before migration 014: `backups/atlas-backup-2026-10-23_12-55-45.tar.gz`.
- Documents: `docs/ATLAS_*` (audit, data source register, quality and freshness, quota and recovery, security and secrets, customer feature readiness, operations runbook).

## Session 10 state
- Migrations 001–012 applied to ./data (backup before 012: `backups/atlas-backup-2026-10-23_09-26-22.tar.gz`).
- Migrations 001–013 applied. A rotated EODHD key is configured in `.env.local` (never committed).
- **Live:** Indian indices (NIFTY 50, SENSEX, NIFTY BANK) and 25 FRED commodity series.
- **Free plan:** NSE/BSE shares answer 404.
- **Commodities:** `docs/commodity/COMMODITY_DATA.md`.
- **Optional next steps:** an EIA key (term structure, inventories); a paid EODHD plan for Indian shares.
- Runbook: `docs/equity/INDIAN_EQUITY_DATA_RUNBOOK.md`. Ledger: `ATLAS_MASTER_EXECUTION_STATUS.md` (session 10 table).

## Where things stand
- Branch `feat/atlas-mvp`. Session-9 start commit `206a354`; recovery branch `backup/pre-session9-2026-10-23`.
- Database: embedded PGlite in `./data/pglite` (git-ignored). Backup before session 9: `backups/atlas-backup-2026-10-22_20-56-27.tar.gz` (139.0 MB).
- Migrations applied locally: 001–010.
- Ledger: `docs/execution/ATLAS_MASTER_EXECUTION_STATUS.md`. Changelog: `docs/execution/ATLAS_CHANGELOG.md`.

## Resume procedure
1. `git status` and `git log --oneline -10` on `feat/atlas-mvp`.
2. Read the ledger: take the first task whose status is not `verified` or `blocked`.
3. `npm test` (unit/integration) and `npm run test:postgres` (real PostgreSQL 17, embedded server) before trusting earlier results.
4. Start/stop: `node scripts/atlas.mjs start` / `stop` (http://localhost:3000, API 127.0.0.1:4000).

## Next action
See the ledger's "Next actions" section.

## Session 9 progress (stopped at usage limit, 2026-10-23)
Done (typechecks; not yet covered by API tests or UI):
- Baseline: `npm run test:postgres` 8/8 pass on PostgreSQL 17 (migrations 001–010, schema parity).
- Video e2e fix: `e2e/helpers.ts` `verifyPlayback` waits for observed progress, seeks, plays to the end (bounded, diagnostic). Not yet re-run under full-suite load.
- Migration `011_equity_reference_and_research.sql` (equity + research schemas, learning-event kinds). Applied on in-memory PGlite only; NOT yet applied to ./data (applies on next start).
- Shared: `research-analytics.ts` (alignment, Sharpe/Sortino, portfolio, stress, walk-forward, discovery) — 106/106 shared tests pass.
- API: `modules/equity/*` (EODHD + Alpha Vantage adapters, validated idempotent import with revisions/quarantine, status, admin import, daily refresh), `modules/research/*` (instrument resolver, metrics, workbench, screener, factors, rolling correlation, walk-forward, event study, regimes, integrity + reconciliation, discovery, portfolios/risk/scenario, notebook/hypotheses/journal + export, reports + markdown, alerts + evaluator, activity ledger), wired in app/server.
- Fixtures: `apps/api/test/fixtures/equity` (real EODHD/Alpha Vantage demo responses and entitlement errors).

Next actions, in order:
1. `npm test` and `npm run test:postgres` (rls/fingerprint include equity+research); write `apps/api/test/research.test.ts` and `equity.test.ts` (parsers on fixtures, import idempotency/revisions/dry run, privacy 404s, alert dedupe/cooldown, activity once-only, hypothesis freeze).
2. Learning engine: derive research XP kinds from `research.activity`, level names, research achievements/missions, skill map.
3. Web: Research hub pages (workbench, screener, portfolios, notebook, reports, alerts, discovery), Indian equities page, Progress additions; nav.
4. Docs: `docs/equity/SOURCE_CAPABILITY_MATRIX.md`, ledger, changelog, test results; full e2e ×2 under load; backup/restore drill into a separate directory; start app and verify.

## Session 9 complete (23 Oct 2026)
All phases implemented and verified except live Indian equity import (needs the owner's provider key) and Feature 18 (needs licensed fundamentals). Migrations 001–011 applied to ./data. ATLAS left running at http://localhost:3000 (API 127.0.0.1:4000). Status and next actions: docs/execution/ATLAS_MASTER_EXECUTION_STATUS.md.
