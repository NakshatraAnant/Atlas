import type { Db } from '../../db/db.js';

// Provider registry for ATLAS Digital Assets. Every row was checked against the provider's official
// documentation on the date recorded, and every endpoint listed was exercised from this environment
// before it was wired in (docs/crypto/SOURCE_CAPABILITY_MATRIX.md). A documented endpoint is not a working
// integration: health below is written only from real request outcomes.

export interface SourceDef {
  source_id: string;
  provider: string;
  category: 'market_reference' | 'exchange' | 'defi' | 'onchain' | 'events';
  base_url: string;
  docs_url: string;
  terms_url: string | null;
  docs_checked_on: string;
  auth: 'none' | 'optional_key' | 'required_key';
  rate_limit_note: string;
  /** Requests ATLAS allows itself per minute (well under the published or observed limit). */
  budget_per_minute: number;
  history_note: string;
  cadence_note: string;
  attribution: string | null;
  storage_note: string;
  known_gaps: string;
  fallback_source_id: string | null;
}

const CHECKED = '2026-10-22';

export const SOURCES: SourceDef[] = [
  {
    source_id: 'coingecko',
    provider: 'CoinGecko API (keyless public, or free Demo key when COINGECKO_DEMO_API_KEY is set)',
    category: 'market_reference',
    base_url: 'https://api.coingecko.com/api/v3',
    docs_url: 'https://docs.coingecko.com/docs/keyless-public-api',
    terms_url: 'https://www.coingecko.com/en/api_terms',
    docs_checked_on: CHECKED,
    auth: 'optional_key',
    rate_limit_note: 'Keyless: about 10–30 calls/min shared per IP, dynamic with server load; documented as not suitable for scheduled polling. A free Demo key (x-cg-demo-api-key header) raises the limit and adds usage tracking.',
    budget_per_minute: 5,
    history_note: 'Keyless requests are limited to the past 365 days of history (verified: error 10012 for days=400 on 22 Oct 2026). Daily granularity for ranges above 90 days.',
    cadence_note: 'Market snapshot every 15 min; global metrics every 15 min; registry and venue mapping daily; 365-day reference history daily.',
    attribution: 'Powered by CoinGecko',
    storage_note: 'CoinGecko discourages caching or storage; where cached, data must be refreshed at least every 24 hours (API terms §6). ATLAS keeps a local, personal cache that is refreshed daily and is never redistributed.',
    known_gaps: 'Aggregated reference prices (not executable on any venue). Supply figures are provider estimates. No token unlock schedules. History limited to 365 days without a paid plan.',
    fallback_source_id: null,
  },
  {
    source_id: 'binance',
    provider: 'Binance Spot public market data',
    category: 'exchange',
    base_url: 'https://data-api.binance.vision',
    docs_url: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api/limits',
    terms_url: 'https://www.binance.com/en/about-legal/terms',
    docs_checked_on: CHECKED,
    auth: 'none',
    rate_limit_note: 'Limits are per IP. exchangeInfo reports REQUEST_WEIGHT 6,000/min (verified 22 Oct 2026); X-MBX-USED-WEIGHT-1M header reports usage; 429 means back off, 418 is an IP ban (2 min to 3 days). data-api.binance.vision is the documented market-data-only base URL.',
    budget_per_minute: 60,
    history_note: 'Daily klines back to the pair listing date (BTCUSDT from 2017-08-17, verified). 1,000 klines per request.',
    cadence_note: 'Daily klines incremental refresh hourly; exchange products daily; WebSocket ticker for a small set of pairs while the API runs.',
    attribution: 'Binance (venue-specific prices)',
    storage_note: 'Binance terms were not fully verified (the dataset terms PDF could not be read as text). Used for personal local research only; never redistributed.',
    known_gaps: 'Venue-specific prices in USDT, not USD. Pairs can be delisted or restricted in some jurisdictions.',
    fallback_source_id: 'coinbase',
  },
  {
    source_id: 'coinbase',
    provider: 'Coinbase Exchange public market data',
    category: 'exchange',
    base_url: 'https://api.exchange.coinbase.com',
    docs_url: 'https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits',
    terms_url: 'https://www.coinbase.com/legal/market_data',
    docs_checked_on: CHECKED,
    auth: 'none',
    rate_limit_note: 'Public endpoints: 10 requests/second per IP, bursts up to 15; 429 when exceeded.',
    budget_per_minute: 120,
    history_note: 'Daily candles back to the product launch (BTC-USD candles from 2015, verified for Jan 2016). 300 candles per request.',
    cadence_note: 'Daily candles incremental refresh hourly; products daily.',
    attribution: 'Coinbase Exchange (venue-specific prices)',
    storage_note: 'Market data terms page returned 403 to automated fetches and could not be read. Used for personal local research only; never redistributed.',
    known_gaps: 'Covers only assets listed on Coinbase Exchange. Candle volume is in the base asset.',
    fallback_source_id: 'binance',
  },
  {
    source_id: 'defillama',
    provider: 'DefiLlama free API',
    category: 'defi',
    base_url: 'https://api.llama.fi',
    docs_url: 'https://api-docs.defillama.com/llms-free.txt',
    terms_url: 'https://defillama.com/docs/api',
    docs_checked_on: CHECKED,
    auth: 'none',
    rate_limit_note: 'Free endpoints need no key. No rate limit is published; ATLAS self-limits.',
    budget_per_minute: 20,
    history_note: 'Daily TVL history from each protocol\'s first tracked date; fees and revenue histories where the protocol has an adapter.',
    cadence_note: 'Protocol list every 6 h; histories for the top protocols daily.',
    attribution: 'DefiLlama',
    storage_note: 'Open data; personal local cache.',
    known_gaps: 'Token unlocks/emissions, hacks and some breakdowns are Pro-only and are not used. TVL, fees and revenue follow DefiLlama methodology and are not comparable with other providers.',
    fallback_source_id: null,
  },
  {
    source_id: 'ethereum_rpc',
    provider: 'Ethereum JSON-RPC (PublicNode free endpoint; override with ETHEREUM_RPC_URL)',
    category: 'onchain',
    base_url: 'https://ethereum-rpc.publicnode.com',
    docs_url: 'https://ethereum.org/en/developers/docs/apis/json-rpc/',
    terms_url: 'https://www.publicnode.com/',
    docs_checked_on: CHECKED,
    auth: 'none',
    rate_limit_note: 'No published rate limit. ATLAS self-limits and backs off on errors.',
    budget_per_minute: 30,
    history_note: 'Recent blocks only. The public endpoint is not an archive node; ATLAS keeps a rolling window of recent blocks.',
    cadence_note: 'Latest blocks every 2 minutes.',
    attribution: null,
    storage_note: 'Public blockchain data.',
    known_gaps: 'No historical state, no token-transfer index, no address labels.',
    fallback_source_id: null,
  },
  {
    source_id: 'mempool_space',
    provider: 'mempool.space public REST API (Bitcoin)',
    category: 'onchain',
    base_url: 'https://mempool.space/api',
    docs_url: 'https://mempool.space/docs/api/rest',
    terms_url: 'https://mempool.space/terms-of-service',
    docs_checked_on: CHECKED,
    auth: 'none',
    rate_limit_note: 'Rate limits are enforced but not published; 429 when exceeded and repeated violations may be banned.',
    budget_per_minute: 12,
    history_note: 'Recent blocks (15 per call). ATLAS keeps a rolling window.',
    cadence_note: 'Latest blocks and fee estimates every 5 minutes.',
    attribution: 'mempool.space',
    storage_note: 'Public blockchain data; personal local cache.',
    known_gaps: 'Fee estimates are mempool.space\'s own estimates, not protocol values.',
    fallback_source_id: null,
  },
  {
    source_id: 'github_releases',
    provider: 'GitHub REST API: official client release notes',
    category: 'events',
    base_url: 'https://api.github.com',
    docs_url: 'https://docs.github.com/en/rest/releases/releases',
    terms_url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
    docs_checked_on: CHECKED,
    auth: 'none',
    rate_limit_note: 'Unauthenticated: 60 requests/hour per IP (X-RateLimit-Limit: 60, verified).',
    budget_per_minute: 4,
    history_note: 'Recent releases of the tracked repositories.',
    cadence_note: 'Every 6 hours.',
    attribution: 'GitHub release pages',
    storage_note: 'Headline, link and publication time only.',
    known_gaps: 'Covers only the tracked client repositories (bitcoin/bitcoin, ethereum/go-ethereum, anza-xyz/agave).',
    fallback_source_id: null,
  },
  {
    source_id: 'ethereum_blog',
    provider: 'Ethereum Foundation Blog RSS feed',
    category: 'events',
    base_url: 'https://blog.ethereum.org/en/feed.xml',
    docs_url: 'https://blog.ethereum.org',
    terms_url: null,
    docs_checked_on: CHECKED,
    auth: 'none',
    rate_limit_note: 'Public RSS feed; ATLAS reads it at most every 6 hours.',
    budget_per_minute: 2,
    history_note: 'The items currently in the feed.',
    cadence_note: 'Every 6 hours.',
    attribution: 'Ethereum Foundation Blog',
    storage_note: 'Content is "All rights reserved": ATLAS stores the headline, link and publication time only, never the article text.',
    known_gaps: 'Official Ethereum Foundation announcements only; not a general news feed.',
    fallback_source_id: null,
  },
  {
    source_id: 'atlas_observed',
    provider: 'ATLAS own observations (derived from stored provider data)',
    category: 'events',
    base_url: 'internal',
    docs_url: 'docs/crypto/SOURCE_CAPABILITY_MATRIX.md',
    terms_url: null,
    docs_checked_on: CHECKED,
    auth: 'none',
    rate_limit_note: 'No external requests.',
    budget_per_minute: 1,
    history_note: 'From the first stored observation.',
    cadence_note: 'With each exchange product refresh.',
    attribution: null,
    storage_note: 'Derived from stored records.',
    known_gaps: 'Only detects changes between ATLAS refreshes (for example a pair whose trading status changed).',
    fallback_source_id: null,
  },
];

