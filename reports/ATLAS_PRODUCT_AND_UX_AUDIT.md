# ATLAS product and UX audit

Session 13, 5 Nov 2026. Based on the QA crawl (37 customer routes and `/admin`, at desktop 1366 and mobile 390 widths), hands-on browser checks, and the recorded walkthrough. The per-feature verdicts are in [ATLAS_COMPLETE_PRODUCT_AUDIT.md](ATLAS_COMPLETE_PRODUCT_AUDIT.md).

## What works well

- **Trust signals are everywhere they matter.** Every figure on Home, series pages, the portfolio review and reports carries its source, the date it refers to and a freshness state. End-of-day and monthly values are never called live.
- **One-keystroke search.** Ctrl+K finds indices, crypto, commodities, macro series, lessons and your own research, and explains known gaps (gold, Indian shares) instead of returning nothing.
- **Research tools are honest by construction.** The walk-forward backtest shows out-of-sample results next to buy-and-hold and labels in-sample returns as optimistic. Portfolios are marked hypothetical. Reports separate calculations from interpretations and list limitations.
- **Clean failure states.** The crawl found 0 empty pages, 0 failed requests and 0 console errors on every route at both sizes. Data-unavailable areas say why (licence, missing key).
- **Mobile.** No horizontal overflow on any route; the nav is a single scrollable line.
- **Academy.** Narrated course videos with captions and transcripts, readiness checks, lesson stages and resume.

## Problems found this session

| Problem | User impact | Status |
|---|---|---|
| Pages stalled 20–35 s every few minutes, and the browser got "Internal Server Error" from the web proxy | Felt broken, intermittently | **Fixed** (crypto scheduler query); measured max 0.63 s afterwards |
| NIFTY 50 page disagreed with Home (22 Oct vs 4 Nov) | Wrong latest value on a key page | **Fixed** |
| Commodity moves on Home had no units | Ambiguous numbers | **Fixed** |
| Home's "What changed" said "could not be loaded" when the machine was busy | A key panel looked broken | **Fixed** (11 Nov): heavy endpoints batched, one retry for proxy failures |
| Ctrl+K did nothing with Caps Lock on | The main shortcut failed silently | **Fixed** |
| Signed out, the nav offered demo sections that answer 403 | Dead links on a real-data install | **Fixed** |
| No favicon (a console 404 on every page) | Unpolished browser tab | **Fixed** |
| No guided first-run onboarding | New users must discover features themselves | **Fixed** (11 Nov): three-step welcome on Home |
| Older pages use earlier mini charts; new pages use TsChart | Inconsistent chart interactions | **Fixed** (11 Nov): one interactive chart on all real-data pages |
| Courses: COMMODITY MARKETS DECODER has no introduction video | Inconsistent course start | **Fixed** (11 Nov): 141.6 s narrated video with captions; the other eight unchanged |

## Highest-value next UX work

1. Pin a "data is end of day" note on Indian markets during market hours, so users don't expect intraday movement.
2. A person-led accessibility review (screen reader, keyboard-only); automated checks only so far.
3. Faster first paint on Home on a busy machine: the database is single-threaded (server PostgreSQL removes this).
