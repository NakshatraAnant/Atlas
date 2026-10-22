import { DAY_MS, num, utcDay, type Candle } from './validate.js';
import type { ProviderClient } from './http.js';

// Provider adapters: fetch functions plus pure transforms from each provider's response shape to the
// canonical ATLAS shape. Transforms are tested against recorded real responses (test/crypto-*.test.ts).
// Anything a provider does not supply is returned as null, and capabilities a provider lacks are not
// faked: callers check SOURCE_CAPABILITIES first.

export const SOURCE_CAPABILITIES: Record<string, string[]> = {
  coingecko: ['asset_discovery', 'metadata', 'market_snapshot', 'global_metrics', 'reference_history', 'supply', 'venue_mapping'],
  binance: ['exchange_products', 'historical_candles', 'exchange_ticker', 'websocket'],
  coinbase: ['exchange_products', 'historical_candles', 'exchange_ticker'],
  defillama: ['protocol_metrics', 'chain_metrics', 'stablecoin_metrics'],
  ethereum_rpc: ['onchain_blocks'],
  mempool_space: ['onchain_blocks', 'fee_estimates'],
  github_releases: ['events'],
  ethereum_blog: ['events'],
};

export function supports(sourceId: string, capability: string): boolean {
  return SOURCE_CAPABILITIES[sourceId]?.includes(capability) ?? false;
}

// ───────────────────────────── CoinGecko ─────────────────────────────

export interface CgMarketRow {
  id: string; symbol: string; name: string; image: string | null;
  price: number | null; market_cap: number | null; market_cap_rank: number | null; fdv: number | null; volume_24h: number | null;
  high_24h: number | null; low_24h: number | null; change_24h_pct: number | null; change_7d_pct: number | null; change_30d_pct: number | null;
  circulating_supply: number | null; total_supply: number | null; max_supply: number | null;
  ath: number | null; ath_at: string | null; last_updated: string | null;
}

export function cgHeaders(demoKey: string): Record<string, string> {
  return demoKey ? { 'x-cg-demo-api-key': demoKey } : {};
}

export function parseCgMarkets(raw: unknown): CgMarketRow[] {
  if (!Array.isArray(raw)) throw new Error('CoinGecko markets: expected an array');
  return raw.filter((r) => r && typeof r.id === 'string' && typeof r.symbol === 'string').map((r) => ({
    id: r.id, symbol: String(r.symbol).toUpperCase(), name: String(r.name ?? r.id), image: typeof r.image === 'string' ? r.image : null,
    price: num(r.current_price), market_cap: num(r.market_cap) || null, market_cap_rank: num(r.market_cap_rank), fdv: num(r.fully_diluted_valuation),
    volume_24h: num(r.total_volume), high_24h: num(r.high_24h), low_24h: num(r.low_24h),
    change_24h_pct: num(r.price_change_percentage_24h_in_currency ?? r.price_change_percentage_24h),
    change_7d_pct: num(r.price_change_percentage_7d_in_currency), change_30d_pct: num(r.price_change_percentage_30d_in_currency),
    circulating_supply: num(r.circulating_supply), total_supply: num(r.total_supply), max_supply: num(r.max_supply) || null,
    ath: num(r.ath), ath_at: typeof r.ath_date === 'string' ? r.ath_date : null, last_updated: typeof r.last_updated === 'string' ? r.last_updated : null,
  }));
}
// Note on market_cap: CoinGecko reports 0 when it has no circulating-supply figure. 0 is not a real market
// capitalisation, so it becomes null ("not available") above. max_supply 0/null likewise means "not defined".

