# Known limitations

Honest list of what ATLAS cannot do or has not verified, as of 19 Oct 2026 (end of session 4).

## Data
- **Automated real-data ingestion is blocked by source terms, not by code.** NSE's website terms prohibit automated collection and electronic storage of content; NSE Indices requires written consent; BSE's terms could not be read. A licence (pending entries in the registry) or written consent is required. See `DATA_RIGHTS_AND_PROVIDERS.md` and Data health.
- All market and company data is synthetic. No real Indian market data is licensed or ingested (B-DATA-01).
- User CSV upload (price series) works with column mapping, validation and provenance (`/app/research/datasets`). XLSX and document (PDF) extraction are not built.
- Point-in-time fundamentals exist for the synthetic data; real point-in-time history would depend on the provider.

## Digital assets (session 8)
- Free tiers only: CoinGecko keyless history is limited to 365 days and its rate pool is shared per IP (ATLAS uses ≤ 5 calls/min); a free Demo key (COINGECKO_DEMO_API_KEY) raises the limit. Long history comes from Binance and Coinbase daily candles (venue-specific).
- Snapshots refresh every 15 minutes; only the Binance panel streams, for 8 pairs. Nothing else is real time.
- Binance and Coinbase market-data terms could not be read in full (PDF / 403); data is used for personal, local research only and never redistributed. CoinGecko asks that cached data be refreshed at least daily.
- Not available: token unlock schedules (no free verified source), holder concentration, Solana on-chain data, transaction-level explorer, active-address metrics, user-selectable chart time zone (UTC only), an automated event-study tool.
- Cross-asset comparison uses only price files you upload; ATLAS's own equity data is synthetic and is never compared with real crypto data.
- The PGlite single-process limit applies: run `atlas crypto …` only while ATLAS is stopped.
- Crypto Academy content (27 lessons, 4 videos) is AI-drafted and in review, like the equity courses.

## Research platform and Indian equities (session 9)
- Real Indian equity prices need your own provider key (EODHD for NSE, Alpha Vantage for BSE); without one, the Indian equities page says so and nothing is imported. Live imports have not been exercised against an Indian ticker (no key available); adapters are tested on real response shapes from the providers' demo keys.
- No provider fundamentals, index constituents, intraday or derivatives for Indian equities. Fundamentals come only from statements you import (`/app/equities/statements`). Breadth covers only your tracked universe. Splits and dividends come from EODHD (validation budget, one instrument a day). Company pages, the synthetic screener and Market remain demo data with a persistent banner (`ALLOW_SYNTHETIC_DATA=false` turns them off).
- Free EODHD plan: 20 calls a day, so at most 12 tracked instruments are refreshed and 2 new ones imported per day; one year of history. The NSE holiday list depends on the exchange-details endpoint being included in your plan (not yet verified); without it only weekends and data-inferred days are excluded. Index provider codes (`NSEI.INDX`, `BSESN.INDX`) are unverified until the first response. The 20:00 IST data-ready time is an assumption. REAL_VERIFIED (two-source cross-check) is defined but no second equity source exists yet.
- Walk-forward backtests run on continuously traded (crypto) series only; session-calendar backtests are not built.
- Factor research covers crypto momentum, relative strength, volatility, volume trend and size; value and quality factors need real fundamentals.
- Token unlock schedules, holder concentration and Solana on-chain data remain unavailable (no free verified source).
- Alerts are in-app only (no email); evaluated every 5 minutes while ATLAS runs.
- No leaderboards (no opt-in community); retention analytics are personal (single-user local install).

## Infrastructure
- **Embedded database (PGlite) memory ceiling: fixed** (ADR-018). Seeds of 40, 120 and 602 companies complete, and the daily catch-up is covered by tests. Limits that remain:
  - A 500-company seed takes about 97 minutes (disk mode, peak RSS about 960 MB, database 1.7 GB). That size is for stress testing; the default is 120.
  - PGlite is single-process. The API and a CLI command (seed, eval, pipeline) cannot open the same data directory at the same time.
  - PGlite computes on the API's own thread. While the evening post-close cycle runs inside the API (after 18:30 IST, about 3 minutes at 120 companies on this machine), requests wait, and the web proxy may show "could not be reached". Startup catch-up avoids this by running before the API starts. A hosted PostgreSQL (`DATABASE_URL`) does not have this limitation.
  - No lint is configured.
- GitHub repository not created; code is committed locally only (B-GH-01).
- The Supabase schema is applied and matches local (migrations 001–008, identical fingerprint), but the app has not connected to Supabase because it needs the database password (B-SB-01). The node-postgres driver path is tested against a real local PostgreSQL 17 (`npm run test:postgres`), not against Supabase itself.
- No Docker route (no WSL on the dev machine). Production deployment is not part of this build.

## Financial engine
- A research DCF, scenario and sensitivity tool for real companies is not built: the `valuation_scenario_tool` flag stays legal-gated. DCF exists only as Academy labs and the Valuation Lab game, on illustrative inputs.
- The financial golden set has 59 hand-checked cases (`apps/api/test/golden/cases.ts`). It is not an exhaustive audit of every metric and edge case.

## AI
- Deterministic composer only; no LLM key configured (B-AI-01). The model-written narrative path is covered by the claim checker but has not been evaluated with a live model.
- The evaluation suite (`npm run eval`) covers 580 generated cases. It does not replace human review of answer quality.

## Academy
- Required-topic coverage is partial: 35 of 87 topics covered, 14 partial, 38 missing (`ACADEMY_COVERAGE.md`). No separate final assessments yet.
- Gamification: XP, levels, streaks, missions and achievements are built; leaderboards, reminders and a planning calendar are not (no opt-in community; no consented notifications).
- With drafts hidden (production default), courses are listed but cannot be opened until lessons pass expert review.
- Four courses, 29 lessons, 87 quiz questions, 48 diagnostic questions, 7 games and 4 capstones are authored. The full 14-module plan in `ACADEMY_CURRICULUM.md` has at least two lessons per module, not complete module depth.
- All Academy content is AI-drafted and **unreviewed**. It is shown locally behind a "Draft, pending expert review" label, and production refuses to serve it. Nothing is presented as expert-approved.
- Mastery parameters (α = 0.5, threshold 0.8, 3 answers) are unvalidated guesses.
- Capstone rubrics are self-assessed; admin review exists in the API only.
- No admin editor for Academy content; content is edited in source files.
- Reflection answers are kept on the device, not saved.

## Testing
- The browser e2e suite (Playwright, 8 journeys plus a restart-persistence check) runs on the installed Microsoft Edge. Other browsers were not tested.
- No automated accessibility audit (axe). Coverage is semantic markup, keyboard focus, reduced-motion support and a table fallback for the 3D lab.
- No independent penetration test (B-SEC-01).
- `npm audit --omit=dev` reports 0 advisories since the upgrade to Next 16 (the postcss 8.4.31 that Next 15 pinned is gone; see SECURITY_AND_PRIVACY.md). Development-only test tooling (vitest / vite / esbuild / tinypool) still has advisories; it is not shipped.
