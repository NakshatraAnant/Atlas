# Test results

Newest first. Only results of commands that actually ran.

## 19 Oct 2026, session 4 (end)

| Command | Result |
|---|---|
| `npm test` | **332 passed** (shared 53, API 279), 8 skipped (PostgreSQL suite without `TEST_DATABASE_URL`; it runs below, and the skips are not counted), 0 failed |
| `npm run test:postgres` | 8/8 passed (PostgreSQL 17, node-postgres) |
| `npm run test:e2e` | 8/8 passed (Edge, 44 s) + restart check: the note survived an API restart |
| `npm run eval` | PASSED: 580 cases; golden 100%, red team 100%, causal 100%, numeric accuracy 1, 0 unsupported numbers, 0 content violations (before the session-4 fixes: golden 94.3%, red team 83.2%) |
| `npm run typecheck` | pass (all workspaces) |
| `npm run build -w @atlas/web` | pass |
| `npm run check:secrets` | pass (257 tracked files) |
| `npm audit --omit=dev` | 2 advisories (postcss 8.4.31 pinned by Next 15; build-time only; accepted; the fix is Next 16) |
| `node scripts/atlas.mjs start` on an empty `./data` | pass: 120 companies seeded in memory in 237 s, 6 min 5 s in total; API and web healthy. Browser: sign-in, Home briefing; the assistant refuses a prediction question and reports Tata Motors as not covered |
| Seeds (earlier in session 4) | 40, 120 and 602 companies complete (602: disk mode, 5,820 s, peak RSS 956 MB, DB 1.7 GB) |
| Supabase | migrations 001–008 checksums identical to local; 102 tables, 0 without RLS |

## 19 Oct 2026, session 3 (end)

| Command | Result |
|---|---|
| `npm test` | **217 passed** (shared 36: content rules 20, format 7, learning sims 9; API 181: calc 29, content-policy 38, pipeline 23, api 57, rls 3, security 1, academy-engine 16, academy 14), **8 skipped** (postgres.integration, no TEST_DATABASE_URL), 0 failed |
| `npm run typecheck` | pass (all workspaces) |
| `npm run build -w @atlas/web` | pass; Academy routes /app/academy, /[course], /[course]/check, /lesson/[id], /review |
| `npm run check:secrets` | pass |
| `SYNTHETIC_COMPANIES=120 npm run seed` | **FAILED**: PGlite "memory access out of bounds" after macro_calendar (calc stage) |
| `SYNTHETIC_COMPANIES=40 npm run seed` | pass: 50 companies, 63.0 MB compressed, 155 s |
| Manual UI journey (in-app browser, dev servers) | pass: sign-in → Academy → MARKET DECODER → readiness check (4/5, "ready", reasons shown) → enrol → lesson md-l2 order-book lab (250 @ ₹101.60, spread ₹3.00) → quiz 3/3 → "Objective mastered, next review 20 Oct" |
| Supabase fingerprint after 006 | local == hosted: cf903493041bedc1db60c4847c37d52e / 2438 lines |


## 19 Oct 2026, session 3

Command: `npm test` (root) on Windows 11, Node 24.16.0.

| Suite | Result |
|---|---|
| packages/shared (content rules, formatting) | 27 passed |
| apps/api calc.test.ts | 29 passed |
| apps/api content-policy.test.ts | 38 passed |
| apps/api pipeline.test.ts | 23 passed |
| apps/api api.test.ts (HTTP integration) | 57 passed |
| apps/api rls.test.ts (new) | 3 passed |
| apps/api security.test.ts | 1 passed |
| apps/api postgres.integration.test.ts (new) | 8 **skipped**: no `TEST_DATABASE_URL` (B-PG-01) |
| **Total** | **178 passed, 8 skipped, 0 failed** |

Other checks:
- `tsc --noEmit` (api): pass.
- Schema fingerprint: local `81fdcafc59bd53cc0ef7683cd803c119` / 2241 lines == Supabase `81fdcafc59bd53cc0ef7683cd803c119` / 2241 lines.
- Supabase security advisor after migration 005: only INFO "RLS enabled, no policy" (intended deny-by-default). Two WARNs fixed by 005 (verified: `pg_trgm` now in `extensions`, `anon` has no USAGE on `app` and no SELECT on `ref.companies`).
- Not run this session: web typecheck/build, local startup script, `npm audit`.

## 18 Oct 2026, session 2 (from commit messages; not re-verified)

- "all 147 API tests pass" (commit 5a493ed).
