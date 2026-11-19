import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { requireUser } from '../auth/service.js';
import { loadSeries, type Loaded } from './explorer.js';
import { loadCrypto } from './network.js';

// Market history from stored observations: the largest single-observation moves and the record high and low
// of each series. Found in the data, not written by hand; dates and values are exactly what is stored.

const SERIES: { key: string; short: string; href: string }[] = [
  { key: 'commodity:fred:DCOILWTICO', short: 'WTI crude', href: '/app/commodities/fred/DCOILWTICO' },
  { key: 'commodity:fred:DCOILBRENTEU', short: 'Brent crude', href: '/app/commodities/fred/DCOILBRENTEU' },
  { key: 'commodity:fred:DHHNGSP', short: 'Henry Hub gas', href: '/app/commodities/fred/DHHNGSP' },
  { key: 'equity:INDEX:NIFTY50', short: 'NIFTY 50', href: '/app/equities/INDEX/NIFTY50' },
  { key: 'macro:DGS10', short: 'US 10Y yield', href: '/app/macro/DGS10' },
  { key: 'macro:DEXINUS', short: 'Rupee per USD', href: '/app/macro/DEXINUS' },
  { key: 'crypto:bitcoin', short: 'Bitcoin', href: '/app/crypto/assets/bitcoin' },
];

export interface HistoryMove { short: string; href: string; date: string; prev_date: string; prev: number; value: number; change: number; unit: string; kind: 'pct' | 'pp' }

/** Moves between consecutive stored observations no more than `maxGapDays` apart. Exported for tests. */
export function largestMoves(s: Loaded, meta: { short: string; href: string }, n: number, maxGapDays = 5): HistoryMove[] {
  const out: HistoryMove[] = [];
  for (let i = 1; i < s.obs.length; i++) {
    const a = s.obs[i - 1]!, b = s.obs[i]!;
    if ((b.t - a.t) / 86_400_000 > maxGapDays) continue;
    const change = s.percentUnits ? b.v - a.v : a.v > 0 && b.v > 0 ? b.v / a.v - 1 : null;
    if (change === null) continue;
    out.push({ ...meta, date: iso(b.t), prev_date: iso(a.t), prev: a.v, value: b.v, change, unit: s.units, kind: s.percentUnits ? 'pp' : 'pct' });
  }
  return out.sort((x, y) => Math.abs(y.change) - Math.abs(x.change)).slice(0, n);
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function pulseRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  let cache: { at: number; data: unknown } | null = null;
  app.get('/v1/pulse/history', async (req) => {
    requireUser(req);
    const now = ctx.clock().getTime();
    if (cache && now - cache.at < 60 * 60_000) return cache.data;
    const series: { short: string; href: string; first: string; last: string; unit: string; high: { d: string; v: number }; low: { d: string; v: number }; moves: HistoryMove[] }[] = [];
    for (const m of SERIES) {
      const s = m.key.startsWith('crypto:') ? await loadCrypto(ctx.db, m.key) : await loadSeries(ctx.db, m.key).catch(() => null);
      if (!s || s.obs.length < 20) continue;
      let hi = s.obs[0]!, lo = s.obs[0]!;
      for (const o of s.obs) { if (o.v > hi.v) hi = o; if (o.v < lo.v) lo = o; }
      series.push({ short: m.short, href: m.href, first: iso(s.obs[0]!.t), last: iso(s.obs[s.obs.length - 1]!.t), unit: s.units, high: { d: iso(hi.t), v: hi.v }, low: { d: iso(lo.t), v: lo.v }, moves: largestMoves(s, m, 3) });
    }
    const data = {
      series,
      method: 'Moves are changes between consecutive stored observations no more than 5 days apart: percentage changes, or percentage-point differences for yields. Record highs and lows are over each series’ stored history (dates shown), not all-time.',
    };
    cache = { at: now, data };
    return data;
  });
}
