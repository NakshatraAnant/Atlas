# ATLAS real-data coverage

Measured from the running local installation on 5 Nov 2026 (session 13), in real-data mode (`synthetic_data: false` at `/readyz`). Licensing is in [ATLAS_PROVIDER_AND_LICENSING_REGISTER.md](ATLAS_PROVIDER_AND_LICENSING_REGISTER.md).

## Coverage by area

| Area | What is stored | Provider | Latest observation (5 Nov) | Update classification | Status |
|---|---|---|---|---|---|
| Indian indices | NIFTY 50, NIFTY BANK, S&P BSE SENSEX: daily OHLC, about 1 year | EODHD (free) | 4 Nov 2026 close; 0 sessions behind | End of day (final after 20:00 IST) | Completed, tested |
| Indian shares | — | — | — | — | **Blocked**: not in the free plan; licence needed |
| Company financials | Only statements you import yourself (`/app/equities/statements`) | You | — | User-supplied | Provider data **blocked** |
| US and India macro | 18 FRED series (inflation, rates, labour, activity, financial conditions, FX, India GDP and CPI) | FRED | Daily series to 3–4 Nov; monthly to Sep 2026; quarterly to Q3 2026 | As published; vintage date stored | Completed, tested. 17 fresh, 1 stale (India CPI, OECD MEI, last value Mar 2025, labelled stale) |
| Commodities | 31 series: crude, gas, products, metals, grains (FRED: EIA spot, IMF monthly); EIA weekly inventories; WTI futures by contract (history) | FRED, EIA | Daily spot to 3 Nov; weekly inventories to 30 Oct | Latest official observation; 4 discontinued series labelled discontinued | Completed, tested |
| Gold, silver | — | — | — | — | **Blocked**: FRED withdrew LBMA series; no permitted free daily source |
| Digital assets | 50 assets: snapshots (price, market cap, volume), long daily history (Coinbase/Binance candles), DeFi and on-chain metrics | CoinGecko Demo, Binance, Coinbase, DefiLlama, node providers | Snapshot 5 Nov 07:22 UTC; daily candles to 4 Nov | Delayed (~15 min) snapshots; daily history | Completed, tested |
| Indian mandi prices | — | data.gov.in | — | Daily | **Requires your action**: `DATA_GOV_IN_API_KEY` |
| Derivatives (F&O, options, OI, IV) | — | — | — | — | **Blocked**: exchange licence needed |
| Real-time prices | — | — | — | — | **Blocked**: no free real-time licence |
| Your uploads | CSV price series | You | — | User-supplied, private | Completed |

## How freshness is labelled

Every series carries a state with its rule: fresh, delayed, stale, unavailable, provider error or discontinued. Expected ages are daily 5 days, weekly 13, monthly 95, quarterly 215 and annual 915 (H.10 FX series 12). Nothing end-of-day or monthly is ever called live.

## Data-integrity defect found and fixed this session

- **Symptom:** Index pages analysed a stale adjusted series (to 22 Oct) while Home showed the 4 Nov close.
- **Fix:** Indices now always use the as-traded series, and a lagging adjusted series is never used for shares.
- **Tests:** two regression tests in `apps/api/test/equity.test.ts`.
- **Live check:** all three indices current to 4 Nov.

## Reconciliation

Four stored values were checked against the providers on 5 Nov; three matched exactly and one was consistent within the refresh interval (details in the register). EODHD was not re-requested, to protect the 20-call daily quota.

## Synthetic data

- **Customers:** synthetic data is off (`ALLOW_SYNTHETIC_DATA=false`), and demo-only endpoints answer 403.
- **Where it remains:** in test fixtures and in the demo screener, which shows a persistent banner and is disabled in real-data mode.
