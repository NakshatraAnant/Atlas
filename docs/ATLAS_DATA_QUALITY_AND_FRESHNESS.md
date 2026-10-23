# Data quality and freshness

## Time fields

| Field | Meaning | Where |
|---|---|---|
| observation date | The period a value refers to (trade date, month, week ending) | `equity.prices.trade_date`, `macro.observations.obs_date`, `commodity.observations.obs_date` |
| published_at | FRED's vintage date (`realtime_start`): when FRED began showing this value. A publication-date proxy | `macro.observations`, `commodity.observations` (FRED API) |
| retrieved_at / imported_at | When ATLAS fetched it | every observation table |
| updated_at / revised_at | When ATLAS last changed the stored row | every observation table |

Retrieval time is never shown as the observation time.

## Freshness states (`apps/api/src/lib/freshness.ts`)

The age of the newest observation is compared with how old it normally is when the series is up to date, meaning its reporting period plus the usual publication lag:

| Cadence | Fresh up to | Calibration (real FRED/EIA data, 23 Oct 2026) |
|---|---|---|
| daily | 5 days | weekends plus a holiday |
| daily, published weekly (Fed H.10: INR/USD, dollar index) | 12 days | H.10 is released weekly |
| weekly | 13 days | EIA inventories (week ending Friday, released the following Wednesday or Thursday) |
| monthly | 95 days | core PCE for August was 83 days old in late October |
| quarterly | 215 days | US GDP Q2 (dated 1 April) was 205 days old just before the Q3 release |
| annual | 915 days | World Bank GDP for year Y appears mid-Y+1 and is replaced mid-Y+2 |

- **Delayed:** up to 1.5 × that age.
- **Stale:** older than that.
- **Provider error:** the last update failed and the data is no longer fresh.
- **Discontinued:** the source stopped publishing the series (EIA WTI futures after 5 Apr 2024; OECD India CPI after March 2025 shows as stale).
- **Unavailable:** nothing is stored.

Indian indices use exchange sessions instead: "current" when the latest expected session (weekdays after 20:00 IST, minus holidays ATLAS has evidence for) is stored; otherwise "N sessions behind".

## Validation rules

| Data | Rules |
|---|---|
| Indian indices (EODHD) | OHLC consistency, positive prices, no future dates, no duplicate dates (quarantined with reasons); moves above 20% flagged `suspect` and kept; **flat zero-volume rows** (EODHD's holiday filler) quarantined as `no_trading_placeholder`; **rows for a session before 20:00 IST** not stored (provisional) and withdrawn if stored earlier, with history kept; changed values kept in `price_revisions` |
| Commodities (FRED/EIA) | Blank or "." values are missing days, never zero; negative prices accepted (WTI −36.98 on 20 Apr 2020); returns, volatility and drawdowns across zero or negative prices are refused and counted; negative inventories and non-positive indices quarantined; revisions kept |
| Macro (FRED) | "." values are missing; revisions kept with the previous value and its vintage; a series is re-downloaded only when FRED reports a change |
| Mandi prices (data.gov.in) | Dates must parse (dd/mm/yyyy); a row without a positive modal price is rejected, not repaired |
| Crypto | Session 8 rules (`docs/crypto/`): OHLC checks, duplicates, gaps left as gaps, outliers flagged |

## Holidays

No permitted official NSE holiday list is available: EODHD's `exchange-details` returns 404 on the current plan, and NSE's own site may not be collected automatically. ATLAS records a weekday as "no session observed" when at least three tracked index series with data on both sides have no row. With the filler rows removed, this found 15 days in the last year, including 25 Dec, 26 Jan, Holi, Good Friday, 1 May, 2 Oct and 20 Oct.
