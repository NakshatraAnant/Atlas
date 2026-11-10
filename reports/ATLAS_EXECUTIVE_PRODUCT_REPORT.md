# ATLAS executive product report

Session 13, 5 and 11 Nov 2026. A one-page view for a decision-maker. Detail is in the linked reports. Test counts and release verdicts are in [ATLAS_FINAL_RELEASE_REPORT.md](ATLAS_FINAL_RELEASE_REPORT.md).

## What ATLAS is today

A local research workspace and learning academy for macro, commodities, Indian indices and digital assets. Every figure carries its source, the period it refers to and a freshness state. It runs on one machine (`node scripts/atlas.mjs start`, http://localhost:3000) with an embedded database.

## What works, on real data

| Area | Data behind it | How current |
|---|---|---|
| Macro (18 series, vintages, revisions) | FRED | As published; daily to monthly |
| Commodities (31 series: benchmarks, spreads, inventories) | FRED, EIA | Daily or weekly; matches the provider on 5 Nov |
| Indian indices (NIFTY 50, NIFTY BANK, SENSEX) | EODHD free plan | End of day; to 9 Nov when checked on 11 Nov (10 Nov due) |
| Digital assets (50 assets, long history, DeFi, on-chain) | CoinGecko Demo, Binance, Coinbase, public endpoints | About 15 minutes delayed |
| Research hub | All of the above | Portfolios, risk, walk-forward backtests, explorer, notebook, sourced reports |
| Academy | 9 courses, 9 narrated introduction videos | AI-drafted; not yet expert-reviewed |

Spot checks against the providers' own APIs on 5 Nov matched exactly: the US 10-year yield, Brent, and US crude stocks. Bitcoin was consistent with a reading taken 13 minutes later.

## What changed this session

- **Outage diagnosed and fixed.** A Windows restart on 3 Nov stopped ATLAS; nothing was lost. It is running again, and the runbook states the restart step.
- **Wrong index values fixed.** Index pages showed the 22 Oct close while Home showed 4 Nov. Fixed, with regression tests.
- **Freezes fixed.** A background query blocked the app for up to 35 s every few minutes. After the fix the worst measured response was 0.63 s; the query went from 9.6 s to 12 ms in a test.
- **Units shown** on commodity moves.
- **Records corrected.** An earlier tracker claimed a walkthrough video that did not exist. It is corrected, and the video was produced this session.
- **11 Nov:**
  - Home loads twice as fast under load.
  - One oversized request can no longer freeze the app.
  - New users get a three-step welcome.
  - Every chart on real-data pages is interactive.
  - The ninth course video was added.
  - Ctrl+K now works with Caps Lock on.
  - Demo links no longer appear on a real-data install.
- **Tests:** 687 automated tests passed on 11 Nov (unit, integration, PostgreSQL and end-to-end). The QA crawl found 0 issues on 37 pages at desktop and phone widths.
- **Reports written:** product audit, data coverage, licensing register, UX audit, security, gamification, bugs, and a 50-initiative tracker.

## What blocks a paid launch

1. **Data licences.** No connected source permits redistribution to paying customers. CoinGecko Demo and the EODHD free plan are personal or non-commercial, and FRED needs per-series checks. Indian shares and company fundamentals need a licensed feed. Nothing was purchased; this is your decision. Details: [ATLAS_PROVIDER_AND_LICENSING_REGISTER.md](ATLAS_PROVIDER_AND_LICENSING_REGISTER.md).
2. **Hosting.** It runs as a single-user local install on an embedded single-threaded database. Multi-user hosting needs server PostgreSQL (the schema already passes against it), a process manager, and monitoring.
3. **Content review.** Academy content is AI-drafted and needs expert review before it is sold as education.
4. **Payments and email** are sandbox or outbox only.

## Recommended next three steps

1. Decide on the data licences (Indian shares, commercial crypto). This unlocks the largest missing features: share pages, screener and fundamentals.
2. Plan the move to hosted PostgreSQL, with a service manager that survives restarts.
3. Commission expert review of the Academy content, and migrate zod to version 4.
