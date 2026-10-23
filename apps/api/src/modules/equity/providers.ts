// Indian equity reference-data providers (real data, separate from the synthetic ref/market schemas).
// Each adapter turns one provider's documented response into canonical daily rows and classifies every
// failure (auth, entitlement, rate limit, network, malformed) instead of treating it as "no data".
// Research and evidence: docs/equity/SOURCE_CAPABILITY_MATRIX.md (checked 23 Oct 2026).

export type ErrorCategory = 'network' | 'timeout' | 'auth' | 'entitlement' | 'rate_limited' | 'quota_exhausted' | 'malformed' | 'provider_error' | 'not_found' | 'not_configured';

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
    limits_note: 'Free plan: 20 API calls a day, 20 requests a minute, a one-time 500-call welcome bonus, one year of end-of-day history, no fundamentals (documented). The allowance resets at midnight GMT (05:30 IST). End-of-day, splits and dividends cost 1 call each; the usage endpoint costs 0. HTTP 402 means the day’s allowance is spent. The public demo token returns HTTP 403 for Indian tickers (verified).',
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

/**
 * API calls each EODHD endpoint spends from the daily allowance (https://eodhd.com/financial-apis/api-limits,
 * checked 23 Oct 2026). Fundamentals (10) and bulk (100) are listed so nothing calls them by accident:
 * fundamentals are not included in the free plan and one bulk call is five times the free daily allowance.
 */
export const EODHD_COSTS = { eod: 1, splits: 1, dividends: 1, exchange_details: 1, user: 0, fundamentals: 10, bulk_eod: 100 } as const;
export type EodhdEndpoint = keyof typeof EODHD_COSTS;

/** HTTP status → error category. Documented: 401 bad token, 402 daily allowance spent, 429 per-minute limit. */
export function eodhdStatusError(status: number): EquityProviderError | null {
  if (status === 401) return new EquityProviderError('eodhd', 'auth', 'EODHD rejected the API token (HTTP 401). Check EODHD_API_TOKEN in .env.local and restart.');
  if (status === 402) return new EquityProviderError('eodhd', 'quota_exhausted', 'EODHD says the daily API allowance is spent (HTTP 402). Calls resume after midnight GMT.');
  if (status === 403) return new EquityProviderError('eodhd', 'entitlement', 'EODHD refused this request for the configured plan or token (HTTP 403).');
  if (status === 404) return new EquityProviderError('eodhd', 'not_found', 'EODHD has no data for this ticker (HTTP 404).');
  if (status === 429) return new EquityProviderError('eodhd', 'rate_limited', 'EODHD per-minute request limit reached (HTTP 429).');
  if (status >= 400) return new EquityProviderError('eodhd', 'provider_error', `EODHD returned HTTP ${status}.`);
  return null;
}

function eodhdJson(status: number, body: string): unknown {
  const err = eodhdStatusError(status);
  if (err) throw err;
  try {
    return JSON.parse(body);
  } catch {
    throw new EquityProviderError('eodhd', 'malformed', 'EODHD returned a response that is not JSON.');
  }
}

export function parseEodhd(status: number, body: string): DailyRow[] {
  const raw = eodhdJson(status, body);
  if (!Array.isArray(raw)) throw new EquityProviderError('eodhd', 'malformed', 'EODHD response is not an array of daily rows.');
  return raw.map((r: any) => ({ date: String(r?.date ?? ''), open: num(r?.open) as number, high: num(r?.high) as number, low: num(r?.low) as number, close: num(r?.close) as number, volume: num(r?.volume), adjusted_close: num(r?.adjusted_close) }));
}

export interface EodhdUsage { api_requests: number; api_requests_date: string; daily_limit: number; extra_limit: number | null; subscription: string | null }

