import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { freshnessOf } from '../../lib/freshness.js';
import { conflict, notFound, parse } from '../../lib/http.js';
import { requireRole, requireUser } from '../auth/service.js';
import type { FetchFn } from '../equity/providers.js';
import { FredError, fredObservations, fredSeriesMeta } from './fred.js';

// Macro research from the official FRED API: a curated set of US series plus India-relevant ones,
// each checked to exist on 23 Oct 2026. Observations keep their FRED vintage (published_at), the time
// ATLAS retrieved them, and every revision. A series is re-downloaded only when FRED reports that it
// changed since the last import (the metadata call is cheap), and at most twice a day.

export interface MacroDef { id: string; category: 'inflation' | 'rates' | 'labour' | 'activity' | 'credit' | 'fx' | 'india'; note: string; expected_age_days?: number }

export const MACRO_SERIES: MacroDef[] = [
  { id: 'CPIAUCSL', category: 'inflation', note: 'US consumer prices (CPI-U), seasonally adjusted index; inflation is its year-on-year change.' },
  { id: 'CPILFESL', category: 'inflation', note: 'US core CPI (excluding food and energy).' },
  { id: 'PCEPILFE', category: 'inflation', note: 'US core PCE price index (the Federal Reserve’s preferred inflation gauge).' },
  { id: 'DFF', category: 'rates', note: 'Federal funds effective rate (daily).' },
  { id: 'DGS2', category: 'rates', note: '2-year US Treasury constant-maturity yield (daily).' },
  { id: 'DGS10', category: 'rates', note: '10-year US Treasury constant-maturity yield (daily).' },
  { id: 'T10Y2Y', category: 'rates', note: '10-year minus 2-year Treasury yield spread (daily); negative values are an inverted curve.' },
  { id: 'DFII10', category: 'rates', note: '10-year Treasury inflation-indexed (real) yield (daily).' },
  { id: 'UNRATE', category: 'labour', note: 'US unemployment rate (monthly).' },
  { id: 'PAYEMS', category: 'labour', note: 'US nonfarm payroll employment (monthly, thousands).' },
  { id: 'GDPC1', category: 'activity', note: 'US real GDP (quarterly, chained 2017 dollars, annualised rate).' },
  { id: 'INDPRO', category: 'activity', note: 'US industrial production index (monthly).' },
  { id: 'STLFSI4', category: 'credit', note: 'St. Louis Fed Financial Stress Index (weekly); zero is normal stress.' },
  { id: 'NFCI', category: 'credit', note: 'Chicago Fed National Financial Conditions Index (weekly); positive is tighter than average.' },
  { id: 'DEXINUS', category: 'fx', note: 'Indian rupees per US dollar, noon buying rate in New York (daily values, published weekly in the Federal Reserve H.10 release).', expected_age_days: 12 },
  { id: 'DTWEXBGS', category: 'fx', note: 'Nominal broad US dollar index (daily values, published weekly in the H.10 release).', expected_age_days: 12 },
  { id: 'MKTGDPINA646NWDB', category: 'india', note: 'India GDP in current US dollars (annual, World Bank).' },
  { id: 'INDCPIALLMINMEI', category: 'india', note: 'India consumer price index (monthly, OECD). OECD stopped updating this series in 2025; shown as history.' },
];

const FRED_TERMS = 'Data from FRED®, Federal Reserve Bank of St. Louis (fred.stlouisfed.org). Each series belongs to its original source (BLS, BEA, Federal Reserve, World Bank, OECD …) and is used here for personal research; check the source’s terms before redistributing.';

export async function syncMacroSeries(db: Db): Promise<void> {
  for (const s of MACRO_SERIES) {
    await db.query(`INSERT INTO macro.series (series_id, category, title, notes) VALUES ($1,$2,$1,$3) ON CONFLICT (series_id) DO UPDATE SET category=EXCLUDED.category, notes=EXCLUDED.notes`, [s.id, s.category, s.note]);
  }
}

export interface MacroImport { series_id: string; status: 'succeeded' | 'unchanged' | 'failed'; stored: number; revised: number; missing: number; last_date: string | null; error: string | null }

