import * as A from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, conflict, notFound, parse } from '../../lib/http.js';
import { isOperator, requireRole, requireUser } from '../auth/service.js';
import { refreshCommodities, type CommodityKeys } from './ingest.js';
import { freshnessOf } from '../../lib/freshness.js';
import { CATEGORY_NOTES, SERIES, UNAVAILABLE } from './sources.js';

// Commodity research over stored source series. Categories stay separate; every figure states its source,
// frequency, unit and price type. Analytics run only on what is stored and say when data is insufficient.

export const commodityKeys = (ctx: AppContext): CommodityKeys => ({ eia: ctx.cfg.EIA_API_KEY, fred: ctx.cfg.FRED_API_KEY });

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

interface Row { series_id: string; category: string; commodity: string; name: string; price_type: string; unit: string; currency: string | null; frequency: A.Frequency; source_id: string; source_series: string; upstream: string; contract_position: number | null; licence_note: string; classification: string; first_date: string | null; last_date: string | null; observations: number; last_import_at: string | null; last_error: string | null; last_error_at: string | null }

async function seriesRows(db: Db): Promise<Row[]> {
  return db.query<Row>(`SELECT series_id, category, commodity, name, price_type, unit, currency, frequency, source_id, source_series, upstream, contract_position, licence_note, classification,
      to_char(first_date, 'YYYY-MM-DD') AS first_date, to_char(last_date, 'YYYY-MM-DD') AS last_date, observations, last_import_at, last_error, last_error_at FROM commodity.series WHERE enabled ORDER BY category, commodity, series_id`);
}

export async function loadObs(db: Db, seriesId: string, from?: string): Promise<A.Obs[]> {
  const rows = await db.query<{ d: string; v: number }>(`SELECT to_char(obs_date, 'YYYY-MM-DD') AS d, value::float8 AS v FROM commodity.observations WHERE series_id=$1 AND ($2::date IS NULL OR obs_date >= $2::date) ORDER BY obs_date`, [seriesId, from ?? null]);
  return rows.map((r) => ({ t: Date.parse(`${r.d}T00:00:00Z`), v: r.v }));
}

/** Change from the last observation on or before (latest − days) to the latest; null when that history is not stored. */
function changeOver(obs: A.Obs[], days: number): number | null {
  if (!obs.length) return null;
  const last = obs[obs.length - 1]!;
  const target = last.t - days * DAY;
  let base: A.Obs | undefined;
  for (let i = obs.length - 1; i >= 0; i--) if (obs[i]!.t <= target) { base = obs[i]; break; }
  if (!base || last.t - base.t > (days + 10) * DAY || !(base.v > 0) || !(last.v > 0)) return null;
  return last.v / base.v - 1;
}

/** The shared schedule-aware freshness (lib/freshness.ts), with discontinued series marked as such. */
function freshness(lastDate: string | null, frequency: A.Frequency, now: Date, seriesId?: string, lastError?: string | null) {
  return freshnessOf(lastDate, frequency, now, lastError, { discontinuedAfter: SERIES.find((s) => s.series_id === seriesId)?.discontinued_after });
}

function stats(obs: A.Obs[], frequency: A.Frequency) {
  const n = A.PERIODS_PER_YEAR[frequency];
  const window = obs.filter((o) => o.t >= obs[obs.length - 1]!.t - 366 * DAY);
  const pr = A.periodicReturns(window, frequency);
  const rs = pr.returns.map((x) => x.r);
  const positive = window.every((o) => o.v > 0);
  const dd = positive && window.length > 2 ? A.drawdowns(window) : null;
  return {
    last: obs[obs.length - 1]!.v, last_date: iso(obs[obs.length - 1]!.t),
    change: { m1: changeOver(obs, 30), m3: changeOver(obs, 91), y1: changeOver(obs, 365), y5: changeOver(obs, 5 * 365) },
    vol_1y: rs.length >= Math.min(20, n) ? A.stdev(rs) * Math.sqrt(n) : null,
    max_drawdown_1y: dd && dd.ok ? dd.max_drawdown : null,
    drawdown_note: positive ? null : 'The last year contains a zero or negative price: drawdown is not defined.',
    returns_used: rs.length, skipped_gap: pr.skipped_gap, skipped_non_positive: pr.skipped_non_positive,
    annualisation: `${frequency} → ×√${n}`,
  };
}

