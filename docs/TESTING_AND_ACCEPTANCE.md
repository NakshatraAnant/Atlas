# Testing and acceptance

## Commands

```bash
npm test                         # shared + API: unit, pipeline, policy, RLS, HTTP integration, Academy
npm run typecheck                # all workspaces
npm run build -w @atlas/web      # web production build
npm run check:secrets            # secret scan of tracked files
npm run test:postgres           # real-PostgreSQL 17 suite (node-postgres driver) on a throwaway local server
npm run test:e2e                # Playwright on installed Microsoft Edge: 8 journeys + restart persistence
npm run eval                    # AI evaluation (580 cases) against the dev database
TEST_DATABASE_URL=postgres://… npm test -w @atlas/api   # real-PostgreSQL suite against your own empty DB
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
| AI evaluation | `npm run eval` | golden (300), red-team (250) and causal (30) suites; release gate 95% / 100% / 100%, numeric accuracy ≥ 98%, zero unsupported numbers |
| AI policy regressions | `ai-policy-regression.test.ts` | prediction/advice wording, off-topic, unknown companies, no fabricated value for missing data |
| Financial golden set | `golden.test.ts`, `golden/cases.ts` | 59 hand-calculated cases with tolerance and severity |
| Pipeline scale and catch-up | `pipeline-batching.test.ts`, `catchup.test.ts` | batched loading is hash-identical to unbatched; missed days catch up in order without duplicates |
| Research features | `investigate.test.ts`, `rule-builder.test.ts`, `cms.test.ts`, `datasets.test.ts` | worth-investigating, custom rule backtests, content publishing, CSV upload validation and isolation |
| Academy content and extras | `academy-content.test.ts`, `academy-extra.test.ts` | lesson structure, answer keys, objectives taught and assessed, games solvable, capstones, completion records |
| Browser e2e | `e2e/*.spec.ts` | research journey (briefing, company, evidence, watchlist, notes, screener, assistant refusal, rule-builder backtest, API-failure state) and Academy journey (check, enrol, lab, quiz, game, 3D lab, capstone) |

Results of each run are recorded in `docs/execution/TEST_RESULTS.md`. A suite that did not run is never described as passing.

## Not yet in place

- Automated accessibility checks (axe) and contrast verification.
- Load tests for backtests and the daily cycle at production scale.
- e2e on browsers other than Edge; local startup test in CI.
- AI evaluation with a live language model (only the deterministic composer has been evaluated).