/** /api/user (costs 0 calls). apiRequests counts API calls spent on apiRequestsDate (documented). */
export function parseEodhdUser(status: number, body: string): EodhdUsage {
  const raw = eodhdJson(status, body) as any;
  const used = num(raw?.apiRequests);
  const limit = num(raw?.dailyRateLimit);
  const date = String(raw?.apiRequestsDate ?? '');
  if (used === null || limit === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new EquityProviderError('eodhd', 'malformed', 'EODHD usage response is missing apiRequests, apiRequestsDate or dailyRateLimit.');
  return { api_requests: used, api_requests_date: date, daily_limit: limit, extra_limit: num(raw?.extraLimit), subscription: typeof raw?.subscriptionType === 'string' ? raw.subscriptionType : null };
}

export interface ProviderAction { kind: 'split' | 'dividend'; ex_date: string; ratio: string | null; value: number | null; currency: string | null; raw: unknown }

export function parseEodhdSplits(status: number, body: string): ProviderAction[] {
  const raw = eodhdJson(status, body);
  if (!Array.isArray(raw)) throw new EquityProviderError('eodhd', 'malformed', 'EODHD splits response is not an array.');
  return raw.filter((r: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date)) && /^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(String(r?.split)))
    .map((r: any) => ({ kind: 'split' as const, ex_date: r.date, ratio: String(r.split), value: null, currency: null, raw: r }));
}

export function parseEodhdDividends(status: number, body: string): ProviderAction[] {
  const raw = eodhdJson(status, body);
  if (!Array.isArray(raw)) throw new EquityProviderError('eodhd', 'malformed', 'EODHD dividends response is not an array.');
  return raw.filter((r: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date)) && num(r?.unadjustedValue ?? r?.value) !== null)
    .map((r: any) => ({ kind: 'dividend' as const, ex_date: r.date, ratio: null, value: num(r.unadjustedValue ?? r.value), currency: typeof r.currency === 'string' ? r.currency : null, raw: r }));
}

export interface ProviderHoliday { date: string; name: string; type: string | null }

/**
 * Exchange details (v1). Documented shape: ExchangeHolidays is an indexed object of {Holiday, Date, Type}.
 * Not yet exercised against a real response for NSE (the public demo token is refused), so anything that
 * does not match is rejected rather than guessed at.
 */
export function parseEodhdExchangeDetails(status: number, body: string): { timezone: string | null; holidays: ProviderHoliday[] } {
  const raw = eodhdJson(status, body) as any;
  const h = raw?.ExchangeHolidays;
  if (!raw || typeof raw !== 'object' || (h !== undefined && (typeof h !== 'object' || h === null))) throw new EquityProviderError('eodhd', 'malformed', 'EODHD exchange-details response has an unexpected shape.');
  const holidays = Object.values(h ?? {}).filter((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(x?.Date)) && typeof x?.Holiday === 'string')
    .map((x: any) => ({ date: x.Date, name: String(x.Holiday).slice(0, 200), type: typeof x.Type === 'string' ? x.Type : null }));
  return { timezone: typeof raw.Timezone === 'string' ? raw.Timezone : null, holidays };
}

export function eodhdUrl(endpoint: EodhdEndpoint, token: string, target: string, params: Record<string, string | undefined> = {}): string {
  const path = endpoint === 'eod' ? `eod/${encodeURIComponent(target)}` : endpoint === 'splits' ? `splits/${encodeURIComponent(target)}` : endpoint === 'dividends' ? `div/${encodeURIComponent(target)}`
    : endpoint === 'exchange_details' ? `exchange-details/${encodeURIComponent(target)}` : endpoint === 'user' ? 'user' : null;
  if (!path) throw new EquityProviderError('eodhd', 'not_found', `ATLAS does not call the EODHD ${endpoint} endpoint.`);
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join('');
  return `https://eodhd.com/api/${path}?api_token=${encodeURIComponent(token)}&fmt=json${q}`;
}

/** One EODHD request; returns the raw status and body (callers parse). Errors before a response are classified. */
export async function eodhdGet(fetchFn: FetchFn, token: string, endpoint: EodhdEndpoint, target: string, params: Record<string, string | undefined> = {}): Promise<{ status: number; body: string }> {
  return getText('eodhd', fetchFn, eodhdUrl(endpoint, token, target, params));
}

export async function fetchEodhd(fetchFn: FetchFn, token: string, ticker: string, from?: string): Promise<DailyRow[]> {
  const r = await eodhdGet(fetchFn, token, 'eod', ticker, { from });
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