export async function importMacroSeries(db: Db, fetchFn: FetchFn, key: string, id: string, now: Date, opts: { force?: boolean } = {}): Promise<MacroImport> {
  const out: MacroImport = { series_id: id, status: 'failed', stored: 0, revised: 0, missing: 0, last_date: null, error: null };
  try {
    const meta = await fredSeriesMeta(db, fetchFn, key, id, now, `macro:${id}`);
    const cur = await db.one<{ source_last_updated: string | null; observations: number }>(`SELECT source_last_updated, observations FROM macro.series WHERE series_id=$1`, [id]);
    const updated = new Date(meta.last_updated.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    await db.query(`UPDATE macro.series SET title=$2, units=$3, frequency=$4, seasonal_adjustment=$5, source_last_updated=$6, observation_start=$7, observation_end=$8 WHERE series_id=$1`,
      [id, meta.title, meta.units, meta.frequency, meta.seasonal_adjustment, Number.isNaN(updated.getTime()) ? null : updated.toISOString(), meta.observation_start, meta.observation_end]);
    // Nothing changed at the source since the last import: no observations request.
    if (!opts.force && cur.observations > 0 && cur.source_last_updated && !Number.isNaN(updated.getTime()) && updated.getTime() <= Date.parse(cur.source_last_updated)) {
      await db.query(`UPDATE macro.series SET last_import_at=$2, last_error=NULL WHERE series_id=$1`, [id, now.toISOString()]);
      out.status = 'unchanged';
      return out;
    }
    const obs = await fredObservations(db, fetchFn, key, id, now, undefined, `macro:${id}`);
    const existing = new Map((await db.query<{ d: string; v: number; p: string | null }>(`SELECT to_char(obs_date,'YYYY-MM-DD') AS d, value::float8 AS v, to_char(published_at,'YYYY-MM-DD') AS p FROM macro.observations WHERE series_id=$1`, [id])).map((x) => [x.d, x]));
    const rows = obs.filter((o) => o.value !== null) as { date: string; value: number; realtime_start: string }[];
    out.missing = obs.length - rows.length;
    const changed = rows.filter((r) => { const e = existing.get(r.date); return !e || Math.abs(e.v - r.value) > 1e-9; });
    const revisions = changed.filter((r) => existing.has(r.date));
    out.revised = revisions.length;
    out.stored = changed.length - revisions.length;
    await db.tx(async (t) => {
      for (let i = 0; i < revisions.length; i += 2000) {
        const c = revisions.slice(i, i + 2000);
        await t.query(`INSERT INTO macro.revisions (series_id, obs_date, previous, previous_published_at, revised_at) SELECT $1, d::date, v, nullif(p,'')::date, $5 FROM unnest($2::text[], $3::float8[], $4::text[]) AS u(d, v, p)`,
          [id, c.map((x) => x.date), c.map((x) => existing.get(x.date)!.v), c.map((x) => existing.get(x.date)!.p ?? ''), now.toISOString()]);
      }
      for (let i = 0; i < changed.length; i += 2000) {
        const c = changed.slice(i, i + 2000);
        await t.query(`INSERT INTO macro.observations (series_id, obs_date, value, published_at, retrieved_at, updated_at) SELECT $1, d::date, v, nullif(p,'')::date, $5, $5 FROM unnest($2::text[], $3::float8[], $4::text[]) AS u(d, v, p)
          ON CONFLICT (series_id, obs_date) DO UPDATE SET value=EXCLUDED.value, published_at=EXCLUDED.published_at, retrieved_at=EXCLUDED.retrieved_at, updated_at=EXCLUDED.updated_at`,
          [id, c.map((x) => x.date), c.map((x) => x.value), c.map((x) => (/^\d{4}-\d{2}-\d{2}$/.test(x.realtime_start) ? x.realtime_start : '')), now.toISOString()]);
      }
      await t.query(`UPDATE macro.series s SET first_date=x.f, last_date=x.l, observations=x.n, last_import_at=$2, last_error=NULL FROM (SELECT min(obs_date) f, max(obs_date) l, count(*)::int n FROM macro.observations WHERE series_id=$1) x WHERE s.series_id=$1`, [id, now.toISOString()]);
    });
    out.status = 'succeeded';
    out.last_date = rows[rows.length - 1]?.date ?? null;
    return out;
  } catch (err) {
    out.error = err instanceof FredError ? err.message : `Unexpected error: ${(err as Error).message}`.slice(0, 300);
    await db.query(`UPDATE macro.series SET last_error=$2 WHERE series_id=$1`, [id, out.error]);
    return out;
  }
}

let refreshing = false;
/** Each series at most once per 12 hours; stops at the first sign the provider is paused. */
export async function refreshMacro(db: Db, fetchFn: FetchFn, key: string, now: Date, opts: { pauseMs?: number } = {}): Promise<{ attempted: number; results: MacroImport[]; busy?: boolean; skipped?: string }> {
  if (!key) return { attempted: 0, results: [], skipped: 'FRED_API_KEY is not set' };
  if (refreshing) return { attempted: 0, results: [], busy: true };
  refreshing = true;
  try {
    const due = await db.query<{ series_id: string }>(`SELECT series_id FROM macro.series WHERE enabled AND (last_import_at IS NULL OR last_import_at < $1) ORDER BY last_import_at NULLS FIRST`, [new Date(now.getTime() - 12 * 3_600_000).toISOString()]);
    const results: MacroImport[] = [];
    for (const d of due) {
      if (results.length && opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
      const r = await importMacroSeries(db, fetchFn, key, d.series_id, now);
      results.push(r);
      if (r.error && /paused/.test(r.error)) break;
    }
    return { attempted: results.length, results };
  } finally {
    refreshing = false;
  }
}

/** Year-on-year change for index-level series (CPI, PCE, IP): needs the observation 12 months earlier. */
function yoy(obs: { d: string; v: number }[]): { d: string; v: number }[] {
  const by = new Map(obs.map((o) => [o.d, o.v]));
  const out: { d: string; v: number }[] = [];
  for (const o of obs) {
    const prev = by.get(`${Number(o.d.slice(0, 4)) - 1}${o.d.slice(4)}`);
    if (prev && prev > 0) out.push({ d: o.d, v: o.v / prev - 1 });
  }
  return out;
}

export async function macroRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  app.get('/v1/macro', async (req) => {
    requireUser(req);
    const now = ctx.clock();
    const rows = await db.query<{ series_id: string; category: string; title: string; units: string | null; frequency: string | null; seasonal_adjustment: string | null; notes: string | null; source_last_updated: string | null; last_date: string | null; observations: number; last_import_at: string | null; last_error: string | null }>(
      `SELECT series_id, category, title, units, frequency, seasonal_adjustment, notes, source_last_updated, to_char(last_date,'YYYY-MM-DD') AS last_date, observations, last_import_at, last_error FROM macro.series WHERE enabled ORDER BY category, series_id`);
    // The latest two observations of every enabled series in one query (was one query per series).
    const lastTwo = await db.query<{ series_id: string; d: string; v: number; p: string | null }>(
      `SELECT x.series_id, to_char(x.obs_date,'YYYY-MM-DD') AS d, x.value::float8 AS v, to_char(x.published_at,'YYYY-MM-DD') AS p
         FROM macro.series s CROSS JOIN LATERAL (
           SELECT o.series_id, o.obs_date, o.value, o.published_at FROM macro.observations o WHERE o.series_id = s.series_id ORDER BY o.obs_date DESC LIMIT 2) x
        WHERE s.enabled ORDER BY x.series_id, x.obs_date DESC`);
    const byId = new Map<string, { d: string; v: number; p: string | null }[]>();
    for (const o of lastTwo) { const l = byId.get(o.series_id) ?? []; l.push({ d: o.d, v: o.v, p: o.p }); byId.set(o.series_id, l); }
    const items = [];
    for (const r of rows) {
      const last2 = byId.get(r.series_id) ?? [];
      items.push({ ...r, latest: last2[0] ?? null, previous: last2[1] ?? null, freshness: freshnessOf(r.last_date, r.frequency, now, r.last_error, { expectedAgeDays: MACRO_SERIES.find((m) => m.id === r.series_id)?.expected_age_days }) });
    }
    return { configured: !!ctx.cfg.FRED_API_KEY, items, terms: FRED_TERMS, notice: 'Economic statistics are published on their own schedules (monthly, quarterly …). The date shown is the period an observation refers to, not when it was released.' };
  });

  app.get('/v1/macro/series/:id', async (req) => {
    requireUser(req);
    const p = parse(z.object({ id: z.string().regex(/^[A-Z0-9_]{2,40}$/) }), req.params);
    const s = await db.maybeOne<{ series_id: string; category: string; title: string; units: string | null; frequency: string | null; seasonal_adjustment: string | null; notes: string | null; source_last_updated: string | null; observation_start: string | null; last_date: string | null; observations: number; last_import_at: string | null; last_error: string | null }>(
      `SELECT series_id, category, title, units, frequency, seasonal_adjustment, notes, source_last_updated, to_char(observation_start,'YYYY-MM-DD') AS observation_start, to_char(last_date,'YYYY-MM-DD') AS last_date, observations, last_import_at, last_error FROM macro.series WHERE series_id=$1`, [p.id]);
    if (!s) throw notFound('Unknown macro series.');
    // Daily series show at most 10 years, so only those rows are read (a daily series can hold 50 years).
    // Index-type series keep full history because year-on-year is computed over all of it.
    const isIndexSeries = /index/i.test(s.units ?? '') && !['STLFSI4', 'NFCI', 'DTWEXBGS'].includes(s.series_id);
    const since = /^d/i.test(s.frequency ?? '') && !isIndexSeries ? new Date(ctx.clock().getTime() - 3653 * 86_400_000).toISOString().slice(0, 10) : null;
    const obs = await db.query<{ d: string; v: number; p: string | null }>(`SELECT to_char(obs_date,'YYYY-MM-DD') AS d, value::float8 AS v, to_char(published_at,'YYYY-MM-DD') AS p FROM macro.observations WHERE series_id=$1 AND ($2::date IS NULL OR obs_date >= $2::date) ORDER BY obs_date`, [p.id, since]);
    const revisions = await db.query(`SELECT to_char(obs_date,'YYYY-MM-DD') AS obs_date, previous::float8 AS previous, to_char(previous_published_at,'YYYY-MM-DD') AS previous_published_at, revised_at FROM macro.revisions WHERE series_id=$1 ORDER BY revised_at DESC, obs_date DESC LIMIT 20`, [p.id]);
    const isIndex = /index/i.test(s.units ?? '') && !['STLFSI4', 'NFCI', 'DTWEXBGS'].includes(s.series_id);
    const latest = obs[obs.length - 1] ?? null;
    return {
      series: s, freshness: freshnessOf(s.last_date, s.frequency, ctx.clock(), s.last_error, { expectedAgeDays: MACRO_SERIES.find((m) => m.id === s.series_id)?.expected_age_days }),
      // Up to 10 years of daily data (about 2,600 points); full history for weekly and lower frequencies.
      latest, observations: (/^d/i.test(s.frequency ?? '') ? obs.filter((o) => o.d >= new Date(ctx.clock().getTime() - 3653 * 86_400_000).toISOString().slice(0, 10)) : obs).map((o) => ({ t: o.d, v: o.v })),
      yoy: isIndex ? yoy(obs).map((o) => ({ t: o.d, v: o.v })) : null,
      yoy_note: isIndex ? 'Year-on-year change: value ÷ value for the same period a year earlier − 1 (only where both exist).' : null,
      revisions, provenance: { source: `FRED series ${s.series_id}`, url: `https://fred.stlouisfed.org/series/${s.series_id}`, source_last_updated: s.source_last_updated, last_retrieved_at: s.last_import_at, latest_published_at: latest?.p ?? null, terms: FRED_TERMS },
      empty_reason: obs.length ? null : ctx.cfg.FRED_API_KEY ? 'Not imported yet: the refresh fetches it shortly after start-up.' : 'FRED is not configured (FRED_API_KEY).',
    };
  });

  let running = false;
  app.post('/admin/v1/macro/refresh', async (req) => {
    requireRole(req, ['admin', 'data_ops']);
    if (running) throw conflict('A macro refresh is already running.');
    running = true;
    try {
      return await refreshMacro(db, ctx.equityFetch, ctx.cfg.FRED_API_KEY, ctx.clock(), { pauseMs: ctx.cfg.NODE_ENV === 'test' ? 0 : 600 });
    } finally {
      running = false;
    }
  });
}