export async function cgMarkets(c: ProviderClient, demoKey: string, vs: 'usd' | 'inr', page: number, perPage = 100): Promise<CgMarketRow[]> {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${perPage}&page=${page}&price_change_percentage=24h,7d,30d`;
  return parseCgMarkets(await c.request('coingecko', url, { headers: cgHeaders(demoKey), ttlMs: 60_000, critical: vs === 'usd' && page === 1 }));
}

export interface CgGlobal { total_market_cap_usd: number | null; total_volume_usd: number | null; market_cap_change_24h_pct: number | null; btc_dominance_pct: number | null; eth_dominance_pct: number | null; active_cryptocurrencies: number | null; markets: number | null; updated_at: string }

export function parseCgGlobal(raw: any): CgGlobal {
  const d = raw?.data;
  if (!d || typeof d.updated_at !== 'number') throw new Error('CoinGecko global: missing data.updated_at');
  return {
    total_market_cap_usd: num(d.total_market_cap?.usd), total_volume_usd: num(d.total_volume?.usd), market_cap_change_24h_pct: num(d.market_cap_change_percentage_24h_usd),
    btc_dominance_pct: num(d.market_cap_percentage?.btc), eth_dominance_pct: num(d.market_cap_percentage?.eth),
    active_cryptocurrencies: num(d.active_cryptocurrencies), markets: num(d.markets), updated_at: new Date(d.updated_at * 1000).toISOString(),
  };
}

export async function cgGlobal(c: ProviderClient, demoKey: string): Promise<CgGlobal> {
  return parseCgGlobal(await c.request('coingecko', 'https://api.coingecko.com/api/v3/global', { headers: cgHeaders(demoKey), ttlMs: 60_000, critical: true }));
}

export interface CgDetail { id: string; description: string | null; categories: string[]; asset_platform_id: string | null; platforms: { platform: string; address: string; decimals: number | null }[]; homepage: string | null }

export function parseCgDetail(raw: any): CgDetail {
  if (!raw || typeof raw.id !== 'string') throw new Error('CoinGecko coin detail: missing id');
  const desc = typeof raw.description?.en === 'string' ? raw.description.en.replace(/<[^>]+>/g, '').trim() : '';
  const detail = raw.detail_platforms ?? {};
  const platforms = Object.entries((raw.platforms ?? {}) as Record<string, string>)
    .filter(([k, v]) => k && typeof v === 'string' && v.length > 0)
    .map(([platform, address]) => ({ platform, address, decimals: num(detail?.[platform]?.decimal_place) }));
  return { id: raw.id, description: desc ? desc.slice(0, 4000) : null, categories: Array.isArray(raw.categories) ? raw.categories.filter((x: unknown) => typeof x === 'string' && x) : [], asset_platform_id: typeof raw.asset_platform_id === 'string' ? raw.asset_platform_id : null, platforms, homepage: Array.isArray(raw.links?.homepage) ? raw.links.homepage.find((u: unknown) => typeof u === 'string' && u.startsWith('https://')) ?? null : null };
}

export async function cgDetail(c: ProviderClient, demoKey: string, id: string): Promise<CgDetail> {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`;
  return parseCgDetail(await c.request('coingecko', url, { headers: cgHeaders(demoKey), ttlMs: 6 * 3_600_000 }));
}

/** Daily reference closes. CoinGecko returns one point per day plus a final "now" point; only completed UTC days are kept. */
export function parseCgChart(raw: any, now: number): Candle[] {
  if (!raw || !Array.isArray(raw.prices)) throw new Error('CoinGecko market_chart: missing prices');
  const mcap = new Map<number, number | null>((raw.market_caps ?? []).map((p: [number, number]) => [utcDay(p[0]), num(p[1]) || null]));
  const vol = new Map<number, number | null>((raw.total_volumes ?? []).map((p: [number, number]) => [utcDay(p[0]), num(p[1])]));
  const today = utcDay(now);
  const out = new Map<number, Candle>();
  for (const [t, p] of raw.prices as [number, number][]) {
    const day = utcDay(t);
    // Daily points are stamped 00:00 UTC and represent the price at that instant (the previous day's close).
    // A point not at midnight is the provider's intraday "latest" value and is not a completed observation.
    if (t !== day || day > today) continue;
    const close = num(p);
    if (close === null) continue;
    out.set(day, { open_time: day, open: null, high: null, low: null, close, volume: vol.get(day) ?? null, market_cap: mcap.get(day) ?? null });
  }
  return [...out.values()].sort((a, b) => a.open_time - b.open_time);
}

export async function cgChart(c: ProviderClient, demoKey: string, id: string, days = 365): Promise<Candle[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  return parseCgChart(await c.request('coingecko', url, { headers: cgHeaders(demoKey), ttlMs: 3_600_000 }), Date.now());
}

export interface CgVenueTicker { coin_id: string; target_coin_id: string | null; base: string; target: string; exchange: string; is_stale: boolean; is_anomaly: boolean }

export function parseCgTickers(raw: any): CgVenueTicker[] {
  if (!raw || !Array.isArray(raw.tickers)) throw new Error('CoinGecko exchange tickers: missing tickers');
  return raw.tickers.filter((t: any) => typeof t.coin_id === 'string' && typeof t.base === 'string' && typeof t.target === 'string').map((t: any) => ({
    coin_id: t.coin_id, target_coin_id: typeof t.target_coin_id === 'string' ? t.target_coin_id : null, base: t.base.toUpperCase(), target: t.target.toUpperCase(),
    exchange: t.market?.identifier ?? '', is_stale: !!t.is_stale, is_anomaly: !!t.is_anomaly,
  }));
}