const SPREADS = [
  { id: 'brent_wti', name: 'Brent − WTI (location spread)', unit: 'USD per barrel', a: 'fred:DCOILBRENTEU', b: 'fred:DCOILWTICO', fa: 1, fb: 1, note: 'Both are EIA daily spot assessments in USD per barrel.' },
  { id: 'heating_oil_crack', name: 'Heating oil crack (NY Harbor heating oil × 42 − WTI)', unit: 'USD per barrel', a: 'fred:DHOILNYH', b: 'fred:DCOILWTICO', fa: 42, fb: 1, note: '42 US gallons per barrel. Spot locations differ (New York Harbor vs Cushing); a simple 1:1 crack, not a refinery margin.' },
  { id: 'diesel_crack', name: 'Gulf Coast diesel crack (ULSD × 42 − WTI)', unit: 'USD per barrel', a: 'fred:DDFUELUSGULF', b: 'fred:DCOILWTICO', fa: 42, fb: 1, note: '42 US gallons per barrel; simple 1:1 crack.' },
  { id: 'jet_crack', name: 'Gulf Coast jet fuel crack (jet × 42 − WTI)', unit: 'USD per barrel', a: 'fred:DJFUELUSGULF', b: 'fred:DCOILWTICO', fa: 42, fb: 1, note: '42 US gallons per barrel; simple 1:1 crack.' },
];

