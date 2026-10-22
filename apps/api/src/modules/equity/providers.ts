// Indian equity reference-data providers (real data, separate from the synthetic ref/market schemas).
// Each adapter turns one provider's documented response into canonical daily rows and classifies every
// failure (auth, entitlement, rate limit, network, malformed) instead of treating it as "no data".
// Research and evidence: docs/equity/SOURCE_CAPABILITY_MATRIX.md (checked 23 Oct 2026).

export type ErrorCategory = 'network' | 'timeout' | 'auth' | 'entitlement' | 'rate_limited' | 'malformed' | 'provider_error' | 'not_found' | 'not_configured';

export class EquityProviderError extends Error {
  constructor(readonly provider: string, readonly category: ErrorCategory, message: string) {
    super(message);
  }
}

export interface DailyRow { date: string; open: number; high: number; low: number; close: number; volume: number | null; adjusted_close?: number | null }

export interface ProviderDef {
  provider_id: 'eodhd' | 'alphavantage';
  name: string;
  docs_url: string;
  terms_url: string;
  docs_checked_on: string;
  auth: 'required_key';
  env: string;
  coverage_note: string;
  limits_note: string;
  licence_note: string;
  priority: number;
  exchanges: ('NSE' | 'BSE' | 'INDEX')[];
  /** Whether the provider returns a split- and dividend-adjusted close alongside raw prices. */
  adjusted: boolean;
}

export const EQUITY_PROVIDERS: ProviderDef[] = [
  {
    provider_id: 'eodhd', name: 'EOD Historical Data (EODHD)', docs_url: 'https://eodhd.com/financial-apis/api-for-historical-data-and-volumes', terms_url: 'https://eodhd.com/financial-apis/terms-conditions',
    docs_checked_on: '2026-10-23', auth: 'required_key', env: 'EODHD_API_TOKEN',
    coverage_note: 'End-of-day OHLCV with a split- and dividend-adjusted close. Ticker format SYMBOL.EXCHANGE; ATLAS uses the .NSE suffix for NSE shares (shown on EODHD’s own NSE pages). Index tickers must be mapped explicitly and are validated by a successful response.',
    limits_note: 'Free plan: 20 API calls a day plus 500 welcome-bonus calls, past year of history only (documented). The demo token works only for six non-Indian tickers and returns HTTP 403 for others (verified).',
    licence_note: 'Free plan is for personal use (documented). Data is kept locally for your own research and never redistributed.',
    priority: 1, exchanges: ['NSE', 'INDEX'], adjusted: true,
  },
  {
    provider_id: 'alphavantage', name: 'Alpha Vantage', docs_url: 'https://www.alphavantage.co/documentation/', terms_url: 'https://www.alphavantage.co/terms_of_service/',
    docs_checked_on: '2026-10-23', auth: 'required_key', env: 'ALPHAVANTAGE_API_KEY',
    coverage_note: 'Daily raw (as-traded) OHLCV for BSE shares (symbol format RELIANCE.BSE, documented). The adjusted series is a premium endpoint and is not used.',
    limits_note: 'Free keys get the "compact" output: the latest 100 trading days (documented). A refused request returns HTTP 200 with an "Information" message (verified with the demo key), which ATLAS treats as an entitlement error, never as data.',
    licence_note: 'Terms of service are published as a PDF that could not be read as text: unverified. Personal, local use only.',
    priority: 2, exchanges: ['BSE'], adjusted: false,
  },
];

export type FetchFn = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

