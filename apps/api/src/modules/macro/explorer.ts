import * as A from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { recordActivity } from '../research/activity.js';

// Macro relationship explorer: two stored series (macro, commodity benchmark, Indian index) compared on a
// common frequency. Each series is reduced to its last observation in each period (month or ISO week);
// changes are then taken per period — percentage-point differences for series measured in percent
// (rates, yields, unemployment), percentage changes for everything else. Only periods both series
// have are used; nothing is filled. Correlation describes co-movement; it does not establish causation.

export interface Loaded { key: string; label: string; units: string; source: string; frequency: string; obs: A.Obs[]; percentUnits: boolean }

const KEY = /^(macro:[A-Z0-9_]{2,40}|commodity:(fred|eia):[A-Za-z0-9_.-]{2,40}|equity:INDEX:[A-Z0-9]{2,30})$/;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

export async function loadSeries(db: Db, key: string): Promise<Loaded> {
  if (key.startsWith('macro:')) {
    const id = key.slice(6);
    const s = await db.maybeOne<{ title: string; units: string | null; frequency: string | null }>(`SELECT title, units, frequency FROM macro.series WHERE series_id=$1`, [id]);
    if (!s) throw notFound(`Unknown macro series ${id}.`);
    const rows = await db.query<{ d: string; v: number }>(`SELECT to_char(obs_date,'YYYY-MM-DD') AS d, value::float8 AS v FROM macro.observations WHERE series_id=$1 ORDER BY obs_date`, [id]);
    return { key, label: s.title, units: s.units ?? '', source: `FRED ${id}`, frequency: s.frequency ?? '', obs: rows.map((r) => ({ t: t(r.d), v: r.v })), percentUnits: /percent/i.test(s.units ?? '') };
  }
  if (key.startsWith('commodity:')) {
    const id = key.slice(10);
    const s = await db.maybeOne<{ name: string; unit: string; frequency: string; source_id: string; source_series: string }>(`SELECT name, unit, frequency, source_id, source_series FROM commodity.series WHERE series_id=$1`, [id]);
    if (!s) throw notFound(`Unknown commodity series ${id}.`);
    const rows = await db.query<{ d: string; v: number }>(`SELECT to_char(obs_date,'YYYY-MM-DD') AS d, value::float8 AS v FROM commodity.observations WHERE series_id=$1 ORDER BY obs_date`, [id]);
    return { key, label: s.name, units: s.unit, source: `${s.source_id.toUpperCase()} ${s.source_series}`, frequency: s.frequency, obs: rows.map((r) => ({ t: t(r.d), v: r.v })), percentUnits: false };
  }
  const sym = key.split(':')[2]!;
  const s = await db.maybeOne<{ instrument_id: string; name: string | null }>(`SELECT instrument_id, name FROM equity.instruments WHERE exchange='INDEX' AND symbol=$1`, [sym]);
  if (!s) throw notFound(`Unknown index ${sym}.`);
  const rows = await db.query<{ d: string; v: number }>(`SELECT to_char(p.trade_date,'YYYY-MM-DD') AS d, p.close::float8 AS v FROM equity.prices p JOIN equity.price_series ps USING (series_id) WHERE ps.instrument_id=$1 AND ps.basis='raw' ORDER BY p.trade_date`, [s.instrument_id]);
  return { key, label: s.name ?? sym, units: 'index points', source: 'EODHD end of day', frequency: 'daily (sessions)', obs: rows.map((r) => ({ t: t(r.d), v: r.v })), percentUnits: false };
}

/** Last observation in each ISO week (Monday-based), stamped with that observation's date. */
export function weekEnd(obs: A.Obs[]): A.Obs[] {
  const out: A.Obs[] = [];
  const weekOf = (ms: number) => Math.floor((ms / 86_400_000 + 3) / 7); // epoch day 0 was a Thursday
  for (const o of obs) {
    const last = out[out.length - 1];
    if (last && weekOf(last.t) === weekOf(o.t)) out[out.length - 1] = o;
    else out.push(o);
  }
  return out;
}

const periodKey = (ms: number, f: 'monthly' | 'weekly') => (f === 'monthly' ? new Date(ms).toISOString().slice(0, 7) : String(Math.floor((ms / 86_400_000 + 3) / 7)));

/** Per-period changes keyed by period: percentage points for percent units, otherwise % change (needs positive values). */
export function periodChanges(obs: A.Obs[], f: 'monthly' | 'weekly', percentUnits: boolean): Map<string, { t: number; level: number; change: number | null }> {
  const pts = f === 'monthly' ? A.monthEnd(obs) : weekEnd(obs);
  const out = new Map<string, { t: number; level: number; change: number | null }>();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[i - 1];
    // A change is defined only between consecutive periods.
    const consecutive = prev && (f === 'monthly' ? monthsApart(prev.t, p.t) === 1 : Math.round((p.t - prev.t) / (7 * 86_400_000)) <= 1 && periodKey(p.t, f) !== periodKey(prev.t, f));
    let change: number | null = null;
    if (consecutive && prev) change = percentUnits ? p.v - prev.v : prev.v > 0 && p.v > 0 ? p.v / prev.v - 1 : null;
    out.set(periodKey(p.t, f), { t: p.t, level: p.v, change });
  }
  return out;
}
const monthsApart = (a: number, b: number) => { const x = new Date(a); const y = new Date(b); return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth(); };

