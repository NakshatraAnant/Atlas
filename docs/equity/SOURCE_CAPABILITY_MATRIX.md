# Indian equity data: source capability matrix

Research dates: 20–21 Oct 2026 (official exchange sites, recorded in `apps/api/src/modules/datahealth/providers.ts`) and 23 Oct 2026 (third-party APIs). Live tests were made from this machine with each provider's **public demo key**; no account was created and no key is stored in the repository.

## Decision

| Rank | Provider | Status in ATLAS | Why |
|---|---|---|---|
| 1 | **EODHD** (EOD Historical Data) | Adapter built and tested on real response shapes; **needs your key** (`EODHD_API_TOKEN`) | Documented `SYMBOL.EXCHANGE` tickers (its own site lists NSE securities as `.NSE`); returns raw OHLC **and** a split- and dividend-adjusted close, so raw and adjusted series can be kept apart. Free plan: 20 calls/day + 500 welcome calls, past year only, personal use. |
| 2 | **Alpha Vantage** | Adapter built and tested on real response shapes; **needs your key** (`ALPHAVANTAGE_API_KEY`) | Documents BSE daily prices (`RELIANCE.BSE`). Free keys: "compact" output (latest 100 trading days). Adjusted series is premium (not used). Terms PDF unreadable → unverified. |
| — | Twelve Data | Not used | Free (Basic) plan reported as US equities, forex and crypto only; NSE appears on paid tiers. |
| — | Financial Modeling Prep | Not used | Free plan reported as US-only; docs page returned HTTP 403 to automated reading. |
| — | NSE website, NSE Indices, BSE website | Not fetched | Terms prohibit automated collection (NSE), need written consent (NSE Indices) or could not be read (BSE). Unchanged since 21 Oct. |

## Verified behaviour (23 Oct 2026, demo keys)

| Request | Result | ATLAS handling |
|---|---|---|
| EODHD `eod/AAPL.US?api_token=demo` | 200, JSON array of `{date, open, high, low, close, adjusted_close, volume}` | Fixture `apps/api/test/fixtures/equity/eodhd-eod-aapl.json`; parser test |
| EODHD `eod/RELIANCE.NSE?api_token=demo` | 403 `Forbidden` | Entitlement error; provider marked `not_entitled`; job failed; no data |
| Alpha Vantage `TIME_SERIES_DAILY&symbol=IBM&apikey=demo` | 200, `Time Series (Daily)` | Fixture `av-daily-ibm.json`; parser test |
| Alpha Vantage `…symbol=RELIANCE.BSE&apikey=demo` | **200** with an `Information` message instead of data | Classified as an entitlement error, never as data |

## Coverage you get with a key

| Field | EODHD | Alpha Vantage |
|---|---|---|
| NSE shares, daily OHLCV | ✓ (`.NSE`) | — |
| BSE shares, daily OHLCV | not verified (map explicitly) | ✓ (`.BSE`), latest 100 days |
| Indices (Nifty, Sensex) | possible via index tickers; ATLAS requires an explicit provider symbol and validates it with a successful response | — |
| Adjusted prices | ✓ provider `adjusted_close` → adjusted OHLC = raw × (adjusted ÷ close), applied once | — (premium) |
| Corporate actions as records | not used (separate endpoints, not evaluated) | — |
| Fundamentals | not available on free plans | — |
| Intraday, derivatives, breadth, constituents | not available | — |

## How data is handled

- **Classification** (`equity.price_series.classification`): `REAL_UNVERIFIED` (one provider), `REAL_VERIFIED` (reserved for a second-source cross-check, not yet available). Uploaded files are `USER_IMPORTED` and stay private in `app.user_datasets`. Synthetic development companies (`SYNTHETIC_DEMO`, `ref`/`market` schemas) are never selectable in research, portfolios, alerts or reports.
- **Import** (`modules/equity/ingest.ts`): one job per request with received / stored / unchanged / corrected / rejected counts; dry-run mode; validation (dates, future dates, OHLC integrity, positivity, duplicates); invalid rows quarantined; changed values kept in `equity.price_revisions`; idempotent upserts; provider health and error category recorded; API keys never written to jobs, errors or logs.
- **Refresh**: imported instruments refresh incrementally every ~20 hours while ATLAS runs, only for configured providers.
- **Market status**: never inferred from the computer's clock; values are end-of-day closes dated by the provider.

## Setup

1. Create your own key (EODHD and/or Alpha Vantage), and read and accept the provider's terms.
2. Add to `.env.local` (git-ignored): `EODHD_API_TOKEN=…` and/or `ALPHAVANTAGE_API_KEY=…`.
3. `node scripts/atlas.mjs restart`.
4. Sign in as an administrator (two-step verification) → **Indian equities** → Import (try a dry run first).