export async function cgExchangeTickers(c: ProviderClient, demoKey: string, exchangeCgId: string, coinIds: string[], page = 1): Promise<CgVenueTicker[]> {
  const url = `https://api.coingecko.com/api/v3/exchanges/${exchangeCgId}/tickers?coin_ids=${coinIds.map(encodeURIComponent).join(',')}&page=${page}`;
  return parseCgTickers(await c.request('coingecko', url, { headers: cgHeaders(demoKey), ttlMs: 3_600_000 }));
}

// ───────────────────────────── Binance ─────────────────────────────

export const BINANCE = 'https://data-api.binance.vision';

export interface VenueProduct { product_id: string; base: string; quote: string; status: string; tradable: boolean; price_increment: string | null; size_increment: string | null }

export function parseBinanceExchangeInfo(raw: any): VenueProduct[] {
  if (!raw || !Array.isArray(raw.symbols)) throw new Error('Binance exchangeInfo: missing symbols');
  return raw.symbols.map((s: any) => {
    const pf = (s.filters ?? []).find((f: any) => f.filterType === 'PRICE_FILTER');
    const lf = (s.filters ?? []).find((f: any) => f.filterType === 'LOT_SIZE');
    return { product_id: s.symbol, base: s.baseAsset, quote: s.quoteAsset, status: s.status, tradable: s.status === 'TRADING', price_increment: pf?.tickSize ?? null, size_increment: lf?.stepSize ?? null };
  });
}

export async function binanceProducts(c: ProviderClient, symbols: string[]): Promise<VenueProduct[]> {
  if (!symbols.length) return [];
  const url = `${BINANCE}/api/v3/exchangeInfo?symbols=${encodeURIComponent(JSON.stringify(symbols))}&showPermissionSets=false`;
  return parseBinanceExchangeInfo(await c.request('binance', url, { ttlMs: 3_600_000 }));
}

export function parseBinanceKlines(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) throw new Error('Binance klines: expected an array');
  return raw.map((k: any[]) => ({ open_time: Number(k[0]), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]) as number, volume: num(k[5]), quote_volume: num(k[7]), trades: num(k[8]) }));
}

/** Completed daily klines from startMs (inclusive). The in-progress UTC day is excluded. */
export async function binanceDailyKlines(c: ProviderClient, symbol: string, startMs: number, now: number): Promise<Candle[]> {
  const url = `${BINANCE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&startTime=${startMs}&limit=1000`;
  return parseBinanceKlines(await c.request('binance', url)).filter((k) => k.open_time + DAY_MS <= now);
}

export interface VenueTicker { product_id: string; last: number | null; bid: number | null; ask: number | null; volume_24h: number | null; change_24h_pct: number | null; observed_at: string }

export function parseBinanceTicker(raw: any, now: number): VenueTicker {
  return { product_id: raw.symbol, last: num(raw.lastPrice), bid: num(raw.bidPrice), ask: num(raw.askPrice), volume_24h: num(raw.volume), change_24h_pct: num(raw.priceChangePercent), observed_at: new Date(num(raw.closeTime) ?? now).toISOString() };
}

// ───────────────────────────── Coinbase Exchange ─────────────────────────────

export const COINBASE = 'https://api.exchange.coinbase.com';

export function parseCoinbaseProducts(raw: unknown): VenueProduct[] {
  if (!Array.isArray(raw)) throw new Error('Coinbase products: expected an array');
  return raw.filter((p: any) => typeof p.id === 'string').map((p: any) => ({ product_id: p.id, base: p.base_currency, quote: p.quote_currency, status: String(p.status ?? 'unknown'), tradable: p.status === 'online' && !p.trading_disabled && !p.cancel_only, price_increment: p.quote_increment ?? null, size_increment: p.base_increment ?? null }));
}

export async function coinbaseProducts(c: ProviderClient): Promise<VenueProduct[]> {
  return parseCoinbaseProducts(await c.request('coinbase', `${COINBASE}/products`, { ttlMs: 3_600_000 }));
}

/** Coinbase candles are [time, low, high, open, close, volume], newest first. */
export function parseCoinbaseCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) throw new Error('Coinbase candles: expected an array');
  return raw.map((k: number[]) => ({ open_time: Number(k[0]) * 1000, low: num(k[1]), high: num(k[2]), open: num(k[3]), close: num(k[4]) as number, volume: num(k[5]) })).sort((a, b) => a.open_time - b.open_time);
}