export const NETWORKS = [
  { network_id: 'bitcoin', name: 'Bitcoin', family: 'utxo', chain_id: null, native_symbol: 'BTC', explorer_url: 'https://mempool.space', capabilities: ['blocks', 'fees'], source_id: 'mempool_space' },
  { network_id: 'ethereum', name: 'Ethereum', family: 'evm', chain_id: 1, native_symbol: 'ETH', explorer_url: 'https://etherscan.io', capabilities: ['blocks', 'gas'], source_id: 'ethereum_rpc' },
  { network_id: 'solana', name: 'Solana', family: 'svm', chain_id: null, native_symbol: 'SOL', explorer_url: 'https://explorer.solana.com', capabilities: [], source_id: null },
] as const;

/** CoinGecko platform keys → ATLAS network ids (only networks ATLAS models). */
export const PLATFORM_TO_NETWORK: Record<string, string> = { ethereum: 'ethereum', solana: 'solana' };

export const EXCHANGES = [
  { exchange_id: 'binance', name: 'Binance', source_id: 'binance', coingecko_id: 'binance', capabilities: ['products', 'daily_candles', 'ticker', 'websocket'] },
  { exchange_id: 'coinbase', name: 'Coinbase Exchange', source_id: 'coinbase', coingecko_id: 'gdax', capabilities: ['products', 'daily_candles', 'ticker'] },
] as const;

