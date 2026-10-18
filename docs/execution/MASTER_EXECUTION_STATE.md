# Master execution state

**Read this first when resuming.** Then `git status`, `git log --oneline -10`, `npm install`, `npm test`.
Do not trust any "passed" claim below until the tests rerun on your machine.

_Last updated: 19 Oct 2026, session 3._

## Current position

| Item | State |
|---|---|
| Current phase | Phase 1 (GitHub + Supabase) done as far as tools allow → starting Phase 5 (Academy foundation) |
| Current task | A-001 Academy schema + placement diagnostics (see `NEXT_ACTIONS.md`) |
| Git branch | `feat/atlas-mvp` (local only; no remote, see BLOCKERS B-GH-01) |
| Last verified commit | see `git log -1`; recorded in `TEST_RESULTS.md` per run |
| Local startup | Verified in session 2 (`node scripts/atlas.mjs start` → http://localhost:3000). Not re-run in session 3. |
| Supabase | Project `project-atlas`, ref `wyknwjdcexisrempmvjr`, region `ap-south-1` (Mumbai), free plan, status ACTIVE_HEALTHY. Migrations 001–005 applied; schema fingerprint identical to local. **No data seeded yet**: app cannot connect until DB password is supplied (B-SB-01). |
| GitHub | Not created. No GitHub connector or `gh` CLI in the environment (B-GH-01). |

## What exists and is verified (by automated tests that ran in session 3)

| Area | Evidence |
|---|---|
| Accounts: sign-up, consent, verify, lockout, reset, TOTP, export/delete | `apps/api/test/api.test.ts` "accounts and authentication" |
| Cross-user isolation (notes, watchlists, screens, backtests, conversations → 404) | api.test.ts "user isolation" |
| Admin requires admin role + 2-step verification | api.test.ts "user isolation" |
| Company research with provenance on every value, plan limits | api.test.ts "company research and evidence" |
| Market intelligence, briefings with number checks | api.test.ts "market intelligence", pipeline.test.ts |
| Screener, AI assistant (deterministic, claim checker, policy), Quant Lab (reproducible hash, cost watermark, PDF) | api.test.ts |
| Watchlists, notes, workspaces, alerts; billing sandbox with GST invoices | api.test.ts |
| Ratio library, indicators | `calc.test.ts` (29) |
| Ingestion integrity, PIT fundamentals, corporate actions | `pipeline.test.ts` (23) |
| Content/advice policy | `content-policy.test.ts` (38) |
| DB deny-by-default RLS on every table; non-owner role reads 0 rows, cannot insert | `rls.test.ts` (3) |
| Hosted Supabase schema == local schema | fingerprint `81fdcafc59bd53cc0ef7683cd803c119` (2241 catalog lines) on both, 19 Oct 2026 |

## Database migrations

| Migration | Local (PGlite) | Supabase | Notes |
|---|---|---|---|
| 001_schema.sql | applied | applied | 128+ tables in schemas ref, market, fund, disc, calc, bt, ai, app, ops |
| 002_reference_extras.sql | applied | applied | |
| 003_billing_notices.sql | applied | applied | |
| 004_rls_deny_by_default.sql | applied | applied | RLS on all tables; revoke anon/authenticated |
| 005_supabase_hardening.sql | applied | applied | trigger search_path; pg_trgm → `extensions` on Supabase |

Supabase migrations were applied via the Supabase MCP connector and recorded in `ops.schema_migrations` with the same SHA-256 checksums the app's migrator computes, so `npm run migrate` against Supabase is a no-op.

## Environment variables (names only; see `.env.example`)

`NODE_ENV, DATABASE_URL, DATABASE_SSL, DATABASE_CA_CERT, PGLITE_DIR, API_PORT, WEB_ORIGIN, APP_SECRET, OBJECT_STORE_DIR, EMAIL_TRANSPORT, AI_PROVIDER, ANTHROPIC_API_KEY, AI_MODEL, AI_COST_BUDGET_INR_PER_ANSWER, PAYMENT_GATEWAY, RAZORPAY_*, SANDBOX_WEBHOOK_SECRET, GST_RATE, SUPPLIER_STATE_CODE, SUPPLIER_GSTIN, GOOGLE_CLIENT_*, ALLOW_SYNTHETIC_DATA, LOG_LEVEL, TRUST_PROXY, RATE_LIMIT_MULTIPLIER, TEST_DATABASE_URL (tests only)`

## Outstanding security issues

- Real-PostgreSQL driver path (node-postgres) has a test suite but it has not run (B-PG-01).
- Supabase performance advisor: 129 FKs without covering index (INFO). Add indexes for actual query patterns, not blanket.
- External pen test not done (B-SEC-01, from session 1).

## Outstanding data-rights issues

- No licensed market data. All data is synthetic and labelled (`is_synthetic`, `XXS` ISIN prefix); production refuses synthetic data.
- Provider scorecard not yet written (`docs/DATA_RIGHTS_AND_PROVIDERS.md` is a stub to complete).

## Next exact actions

See `NEXT_ACTIONS.md`.
