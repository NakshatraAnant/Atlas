# ATLAS 50-point implementation tracker

Session 12, 30 Oct 2026, from checkpoint `03cdbbf`.

Status values:
- **Completed**: built in this session and checked.
- **Existing**: already built and tested in an earlier session; verified working at baseline, no change needed.
- **Partial**: some of it is built; the rest is noted.
- **Blocked**: cannot be done without a licence, money or your decision.
- **Deferred**: deliberately not done, with the reason.

"Tested" names the automated tests or the manual check.

Priority was set by value to customers **and** data rights. Anything that would need unlicensed data or synthetic numbers was not built.

## A. Data

| # | Item | Status | What was done / why not | Tested |
|---|---|---|---|---|
| 1 | Unified provider layer | Existing | Shared durable provider gate for fred, fred_csv, eia, coingecko, eodhd, data_gov_in (session 11) | providers.test.ts |
| 2 | Coverage map | Completed | The data-sources page (existing), plus search now explains known gaps (gold/silver, Indian shares, futures) instead of returning nothing | discovery.test.ts |
| 3 | Real time where licensed | Blocked | No source licenses real-time redistribution at no cost. CoinGecko updates about every 15 minutes; everything else is end of day or as released | — |
| 4 | Global markets | Partial | US macro (FRED) and global commodity benchmarks are covered. Global equity indices beyond the EODHD free plan need a paid plan | — |
| 5 | Company financials | Blocked | No licensed Indian fundamentals source. SEC EDGAR needs a contact address you choose to publish (your email may not be used) | — |
| 6 | Macro | Completed | Full history for non-daily series; catalogue notes stay in sync on every catalogue sync (corrected H.10 note); per-series notes on the Macro list | API suite; QA crawl |
| 7 | Commodities | Existing + Completed | Interactive charts on series pages; follow any benchmark | QA crawl; discovery.test.ts (follows) |
| 8 | Provenance | Existing | Source, period, vintage, retrieval time and source update time on every series page | providers.test.ts |
| 9 | Data quality | Existing | Freshness rules by frequency, revisions recorded, discontinued series marked | providers.test.ts |
| 10 | Freshness centre | Existing | Data sources page: provider states and series freshness | data-health.test.ts |

## B. Research

