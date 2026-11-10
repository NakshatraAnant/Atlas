# ATLAS provider and licensing register

Session 13, 5 Nov 2026. This is the customer-facing summary. The detailed register, with the date each term was read and quoted terms, is [docs/ATLAS_DATA_SOURCE_REGISTER.md](../docs/ATLAS_DATA_SOURCE_REGISTER.md). Exchange-website findings are in [docs/DATA_RIGHTS_AND_PROVIDERS.md](../docs/DATA_RIGHTS_AND_PROVIDERS.md).

Nothing here is legal advice. "Commercial display" means showing the data to paying customers. No paid plan was bought, no terms were accepted on your behalf, and no key was printed or committed.

## Connected providers

All four connected providers updated successfully on 5 Nov 2026. Four stored values were reconciled against each provider's own API on the same day (section "Verification").

| Provider | What ATLAS uses | Access | Update class | Personal / research use | Commercial display to customers | Storage | Redistribution | Attribution | Limits respected |
|---|---|---|---|---|---|---|---|---|---|
| FRED® (Federal Reserve Bank of St. Louis) | 18 macro series; 25 commodity benchmarks (EIA spot, IMF monthly) | Free API key | As published (daily to annual); latest official observation | Yes | **Not cleared.** FRED data belong to the original publishers; some series carry third-party copyright. Needs a per-series check before a paid launch | Local cache | Not cleared | "Source: FRED®, Federal Reserve Bank of St. Louis, and the original source", shown | API rate limit; paced |
| U.S. Energy Information Administration | Weekly crude and gas inventories; WTI futures by contract (history to Apr 2024) | Free API key | Weekly; historical | Yes | Yes, as a U.S. government work (public domain), with attribution | Yes | Yes | "Source: U.S. Energy Information Administration", shown | Paced |
| CoinGecko (Demo plan) | Crypto prices, market capitalisation, volume, metadata | Free Demo key | About every 15 minutes (delayed reference prices) | Yes | **No.** The Demo plan is not a commercial licence. A paid plan is needed for a paid product | Cache refreshed at least daily (their request) | No | "Data provided by CoinGecko", shown | 10,000 calls a month, paced |
| EOD Historical Data (EODHD, free plan) | NIFTY 50, NIFTY BANK, S&P BSE SENSEX end of day, about 1 year | Free key | End of day, final after 20:00 IST | Personal use | **No** (free plan). Individual NSE/BSE shares are not in the plan | Local | No | "Data provided by EODHD", shown | 20 calls a day, quota-aware scheduler |
| Binance, Coinbase public market data (keyless) | Daily candles for long crypto history | Public endpoints | Daily | Personal research | **Not cleared**: terms could not be read in full (PDF / 403) | Local | No | Venue named per series | Paced |
| data.gov.in (Agmarknet) | Mandi prices | Needs `DATA_GOV_IN_API_KEY` | Daily | Yes | Yes, under the Government Open Data Licence – India, with attribution | Yes | Yes, with attribution | — | **Not connected**: no key set |

## Sources that were assessed and not used

| Source | Finding | Status |
|---|---|---|
| NSE website, archives, reports | Terms prohibit systematic or automated collection and electronic storage. Market data is licensed through NSE Data & Analytics | **Blocked**: licence needed |
| NSE Indices (niftyindices.com) | Automated collection needs express written consent; site use is personal and non-commercial | **Blocked**: consent or licence |
| BSE website | Terms could not be read (terms URL returned 404 on 21 Oct; no terms link found) | Treated as not permitted |
| MCX | Automated collection needs written consent | **Blocked** |
| SEBI corporate-filings page | A directory of NSE/BSE links, not a data source | n/a |
| SEC EDGAR (US filings) | Requires a contact address in the User-Agent. Your email may not be used for that | **Requires your action**: choose a contact address to publish |
| Gold and silver (LBMA via FRED) | FRED withdrew the series (404). No permitted free daily source found | **Blocked** |

## Verification on 5 Nov 2026 (stored value vs provider)

| Series | ATLAS stored | Provider returned | Result |
|---|---|---|---|
| FRED DGS10 (10-year Treasury yield) | 30 Oct 4.94, 2 Nov 4.91, 3 Nov 4.95 | Same three values (FRED API) | Match |
| FRED DCOILBRENTEU (Brent, USD/bbl) | 30 Oct 120.15, 2 Nov 107.39, 3 Nov 107.03 | Same three values (FRED API) | Match |
| EIA WCESTUS1 (US crude stocks, thousand bbl) | 23 Oct 410,625; 30 Oct 409,760 | Same two values (EIA API v2) | Match |
| CoinGecko bitcoin (USD) | 80,607 at 07:22 UTC | 80,361 at about 07:35 UTC (public endpoint) | Consistent: 0.3% apart, 13 minutes later |
| EODHD NIFTY 50 | 23,960.6 close on 4 Nov | Not re-requested: the free plan allows 20 calls a day, all used by ATLAS's own refresh | Not independently checked today |

## What a paid launch needs (your decision; nothing was purchased)

1. **Indian shares and fundamentals:** a licensed feed. Options include NSE Data & Analytics (EOD, corporate and master data; tariffs listed in the registry), a paid EODHD plan with the Indian exchange add-on, or a fundamentals vendor. This needs your approval to spend and to accept their terms.
2. **Crypto:** a CoinGecko paid plan (commercial use) or another licensed crypto data vendor.
3. **FRED series:** a per-series check of third-party copyright, or sourcing from the original publishers (BLS, BEA, Federal Reserve) directly. Those are mostly public-domain U.S. government works.
4. **Real-time anything:** a real-time vendor licence. None is free.
