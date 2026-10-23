# ATLAS resume checkpoint

Updated: 2026-10-23, session 10 (mandate: "Master Indian equity data integration & zero-dummy-data execution").

## Session 10 state
- Migrations 001–012 applied to ./data (backup before 012: `backups/atlas-backup-2026-10-23_09-26-22.tar.gz`).
- Indian equity pipeline complete and tested with recorded response shapes; **live acceptance test blocked until you configure a rotated EODHD key in `.env.local`** (runbook §10). The key pasted in conversation was treated as exposed and never used or stored.
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