async function getText(provider: string, fetchFn: FetchFn, url: string, timeoutMs = 20_000): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'ATLAS-local-research/0.1' } });
    return { status: r.status, body: await r.text() };
  } catch (err) {
    const timeout = (err as Error).name === 'AbortError';
    throw new EquityProviderError(provider, timeout ? 'timeout' : 'network', timeout ? 'The provider did not answer in time.' : `Network error: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** URL with the secret removed, for logs and job records. */
export const redact = (url: string) => url.replace(/(api_token|apikey)=[^&]+/g, '$1=REDACTED');

// ───────────── EODHD ─────────────
export function eodhdTicker(exchange: string, symbol: string, explicit?: string): string {
  if (explicit) return explicit;
  if (exchange === 'NSE') return `${symbol}.NSE`;
  throw new EquityProviderError('eodhd', 'not_found', `ATLAS has no verified EODHD ticker format for ${exchange}; map the provider symbol explicitly.`);
}

export function parseEodhd(status: number, body: string): DailyRow[] {
  if (status === 401) throw new EquityProviderError('eodhd', 'auth', 'EODHD rejected the API token (HTTP 401).');
  if (status === 403) throw new EquityProviderError('eodhd', 'entitlement', 'EODHD refused this ticker for the configured plan or token (HTTP 403).');
  if (status === 404) throw new EquityProviderError('eodhd', 'not_found', 'EODHD has no data for this ticker (HTTP 404).');
  if (status === 429) throw new EquityProviderError('eodhd', 'rate_limited', 'EODHD daily or per-minute limit reached (HTTP 429).');
  if (status >= 400) throw new EquityProviderError('eodhd', 'provider_error', `EODHD returned HTTP ${status}.`);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new EquityProviderError('eodhd', 'malformed', 'EODHD returned a response that is not JSON.');
  }
  if (!Array.isArray(raw)) throw new EquityProviderError('eodhd', 'malformed', 'EODHD response is not an array of daily rows.');
  return raw.map((r: any) => ({ date: String(r?.date ?? ''), open: num(r?.open) as number, high: num(r?.high) as number, low: num(r?.low) as number, close: num(r?.close) as number, volume: num(r?.volume), adjusted_close: num(r?.adjusted_close) }));
}

export async function fetchEodhd(fetchFn: FetchFn, token: string, ticker: string, from?: string): Promise<DailyRow[]> {
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(ticker)}?api_token=${encodeURIComponent(token)}&fmt=json${from ? `&from=${from}` : ''}`;
  const r = await getText('eodhd', fetchFn, url);
  return parseEodhd(r.status, r.body);
}

// ───────────── Alpha Vantage ─────────────
export function alphaVantageSymbol(exchange: string, symbol: string, explicit?: string): string {
  if (explicit) return explicit;
  if (exchange === 'BSE') return `${symbol}.BSE`;
  throw new EquityProviderError('alphavantage', 'not_found', `ATLAS has no verified Alpha Vantage symbol format for ${exchange}.`);
}

export function parseAlphaVantage(status: number, body: string): DailyRow[] {
  if (status === 429) throw new EquityProviderError('alphavantage', 'rate_limited', 'Alpha Vantage rate limit reached (HTTP 429).');
  if (status >= 400) throw new EquityProviderError('alphavantage', 'provider_error', `Alpha Vantage returned HTTP ${status}.`);
  let raw: any;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new EquityProviderError('alphavantage', 'malformed', 'Alpha Vantage returned a response that is not JSON.');
  }
  // Alpha Vantage answers refusals with HTTP 200 and a message instead of data.
  if (typeof raw?.Information === 'string') throw new EquityProviderError('alphavantage', /premium|demo|claim your free/i.test(raw.Information) ? 'entitlement' : 'rate_limited', `Alpha Vantage: ${raw.Information.slice(0, 200)}`);
  if (typeof raw?.Note === 'string') throw new EquityProviderError('alphavantage', 'rate_limited', `Alpha Vantage: ${raw.Note.slice(0, 200)}`);
  if (typeof raw?.['Error Message'] === 'string') throw new EquityProviderError('alphavantage', 'not_found', `Alpha Vantage: ${raw['Error Message'].slice(0, 200)}`);
  const series = raw?.['Time Series (Daily)'];
  if (!series || typeof series !== 'object') throw new EquityProviderError('alphavantage', 'malformed', 'Alpha Vantage response has no "Time Series (Daily)".');
  return Object.entries(series as Record<string, Record<string, string>>).map(([date, v]) => ({ date, open: num(v['1. open']) as number, high: num(v['2. high']) as number, low: num(v['3. low']) as number, close: num(v['4. close']) as number, volume: num(v['5. volume']) })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchAlphaVantage(fetchFn: FetchFn, key: string, symbol: string): Promise<DailyRow[]> {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(key)}`;
  const r = await getText('alphavantage', fetchFn, url);
  return parseAlphaVantage(r.status, r.body);
}

// ───────────── Validation ─────────────
export interface RowCheck { ok: boolean; reasons: string[] }

/** Rejects what cannot be true; nothing is coerced or filled. Weekend dates are allowed (special sessions exist). */
export function checkRow(r: DailyRow, today: string): RowCheck {
  const reasons: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(`${r.date}T00:00:00Z`))) reasons.push('invalid_date');
  else if (r.date > today) reasons.push('date_in_future');
  for (const k of ['open', 'high', 'low', 'close'] as const) if (r[k] === null || !(r[k] > 0)) reasons.push(`${k}_not_positive`);
  if (!reasons.length) {
    if (r.high < r.low) reasons.push('high_below_low');
    if (r.high < Math.max(r.open, r.close)) reasons.push('high_below_open_or_close');
    if (r.low > Math.min(r.open, r.close)) reasons.push('low_above_open_or_close');
  }
  if (r.volume !== null && (!Number.isFinite(r.volume) || r.volume < 0)) reasons.push('volume_negative');
  if (r.adjusted_close !== undefined && r.adjusted_close !== null && !(r.adjusted_close > 0)) reasons.push('adjusted_close_not_positive');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Adjusted OHLC from a provider's adjusted close: every raw price on a day is multiplied by that day's
 * factor (adjusted_close ÷ close). Volume is left as traded. Applied once, to raw prices only.
 */
export function adjustRow(r: DailyRow): DailyRow | null {
  if (!r.adjusted_close || !(r.close > 0)) return null;
  const f = r.adjusted_close / r.close;
  // Rounded to the stored precision; high/low widened by rounding only, so OHLC integrity still holds.
  const q = (v: number) => Math.round(v * 1e6) / 1e6;
  const close = q(r.adjusted_close);
  const open = q(r.open * f);
  return { date: r.date, open, high: Math.max(q(r.high * f), open, close), low: Math.min(q(r.low * f), open, close), close, volume: r.volume };
}