export async function coinbaseDailyCandles(c: ProviderClient, productId: string, startMs: number, now: number): Promise<Candle[]> {
  const end = Math.min(startMs + 299 * DAY_MS, utcDay(now) - DAY_MS);
  if (end < startMs) return [];
  const url = `${COINBASE}/products/${encodeURIComponent(productId)}/candles?granularity=86400&start=${new Date(startMs).toISOString()}&end=${new Date(end).toISOString()}`;
  return parseCoinbaseCandles(await c.request('coinbase', url)).filter((k) => k.open_time >= startMs && k.open_time + DAY_MS <= now);
}

export async function coinbaseTicker(c: ProviderClient, productId: string, now: number): Promise<VenueTicker> {
  const r: any = await c.request('coinbase', `${COINBASE}/products/${encodeURIComponent(productId)}/ticker`, { ttlMs: 10_000 });
  return { product_id: productId, last: num(r.price), bid: num(r.bid), ask: num(r.ask), volume_24h: num(r.volume), change_24h_pct: null, observed_at: typeof r.time === 'string' ? r.time : new Date(now).toISOString() };
}

// ───────────────────────────── DefiLlama ─────────────────────────────

export interface LlamaProtocol { slug: string; name: string; category: string | null; chains: string[]; url: string | null; description: string | null; gecko_id: string | null; tvl: number | null; change_1d: number | null; change_7d: number | null }

export function parseLlamaProtocols(raw: unknown): LlamaProtocol[] {
  if (!Array.isArray(raw)) throw new Error('DefiLlama protocols: expected an array');
  return raw.filter((p: any) => typeof p.slug === 'string' && typeof p.name === 'string').map((p: any) => ({
    slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null, chains: Array.isArray(p.chains) ? p.chains.filter((x: unknown) => typeof x === 'string') : [],
    url: typeof p.url === 'string' ? p.url : null, description: typeof p.description === 'string' ? p.description.slice(0, 2000) : null, gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    tvl: num(p.tvl), change_1d: num(p.change_1d), change_7d: num(p.change_7d),
  }));
}

/** Daily TVL from /protocol/{slug}: one value per UTC day (the provider's last point that day). */
export function parseLlamaTvlHistory(raw: any): { day: number; value: number }[] {
  if (!raw || !Array.isArray(raw.tvl)) throw new Error('DefiLlama protocol: missing tvl history');
  const m = new Map<number, number>();
  for (const p of raw.tvl) {
    const v = num(p.totalLiquidityUSD);
    if (typeof p.date === 'number' && v !== null && v >= 0) m.set(utcDay(p.date * 1000), v);
  }
  return [...m].map(([day, value]) => ({ day, value })).sort((a, b) => a.day - b.day);
}

/** totalDataChart from /summary/fees/{slug}: [[unixSeconds, value], …]. */
export function parseLlamaDaily(raw: any, field = 'totalDataChart'): { day: number; value: number }[] {
  const arr = raw?.[field];
  if (!Array.isArray(arr)) throw new Error(`DefiLlama: missing ${field}`);
  return arr.filter((p: unknown[]) => Array.isArray(p) && typeof p[0] === 'number').map((p: [number, unknown]) => ({ day: utcDay(p[0] * 1000), value: num(p[1]) })).filter((p): p is { day: number; value: number } => p.value !== null && p.value >= 0);
}

export function parseLlamaStablecoinTotal(raw: unknown): { day: number; value: number }[] {
  if (!Array.isArray(raw)) throw new Error('DefiLlama stablecoincharts: expected an array');
  return raw.map((p: any) => ({ day: utcDay(Number(p.date) * 1000), value: num(p.totalCirculatingUSD?.peggedUSD) })).filter((p): p is { day: number; value: number } => Number.isFinite(p.day) && p.value !== null && p.value >= 0);
}

export function parseLlamaChainHistory(raw: unknown): { day: number; value: number }[] {
  if (!Array.isArray(raw)) throw new Error('DefiLlama historicalChainTvl: expected an array');
  return raw.map((p: any) => ({ day: utcDay(Number(p.date) * 1000), value: num(p.tvl) })).filter((p): p is { day: number; value: number } => Number.isFinite(p.day) && p.value !== null && p.value >= 0);
}

// ───────────────────────────── On-chain ─────────────────────────────

export interface ChainBlock { height: number; hash: string; time: string; tx_count: number | null; size_bytes: number | null; gas_used: number | null; gas_limit: number | null; base_fee_gwei: number | null; total_fees_native: number | null; producer: string | null }