| # | Item | Status | What was done / why not | Tested |
|---|---|---|---|---|
| 11 | Universal search | Completed | Ctrl/⌘+K or "/" palette over indices, crypto, commodities, macro, lessons, courses, pages and **your own** research. Plain-word aliases ("oil", "rupee", "inflation"). Ranked by the markets you choose in Settings. Recent picks are remembered | discovery.test.ts (aliases, gaps, privacy, ranking) |
| 12 | Asset pages | Partial | Index, macro, commodity and crypto pages exist. Individual share pages are blocked (#5) | QA crawl |
| 13 | Interactive charting | Completed | New `TsChart`: range presets, custom dates, drag to zoom, hover read-out, keyboard, two series on two axes, CSV export, table view, full screen, gap-aware lines | Web typecheck/build; QA crawl |
| 14 | Screener | Blocked | Needs licensed fundamentals (#5). The demo screener stays demo-only | — |
| 15 | Comparison | Partial | Two-series comparison in the explorer; benchmark comparison in the workbench (existing). Company peer comparison is blocked (#5) | discovery.test.ts |
| 16 | Modelling | Existing | Research portfolios, scenario stress tests, walk-forward on stored real series | research.test.ts |
| 17 | Macro relationship explorer | Completed | Any two stored series, monthly or weekly, correlation of period changes (percentage points for percent series), rolling window, method and caveats, four presets. Earns research XP | discovery.test.ts (known answers, gap handling, weekly refusal, activity once) |
| 18 | Portfolio | Existing | Research portfolios with risk review | research.test.ts |
| 19 | Quant | Existing | Walk-forward backtests and correlation studies in the research hub | research.test.ts |
| 20 | Notebook | Existing + Completed | The notebook now appears in search. A clock bug in hypothesis timing was fixed (see the bug report) | research.test.ts |

## C. UX

| # | Item | Status | What was done / why not | Tested |
|---|---|---|---|---|
| 21 | Redesign | Completed | Dark default theme with a gold accent, tokenised colours (light theme kept), refined cards, buttons and KPI tiles | QA crawl screenshots |
| 22 | Dashboard | Completed | Home: "What changed" (releases in the last 7 days, largest commodity moves), followed series, learning panel; existing market panels | discovery.test.ts (attention); QA crawl |
| 23 | Onboarding | Partial | The existing onboarding flow is unchanged. Real-mode Home explains sources and shows the Ctrl+K hint. A guided first-run tour was not built | — |
| 24 | Navigation | Completed | Command palette, header search button, Settings link, breadcrumbs on macro pages, single-line scrollable mobile nav | QA crawl |
| 25 | Animations | Completed | Subtle fade-in and hover lift; `prefers-reduced-motion` disables them | CSS review |
| 26 | Visualisation system | Partial | `TsChart` is used for macro, commodity and explorer charts. Older pages still use the earlier mini charts | — |
| 27 | States | Completed | Home and Data health wait for the account before choosing demo or real (fixed five 403s). Every new panel has loading, empty and error text | QA crawl |
| 28 | Responsive | Completed | Mobile crawl of every route; no horizontal overflow | QA crawl (mobile) |
| 29 | Accessibility | Partial | ARIA combobox/listbox palette, keyboard chart navigation, `aria-pressed` follow buttons, labelled sections and moves. No screen-reader audit by a person | QA crawl |
| 30 | Personalisation | Completed | Settings: show/hide and order Home panels, preferred markets, release notices, weekly summary, theme (saved to the account), optional streaks | discovery.test.ts (validation) |

## D. Gamification

| # | Item | Status | What was done / why not | Tested |
|---|---|---|---|---|
| 31 | XP | Existing + Completed | Explorer studies earn `correlation_study` XP | discovery.test.ts |
| 32 | Levels | Existing | 50·n·(n−1) | learning-engine.test.ts |
| 33 | Badges | Existing | 26 achievements. *Correlation Explorer* is now reachable from the explorer | learning-engine.test.ts |
| 34 | Missions | Existing | Daily and weekly missions, weekly goal | learning-engine.test.ts |
| 35 | Optional streaks | Completed | Setting to hide streaks everywhere; no effect on XP | discovery.test.ts (prefs) |
| 36 | Skill tree | Existing | Skill map on My progress | learning-engine.test.ts |
| 37 | Quizzes | Existing | Readiness checks, quizzes, spaced review | academy tests |
| 38 | Progress | Existing | My progress page | learning-engine.test.ts |
| 39 | Community | Deferred | Moderation, abuse and compliance burden for investment-related user content. Leaderboards would reward volume over understanding | — |
| 40 | Notifications and digest | Completed | Follow series; one notice per new observation (never the backlog); opt-in weekly summary at most every 7 days; preferences respected | discovery.test.ts |

## E. Engineering

| # | Item | Status | What was done / why not | Tested |
|---|---|---|---|---|
| 41 | Performance | Partial | Page load times measured for every route (QA crawl). Search is one indexed query per source. No profiling-driven optimisation | QA crawl timings |
| 42 | API quality | Completed | Strict `display_prefs` schema (it previously accepted any JSON), regex-validated keys, rate limit on search, problem+json errors | discovery.test.ts |
| 43 | Auth | Existing | Sessions, CSRF, TOTP for operators | security.test.ts |
| 44 | Privacy | Completed | Search returns only your own research. Follows are deleted with the account. RLS on the new table | discovery.test.ts, rls.test.ts |
| 45 | Monitoring | Existing | Provider states and the operator diagnostics console | providers.test.ts |
| 46 | Backup | Existing | Backups before changes and before the rebuild; restore drill passed | atlas.mjs verify-backup |
| 47 | Testing | Completed | 13 new API tests; the full suites were rerun (counts in the bug report) | — |
| 48 | Admin centre | Existing | Operator console unchanged | QA crawl (/admin) |
| 49 | Polish | Completed | Findings from the QA crawl fixed (bug report) | QA crawl rerun |
| 50 | Walkthrough video | Completed | Recorded from the running app with synthetic narration and burned-in captions; verified by playback | Recording notes |

## Summary

| Status | Count |
|---|---|
| Completed (including "Existing + Completed": #7, #20, #31) | 22 |
| Existing (verified, no change needed) | 17 |
| Partial | 7 (#4, #12, #15, #23, #26, #29, #41) |
| Blocked | 3 (#3 real time, #5 company financials, #14 screener) |
| Deferred | 1 (#39 community) |
| **Total** | **50** |

Partial and blocked items, and what each needs, are listed in [ATLAS_FINAL_RELEASE_NOTES.md](ATLAS_FINAL_RELEASE_NOTES.md).
