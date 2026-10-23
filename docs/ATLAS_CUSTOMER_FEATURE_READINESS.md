# Customer feature readiness (real-data mode)

State on 23 Oct 2026, running installation with `ALLOW_SYNTHETIC_DATA=false`. "Operational" means its core workflow was exercised on real stored data in this session (browser or API) and is covered by automated tests.

## Visible modules (navigation in real-data mode)

| Route | Status | Real data source | Latest verified observation | Update frequency | Material limitations |
|---|---|---|---|---|---|
| `/app` Home | Operational | EODHD, FRED, CoinGecko (stored) | NIFTY 50/SENSEX/NIFTY BANK close 23 Oct 2026; Brent/WTI 20 Oct; CPI Sep 2026 | As each source updates | Snapshot only; dates and freshness shown per figure |
| `/app/equities` Indian markets | Operational (indices) | EODHD | Index closes 23 Oct 2026 | End of day, refresh 08:00 and 20:30 IST | Free plan: indices only (NSE/BSE shares answer 404); one year of history (247 sessions, so 1-year returns are unavailable); holidays inferred from data |
| `/app/equities/[exchange]/[symbol]` | Operational | EODHD | as above | as above | Indicators on 247 sessions; relative strength vs NIFTY 50 |
| `/app/equities/statements` | Operational | your own imported CSV | n/a | n/a | Private; figures not checked against filings |
| `/app/crypto` and sub-pages | Operational (session 8) | CoinGecko Demo, Binance, Coinbase, DefiLlama, node providers | CoinGecko snapshot every ~15 min | Paced to 10,000 calls/month | Reference prices, not executable; Demo plan has no commercial licence |
| `/app/commodities` | Operational | FRED (EIA spot, IMF monthly), EIA | Daily spot 20 Oct 2026; monthly Sep 2026; EIA stocks week ending 16 Oct 2026 | Daily / weekly / monthly | Benchmarks, not Indian or tradable prices; no gold/silver; no MCX; term structure is history to 5 Apr 2024; mandi prices need a data.gov.in key |
| `/app/commodities/[source]/[code]` | Operational | as above | as above | as above | Statistics at each series' own frequency |
| `/app/macro`, `/app/macro/[id]` | Operational | FRED API | e.g. DGS10 21 Oct 2026, CPI Sep 2026, GDP Q2 2026 | Per series release | India CPI (OECD) ended March 2025, shown as stale |
| `/app/research-hub` | Operational (session 9, plus commodities) | Stored crypto, Indian indices, daily commodities, your uploads | as above | as above | Daily series only; weekly or monthly commodities refused with a reason |
| `/app/research/datasets` Your data | Operational (session 3) | Your uploaded CSV files | n/a | n/a | Private; not verified by ATLAS |
| `/app/academy` and lessons | Operational (draft content) | Educational content; practical tasks use real pages | n/a | n/a | All courses await named expert review; tasks built on the demo companies show "unavailable here" |
| `/app/learn` Quick lessons | Operational | Static educational content | n/a | n/a | Educational examples are labelled |
| `/app/data-health` Data sources | Operational | `ops.provider_state`, series freshness | live | live | Plain-language status only |
| `/status` (public) | Operational | provider state | live | live | |
| `/` (public landing) | Operational | none (describes the product; no provider data on a public page) | n/a | n/a | |

## Hidden in real-data mode (demo-only: fictional development companies)

Terminal, Market, Companies, Assistant, Screener (company), Quant Lab, Briefings, My research main page, Sample briefing. Their API sections answer 403 "Demo data disabled", and Home and Academy do not call them. They remain available with `ALLOW_SYNTHETIC_DATA=true` for demos and tests, always with a "Demo data" banner.

## Not available (with reason)

| Capability | Reason |
|---|---|
| Individual NSE/BSE share prices, company financials, bhavcopy, F&O, open interest, breadth | NSE and BSE terms prohibit automated collection and redistribution; the free EODHD plan has indices only. Needs a data licence or a paid EODHD plan (shares) |
| MCX futures (gold, silver, crude, gas) | MCX terms prohibit automated collection without written consent; data feed is paid |
| Gold and silver benchmarks | No permitted free daily source found (LBMA withdrawn from FRED) |
| Current futures curves | EIA stopped publishing futures prices after 5 Apr 2024 |
| Indian mandi prices | Implemented; needs your free data.gov.in key |
| Live (intraday) prices | No source here provides permitted intraday Indian data |
