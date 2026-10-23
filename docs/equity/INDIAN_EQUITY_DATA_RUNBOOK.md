# Indian equity data runbook (EODHD free plan)

Last updated 23 Oct 2026 (session 10). Code: `apps/api/src/modules/equity/` (`providers.ts`, `quota.ts`, `ingest.ts`, `operations.ts`, `analytics.ts`, `routes.ts`); schema: migrations `011` and `012`; page: **Indian equities** (`/app/equities`).

## 1. What the provider allows (checked 23 Oct 2026)

| Fact | Value | Source |
|---|---|---|
| Daily allowance, free plan | 20 API calls | eodhd.com/pricing, /financial-apis/api-limits |
| Per-minute limit, free plan | 20 requests | eodhd.com/pricing |
| Reset | midnight GMT (05:30 IST), applied lazily at the first request after midnight | api-limits page |
| Welcome bonus | 500 calls (`extraLimit`), spent by the provider only after the daily allowance | api-limits page |
| History | 1 year of end-of-day prices | pricing page |
| Fundamentals | **not included** in the free plan (10 calls each on paid plans) | pricing page |
| Cost per request | end-of-day 1, splits 1, dividends 1, exchange details 1, usage (`/api/user`) 0, bulk 100+ | api-limits page |
| Errors | 401 bad token; 402 daily allowance spent; 403 not permitted for the plan/ticker; 429 per-minute limit | api-limits page; 403 verified with the demo token |
| Ticker format | `SYMBOL.NSE`; indices `CODE.INDX` (e.g. `NSEI.INDX`, `BSESN.INDX`) | EODHD symbol pages; **index codes unverified until the first response** |
| Licence | the free plan sits under "personal plans". ATLAS keeps data locally for your own research. Nothing in ATLAS implies a right to redistribute | pricing page |

Response shapes recorded with the public demo token: `/api/user`, splits and dividends (`apps/api/test/fixtures/equity`). End-of-day rows were recorded for a US ticker; the demo token returns 403 for Indian tickers. **The exchange-details (holiday) response for NSE has not been seen yet.** Its parser accepts only the documented shape and rejects anything else.

## 2. Configure your key (you do this; ATLAS never asks for it in chat)

1. **If a key was ever pasted into a chat, email, screenshot or file, treat it as exposed.** Rotate it in the EODHD dashboard and use only the new one.
2. Edit `.env.local` in the ATLAS folder (git-ignored):
   ```
   EODHD_API_TOKEN=<your new key>
   ```
   `EODHD_API_KEY` is accepted as an alias.
3. Restart:
   ```bash
   node scripts/atlas.mjs restart
   ```
4. Run `npm run check:secrets` before any commit (it fails if a key appears in tracked files).

The key is read server-side only. It is never sent to the browser, and it is never written to job records, request logs or error messages: URLs are not stored, and `redact()` masks `api_token`/`apikey` wherever a URL could appear.

## 3. Daily budget

| Purpose | Calls/day | Used for |
|---|---|---|
| refresh | 12 | tracked instruments that already have data (one call each brings every new session since the last one) |
| backfill | 2 | first import of a newly added instrument (one call = up to a year of history) |
| validation | 2 | NSE holiday calendar (once a year), then one instrument's splits and dividends a day |
| manual | 2 | administrator imports from the page |
| reserve | 2 | only when an administrator ticks "use reserve" on a manual import |

- Every call is charged in `equity.quota_days` **before** it is sent, with one conditional `UPDATE`, so concurrent jobs cannot overspend.
- A refused call is never sent; it is logged as `not_sent_budget` in `equity.provider_requests`.
- At the start of each run ATLAS asks `/api/user` (0 calls) for the provider's own count. If that count is higher (another app on the same key), the provider's figure plus ATLAS's calls since then is what counts.
- HTTP 402 marks the day exhausted: no further calls until the reset.
- HTTP 401 opens a circuit: no calls until the key is fixed and ATLAS restarted.
- 403 and 404 park that instrument for 7 days and mark its mapping `failed`.
- Timeouts, network errors and 5xx retry after 6 hours.
- Nothing is retried in a loop.
- Requests are spaced at least 3.1 s apart (20 per minute).
- With a paid plan, set `EODHD_DAILY_LIMIT`. The split defaults to 60/10/10/10/10, or set `EODHD_QUOTA_BUDGETS=refresh=…,backfill=…,validation=…,manual=…,reserve=…`; the budgets must add up to the limit or ATLAS refuses to start.

## 4. Universe and refresh

- **Add instruments:** Indian equities → Data operations → Tracked universe (administrator with two-step verification).
  - "Add starter list" adds NIFTY 50, SENSEX and ten large NSE shares as identifiers only.
  - Adding never calls the provider. A mapping stays `unverified` until the provider answers for it.
