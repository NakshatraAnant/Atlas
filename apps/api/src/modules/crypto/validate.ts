// Pure validation for crypto observations. Rules reject what cannot be true (a high below the low, a
// timestamp in the future, a negative volume) and flag what is merely unusual (a 40% daily move) as
// "suspect" instead of rejecting it: crypto markets do make extreme moves. Missing values stay null.

export const TRANSFORM_VERSION = 'crypto-transform-1';
export const DAY_MS = 86_400_000;

export interface Candle {
  open_time: number; // epoch ms, UTC
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  quote_volume?: number | null;
  market_cap?: number | null;
  trades?: number | null;
}

export interface CandleCheck { ok: boolean; reasons: string[]; suspect: boolean; notes: string[] }

const finitePos = (v: number | null | undefined) => v !== null && v !== undefined && Number.isFinite(v) && v > 0;

/** Parse a provider number string. Empty, non-numeric or non-finite values become null (never 0). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function checkCandle(c: Candle, opts: { now: number; interval: '1d' | '1h'; prevClose?: number | null }): CandleCheck {
  const reasons: string[] = [];
  const notes: string[] = [];
  const step = opts.interval === '1d' ? DAY_MS : 3_600_000;
  if (!Number.isFinite(c.open_time) || c.open_time < Date.UTC(2009, 0, 3)) reasons.push('invalid_timestamp');
  else if (c.open_time % step !== 0) reasons.push('timestamp_not_aligned_to_interval');
  if (c.open_time > opts.now) reasons.push('timestamp_in_future');
  if (!finitePos(c.close)) reasons.push('close_not_positive');
  const hasOhl = c.open !== null || c.high !== null || c.low !== null;
  if (hasOhl) {
    if (!finitePos(c.open) || !finitePos(c.high) || !finitePos(c.low)) reasons.push('ohl_not_positive');
    else {
      if (c.high! < c.low!) reasons.push('high_below_low');
      if (c.high! < Math.max(c.open!, c.close)) reasons.push('high_below_open_or_close');
      if (c.low! > Math.min(c.open!, c.close)) reasons.push('low_above_open_or_close');
    }
  }
  for (const [k, v] of [['volume', c.volume], ['quote_volume', c.quote_volume], ['market_cap', c.market_cap]] as const) {
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) reasons.push(`${k}_negative_or_invalid`);
  }
  let suspect = false;
  if (!reasons.length && opts.prevClose && opts.prevClose > 0) {
    const move = Math.abs(c.close / opts.prevClose - 1);
    // Context-aware: an extreme move is kept but flagged for review, never silently dropped.
    if (move > (opts.interval === '1d' ? 0.5 : 0.3)) {
      suspect = true;
      notes.push(`close moved ${(move * 100).toFixed(1)}% from the previous ${opts.interval} close`);
    }
  }
  return { ok: reasons.length === 0, reasons, suspect, notes };
}

/** Missing interval starts between first and last open time (sorted input). */
export function findGaps(openTimes: number[], stepMs: number): { from: number; to: number; missing: number }[] {
  const gaps: { from: number; to: number; missing: number }[] = [];
  for (let i = 1; i < openTimes.length; i++) {
    const d = openTimes[i]! - openTimes[i - 1]!;
    if (d > stepMs) gaps.push({ from: openTimes[i - 1]! + stepMs, to: openTimes[i]! - stepMs, missing: Math.round(d / stepMs) - 1 });
  }
  return gaps;
}

/** Remove exact duplicate timestamps (keep the last occurrence, which is the provider's latest revision). */
export function dedupeByTime<T extends { open_time: number }>(rows: T[]): { rows: T[]; duplicates: number } {
  const m = new Map<number, T>();
  for (const r of rows) m.set(r.open_time, r);
  const out = [...m.values()].sort((a, b) => a.open_time - b.open_time);
  return { rows: out, duplicates: rows.length - out.length };
}

/** EVM addresses: 0x + 40 hex, normalised to lower case. Solana: base58, 32–44 chars, case preserved. */
export function normaliseAddress(family: 'evm' | 'svm' | 'utxo' | 'other', address: string): string | null {
  const a = address.trim();
  if (family === 'evm') return /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null;
  if (family === 'svm') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
  return a.length >= 4 && a.length <= 100 ? a : null;
}

export interface SupplyCheck { validation: 'valid' | 'inconsistent'; note: string | null }

/** Supply definitions are kept separate; this only flags combinations that cannot all be true. */
export function checkSupply(s: { circulating: number | null; total: number | null; max: number | null }): SupplyCheck {
  const issues: string[] = [];
  const tol = 1.000001; // providers round independently
  if (s.circulating !== null && s.total !== null && s.circulating > s.total * tol) issues.push('circulating supply exceeds total supply');
  if (s.total !== null && s.max !== null && s.total > s.max * tol) issues.push('total supply exceeds maximum supply');
  if (s.circulating !== null && s.max !== null && s.circulating > s.max * tol) issues.push('circulating supply exceeds maximum supply');
  return issues.length ? { validation: 'inconsistent', note: issues.join('; ') } : { validation: 'valid', note: null };
}

/** UTC midnight of the day containing t. */
export const utcDay = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;

/** Freshness of an observation against a target age. */
export function freshness(observedAt: string | null, targetMinutes: number, now: number): { state: 'fresh' | 'stale' | 'missing'; age_minutes: number | null } {
  if (!observedAt) return { state: 'missing', age_minutes: null };
  const age = (now - Date.parse(observedAt)) / 60_000;
  return { state: age <= targetMinutes ? 'fresh' : 'stale', age_minutes: Math.round(age) };
}

/** Two providers disagree by more than tol (relative). Used to flag, never to overwrite. */
export function providersConflict(a: number | null, b: number | null, tol = 0.02): boolean {
  if (a === null || b === null || a <= 0 || b <= 0) return false;
  return Math.abs(a / b - 1) > tol;
}