export interface Exploration {
  pairs: { period: string; t: number; a_level: number; b_level: number; a_change: number | null; b_change: number | null }[];
  correlation: number | null; n: number; rolling: { t: number; v: number }[]; window: number;
}

export function explore(a: Loaded, b: Loaded, f: 'monthly' | 'weekly', window: number): Exploration {
  const ca = periodChanges(a.obs, f, a.percentUnits);
  const cb = periodChanges(b.obs, f, b.percentUnits);
  const pairs = [...ca.entries()].filter(([k]) => cb.has(k)).map(([k, x]) => ({ period: k, t: x.t, a_level: x.level, b_level: cb.get(k)!.level, a_change: x.change, b_change: cb.get(k)!.change })).sort((p, q) => p.t - q.t);
  const both = pairs.filter((p) => p.a_change !== null && p.b_change !== null);
  const corr = both.length >= 12 ? A.pearson(both.map((p) => p.a_change!), both.map((p) => p.b_change!)) : null;
  const rolling: { t: number; v: number }[] = [];
  for (let i = window - 1; i < both.length; i++) {
    const w = both.slice(i - window + 1, i + 1);
    rolling.push({ t: w[w.length - 1]!.t, v: A.pearson(w.map((p) => p.a_change!), w.map((p) => p.b_change!)) });
  }
  return { pairs, correlation: corr, n: both.length, rolling, window };
}

export async function explorerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/macro/explorer/options', async (req) => {
    requireUser(req);
    const macro = await ctx.db.query<{ key: string; label: string; frequency: string | null }>(`SELECT 'macro:' || series_id AS key, title AS label, frequency FROM macro.series WHERE enabled AND observations > 0 ORDER BY category, series_id`);
    const comm = await ctx.db.query<{ key: string; label: string; frequency: string }>(`SELECT 'commodity:' || series_id AS key, name AS label, frequency FROM commodity.series WHERE enabled AND observations > 0 AND price_type <> 'futures_settlement' ORDER BY category, name`);
    const idx = await ctx.db.query<{ key: string; label: string }>(`SELECT DISTINCT 'equity:INDEX:' || i.symbol AS key, coalesce(i.name, i.symbol) AS label FROM equity.instruments i JOIN equity.price_series s USING (instrument_id) WHERE i.exchange='INDEX' AND s.observations > 0`);
    return { groups: [{ group: 'Macro (FRED)', items: macro }, { group: 'Commodities', items: comm }, { group: 'Indian indices (EODHD)', items: idx.map((x) => ({ ...x, frequency: 'daily' })) }] };
  });

  app.post('/v1/macro/explore', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ a: z.string().regex(KEY), b: z.string().regex(KEY), frequency: z.enum(['monthly', 'weekly']).default('monthly'), window: z.number().int().min(6).max(120).default(24) }), req.body);
    if (b.a === b.b) throw badRequest('Choose two different series.');
    const [sa, sb] = [await loadSeries(ctx.db, b.a), await loadSeries(ctx.db, b.b)];
    for (const s of [sa, sb]) if (b.frequency === 'weekly' && /month|quarter|annual/i.test(s.frequency)) throw badRequest(`${s.label} is published ${s.frequency.toLowerCase()}; compare it monthly.`);
    const r = explore(sa, sb, b.frequency, b.window);
    if (r.n >= 12) await recordActivity(ctx.db, u.userId, 'correlation_study', `explorer|${b.a}|${b.b}|${b.frequency}|${b.window}`, ctx.clock(), { n: r.n });
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const unit = (s: Loaded) => (s.percentUnits ? 'change in percentage points' : '% change');
    return {
      a: { key: sa.key, label: sa.label, units: sa.units, source: sa.source, change_unit: unit(sa) }, b: { key: sb.key, label: sb.label, units: sb.units, source: sb.source, change_unit: unit(sb) },
      frequency: b.frequency, window: b.window, n: r.n, correlation: r.correlation,
      first: r.pairs[0] ? iso(r.pairs[0].t) : null, last: r.pairs.length ? iso(r.pairs[r.pairs.length - 1]!.t) : null,
      levels: r.pairs.map((p) => ({ t: iso(p.t), a: p.a_level, b: p.b_level })),
      rolling: r.rolling.map((p) => ({ t: iso(p.t), v: p.v })),
      insufficient: r.n < 12 ? `Only ${r.n} shared ${b.frequency === 'monthly' ? 'months' : 'weeks'} with a change in both series; at least 12 are needed.` : null,
      method: `Each series is reduced to its last observation per ${b.frequency === 'monthly' ? 'calendar month' : 'ISO week'}. Changes: ${sa.label} as ${unit(sa)}, ${sb.label} as ${unit(sb)}, only between consecutive periods. Pearson correlation over the ${r.n} periods both series share; rolling correlation over ${b.window} periods.`,
      caveats: ['Correlation describes how two series moved together in the past; it does not establish causation and can change.', 'Series released on different schedules are compared by the period they refer to, not by when they were published.', 'With few periods, correlations are unreliable: check n.'],
    };
  });
}
