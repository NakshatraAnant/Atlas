# Test results

Newest first. Only results of commands that actually ran.

## 19 Oct 2026, after merging Next 16 into `feat/atlas-mvp` (fast-forward to 81a8e5c) and launch fixes

| Command / check | Result |
|---|---|
| `npm ci` | pass; next 16.4.2, react 19.0.0, postcss under next 8.5.23 |
| `npm audit --omit=dev` | **found 0 vulnerabilities** |
| `npm run typecheck` | pass |
| Lint | **not configured** (no lint script in any workspace) |
| `npm test` | 332 passed (shared 53, API 279), 8 skipped (PostgreSQL suite without `TEST_DATABASE_URL`; run below), 0 failed. Run before and after the fixes. |
| `npm run test:postgres` | 8/8 (before and after) |
| `npm run build -w @atlas/web` | pass (Next 16.4.2, 32 static pages) |
| `npm run test:e2e` | 8/8 + restart check (before and after) |
| `npm run eval` | PASSED: 580 cases; golden, red team and causal 100%; numeric accuracy 1; 0 unsupported numbers; 0 content violations (synthetic data, deterministic composer) |
| `npm run check:secrets` | pass (259 files) |
| `node scripts/atlas.mjs start` (port 3000) | API and web healthy. `/`, `/login`, `/app`, `/app/companies`, `/app/academy`, `/app/assistant`, `/methodology`, `/status`, `/healthz` → 200 |
| Unauthenticated `/v1/watchlists`, `/v1/notes`, `/v1/me`, `/v1/datasets`, `/v1/academy/progress` | 401; forged session cookie 401; cross-origin POST 403; login without CSRF 403 |
| Security headers | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; no X-Powered-By |
| Browser (in-app, pro account) | sign-in → company search → Kaveri Foods profile (synthetic label, ratios, evidence) → add to watchlist → note created → Academy (4 courses, draft) |
| Restart persistence | stop/start via launcher: note, watchlist entry and session survived |
| Live cross-user isolation | free user PATCH/DELETE of pro's note → 404 (owner control → 200; note unchanged) |
| **Defect found** | startup catch-up inside the API blocked every request for ~3.3 min (PGlite computes on the API's thread); web proxy returned 500 "socket hang up". Fixed: the launcher now runs `npm run pipeline` before starting the API (catch-up then reported "nothing to catch up", start took 22 s) |
| Supabase (via connector, read-only) | URL https://wyknwjdcexisrempmvjr.supabase.co; auth health 200; REST rejects every ATLAS schema (PGRST106); 151 tables in 10 schemas, all RLS, 0 policies, no anon/authenticated privileges or schema usage; migrations 001–008 checksums = local; schema fingerprint 99a30a29…/2547 lines = local; triggers/functions hash = local; advisor: only INFO rls_enabled_no_policy; hosted data: 0 users, 0 companies. App connection: not tested (no `DATABASE_URL`) |

## 19 Oct 2026, Next 16 upgrade (next 15.5.28 → 16.4.2)

| Command | Result |
|---|---|
| `npm run typecheck` | pass (all workspaces) |
| `npm run build -w @atlas/web` | pass (Next 16.4.2, Turbopack; 32 static pages) |
| `npm test` | **332 passed** (shared 53, API 279), 8 skipped (PostgreSQL suite without `TEST_DATABASE_URL`; not re-run here because the upgrade does not touch the API), 0 failed |
| `npm run test:e2e` | 8/8 passed (Edge, 40 s) + restart check: the note survived an API restart |
| `npm audit --omit=dev` | **0 vulnerabilities** (next now depends on postcss 8.5.23) |
| `next start` header check | CSP, X-Content-Type-Options, Referrer-Policy, X-Frame-Options and Permissions-Policy present; no `X-Powered-By` |

Code changes: the `next` version and `apps/web/tsconfig.json`, where Next 16 sets `jsx: react-jsx` and adds `.next/dev/types`. All dynamic routes already used async `params`, and there is no middleware, so the other breaking changes did not apply.

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
| Supabase | migrations 001–008 checksums identical to local; 151 tables in the 10 ATLAS schemas, 0 without RLS (corrected from 102, which used an incomplete schema list) |

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
