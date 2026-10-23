# ATLAS data source register

Verified 23 Oct 2026 from this machine. Keys live only in `.env.local` (git-ignored) and are never written to logs, job records, API responses or documents. "Verified" means a real response was received and stored; "implemented, unverified" means code and tests exist but no real response has been seen yet.

## Integrated providers

| Provider | Datasets in ATLAS | Access and auth | Limits (verified or documented) | History | Update frequency | Rights | Status |
|---|---|---|---|---|---|---|---|
| **EODHD** | Indian indices: NIFTY 50 (`NSEI.INDX`), SENSEX (`BSESN.INDX`), NIFTY BANK (`NSEBANK.INDX`) | REST, `EODHD_API_TOKEN` | Free plan: 20 calls/day, 20/min; reset midnight GMT; usage via `/api/user` (free) | 1 year (247 sessions after cleaning) | End of day; final after 20:00 IST | Personal use (free plan) | **Verified** for indices. NSE/BSE shares return 404 "Ticker Not Found" on the free plan. `exchange-details` returns 404 |
| **FRED API** (St. Louis Fed) | 18 macro series (US inflation, rates, labour, activity, financial conditions, INR/USD, India GDP and CPI); 25 commodity benchmark series | REST, `FRED_API_KEY` | 120 requests/min (documented) | Full series history | As each series is released (daily to annual) | FRED data belong to the original sources; personal research use | **Verified** (metadata, observations, vintages) |
| **FRED public CSV** | Fallback for the commodity series when no FRED key is set | No key | None published; ATLAS paces 1 request/s | Full | Daily | as above | **Verified** (used before the key was configured) |
| **EIA API v2** | US crude stocks ex-SPR (`WCESTUS1`, weekly); Lower-48 natural-gas storage (`NW2_EPG0_SWO_R48_BCF`, weekly); NYMEX WTI futures by contract position (`RCLC1`–`RCLC4`) | REST, `EIA_API_KEY` | 5,000 rows per response (ATLAS pages); rate limits per key (429 handled) | Inventories from 1982 / 2010; futures 1983 → **5 Apr 2024** | Weekly (inventories) | U.S. government work | **Verified**. EIA stopped publishing futures prices after 5 Apr 2024, so term structure is history only |
| **CoinGecko** (Demo plan) | Crypto markets, global metrics, coin metadata, reference history | REST, header `x-cg-demo-api-key`, `COINGECKO_DEMO_API_KEY` (alias `COINGECKO_API_KEY`) | 100 calls/min, **10,000 calls/month**; usage endpoint is paid-only (401), so usage is counted by ATLAS | 1 year daily | About every 15 min (paced to the monthly cap) | Attribution required; Demo is not a commercial licence | **Verified** (`/ping`, `/simple/price`) |
| **Binance, Coinbase, DefiLlama, PublicNode, mempool.space, GitHub, Ethereum Foundation blog** | Venue candles, DeFi, on-chain, events (session 8) | Keyless | Per-source budgets (session 8) | Binance from 2017, Coinbase from 2015 | Per job | Per each source's terms (`docs/crypto/SOURCE_CAPABILITY_MATRIX.md`) | **Verified** (session 8) |
| **data.gov.in** (Agmarknet mandi prices, resource `9ef84268-d588-465a-a308-a864a43d0070`) | Daily mandi prices: min, max and modal ₹/quintal per market | REST, `DATA_GOV_IN_API_KEY` | Not documented; the shared sample key returned 429 | Current day only (ATLAS accumulates history) | Daily | Government Open Data License – India (use with attribution; per secondary sources, as the official page did not render the clause text) | **Implemented, unverified**: needs your key |

## Indian exchange sources evaluated and not integrated

| Source | Finding (read 23 Oct 2026) | Decision |
|---|---|---|
| NSE (nseindia.com, all reports, bhavcopy, derivatives) | Terms of use: "User is prohibited to conduct any systematic or automated data collection activities (including scraping, data mining, data extraction and data harvesting)", and content may not be "stored … in an electronic retrieval system" | Not integrated. Needs an NSE data licence (NSE Data & Analytics) |
| BSE (bseindia.com) | Disclaimer: "Any reproduction, redistribution or transmission, for consideration or otherwise, of any such information … is strictly prohibited" | Not integrated. Needs a BSE data licence |
| MCX (mcxindia.com market data, historical reports) | Terms: "User may not conduct any systematic or automated data collection activities … with[out] MCX's written consent"; no material may be "copied … reproduced … distributed … without prior written permission" | Not integrated. MCX sells a data feed and has a research data-sharing policy |
| Gold and silver (LBMA via FRED) | FRED returns 404 for the LBMA series | Not available |

## Where each customer page gets its numbers

| Page | Source tables | Provider |
|---|---|---|
| Home (real-data mode) | `equity.prices`, `commodity.observations`, `macro.observations`, `crypto.market_snapshots` | EODHD, FRED, CoinGecko |
| Indian markets | `equity.*` | EODHD |
| Commodities | `commodity.*` | FRED, EIA (data.gov.in when configured) |
| Macro | `macro.*` | FRED |
| Digital Assets | `crypto.*` | CoinGecko, Binance, Coinbase, DefiLlama, node providers |
| Research hub | the above, plus your uploads (`app.user_datasets`) | as above |
| Data sources | `ops.provider_state`, freshness of `macro`/`commodity` series | none (summary) |
