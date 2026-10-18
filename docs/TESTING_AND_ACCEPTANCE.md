# Testing and acceptance

## Commands

```bash
npm test                         # shared + API: unit, pipeline, policy, RLS, HTTP integration, Academy
npm run typecheck                # all workspaces
npm run build -w @atlas/web      # web production build
npm run check:secrets            # secret scan of tracked files
TEST_DATABASE_URL=postgres://… npm test -w @atlas/api   # adds the real-PostgreSQL suite (empty DB only)
npx tsx scripts/schema-fingerprint.mts                  # schema fingerprint to compare with Supabase
```

## Layers

| Layer | Files | What it proves |
|---|---|---|
| Unit: formatting, content rules, learning sims | `packages/shared/test/*` | number formatting, advice-language policy, order matching and returns arithmetic used in lessons |
| Unit: calculations | `apps/api/test/calc.test.ts` | ratios, indicators, edge cases |
| Unit: Academy engine | `academy-engine.test.ts` | selection, grading, readiness rules and boundaries, retake limit, mastery, Leitner review, no answer leakage |
| Pipeline | `pipeline.test.ts` | idempotent ingestion, quality checks, PIT fundamentals, restatements, alerts |
| Content policy | `content-policy.test.ts` | no recommendations or advice language in generated text |
| RLS | `rls.test.ts` | RLS on every table in every ATLAS schema; non-owner role reads 0 rows and cannot insert |
| HTTP integration | `api.test.ts` | user journeys for accounts, isolation, research, market, screener, AI, lab, workspace, billing, transparency |
| Academy integration | `academy.test.ts` | catalogue, diagnostic journey, isolation, retake limit, low-readiness override, lessons, quiz, mastery vs completion, review, audited publication, version immutability |
| Real PostgreSQL (opt-in) | `postgres.integration.test.ts` | migrations, schema parity with PGlite, type parity, RLS, rollback, full seed via node-postgres |
| AI evaluation | `npm run eval` | golden, red-team and causal suites for the assistant |

Results of each run are recorded in `docs/execution/TEST_RESULTS.md`. A suite that did not run is never described as passing.

## Not yet in place

- Browser end-to-end tests (Playwright).
- Automated accessibility checks (axe) and contrast verification.
- Financial golden-set report (case count, tolerance, severity) as a separate artefact.
- Load tests for backtests and the daily cycle.
- Local startup test in CI.
