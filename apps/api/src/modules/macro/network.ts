import * as A from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { loadSeries, periodChanges, type Loaded } from './explorer.js';

// Intelligence network: how stored series moved together. Nodes are series ATLAS actually stores; an edge is
// the Pearson correlation of weekly changes over the chosen window, on weeks both series have. Nothing is
// invented: a series that is not stored is left out, and a pair with too few shared weeks has no edge.
// Correlation describes co-movement in the window; it is not causation and can change.

export const NETWORK_NODES: { key: string; group: 'india' | 'rates' | 'fx' | 'energy' | 'crypto' | 'conditions'; short: string }[] = [
  { key: 'equity:INDEX:NIFTY50', group: 'india', short: 'NIFTY 50' },
  { key: 'equity:INDEX:NIFTYBANK', group: 'india', short: 'NIFTY BANK' },
  { key: 'equity:INDEX:SENSEX', group: 'india', short: 'SENSEX' },
  { key: 'macro:DGS10', group: 'rates', short: 'US 10Y yield' },
  { key: 'macro:DGS2', group: 'rates', short: 'US 2Y yield' },
  { key: 'macro:DFII10', group: 'rates', short: 'US 10Y real yield' },
  { key: 'macro:T10Y2Y', group: 'rates', short: '10Y−2Y spread' },
  { key: 'macro:DEXINUS', group: 'fx', short: 'Rupee per USD' },
  { key: 'macro:DTWEXBGS', group: 'fx', short: 'US dollar index' },
  { key: 'macro:STLFSI4', group: 'conditions', short: 'Financial stress' },
  { key: 'macro:NFCI', group: 'conditions', short: 'Financial conditions' },
  { key: 'commodity:fred:DCOILBRENTEU', group: 'energy', short: 'Brent crude' },
  { key: 'commodity:fred:DCOILWTICO', group: 'energy', short: 'WTI crude' },
  { key: 'commodity:fred:DHHNGSP', group: 'energy', short: 'Henry Hub gas' },
  { key: 'commodity:fred:GASREGW', group: 'energy', short: 'US gasoline' },
  { key: 'crypto:bitcoin', group: 'crypto', short: 'Bitcoin' },
  { key: 'crypto:ethereum', group: 'crypto', short: 'Ether' },
];

const hrefOf = (key: string) => {
  const p = key.split(':');
  return p[0] === 'macro' ? `/app/macro/${p[1]}` : p[0] === 'commodity' ? `/app/commodities/${p[1]}/${p[2]}` : p[0] === 'equity' ? `/app/equities/INDEX/${p[2]}` : `/app/crypto/assets/${p[1]}`;
};
const timing = (key: string) => (key.startsWith('equity:') ? 'End of day' : key.startsWith('crypto:') ? 'Daily close (UTC), venue price' : 'Latest official observation');

async function loadCrypto(db: Db, key: string): Promise<Loaded | null> {
  const asset = key.slice(7);
  const s = await db.maybeOne<{ series_id: string; name: string; source_id: string }>(
    `SELECT ps.series_id, a.name, ps.source_id FROM crypto.price_series ps JOIN crypto.assets a USING (asset_id)
      WHERE a.canonical_key=$1 AND ps.interval='1d' AND ps.observations > 0 ORDER BY (ps.source_id='binance') DESC, ps.observations DESC LIMIT 1`, [asset]);
  if (!s) return null;
  const rows = await db.query<{ d: string; v: number }>(`SELECT to_char(open_time,'YYYY-MM-DD') AS d, close::float8 AS v FROM crypto.ohlcv WHERE series_id=$1 ORDER BY open_time`, [s.series_id]);
  return { key, label: s.name, units: 'USD', source: `${s.source_id} daily candles`, frequency: 'daily', obs: rows.map((r) => ({ t: Date.parse(`${r.d}T00:00:00Z`), v: r.v })), percentUnits: false };
}

/** Correlation of weekly changes on shared weeks; null with fewer than `minN` shared weeks. Exported for tests. */
export function weeklyCorrelation(a: Loaded, b: Loaded, sinceMs: number, minN = 26): { r: number; n: number } | null {
  const ca = periodChanges(a.obs.filter((o) => o.t >= sinceMs), 'weekly', a.percentUnits);
  const cb = periodChanges(b.obs.filter((o) => o.t >= sinceMs), 'weekly', b.percentUnits);
  const xs: number[] = [], ys: number[] = [];
  for (const [k, x] of ca) { const y = cb.get(k); if (y && x.change !== null && y.change !== null) { xs.push(x.change); ys.push(y.change); } }
  if (xs.length < minN) return null;
  const r = A.pearson(xs, ys);
  return Number.isFinite(r) ? { r, n: xs.length } : null;
}

export async function networkRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const cache = new Map<string, { at: number; data: unknown }>();
  app.get('/v1/network', async (req) => {
    requireUser(req);
    const { window } = parse(z.object({ window: z.enum(['1y', '3y', '5y']).default('1y') }), req.query);
    const now = ctx.clock().getTime();
    const hit = cache.get(window);
    if (hit && now - hit.at < 30 * 60_000) return hit.data;
    const years = Number(window[0]);
    const since = now - years * 365.25 * 86_400_000;
    const loaded: (Loaded & { group: string; short: string })[] = [];
    for (const n of NETWORK_NODES) {
      const s = n.key.startsWith('crypto:') ? await loadCrypto(ctx.db, n.key) : await loadSeries(ctx.db, n.key).catch(() => null);
      if (s && s.obs.some((o) => o.t >= since)) loaded.push({ ...s, group: n.group, short: n.short });
    }
    const edges: { a: string; b: string; r: number; n: number }[] = [];
    for (let i = 0; i < loaded.length; i++) for (let j = i + 1; j < loaded.length; j++) {
      const c = weeklyCorrelation(loaded[i]!, loaded[j]!, since);
      if (c) edges.push({ a: loaded[i]!.key, b: loaded[j]!.key, r: c.r, n: c.n });
    }
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    const data = {
      window, from: iso(since), to: iso(now),
      nodes: loaded.map((s) => { const last = s.obs[s.obs.length - 1]!; return { key: s.key, label: s.label, short: s.short, group: s.group, units: s.units, source: s.source, href: hrefOf(s.key), timing: timing(s.key), latest: { d: iso(last.t), v: last.v } }; }),
      edges,
      not_stored: NETWORK_NODES.filter((n) => !loaded.some((l) => l.key === n.key)).map((n) => n.short),
      method: `Each series is reduced to its last observation in each ISO week over the last ${years} year${years > 1 ? 's' : ''}. Changes are percentage changes, or percentage-point differences for series measured in percent (yields, spreads). An edge is the Pearson correlation of those weekly changes on weeks both series have; pairs with fewer than 26 shared weeks have no edge.`,
      caveats: ['Correlation describes how two series moved together in this window. It does not show that one causes the other, and it can change.', 'Indian index history covers about one year, so longer windows drop those nodes’ edges or use fewer weeks (n is shown).'],
    };
    cache.set(window, { at: now, data });
    return data;
  });
}