const hexNum = (h: unknown): number | null => (typeof h === 'string' && /^0x[0-9a-f]+$/i.test(h) ? Number(BigInt(h)) : null);

export function parseEthBlock(raw: any): ChainBlock {
  const b = raw?.result;
  if (!b || typeof b.hash !== 'string' || hexNum(b.number) === null || hexNum(b.timestamp) === null) throw new Error('Ethereum RPC: malformed block');
  const baseFee = hexNum(b.baseFeePerGas);
  return {
    height: hexNum(b.number)!, hash: b.hash.toLowerCase(), time: new Date(hexNum(b.timestamp)! * 1000).toISOString(),
    tx_count: Array.isArray(b.transactions) ? b.transactions.length : null, size_bytes: hexNum(b.size), gas_used: hexNum(b.gasUsed), gas_limit: hexNum(b.gasLimit),
    base_fee_gwei: baseFee === null ? null : baseFee / 1e9,
    // Total fees need every receipt; the public endpoint budget does not allow that, so this stays unavailable.
    total_fees_native: null, producer: typeof b.miner === 'string' ? b.miner.toLowerCase() : null,
  };
}

export async function ethRpc<T>(c: ProviderClient, rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const r: any = await c.request('ethereum_rpc', rpcUrl, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method, params } });
  if (r?.error) throw new Error(`Ethereum RPC ${method}: ${r.error.message ?? 'error'}`);
  return r as T;
}

export function parseMempoolBlocks(raw: unknown): ChainBlock[] {
  if (!Array.isArray(raw)) throw new Error('mempool.space blocks: expected an array');
  return raw.filter((b: any) => typeof b.id === 'string' && typeof b.height === 'number' && typeof b.timestamp === 'number').map((b: any) => ({
    height: b.height, hash: b.id, time: new Date(b.timestamp * 1000).toISOString(), tx_count: num(b.tx_count), size_bytes: num(b.size), gas_used: null, gas_limit: null, base_fee_gwei: null,
    total_fees_native: num(b.extras?.totalFees) === null ? null : num(b.extras.totalFees)! / 1e8, producer: typeof b.extras?.pool?.name === 'string' ? b.extras.pool.name : null,
  }));
}

// ───────────────────────────── Events ─────────────────────────────

export interface SourceEvent { dedupe_key: string; headline: string; url: string; published_at: string; category: 'software_release' | 'protocol_announcement' | 'network_upgrade'; network_ids: string[] }

export const TRACKED_REPOS: { repo: string; network: string; client: string }[] = [
  { repo: 'bitcoin/bitcoin', network: 'bitcoin', client: 'Bitcoin Core' },
  { repo: 'ethereum/go-ethereum', network: 'ethereum', client: 'Geth (Ethereum execution client)' },
  { repo: 'anza-xyz/agave', network: 'solana', client: 'Agave (Solana validator client)' },
];

export function parseGithubReleases(raw: unknown, repo: { repo: string; network: string; client: string }): SourceEvent[] {
  if (!Array.isArray(raw)) throw new Error('GitHub releases: expected an array');
  return raw.filter((r: any) => !r.draft && typeof r.html_url === 'string' && typeof r.published_at === 'string' && r.html_url.startsWith('https://github.com/')).map((r: any) => ({
    dedupe_key: `github:${repo.repo}:${r.id}`, headline: `${repo.client} ${String(r.name || r.tag_name).slice(0, 120)}${r.prerelease ? ' (pre-release)' : ''} released`,
    url: r.html_url, published_at: new Date(r.published_at).toISOString(), category: 'software_release', network_ids: [repo.network],
  }));
}

const decodeXml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

export function parseRss(xml: string, prefix: string, networkIds: string[]): SourceEvent[] {
  if (typeof xml !== 'string' || !xml.includes('<rss')) throw new Error('RSS: not an RSS document');
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: SourceEvent[] = [];
  for (const it of items) {
    const title = decodeXml(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link = decodeXml(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const pub = it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    const t = pub ? Date.parse(pub) : NaN;
    if (title.length < 3 || !link.startsWith('https://') || !Number.isFinite(t)) continue;
    const upgrade = /upgrade|fork|mainnet|testnet|announcement/i.test(title);
    out.push({ dedupe_key: `${prefix}:${link}`, headline: title.slice(0, 300), url: link, published_at: new Date(t).toISOString(), category: upgrade ? 'network_upgrade' : 'protocol_announcement', network_ids: networkIds });
  }
  return out;
}