- **Order:** priority 1 → 5, then the instruments that have waited longest. With the free plan, two new instruments are imported a day; the starter list fills in six days.
- **Schedule:** runs at 08:00 and 20:30 IST (checked every 10 minutes; one run per slot; survives restarts because the last run is read from `equity.refresh_runs`).
  - "Refresh now" runs the same procedure immediately, within the same budgets.
- **Expected session:** the latest weekday after 20:00 IST, skipping holidays ATLAS has evidence for. EODHD does not document when Indian end-of-day data is complete, so 20:00 IST is an assumption.
  - Instruments already at that session cost nothing.
  - An instrument whose provider has nothing newer is not asked again for 6 hours.
- **Removing** an instrument stops its refresh. Stored prices are kept.

## 5. Calendar

Every entry in `equity.calendar_days` names its source:
- `eodhd_exchange_details`: the official list, if the plan allows that endpoint. A refusal is not retried for 30 days.
- `inferred_from_data`: a weekday on which at least three tracked series with data on both sides have no row. Removed automatically if a row for that day appears later.
- `user`: added by an administrator through the API.

ATLAS never invents a holiday. Without a list, only weekends and inferred days are excluded, and "missing sessions" may include real holidays (the page says so).

## 6. Data quality and corrections

- Rows are validated (OHLC consistency, positive prices, no future dates, no duplicates) or quarantined with reasons.
- Moves above 20% are kept and flagged `suspect`.
- A re-import that changes a stored value keeps the old value in `equity.price_revisions`.
- Raw (as-traded) and provider-adjusted (splits + dividends) series are stored separately; adjustments are never applied twice.
- Splits from the provider are checked against the adjusted series ("Split checks" on the instrument page).
- Classification: everything from one provider is `REAL_UNVERIFIED`. `REAL_VERIFIED` requires a second independent source, and none is configured.

## 7. Analytics on equity sessions

- One observation = one trading session.
- Returns run over 1/5/21/63/126/252 sessions. Volatility uses session log returns × √252; a gap longer than 5 calendar days breaks the chain.
- Indicators: RSI (Wilder), MACD (12, 26, 9), momentum, rolling returns, relative strength against NIFTY 50 on shared dates only, and opening gaps.
- Definitions are in `packages/shared/src/technical-indicators.ts`, with hand-checked tests.
- Walk-forward backtests in the Research hub accept equities, with windows counted in sessions (engine `sma-trend-walkforward-sessions-1`).

## 8. Fundamentals

EODHD's free plan has no fundamentals, and ATLAS holds no licence to supply them. Indian equities → **Financial statements you import** (`/app/equities/statements`) accepts a CSV of figures from documents you obtained yourself:
- every row must pass and cite its source;
- figures are stored in rupees and kept private to you;
- they are deleted with your account.

Ratios use only your rows. P/E combines the latest stored provider close with your diluted EPS, and shows both dates.

## 9. Demo data

The fictional development companies (Companies, Market, Screener, Quant Lab, Assistant, briefings) are demo mode:
- on by default outside production, with a persistent "Demo data" banner on each of those pages;
- refused in production;
- `ALLOW_SYNTHETIC_DATA=false` disables it: nothing synthetic is generated (`NoVendor`) and those API sections answer 403.

Real Indian prices never mix with demo data.

## 10. Live acceptance test (after you configure a rotated key)

1. `node scripts/atlas.mjs restart`. Data operations shows "EODHD calls left today: N of 20" and the provider's reported usage after the first run.
2. Add `NSE:RELIANCE` (priority 1), then "Refresh now". Expected: one backfill call, about 250 sessions stored (raw and adjusted), mapping `verified`, and a request log entry `eod … ok (HTTP 200)`.
3. Add `INDEX:NIFTY50` with provider code `NSEI.INDX` and refresh. Either data, or a clear 403/404 with the mapping marked `failed`; record which.
4. Check the instrument page for chart, metrics and freshness "current" (after 20:00 IST on a session day).
5. Record the date, the calls spent, and any provider difference in `docs/execution/TEST_RESULTS.md`.

Status on 23 Oct 2026: **blocked pending your rotated key.** Every step above is covered by automated tests with recorded response shapes. No live Indian response has been received yet.

## 11. Troubleshooting

| Symptom | Meaning | Action |
|---|---|---|
| "not configured" | no key in `.env.local` | §2 |
| health `not_entitled`, last error `auth` | key rejected (401) | fix the key, restart |
| `quota_exhausted` with HTTP 402 | provider allowance spent | wait for 05:30 IST |
| `deferred (budget)` in a run | ATLAS budget spent; nothing was sent | wait, or raise the limit if your plan allows |
| mapping `failed` (403/404) | wrong code or not in your plan | correct the provider code and re-add (clears the wait) |
| a different count from the provider | another app uses the key | ATLAS already counts the provider's figure |

Backups (`node scripts/atlas.mjs backup`) include all of this data. The database before migration 012 was backed up on 23 Oct 2026 (`backups/atlas-backup-2026-10-23_09-26-22.tar.gz`).
