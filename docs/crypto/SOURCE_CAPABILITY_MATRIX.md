# ATLAS Digital Assets: source capability matrix

Checked 22–23 Oct 2026 against official documentation, and every endpoint below was exercised from this
machine before it was wired in. The machine-readable registry is `apps/api/src/modules/crypto/registry.ts`
(shown in the app under **Digital Assets → Sources & health**, with live health, last success, last import,
request counts and budget use). A documented endpoint is not a working integration: health is written only
from real request outcomes.

| Provider | Category | Endpoints used | Auth | Limits (documented or observed) | ATLAS budget | Historical coverage | Cadence in ATLAS | Attribution / terms | Known gaps | Fallback |
|---|---|---|---|---|---|---|---|---|---|---|
| CoinGecko (keyless public; Demo key optional) | Reference market data | `/coins/markets` (usd, inr), `/global`, `/coins/{id}`, `/coins/{id}/market_chart?days=365&interval=daily`, `/exchanges/{binance,gdax}/tickers?coin_ids=` | none; `COINGECKO_DEMO_API_KEY` adds `x-cg-demo-api-key` | Keyless: ~10–30 calls/min shared per IP, dynamic; docs say keyless is not for scheduled polling. 429 observed once in testing and handled by back-off. | 5/min (25/min with a Demo key) | **365 days** for keyless requests (verified: error 10012 for `days=400`) | markets/global 15 min; INR 1 h; details 30 min (6 assets per run); venue mapping 24 h; 365-day history 2 h (6 assets per run) | "Powered by CoinGecko" shown on every page using it. Terms §6: storage discouraged; cached data must be refreshed at least every 24 h. ATLAS keeps a personal local cache and refreshes daily. | Aggregated reference prices only; supply is a provider estimate; no unlock schedules; 365-day history limit | none |
| Binance spot public market data | Exchange (venue) | `data-api.binance.vision`: `/api/v3/exchangeInfo?symbols=`, `/api/v3/klines?interval=1d`; WebSocket `data-stream.binance.vision` miniTicker | none | REQUEST_WEIGHT 6,000/min per IP (from exchangeInfo, verified); `X-MBX-USED-WEIGHT-1M`; 429 back off, 418 ban | 60/min | Daily klines from pair listing (BTCUSDT from 2017-08-17, verified) | candles hourly (incremental, resumable, ≤30 requests per run); products daily; WebSocket while the API runs | Terms PDF could not be read as text: **unverified**. Personal local research use only; never redistributed. | USDT-quoted; venue-specific; jurisdiction restrictions possible | Coinbase |
| Coinbase Exchange public | Exchange (venue) | `/products`, `/products/{id}/candles?granularity=86400`, `/products/{id}/ticker` | none | 10 req/s per IP, bursts 15 (documented) | 120/min | Daily candles from product launch (BTC-USD from 2015-07-20, stored) | candles hourly (300 per request, resumable) | Market-data terms page returned HTTP 403 to automated fetches: **unverified**. Personal local use only. | Only Coinbase-listed assets | Binance |
| DefiLlama free API | DeFi | `api.llama.fi`: `/protocols`, `/protocol/{slug}`, `/summary/fees/{slug}?dataType=dailyFees|dailyRevenue`, `/v2/historicalChainTvl[/{chain}]`; `stablecoins.llama.fi/stablecoincharts/all` | none | No published limit | 20/min | Protocol TVL from first tracked date; fees/revenue where an adapter exists | list 6 h (top 300 stored); histories daily (top 8 protocols, 5 chains, all-DeFi, stablecoins) | Attribution "DefiLlama". Free endpoints list at `api-docs.defillama.com/llms-free.txt`. | Unlocks/emissions, hacks: Pro-only, not used. `api.llama.fi/stablecoincharts/all` returned an empty body on 22 Oct; the stablecoins host is used. Fees 400 for CEX entries (recorded as partial). | none |
| Ethereum JSON-RPC (PublicNode) | On-chain | `eth_blockNumber`, `eth_getBlockByNumber` | none (`ETHEREUM_RPC_URL` overrides) | Not published | 30/min | Recent blocks only (not an archive) | every 2 min, ≤20 blocks per run, rolling window of 500 | Public chain data | No per-block total fees (needs receipts); no token-transfer index | none |
| mempool.space | On-chain (Bitcoin) | `/api/v1/blocks`, `/api/v1/fees/recommended` | none | Rate limited, limits not published | 12/min | 15 latest blocks per call | every 5 min, rolling window of 500 | Attribution "mempool.space" | Fee estimates are the site's own | none |
| GitHub REST (releases) | Events | `/repos/{bitcoin/bitcoin, ethereum/go-ethereum, anza-xyz/agave}/releases` | none | 60 requests/hour unauthenticated (`X-RateLimit-Limit: 60`, verified) | 4/min | Recent releases | every 6 h | Headline, link and time only | Only tracked client repos | none |
| Ethereum Foundation blog RSS | Events | `blog.ethereum.org/en/feed.xml` | none | — | 2/min | Items currently in the feed | every 6 h | "All rights reserved": ATLAS stores headline, link and date only | Official EF posts only | none |

## Evaluated and not connected

| Candidate | Finding | Status |
|---|---|---|
| Alpha Vantage (Indian equities, BSE) | Docs show `RELIANCE.BSE` daily prices; API key required; free keys get the "compact" output (latest 100 points); terms PDF unreadable | Blocked: needs your key and a terms review (see `docs/DATA_RIGHTS_AND_PROVIDERS.md`) |
| NSE / NSE Indices / BSE websites | Unchanged from 20–21 Oct assessment: automated retrieval prohibited or unverified | Blocked (B-DATA-01) |
| Solana public RPC | Not integrated: Bitcoin and Ethereum cover the initial on-chain scope | Not implemented |
| Token unlock data | DefiLlama emissions are Pro-only; no other free verified source | Not available; shown as such in the UI |

## What ATLAS never does

- Uses random or synthetic values for any crypto price, supply, volume, block or event.
- Fills gaps in a series, or computes a daily return across a gap.
- Calls a pair "the" price: every series is labelled reference (CoinGecko) or venue (Binance/Coinbase pair).
- Maps a market pair by symbol: a pair is stored only when CoinGecko names the asset's id **and** the venue's own product list confirms the product.
- Labels a feed live without recent valid messages (15-second staleness threshold).
