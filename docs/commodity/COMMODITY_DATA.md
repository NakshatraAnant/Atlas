# Commodity data (session 10, 23 Oct 2026)

Code: `apps/api/src/modules/commodity/` (`sources.ts`, `ingest.ts`, `routes.ts`); analytics in `packages/shared/src/commodity-analytics.ts`; schema: migration `013_commodities.sql`; pages: **Commodities** (`/app/commodities`).

## Categories (kept separate, never blended)

| Category | Status | Source |
|---|---|---|
| Global benchmark prices | **live, verified 23 Oct 2026** | FRED CSV downloads (no key) of EIA daily spot prices and IMF monthly average prices |
| Indian exchange-traded futures (MCX, NCDEX) | **not available** | licensed exchange data; no permitted free source found. Nothing is shown in its place |
| Physical and fundamental data | **implemented, not verified** (needs your key) | EIA open-data API v2: US crude stocks (weekly), NYMEX WTI futures by contract position 1–4 (daily). Set `EIA_API_KEY` in `.env.local` (free key from eia.gov/opendata). The parser follows EIA's documented shape and has not yet seen a real response |

## Sources checked

- **FRED** (`fred.stlouisfed.org/graph/fredgraph.csv?id=…`):
  - 25 series fetched from this machine: 8 daily/weekly EIA spot/retail series and 17 monthly IMF series. The list is in `sources.ts`.
  - Blank values mark days without an assessment (e.g. US holidays) and are counted as missing, never stored as zero.
- **EODHD commodities API**: the same FRED series, but 5 API calls per request out of the free plan's 20 a day. Not used; FRED is the primary aggregator and costs no quota.
- **EIA API v2**: refuses requests without a key (verified).
- **Gold and silver**: the LBMA series on FRED return 404, and no free permitted daily source was found. Not available.
- **Indian physical prices** (Agmarknet via data.gov.in): need a separate key; not evaluated in this release.

## Data handling

- **Storage:** one row per series per date in `commodity.observations` (`numeric(24,8)`).
- **Idempotent upserts:**
  - changed values keep their previous value in `commodity.revisions`;
  - invalid rows (bad date, not a number, future date, negative inventory, non-positive index) go to `commodity.quarantine`;
  - each import is a job with counts, including `missing_values`.
- **Negative prices are real data** (WTI spot −36.98 USD on 20 Apr 2020) and are stored as published:
  - returns across a zero or negative price are undefined and are skipped and counted;
  - drawdown is not reported for a window that contains one;
  - the Research hub leaves such days out of a commodity series and says how many.
- **Refresh:**
  - each enabled series at most once every 20 hours, one request at a time with a 1-second pause;
  - checked every 3 hours, with the first check about 90 seconds after start;
  - a 429 stops the run;
  - one refresh at a time (scheduled and manual share a lock);
  - jobs interrupted by a stop are marked failed at the next start.
- **Bulk writes:** set-based inserts in chunks of 2,000. A full 10,000-row daily history takes seconds (it took about a minute with row-by-row inserts, found on the live run).

## Analytics (each with hand-checked tests)

- **Changes** over 1 month, 3 months, 1 year and 5 years, measured from the last observation at or before that date. Not reported if the base is missing or more than 10 days early.
- **Volatility** at the series' own frequency: daily ×√252 (business-day assessments), weekly ×√52, monthly ×√12. Returns across gaps longer than 5, 10 or 35 days are excluded.
- **Seasonality:** average change by calendar month over at most the last 15 years.
  - Daily and weekly series use month-end values; monthly IMF series use their monthly averages (stated).
  - Months with fewer than 5 years of history are flagged.
- **Spreads:** Brent − WTI; heating oil, ULSD and jet cracks (× 42 gallons per barrel − WTI). On shared dates only, with mean, range and percentile over 3 years. A simple 1:1 crack, not a refinery margin.
- **Term structure** (with EIA data):
  - contango or backwardation from positions 4 vs 1 (±0.25% band);
  - roll-yield proxy (C1/C2 − 1) × 12;
  - a position series rolls to the next contract after expiry, so it is not one contract (stated).
- **Inventories:** latest week against the same week of up to 5 earlier years (z-score).
- **Correlations** with series of the same frequency, over 3 years on shared dates.
- **Research hub:** daily series as `commodity:fred:<ID>` in the workbench, portfolios, alerts and reports. Weekly and monthly series are refused there with a reason, because aligning them with daily instruments would change their meaning.

## What a reader must not assume

- None of these is an Indian price, a tradable quote or live data.
- EIA spot prices are assessments at US locations; IMF prices are monthly averages of world prices.
- Values are in the source's currency and unit; no FX conversion is applied.