export async function commodityRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const now = () => ctx.clock();
  let running = false;

  app.get('/v1/commodities', async (req) => {
    const ops = isOperator(requireUser(req));
    const rows = await seriesRows(db);
    const t = now();
    const items: (Row & Record<string, unknown>)[] = [];
    for (const r of rows) {
      const obs = r.observations ? await loadObs(db, r.series_id, iso(t.getTime() - 6 * 366 * DAY)) : [];
      items.push({ ...r, freshness: freshness(r.last_date, r.frequency, t, r.series_id, r.last_error), last: obs.length ? obs[obs.length - 1]!.v : null, change: obs.length ? { m1: changeOver(obs, 30), y1: changeOver(obs, 365) } : null, configured: r.source_id === 'fred' || !!ctx.cfg.EIA_API_KEY });
    }
    const jobs = await db.query(`SELECT job_id, series_id, started_at, status, received, stored, unchanged, corrected, missing_values, rejected, error, error_category FROM commodity.import_jobs ORDER BY started_at DESC LIMIT 15`);
    return {
      categories: (Object.keys(CATEGORY_NOTES) as (keyof typeof CATEGORY_NOTES)[]).map((c) => ({ category: c, note: CATEGORY_NOTES[c], series: items.filter((i) => i.category === c) })),
      unavailable: UNAVAILABLE, jobs: ops ? jobs : [], diagnostics_visible: ops, eia_configured: !!ctx.cfg.EIA_API_KEY,
      notice: 'Benchmark spot prices and monthly averages are published assessments, not tradable quotes; none is an Indian price or live data. Values are in the source’s currency and unit.',
    };
  });

  app.get('/v1/commodities/series/:source/:code', async (req) => {
    requireUser(req);
    const p = parse(z.object({ source: z.enum(['fred', 'eia']), code: z.string().regex(/^[A-Za-z0-9_.-]{2,40}$/) }), req.params);
    const id = `${p.source}:${p.code}`;
    const r = (await seriesRows(db)).find((x) => x.series_id === id);
    if (!r) throw notFound('Unknown commodity series.');
    const t = now();
    const obs = await loadObs(db, id);
    const revisions = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM commodity.revisions WHERE series_id=$1`, [id]);
    const lastJob = await db.maybeOne(`SELECT started_at, status, received, stored, unchanged, corrected, missing_values, rejected, error FROM commodity.import_jobs WHERE series_id=$1 ORDER BY started_at DESC LIMIT 1`, [id]);
    if (!obs.length) return { series: r, freshness: freshness(null, r.frequency, t), analysis: null, empty_reason: r.source_id === 'eia' && !ctx.cfg.EIA_API_KEY ? 'Needs your free EIA key (EIA_API_KEY in .env.local).' : 'Not imported yet: the daily refresh fetches it, or an administrator can refresh now.', provenance: { source: r.source_id === 'fred' ? `FRED series ${r.source_series}` : `EIA series ${r.source_series}`, upstream: r.upstream, licence: r.licence_note, last_import_at: r.last_import_at, last_job: lastJob, revisions: revisions.n } };
    const chartFrom = r.frequency === 'daily' ? t.getTime() - 10 * 366 * DAY : 0; // 10 years of daily data; full history otherwise
    // Correlation of returns with other series of the same frequency (aligned on shared dates, last 3 years).
    const peers = (await seriesRows(db)).filter((x) => x.series_id !== id && x.frequency === r.frequency && x.observations > 0 && x.price_type !== 'inventory');
    const mine = obs.filter((o) => o.t >= t.getTime() - 3 * 366 * DAY);
    const correlations = [];
    for (const peer of peers) {
      const other = await loadObs(db, peer.series_id, iso(t.getTime() - 3 * 366 * DAY));
      const al = A.alignSeries([mine, other]);
      const ra = A.alignedReturns(al.dates, al.values[0]!, A.MAX_GAP_DAYS[r.frequency]);
      const rb = A.alignedReturns(al.dates, al.values[1]!, A.MAX_GAP_DAYS[r.frequency]);
      const pairs = ra.map((x, i) => [x, rb[i]] as const).filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null);
      if (pairs.length >= 30) correlations.push({ series_id: peer.series_id, name: peer.name, correlation: A.pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1])), observations: pairs.length });
    }
    correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    return {
      series: r, freshness: freshness(r.last_date, r.frequency, t, r.series_id, r.last_error),
      analysis: {
        stats: stats(obs, r.frequency), seasonality: A.seasonality(obs.filter((o) => o.t >= t.getTime() - 15 * 366 * DAY), r.frequency),
        inventory_vs_history: r.price_type === 'inventory' ? A.seasonalZ(obs, 5) : null,
        chart: obs.filter((o) => o.t >= chartFrom).map((o) => ({ t: iso(o.t), v: o.v })),
        correlations: correlations.slice(0, 8), correlation_note: `Pearson correlation of ${r.frequency} returns over the last 3 years, on dates both series have; returns across gaps or non-positive prices excluded.`,
      },
      provenance: { source: r.source_id === 'fred' ? `FRED series ${r.source_series}` : `EIA series ${r.source_series}`, upstream: r.upstream, licence: r.licence_note, last_import_at: r.last_import_at, last_job: lastJob, revisions: revisions.n },
    };
  });

  app.get('/v1/commodities/spreads', async (req) => {
    requireUser(req);
    const t = now();
    const from = iso(t.getTime() - 3 * 366 * DAY);
    const out = [];
    for (const s of SPREADS) {
      const a = await loadObs(db, s.a, from);
      const b = await loadObs(db, s.b, from);
      const pts = A.seriesSpread(a, b, s.fa, s.fb);
      if (pts.length < 20) { out.push({ ...s, available: false, reason: 'Both legs need stored daily data (refresh not run yet).' }); continue; }
      const vs = pts.map((p) => p.v);
      const last = vs[vs.length - 1]!;
      const sorted = [...vs].sort((x, y) => x - y);
      out.push({ ...s, available: true, last, last_date: iso(pts[pts.length - 1]!.t), mean_3y: A.mean(vs), percentile_3y: sorted.filter((x) => x <= last).length / sorted.length, min_3y: sorted[0], max_3y: sorted[sorted.length - 1], observations: pts.length, points: pts.filter((p) => p.t >= t.getTime() - 366 * DAY).map((p) => ({ t: iso(p.t), v: p.v })) });
    }
    return { spreads: out, method: 'Leg A × multiplier − leg B on dates both legs have; no filling. Percentile = share of the last 3 years at or below today’s value.' };
  });

  app.get('/v1/commodities/term-structure', async (req) => {
    requireUser(req);
    const legs = SERIES.filter((s) => s.price_type === 'futures_settlement');
    const stored = await db.query<{ series_id: string; d: string; v: number }>(`SELECT series_id, to_char(obs_date, 'YYYY-MM-DD') AS d, value::float8 AS v FROM commodity.observations WHERE series_id = ANY($1) AND obs_date >= (SELECT max(obs_date) - 400 FROM commodity.observations WHERE series_id = ANY($1)) ORDER BY obs_date`, [legs.map((l) => l.series_id)]);
    if (!stored.length) return { available: false, reason: ctx.cfg.EIA_API_KEY ? 'EIA futures by contract position are not imported yet.' : 'Needs your free EIA key (EIA_API_KEY in .env.local): NYMEX WTI futures by contract position 1–4 come from the EIA API.', method: null };
    const byDate = new Map<string, { position: number; value: number }[]>();
    for (const r of stored) {
      const pos = legs.find((l) => l.series_id === r.series_id)!.contract_position!;
      if (!byDate.has(r.d)) byDate.set(r.d, []);
      byDate.get(r.d)!.push({ position: pos, value: r.v });
    }
    const complete = [...byDate.entries()].filter(([, ps]) => ps.length === legs.length).sort(([a], [b]) => a.localeCompare(b));
    const history = complete.map(([d, ps]) => ({ t: d, ...A.termStructure(ps)! }));
    const stoppedAfter = legs.find((l) => l.discontinued_after)?.discontinued_after ?? null;
    return { available: !!history.length, historical_only: !!stoppedAfter, history_note: stoppedAfter ? `EIA stopped publishing NYMEX futures prices after ${stoppedAfter}. This is the last curve it published, not today’s market; current curves need licensed exchange data.` : null, latest: history[history.length - 1] ?? null, history: history.map((h) => ({ t: h.t, slope: h.slope, slope_pct: h.slope_pct, state: h.state, roll_yield_annualised: h.roll_yield_annualised })), method: 'Positions 1–4 are the nearest four NYMEX WTI contracts as published by EIA; a position rolls to the next contract after expiry, so a position series is not one contract. Contango/backwardation from position 4 vs 1 (±0.25% band).' };
  });

  app.post('/admin/v1/commodities/refresh', async (req) => {
    requireRole(req, ['admin', 'data_ops']);
    if (running) throw conflict('A commodity refresh is already running.');
    running = true;
    try {
      const r = await refreshCommodities(db, ctx.equityFetch, commodityKeys(ctx), now(), { pauseMs: ctx.cfg.NODE_ENV === 'test' ? 0 : 1000 });
      if (r.busy) throw conflict('The scheduled commodity refresh is running; try again in a few minutes.');
      return { attempted: r.attempted, results: r.results.map((x) => ({ series_id: x.series_id, status: x.status, stored: x.stored, corrected: x.corrected, missing_values: x.missing_values, last_date: x.last_date, error: x.error })) };
    } finally {
      running = false;
    }
  });

  app.patch('/admin/v1/commodities/series/:source/:code', async (req) => {
    requireRole(req, ['admin', 'data_ops']);
    const p = parse(z.object({ source: z.enum(['fred', 'eia']), code: z.string().regex(/^[A-Za-z0-9_.-]{2,40}$/) }), req.params);
    const b = parse(z.object({ enabled: z.boolean() }), req.body);
    const r = await db.query(`UPDATE commodity.series SET enabled=$2 WHERE series_id=$1 RETURNING 1`, [`${p.source}:${p.code}`, b.enabled]);
    if (!r.length) throw badRequest('Unknown series.');
    return { ok: true };
  });
}
