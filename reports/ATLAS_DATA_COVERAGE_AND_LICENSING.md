# ATLAS data coverage and licensing

Session 12, 30 Oct 2026. The detailed provider register, with verification dates and quoted terms, is [docs/ATLAS_DATA_SOURCE_REGISTER.md](../docs/ATLAS_DATA_SOURCE_REGISTER.md). This report summarises what customers can see, what they cannot see and why, and what changed in this session.

Status words used here: **completed**, **tested**, **failed**, **blocked**, **requires your action**.

## 1. What customers see (real-data mode, `ALLOW_SYNTHETIC_DATA=false`)

| Area | Datasets | Provider | Timeliness | Licence basis | Status |
|---|---|---|---|---|---|
| Indian indices | NIFTY 50, SENSEX, NIFTY BANK, about 1 year of daily closes | EODHD free plan | End of day, final after 20:00 IST. Never labelled live | Personal use (free plan) | Completed, tested. Closes stored to 29 Oct 2026 at baseline |
| Macro | 18 FRED series: US CPI, core CPI, core PCE, fed funds, 2y/10y/real 10y yields, 10y–2y, unemployment, payrolls, real GDP, St. Louis stress, NFCI, INR per USD, broad dollar, India GDP and CPI | FRED API | As released, from daily to annual. Vintage (first published) date stored per value; revisions recorded | FRED terms: data belong to the original sources; research use | Completed, tested |
| Commodities | 25 FRED benchmark series (crude, gas, metals, grains), EIA weekly crude and gas inventories, WTI futures term structure up to 5 Apr 2024 | FRED API, EIA API v2 | Daily, weekly or monthly. Futures are history only, because EIA stopped publishing them | U.S. government work (EIA); FRED terms | Completed, tested |
| Digital assets | Market snapshot, global metrics, coin metadata, 1-year daily reference history | CoinGecko Demo, plus keyless venue, DeFi and on-chain sources (session 8) | About 15 minutes, paced to 10,000 calls a month | Attribution; Demo is not a commercial licence | Completed, tested |
| Mandi prices | Agmarknet daily prices | data.gov.in | Daily | Government Open Data Licence – India | **Requires your action**: set `DATA_GOV_IN_API_KEY` |
| Your own data | CSV price files you upload | You | n/a | Yours | Completed (prior session) |

## 2. What customers cannot see, and why

| Wanted | Why it is absent | What would unblock it | Status |
|---|---|---|---|
| Individual NSE/BSE shares, live or end of day | The EODHD free plan returns 404 for NSE/BSE tickers. NSE and BSE terms prohibit automated collection and redistribution | A paid EODHD plan with the Indian exchange add-on, or an NSE/BSE data licence | **Blocked**: needs your approval to spend |
| Company financials, screener, peer comparison | No licensed Indian fundamentals source. The SEC EDGAR API (US filers only) requires a contact address in the User-Agent, and your email may not be used for that | A fundamentals vendor licence. For EDGAR, a contact address you choose to publish | **Blocked**: requires your action |
| Real-time prices | No source licenses real-time redistribution at no cost | A real-time vendor licence (paid) | **Blocked** |
| MCX and Indian futures and options | MCX terms prohibit automated collection without written consent | An MCX data feed agreement | **Blocked** |
| Gold and silver | FRED withdrew the LBMA series (404). No permitted free daily source was found | A licensed precious-metals feed | **Blocked** |

Search answers these requests with the reason instead of returning nothing (`KNOWN_GAPS` in `apps/api/src/modules/ops/searchRoutes.ts`, tested in `apps/api/test/discovery.test.ts`).

## 3. Changes in this session

- **Macro history is no longer truncated.** Series pages return the full history for non-daily series and ten years for daily series. The year-on-year chart covers the full history.
- **Catalogue notes stay in sync.** The macro series description is updated on every catalogue sync (previously it was written only once). This carries the corrected note for DEXINUS and DTWEXBGS: they are H.10 series, published weekly on Mondays.
- **Relationship explorer.** Any two stored series (macro, commodity benchmark, Indian index) can be compared on a monthly or weekly basis, with Pearson correlation of period changes and a rolling window. It refuses to compare a monthly series weekly and states its method and caveats. Tested with known-answer cases.
- **Home "What changed".** It lists FRED observations whose vintage date falls in the last 7 days (monthly and slower series), and the largest one-month moves in daily commodity benchmarks. It uses stored data only.
- **Follows.** A follower is told once per newer observation period, and never about the backlog that existed when they followed. Tested.
- **No new external provider was added.** No money was spent, and no key was added, printed or committed.

## 4. Provenance shown to customers

Each series page shows:
- the source and its URL;
- the period the value refers to;
- the vintage date (macro);
- when ATLAS retrieved the value;
- the source's own last-updated time;
- a freshness state with its rule (fresh, delayed, stale, unavailable, provider error, discontinued).

Expected ages are: daily 5 days, weekly 13, monthly 95, quarterly 215, annual 915; H.10 FX series 12.

## 5. Synthetic data

- Synthetic data is off for customers (`ALLOW_SYNTHETIC_DATA=false`). Demo-only API prefixes answer 403 "Demo data disabled".
- The baseline QA crawl found Home calling five demo-only endpoints before it knew the account mode. This is fixed: Home waits for the account first. The crawl after the fix is reported in [ATLAS_BUG_AND_REGRESSION_REPORT.md](ATLAS_BUG_AND_REGRESSION_REPORT.md).
