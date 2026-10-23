import type { Db } from '../../db/db.js';
import type { FetchFn } from '../equity/providers.js';
import { CommodityError, eiaUrl, fredUrl, parseEiaV2, parseFredCsv, redactUrl, SERIES, type SeriesDef } from './sources.js';

// Imports commodity series. Each run is a job with counts; writes are idempotent upserts; a changed value
// keeps its previous value in commodity.revisions; blanks are counted as missing, never stored as zero.
// Negative prices are valid data (WTI spot settled at −36.98 USD on 20 Apr 2020) and are stored as given.

export interface CommodityKeys { eia: string }

export async function syncCommoditySeries(db: Db): Promise<void> {
  // A job still "running" at start-up was interrupted by a stop or crash: say so instead of leaving it open.
  await db.query(`UPDATE commodity.import_jobs SET status='failed', finished_at=now(), error='Interrupted: ATLAS stopped before the import finished. Stored rows are complete per transaction.', error_category='provider_error' WHERE status='running'`);
  for (const s of SERIES) {
    await db.query(
      `INSERT INTO commodity.series (series_id, category, commodity, name, price_type, unit, currency, frequency, source_id, source_series, upstream, contract_position, licence_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (series_id) DO UPDATE SET category=EXCLUDED.category, commodity=EXCLUDED.commodity, name=EXCLUDED.name, price_type=EXCLUDED.price_type, unit=EXCLUDED.unit, currency=EXCLUDED.currency,
         frequency=EXCLUDED.frequency, upstream=EXCLUDED.upstream, contract_position=EXCLUDED.contract_position, licence_note=EXCLUDED.licence_note`,
      [s.series_id, s.category, s.commodity, s.name, s.price_type, s.unit, s.currency, s.frequency, s.source_id, s.source_series, s.upstream, s.contract_position ?? null, s.licence_note]);
  }
}

export interface CommodityImport { job_id: string; series_id: string; status: 'succeeded' | 'partial' | 'failed'; received: number; stored: number; unchanged: number; corrected: number; missing_values: number; rejected: number; first_date: string | null; last_date: string | null; error: string | null; error_category: string | null }

