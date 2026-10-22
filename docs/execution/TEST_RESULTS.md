# Test results

Newest first. Only results of commands that actually ran.

## 20 Oct 2026: Academy discovery, learning engine, data health, MARKET DECODER module 5

| Command / check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | **356 passed** (shared 53, API 303), 8 skipped (PostgreSQL suite; run below), 0 failed. New: academy-discovery (5), learning-engine (11), data-health (3); content integrity 40 (now incl. module 5) |
| `npm run test:postgres` | 8/8 |
| `npm run test:e2e` | **9/9** + restart check. New: Academy discoverable from Home and nav (2nd item), all four course routes open and survive reload, lesson resumes at the stage reached after refresh and back/forward, progress page shows level, XP rules and achievements |
| `npm run eval` | PASSED: 580 cases, 100% golden/red-team/causal, 0 unsupported numbers |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run check:secrets` | pass (266 files) |
| Import check | all 703 relative imports in tracked files resolve to tracked files (after fixing a module hidden by the `data/` ignore rule) |
| Browser (in-app) | Academy 2nd in nav; next-action card; preview-mode note; course cards with level, lessons, hours, status; enrol → lesson → advanced to stage 3 → refresh → **restarted at stage 1 (defect, fixed)** → now resumes; Data health shows 120 synthetic companies, 3,91,597 price rows over 3,520 trading days, 0 missing days, provider assessments; module 5 lesson with guided ATLAS task |
| Supabase | migration 009 applied (additive: 3 tables, RLS on, no anon/authenticated privileges) with the local checksum; fingerprint local = hosted `6e8838fbcbff8733fa67a13d3093932e` / 2580 lines; 154 tables, 0 without RLS; advisor INFO only |
| Real-data sources | NSE and NSE Indices terms read in a browser: automated collection prohibited / needs written consent → no ingestion built against them |

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

## 22 Oct 2026, session 7

Windows 11, Node 24.16.0, Microsoft Edge (Playwright channel `msedge`).

| Check | Command | Result |
|---|---|---|
| Baseline before any change | `npm run typecheck`; `npm test` | pass; shared 58 passed; API 309 passed, 8 skipped |
| Type checking (after changes) | `npm run typecheck` | pass (all workspaces) |
| Unit, pipeline, policy, golden and API tests | `npm test` | shared **58 passed**; API **321 passed, 8 skipped** (real-PostgreSQL suite: no `TEST_DATABASE_URL`; skips are not passes), 0 failed |
| New: video helpers, files, access gate | `apps/api/test/videos.test.ts` | 7 passed |
| New: production refuses synthetic data and drafts | `apps/api/test/config.test.ts` | 5 passed |
| Browser end-to-end (includes `next build`) | `npm run test:e2e` | **12 passed** (new: lesson video plays with captions and transcript) + restart check passed |
| Video render | `npm run video:render` | 4 videos rendered (md 131.9 s, ed 119.7 s, se 93.9 s, ma 107.2 s; 9.3–12.8 MB) |
| Video playback | `npm run video:verify` | 4/4 OK in Edge: duration matches, 1280×720, video and audio decoded, 19–30 caption cues |
| Secret scan | `npm run check:secrets` | pass (282 tracked files) |
| Real-PostgreSQL suite | `npm run test:postgres` | **not run** this session |

Local hosting, verified against the running app (`node scripts/atlas.mjs start` on the existing `./data`, no reseed):
- `atlas status`: API healthy, readiness `{"status":"ready","database":"ok","data":"loaded","synthetic_data":true}`; web healthy at http://localhost:3000.
- Signed-out request for `/v1/academy/videos/md-intro/video` through the web origin → 401.
- In the browser pane: signed in as `plus@atlas.test`; lessons se-l1 and md-l1 show their video; it played, seeked to 60 s (206 responses through the Next proxy), captions showing with the cue matching the narration, audio decoded, no media error. At 375 px width: no horizontal scroll; video 314 px wide.
- `atlas stop` → "API stopped cleanly"; `start` and `restart` brought it back healthy; the browser session survived both restarts.

### After integrating batch2 (`554aa69`, EQUITY DETECTIVE module 5)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | shared 58 passed; API **328 passed, 8 skipped**, 0 failed (+7 from the new lessons' content checks) |
| `npm run test:e2e` | 12 passed + restart check passed |
| Running app (existing `./data`, no reseed) | catalogue lessons 14 / 15 / 6 / 6; `Module 5: The business behind the numbers` listed; ed-l9 and ed-l15 open (7 stages, 3 questions, draft) |

## 23 Oct 2026, session 8 (ATLAS Digital Assets)

Windows 11, Node 24.16.0, Microsoft Edge. Baseline before any change (22 Oct): typecheck pass; shared 58 passed; API 328 passed, 8 skipped.

| Check | Command | Result |
|---|---|---|
| Type checking | `npm run typecheck` | pass (all workspaces) |
| Unit, pipeline, policy, golden, API, crypto tests | `npm test` | shared **92 passed** (+34 crypto analytics/simulation tests, hand-calculated values); API **392 passed, 8 skipped** (real-PostgreSQL suite, no `TEST_DATABASE_URL`; skips are not passes), 0 failed |
| New: crypto integration | `apps/api/test/crypto.test.ts` | 36 passed: transforms on recorded real responses, validation, budget/cache/back-off, idempotent ingestion, quarantine, staged jobs, outage → stale (no invented values), analytics vs independent calculation, access control, watchlist privacy, live-feed staleness |
| Academy content checks with the 27 crypto lessons | `academy-content.test.ts` etc. | pass (seven-stage loop, objectives assessed ≥ 3 times, answer keys, no advice language) |
| Production build | `npm run build` | pass (9 Digital Assets routes) |
| Browser end-to-end | `npm run test:e2e` | **15 passed, 1 failed** + restart check passed. The failure: existing md-intro video test (`currentTime` 0 after 2 s) while unit tests and a backfill ran concurrently. Re-run alone (`npm run test:e2e -- e2e/academy.spec.ts -g "Academy video"`): **passed**, with all four Academy tests. Recorded as a load-sensitive test, not fixed. All four new crypto journeys passed. |
| Video render | `npm run video:render cd-intro td-intro oe-intro aa-intro` | 4 rendered (136.5 s, 116.0 s, 107.2 s, 107.6 s; 10.5–13.3 MB); script numbers checked against `@atlas/shared` first |
| Video playback | `npm run video:verify` | 8/8 OK in Edge (duration, 1280×720, video and audio decoded, 21–30 caption cues) |
| Secret scan | `npm run check:secrets` | pass (370 tracked files) |
| Real-PostgreSQL suite | `npm run test:postgres` | **not run** (migration 010 verified on PGlite only) |

Real-data verification (local database `./data/pglite`, free public sources, 22 Oct 2026):
- Imported: 100 assets (CoinGecko top 100), 241 verified venue pairs (Binance 124, Coinbase 117), daily OHLCV and reference observations (77,078 stored across 45 series by the second restart; Binance back to 2017-08-17, Coinbase back to 2015-07-20, CoinGecko last 365 days), 300 DeFi protocols, 37,720 DeFi metric points, rolling Bitcoin/Ethereum blocks, 668 source-linked events, 0 quarantined.
- Browser pane (signed in as `pro@atlas.test`): overview with CoinGecko totals and freshness; Binance WebSocket "Live: receiving messages"; asset page with CoinGecko 365-day chart; correlation matrix from Binance candles (BTC/ETH 0.89 over 90 days); backtest on Coinbase BTC-USD; on-chain blocks; sources & health; crypto lesson cd-l1 with video (poster, captions) and the 3D transaction-journey scene (WebGL canvas; tamper detection works). 375 px width: no horizontal scroll on overview and explorer.
- `atlas stop` → "API stopped cleanly"; `restart` → healthy; persisted crypto data intact; scheduler resumed (markets_inr, asset_details, onchain_bitcoin ran within a minute). One `onchain_ethereum` run failed on a transient "fetch failed" from the public RPC: recorded, source marked degraded, retried on schedule.
