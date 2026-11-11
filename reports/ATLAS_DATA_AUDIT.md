# ATLAS data audit

11 Nov 2026, on a consistent snapshot of the live database (`data/pglite`, copied with ATLAS stopped), plus direct requests to the providers' own APIs. Read-only: nothing was changed by the audit queries.

## Scope and method

Every stored series in the four data domains:
- **Equity:** 6 index series.
- **Commodities:** 31 series.
- **Macro:** 18 series.
- **Crypto:** 144,180 daily candles across the stored assets and venues.

**Checks for each series:**
- **Integrity.** Duplicates; impossible values (non-positive prices, a high below the low, a close outside the day's range); nulls.
- **Metadata.** Stored counts, first and last dates against the actual rows.
- **Plausibility.** Extreme moves, cross-checked against related series.
- **Freshness.** Freshness against each series' publication schedule.
- **Reconciliation.** Values compared with the provider's API.

## Results

| Domain | Integrity | Metadata vs data | Extreme moves | Reconciliation |
|---|---|---|---|---|
| Indian indices (EODHD) | 0 non-positive, 0 bad OHLC, 0 not valid, 0 quarantined | All 6 series match | The 4–9 Nov rally (+5.5% NIFTY 50) appears in all three indices together, so it is consistent. 8 Nov (Sunday) is the Diwali Muhurat session; 10 Nov has no row (a market holiday) | EODHD was not re-requested, to save the 20-call daily quota. Cross-index consistency checked instead |
| Commodities (FRED, EIA) | The only non-positive values are the known WTI −36.98 day (20 Apr 2020), in both the spot and contract-1 series | All 31 match | Henry Hub gas $30.72 on 23 Jan 2026; propane +32% on 30 Oct 2026 | **Exact match with FRED** for both extreme moves; **exact match with EIA** for the latest three crude-stock weeks |
| Macro (FRED) | 0 nulls | All 18 match | — | **DGS10: the latest five days match FRED exactly** (4.95, 4.90, 4.84, 4.86, 4.88) |
| Crypto (CoinGecko, Binance, Coinbase) | 0 non-positive, 0 bad OHLC; **82 candles flagged "suspect"** (moves over 50% a day) | All series match | Real events: ADA +72% (2 Mar 2025), XRP (13 Jul 2023), TRX (3 Dec 2024). **Bad prints:** Figure Heloc, a ~$1 asset, shows $0.23 and $0.50 for single days, flagged suspect | CoinGecko BTC 74,475 against the Binance daily close of 73,796 the day before: consistent |

**Freshness on 11 Nov:**
- **Indian indices:** 11 Nov.
- **FRED daily:** 9–10 Nov.
- **FRED monthly:** October.
- **EIA weekly:** 30 Oct (next release 12 Nov).
- **CoinGecko:** within the last 15 minutes.
- **India CPI:** last observation March 2025. The source stopped publishing; ATLAS labels it stale.

## Findings fixed in this session

1. **Flagged crypto values were not disclosed where they mattered most.**
   - ATLAS keeps extreme moves (crypto really does move 50% in a day) and flags them, and the price table showed the flag.
   - But an asset's drawdown and volatility included the flagged closes without saying so. Figure Heloc's two bad prints, for example, produce a −77% "drawdown" that never happened.
   - The analytics now list the flagged dates included, and the page warns before you rely on those measures.
2. **Sharpe ratio of constant returns.** A series with no variation (a flat cash rule, a pegged asset) produced a floating-point artefact instead of "not defined". The values were on the order of 10^16. Fixed in the shared analytics and in the new Academy calculations, with regression tests.

## Not defects (checked)

- **Stale crypto snapshots.** Five assets still have snapshots from 24 Oct to 5 Nov. They dropped out of CoinGecko's top 100 and are marked "not in latest snapshot", so the overview already leaves them out.
- **XRP on Coinbase: a jump from 0.30 to 0.82.** The venue delisted XRP in January 2021 and relisted it on 13 July 2023. The "previous close" is two years earlier; ATLAS's return calculations break chains across such gaps.
- **The indices showed "due" on 11 Nov morning.** 10 Nov had no session. ATLAS cannot know a holiday until later data arrives, so "due" was the honest label.
