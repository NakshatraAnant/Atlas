# ATLAS master execution tracker

Replaces `ATLAS_50_POINT_IMPLEMENTATION_TRACKER.md` (session 12, which overstated item 50). Updated in session 13, 5 and 11 Nov 2026.

**Statuses:** Not started · In progress · Implemented (code exists, no automated test) · Tested (an automated test or a recorded check ran) · Blocked · Deferred.

**Evidence keys:**
- **T:** automated tests (`npm test`).
- **Q:** the QA crawl on 5 Nov.
- **B:** a hands-on browser check on 5 Nov.
- **R:** provider reconciliation on 5 Nov.

## Checkpoint (for the next session)

- **Branch:** `feat/atlas-mvp`. Session-13 commits start at `63520ea`. The session-12 uncommitted state is preserved on branch `checkpoint/session12-wip-20261105`.
- **Database:** backup `backups/atlas-backup-2026-11-05_07-08-47.tar.gz`; its restore drill passed.
- **Last completed action and next exact action:** see `docs/execution/ATLAS_RESUME_CHECKPOINT.md`.

## A. Real data and data intelligence

| # | Initiative | Status | Evidence / notes |
|---|---|---|---|
| 1 | Unified provider architecture | Tested | Shared provider gate (fred, eia, coingecko, eodhd, data_gov_in) · T (providers) |
| 2 | Expanded coverage | Tested (within free sources) | 18 macro, 31 commodity, 50 crypto, 3 Indian indices · A, R |
| 3 | Licensed real-time / delayed feeds | Blocked | No free real-time licence; CoinGecko ~15 min delayed |
| 4 | Global exchanges and instruments | Blocked | Global equities need a paid plan |
| 5 | Company financials | Blocked | No licensed Indian fundamentals; EDGAR needs your contact address |
| 6 | Macro intelligence | Tested | FRED with vintages and revisions · T, R (DGS10) |
| 7 | Commodity intelligence | Tested | FRED/EIA · R (Brent, crude stocks). Gold/silver blocked |
| 8 | Provenance | Tested | Source, period, vintage, retrieval on every series and report · T, A |
| 9 | Data quality and anomalies | Tested | Freshness rules, revisions, quarantine · T. **Stale-series defect found and fixed today** |
| 10 | Freshness and provider reliability centre | Tested | Data sources page · T, Q |

## B. Research and analytics

| # | Initiative | Status | Evidence / notes |
|---|---|---|---|
| 11 | Universal search | Tested | Ctrl+K palette · T (discovery) |
| 12 | Asset and company pages | Tested for indices, macro, commodities, crypto; Blocked for shares | Index pages fixed today · T |
| 13 | Interactive charts | Tested | TsChart (ranges, zoom, export, table) · Q |
| 14 | Screener | Blocked for equities; Tested for crypto factors | Needs fundamentals |
| 15 | Comparison workbench | Tested (series); Blocked (company peers) | Explorer, workbench · T |
| 16 | Modelling / DCF workspace | Implemented (learning labs, scenarios); a DCF for real companies is Blocked (no fundamentals) | — |
| 17 | Macro relationship explorer | Tested | Known-answer tests · T |
| 18 | Portfolio analytics | Tested | Hypothetical portfolio, risk, stress · B, T |
| 19 | Quant workbench | Tested | Walk-forward run on bitcoin · B, T |
| 20 | Research notebook | Tested | Notebook, Markdown export · T, B |

## C. User experience

| # | Initiative | Status | Evidence / notes |
|---|---|---|---|
| 21 | Design system | Implemented | Dark default, gold accent, tokens · Q screenshots |
| 22 | Personalised dashboard | Tested | Home panels, What changed, follows · T |
| 23 | Onboarding | Tested | Three-step welcome on Home (choose markets, follow two series, try search), dismissible and restorable from Settings · T (preference), headless check, walkthrough |
| 24 | Navigation and command search | Tested | Ctrl+K now works with Caps Lock; no demo links before sign-in on a real-data install (11 Nov) · Q, T, headless check |
| 25 | Animations | Implemented | Subtle; reduced-motion respected |
| 26 | Charts and tables | Tested | One interactive chart (TsChart) for every line chart on real-data pages: the 18 former mini charts and the workbench now have ranges, hover, zoom, CSV and table view. Candlestick price charts stay a separate type; demo-only pages keep their older charts · headless check, Q |
| 27 | Loading, error, empty states | Tested | Q (0 empty pages, 0 errors) |
| 28 | Responsive | Tested | Q mobile crawl, 0 overflow |
| 29 | Accessibility | Implemented | ARIA palette, keyboard charts; no screen-reader audit by a person |
| 30 | Personalisation | Tested | Settings · T |

## D. Gamification and retention

| # | Initiative | Status | Evidence / notes |
|---|---|---|---|
| 31 | XP | Tested | T (learning-engine) |
| 32 | Levels | Tested | T |
| 33 | Achievements | Tested | T |
| 34 | Missions | Tested | T |
| 35 | Optional streaks | Tested | T (prefs) |
| 36 | Skill tree | Tested | T |
| 37 | Quizzes | Tested | T (academy) |
| 38 | Learning and research analytics | Tested | T |
| 39 | Community | Deferred | Moderation and compliance burden for investment content |
| 40 | Notifications and weekly digest | Tested | T; email transport is outbox-only locally |

## E. Engineering and production quality

| # | Initiative | Status | Evidence / notes |
|---|---|---|---|
| 41 | Performance | Tested | Scheduler stall fixed (9.6 s → 12 ms query). Home endpoints batched: parallel Home load 4.9 s → 2.4 s on the live app (11 Nov); regression tests for each change. PGlite still serves one query at a time, so heavy concurrent use queues · T |
| 42 | API and database | Tested | Strict schemas, rate limits · T |
| 43 | Auth and security | Tested | T (security) |
| 44 | Privacy and isolation | Tested | T (rls, discovery privacy) |
| 45 | Monitoring | Implemented | Provider states, operator console, slow-request log |
| 46 | Backups and recovery | Tested | Backup + restore drill passed today |
| 47 | Automated testing | Tested | 687 passed on 11 Nov (unit, integration, PostgreSQL, end-to-end); counts in the final release report |
| 48 | Admin centre | Tested | Q (`/admin`, two-step sign-in) |
| 49 | Launch-readiness polish | Tested (for local use) | 16 defects fixed with regression tests; QA crawl 0 findings; launch blockers are licensing and hosting (release report) |
| 50 | Narrated walkthrough | Tested | Recorded and verified 11 Nov (take 5): 345.5 s, 1280×720, H.264/AAC, narration throughout, 0 console errors · `artifacts/ATLAS_RECORDING_NOTES.md` |