async function fetchText(fetchFn: FetchFn, url: string, timeoutMs = 30_000): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal, headers: { accept: 'text/csv, application/json', 'user-agent': 'ATLAS-local-research/0.1' } });
    return { status: r.status, body: await r.text() };
  } catch (err) {
    const timeout = (err as Error).name === 'AbortError';
    throw new CommodityError(timeout ? 'timeout' : 'network', timeout ? 'The source did not answer in time.' : `Network error: ${redactUrl((err as Error).message)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function importCommoditySeries(db: Db, fetchFn: FetchFn, keys: CommodityKeys, seriesId: string, now: Date): Promise<CommodityImport> {
  const def = SERIES.find((s) => s.series_id === seriesId);
  if (!def) throw new CommodityError('not_found', `Unknown commodity series ${seriesId}.`);
  const { job_id } = await db.one<{ job_id: string }>(`INSERT INTO commodity.import_jobs (series_id, status, started_at) VALUES ($1,'running',$2) RETURNING job_id`, [seriesId, now.toISOString()]);
  const sum: CommodityImport = { job_id, series_id: seriesId, status: 'failed', received: 0, stored: 0, unchanged: 0, corrected: 0, missing_values: 0, rejected: 0, first_date: null, last_date: null, error: null, error_category: null };
  const finish = async () => {
    await db.query(`UPDATE commodity.import_jobs SET status=$2, finished_at=$3, received=$4, stored=$5, unchanged=$6, corrected=$7, missing_values=$8, rejected=$9, error=$10, error_category=$11 WHERE job_id=$1`,
      [job_id, sum.status, new Date().toISOString(), sum.received, sum.stored, sum.unchanged, sum.corrected, sum.missing_values, sum.rejected, sum.error, sum.error_category]);
    await db.query(`UPDATE commodity.series SET last_error=$2, last_error_at=CASE WHEN $2::text IS NULL THEN last_error_at ELSE $3 END WHERE series_id=$1`, [seriesId, sum.error, now.toISOString()]);
    return sum;
  };
  if (def.source_id === 'eia' && !keys.eia) {
    sum.error = 'EIA is not configured: set EIA_API_KEY in .env.local (a free key from eia.gov/opendata) and restart.';
    sum.error_category = 'not_configured';
    return finish();
  }
  let parsed;
  try {
    const url = def.source_id === 'fred' ? fredUrl(def.source_series) : eiaUrl(def, keys.eia);
    const r = await fetchText(fetchFn, url);
    parsed = def.source_id === 'fred' ? parseFredCsv(r.status, r.body, def.source_series) : parseEiaV2(r.status, r.body, def.source_series);
  } catch (err) {
    const e = err instanceof CommodityError ? err : new CommodityError('provider_error', redactUrl((err as Error).message));
    sum.error = e.message;
    sum.error_category = e.category;
    return finish();
  }
  sum.received = parsed.rows.length + parsed.missing + parsed.invalid.length;
  sum.missing_values = parsed.missing;
  const today = now.toISOString().slice(0, 10);
  const valid: { date: string; value: number }[] = [];
  const seen = new Set<string>();
  for (const inv of parsed.invalid) await db.query(`INSERT INTO commodity.quarantine (job_id, record, reasons) VALUES ($1,$2,$3)`, [job_id, JSON.stringify(inv), [inv.reason]]);
  sum.rejected += parsed.invalid.length;
  for (const r of parsed.rows) {
    const reasons: string[] = [];
    if (r.date > today) reasons.push('date_in_future');
    if (seen.has(r.date)) reasons.push('duplicate_date');
    if (def.price_type === 'inventory' && r.value < 0) reasons.push('negative_inventory');
    if (def.price_type === 'index' && !(r.value > 0)) reasons.push('index_not_positive');
    seen.add(r.date);
    if (reasons.length) {
      sum.rejected++;
      await db.query(`INSERT INTO commodity.quarantine (job_id, record, reasons) VALUES ($1,$2,$3)`, [job_id, JSON.stringify(r), reasons]);
      continue;
    }
    valid.push(r);
  }
  if (!valid.length) {
    sum.error = 'The source returned no usable observations.';
    sum.error_category = 'malformed';
    return finish();
  }
  sum.first_date = valid[0]!.date;
  sum.last_date = valid[valid.length - 1]!.date;
  const existing = new Map((await db.query<{ d: string; v: number }>(`SELECT to_char(obs_date, 'YYYY-MM-DD') AS d, value::float8 AS v FROM commodity.observations WHERE series_id=$1`, [seriesId])).map((x) => [x.d, x.v]));
  const changed: { date: string; value: number }[] = [];
  const revised: { date: string; previous: number }[] = [];
  for (const r of valid) {
    const old = existing.get(r.date);
    if (old !== undefined && Math.abs(old - r.value) < 1e-9) { sum.unchanged++; continue; }
    if (old !== undefined) { sum.corrected++; revised.push({ date: r.date, previous: old }); } else sum.stored++;
    changed.push(r);
  }
  // Set-based writes in chunks: a full FRED history is ~10,000 rows.
  const CHUNK = 2000;
  await db.tx(async (t) => {
    for (let i = 0; i < revised.length; i += CHUNK) {
      const c = revised.slice(i, i + CHUNK);
      await t.query(`INSERT INTO commodity.revisions (series_id, obs_date, previous, job_id, revised_at) SELECT $1, d::date, v, $4, $5 FROM unnest($2::text[], $3::float8[]) AS u(d, v)`, [seriesId, c.map((x) => x.date), c.map((x) => x.previous), job_id, now.toISOString()]);
    }
    for (let i = 0; i < changed.length; i += CHUNK) {
      const c = changed.slice(i, i + CHUNK);
      await t.query(`INSERT INTO commodity.observations (series_id, obs_date, value, job_id, imported_at) SELECT $1, d::date, v, $4, $5 FROM unnest($2::text[], $3::float8[]) AS u(d, v)
        ON CONFLICT (series_id, obs_date) DO UPDATE SET value=EXCLUDED.value, job_id=EXCLUDED.job_id, revised_at=EXCLUDED.imported_at`, [seriesId, c.map((x) => x.date), c.map((x) => x.value), job_id, now.toISOString()]);
    }
    await t.query(`UPDATE commodity.series s SET first_date=x.f, last_date=x.l, observations=x.n, last_import_at=$2 FROM (SELECT min(obs_date) f, max(obs_date) l, count(*)::int n FROM commodity.observations WHERE series_id=$1) x WHERE s.series_id=$1`, [seriesId, now.toISOString()]);
  });
  sum.status = sum.rejected ? 'partial' : 'succeeded';
  return finish();
}

/**
 * Refresh: each enabled series at most once per 20 hours, one request at a time with a pause between
 * requests (FRED's CSV download publishes no rate limit; ATLAS stays polite). EIA series only with a key.
 */
let refreshing = false;

export async function refreshCommodities(db: Db, fetchFn: FetchFn, keys: CommodityKeys, now: Date, opts: { pauseMs?: number; max?: number } = {}): Promise<{ attempted: number; results: CommodityImport[]; busy?: boolean }> {
  // One refresh at a time in this process (scheduled and manual runs share the lock).
  if (refreshing) return { attempted: 0, results: [], busy: true };
  refreshing = true;
  try {
    return await runRefresh(db, fetchFn, keys, now, opts);
  } finally {
    refreshing = false;
  }
}

async function runRefresh(db: Db, fetchFn: FetchFn, keys: CommodityKeys, now: Date, opts: { pauseMs?: number; max?: number }): Promise<{ attempted: number; results: CommodityImport[] }> {
  const due = await db.query<{ series_id: string; source_id: string }>(
    `SELECT series_id, source_id FROM commodity.series WHERE enabled AND (last_import_at IS NULL OR last_import_at < $1) ORDER BY last_import_at NULLS FIRST, series_id LIMIT $2`,
    [new Date(now.getTime() - 20 * 3_600_000).toISOString(), opts.max ?? 40]);
  const results: CommodityImport[] = [];
  for (const d of due) {
    if (d.source_id === 'eia' && !keys.eia) continue;
    if (results.length && opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
    results.push(await importCommoditySeries(db, fetchFn, keys, d.series_id, now));
    // Stop at the first rate-limit answer instead of hammering the source.
    if (results[results.length - 1]!.error_category === 'rate_limited') break;
  }
  return { attempted: results.length, results };
}

export type { SeriesDef };