/** Idempotent: inserts new rows and refreshes documentation fields; never touches health or history. */
export async function syncRegistry(db: Db): Promise<void> {
  for (const s of SOURCES) {
    await db.query(
      `INSERT INTO crypto.sources (source_id, provider, category, base_url, docs_url, terms_url, docs_checked_on, auth, rate_limit_note, budget_per_minute, history_note, cadence_note, attribution, storage_note, known_gaps, fallback_source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (source_id) DO UPDATE SET provider=EXCLUDED.provider, category=EXCLUDED.category, base_url=EXCLUDED.base_url, docs_url=EXCLUDED.docs_url, terms_url=EXCLUDED.terms_url,
         docs_checked_on=EXCLUDED.docs_checked_on, auth=EXCLUDED.auth, rate_limit_note=EXCLUDED.rate_limit_note, budget_per_minute=EXCLUDED.budget_per_minute, history_note=EXCLUDED.history_note,
         cadence_note=EXCLUDED.cadence_note, attribution=EXCLUDED.attribution, storage_note=EXCLUDED.storage_note, known_gaps=EXCLUDED.known_gaps, fallback_source_id=EXCLUDED.fallback_source_id, updated_at=now()`,
      [s.source_id, s.provider, s.category, s.base_url, s.docs_url, s.terms_url, s.docs_checked_on, s.auth, s.rate_limit_note, s.budget_per_minute, s.history_note, s.cadence_note, s.attribution, s.storage_note, s.known_gaps, s.fallback_source_id],
    );
  }
  for (const n of NETWORKS) {
    await db.query(
      `INSERT INTO crypto.networks (network_id, name, family, chain_id, native_symbol, explorer_url, capabilities, source_id, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (network_id) DO UPDATE SET name=EXCLUDED.name, family=EXCLUDED.family, chain_id=EXCLUDED.chain_id, native_symbol=EXCLUDED.native_symbol, explorer_url=EXCLUDED.explorer_url, capabilities=EXCLUDED.capabilities, source_id=EXCLUDED.source_id`,
      [n.network_id, n.name, n.family, n.chain_id, n.native_symbol, n.explorer_url, [...n.capabilities], n.source_id],
    );
  }
  for (const e of EXCHANGES) {
    await db.query(
      `INSERT INTO crypto.exchanges (exchange_id, name, source_id, coingecko_id, capabilities) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (exchange_id) DO UPDATE SET name=EXCLUDED.name, source_id=EXCLUDED.source_id, coingecko_id=EXCLUDED.coingecko_id, capabilities=EXCLUDED.capabilities`,
      [e.exchange_id, e.name, e.source_id, e.coingecko_id, [...e.capabilities]],
    );
  }
}
