# ATLAS complete product audit

Session 13, 5 Nov 2026 (updated 11 Nov), at commit `63520ea` and later. "Evidence" names what was actually run today; earlier-session claims were not taken on trust.

**Evidence sources used today:**
- **Q:** QA crawl of 37 routes plus `/admin`, at desktop (1366) and mobile (390) widths. It checks console errors, failed requests, near-empty pages and horizontal overflow. Result: 0 findings at both sizes. Output in `artifacts/qa-1105/` (screenshots git-ignored).
- **B:** manual check in the in-app browser.
- **A:** API call against the running app.
- **T:** automated tests. `npm test` passed 640 tests (shared 125; API 515, including 2 new regression tests), with 13 skipped (PostgreSQL suite, run separately).
- **R:** reconciliation against the provider's own API.

Status values: Fully implemented and tested · Implemented but unverified · Partially implemented · UI only · Broken · Data unavailable · Licensing blocked · Not implemented · Deferred with justification.

| Feature | Intent | Status | Real data? (source, latest) | Evidence | Known defects / next step |
|---|---|---|---|---|---|
| Sign-in, sessions, CSRF, TOTP for operators | Accounts | Fully implemented and tested | — | T (security, accounts), Q (`/admin` with two-step sign-in) | — |
| Home | What matters, what changed, what I follow | Fully implemented and tested | FRED releases (last 7 days), FRED/EIA commodity moves, EODHD indices (4 Nov), CoinGecko | Q, B, A, T (discovery) | Units were missing on commodity moves; **fixed today** |
| Command search (Ctrl+K) | Find indices, crypto, commodities, macro, lessons, own research | Fully implemented and tested | Stored catalogue | T (discovery: aliases, gaps, privacy, ranking), walkthrough scene | — |
| Indian markets: index pages | Prices, freshness, risk, indicators | Fully implemented and tested | EODHD, 3 indices to 4 Nov | A, T | **Stale adjusted series used for indices: fixed today** (regression tests) |
| Indian shares | Share pages, screener, fundamentals | Licensing blocked | — | A (`/v1/data-sources` "not available") | Needs a licence |
| User-imported statements | Fundamentals from your own files | Implemented but unverified today | User files | Covered by session-9 tests (in `npm test`) | — |
| Macro list and series pages | Latest value, vintage, provenance, chart | Fully implemented and tested | FRED, 18 series | Q, A, R (DGS10 match), T | India CPI is stale since Mar 2025 (source stopped); labelled stale |
| Macro relationship explorer | Correlate any two stored series | Fully implemented and tested | Stored series | T (known answers), Q | — |
| Follows and release notices | Notify on new observations | Fully implemented and tested | Stored series | T (discovery) | — |
| Commodities | Benchmarks, inventories, term structure | Fully implemented and tested | FRED/EIA, 31 series to 3 Nov / 30 Oct | Q, A, R (Brent, crude stocks match) | Gold and silver are licensing blocked |
| Digital assets | Prices, history, DeFi, on-chain, events, research | Fully implemented and tested | CoinGecko 07:22 UTC; Coinbase/Binance candles to 4 Nov; 50 assets | Q, A, R (bitcoin consistent), T | CoinGecko Demo is not commercial |
| Research portfolios and risk | Hypothetical portfolios, risk review, stress | Fully implemented and tested | Stored real series | B (created a hypothetical portfolio: return, drawdown, volatility, contributions, provenance), T | — |
| Walk-forward backtest | Out-of-sample testing with costs | Fully implemented and tested | Bitcoin since 2015 | B (ran: out-of-sample +5,544% vs buy-and-hold +10,847%; in-sample labelled optimistic), T | Crypto series only (session calendars for shares not built) |
| Notebook | Notes, hypotheses, reflections; Markdown export | Fully implemented and tested | — | B, T | — |
| Reports | Sourced research report | Fully implemented and tested | Stored series | A (generated: 12 calculation findings, methodology, limitations, per-instrument source), T | — |
| Screener and factors (research hub) | Crypto factor research | Implemented, tested in earlier sessions | Stored crypto | Q | Equity factors need fundamentals (blocked) |
| Event study, regimes, data integrity, discovery, alerts | Research tools | Implemented, tested in earlier sessions | Stored series | Q | Not exercised by hand today |
| Academy (9 courses) | Courses, readiness checks, lessons, quizzes, capstones | Fully implemented and tested | Teaching content (AI-drafted, in review) | Q, T (academy suites) | Content not expert-reviewed |
| Academy videos | 9 course introductions with captions and transcripts | Fully implemented and tested | — | B (md-intro played: 1280×720, 131.9 s); cm-intro rendered 11 Nov (141.6 s, verified decode, audio and 29 caption cues; plays in the lesson); `videos.test.ts` | Synthetic voice; content in review |
| Progress, XP, levels, missions, achievements, skill map | Retention for genuine learning and research | Fully implemented and tested | — | T (learning-engine), Q | Community features deferred |
| Settings (panels, markets, theme, digest, optional streaks) | Personalisation | Fully implemented and tested | — | T (discovery prefs), Q | — |
| Notifications | Notices | Fully implemented and tested | — | Q, T | No email transport configured locally (outbox) |
| Data sources / freshness | Provenance and provider health | Fully implemented and tested | Live provider states | Q, A, T | A transient "provider error" at start-up cleared on retry |
| Onboarding | First-run preferences and a three-step welcome on Home | Fully implemented and tested | — | Headless check (shows, "Try search" opens search, Done hides it and persists), preference test, walkthrough | — |
| Operator console (`/admin`) | Diagnostics, re-runs, review | Fully implemented and tested | — | Q (two-step sign-in), T | — |
| Billing | Plans, sandbox checkout | Implemented (sandbox only) | — | T | Real payment gateway not connected |
| AI assistant | Grounded answers | Implemented, tested in earlier sessions | Deterministic composer | T (eval suite earlier) | No live model key |
| Local launcher | Start, stop, backup, restore, verify | Fully implemented and tested | — | Backup plus restore drill passed today; start and stop used today | Does not survive a reboot (no OS service): the cause of today's outage |

## Obsolete or unused

- `apps/web/public/academy/videos/` is an empty folder left from an earlier design; videos are served from `apps/api/media/academy-videos/` behind the lesson gate. It is safe to delete.
- The equity-demo screens (synthetic) remain for demo mode only; they are disabled in real-data mode.
- The empty `markets` file at the repo root was a stray; it was removed (it is preserved on the checkpoint branch).
