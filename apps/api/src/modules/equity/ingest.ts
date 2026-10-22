import type { Db } from '../../db/db.js';
import { adjustRow, alphaVantageSymbol, checkRow, eodhdTicker, EQUITY_PROVIDERS, EquityProviderError, fetchAlphaVantage, fetchEodhd, type DailyRow, type FetchFn } from './providers.js';

// Imports real daily prices for one Indian instrument from one provider. Every run is a job with counts
// for received / stored / unchanged / corrected / rejected rows. Writes are idempotent upserts; a changed
// value keeps its previous version in equity.price_revisions; invalid rows go to quarantine. A dry run
// does all of the above except writing prices, so the summary shows what a real run would do.

export interface EquityKeys { eodhd: string; alphavantage: string }

export interface ImportRequest { provider: 'eodhd' | 'alphavantage'; exchange: 'NSE' | 'BSE' | 'INDEX'; symbol: string; kind: 'equity' | 'index'; name?: string; providerSymbol?: string; from?: string; dryRun?: boolean; requestedBy?: string }

export interface ImportSummary { job_id: string; status: 'succeeded' | 'partial' | 'failed'; dry_run: boolean; received: number; stored: number; unchanged: number; corrected: number; rejected: number; suspect: number; first_date: string | null; last_date: string | null; error: string | null; error_category: string | null; series: { basis: string; series_id: string | null }[] }

export async function syncEquityProviders(db: Db, keys: EquityKeys): Promise<void> {
  for (const p of EQUITY_PROVIDERS) {
    const configured = !!keys[p.provider_id];
    await db.query(
      `INSERT INTO equity.providers (provider_id, name, docs_url, terms_url, docs_checked_on, auth, coverage_note, limits_note, licence_note, priority, health)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (provider_id) DO UPDATE SET name=EXCLUDED.name, docs_url=EXCLUDED.docs_url, terms_url=EXCLUDED.terms_url, docs_checked_on=EXCLUDED.docs_checked_on, auth=EXCLUDED.auth,
         coverage_note=EXCLUDED.coverage_note, limits_note=EXCLUDED.limits_note, licence_note=EXCLUDED.licence_note, priority=EXCLUDED.priority,
         health=CASE WHEN NOT $12 THEN 'not_configured' WHEN equity.providers.health='not_configured' THEN 'unknown' ELSE equity.providers.health END, updated_at=now()`,
      [p.provider_id, p.name, p.docs_url, p.terms_url, p.docs_checked_on, p.auth, p.coverage_note, p.limits_note, p.licence_note, p.priority, configured ? 'unknown' : 'not_configured', configured],
    );
  }
}

const SUSPECT_MOVE = 0.2; // Indian price bands commonly cap single-stock moves at 20%; a bigger move is kept and flagged.

export async function importEquityPrices(db: Db, fetchFn: FetchFn, keys: EquityKeys, req: ImportRequest, now: Date): Promise<ImportSummary> {
  const symbol = req.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9&_.-]{1,30}$/.test(symbol)) throw new EquityProviderError(req.provider, 'not_found', 'Invalid symbol.');
  const def = EQUITY_PROVIDERS.find((p) => p.provider_id === req.provider)!;
  if (!def.exchanges.includes(req.exchange)) throw new EquityProviderError(req.provider, 'not_found', `${def.name} is not set up for ${req.exchange} in ATLAS.`);
  const { job_id } = await db.one<{ job_id: string }>(`INSERT INTO equity.import_jobs (provider_id, kind, dry_run, status, requested_by, started_at) VALUES ($1,'api',$2,'running',$3,$4) RETURNING job_id`, [req.provider, !!req.dryRun, req.requestedBy ?? null, now.toISOString()]);
  const sum: ImportSummary = { job_id, status: 'failed', dry_run: !!req.dryRun, received: 0, stored: 0, unchanged: 0, corrected: 0, rejected: 0, suspect: 0, first_date: null, last_date: null, error: null, error_category: null, series: [] };
  const finish = async () => {
    await db.query(`UPDATE equity.import_jobs SET status=$2, finished_at=$3, received=$4, stored=$5, unchanged=$6, corrected=$7, rejected=$8, error=$9, error_category=$10, detail=$11 WHERE job_id=$1`,
      [job_id, sum.status, new Date().toISOString(), sum.received, sum.stored, sum.unchanged, sum.corrected, sum.rejected, sum.error, sum.error_category, JSON.stringify({ suspect: sum.suspect, first_date: sum.first_date, last_date: sum.last_date, symbol, exchange: req.exchange })]);
    return sum;
  };
  const key = keys[req.provider];
  if (!key) {
    sum.error = `${def.name} is not configured: set ${def.env} in .env.local (your own key; see docs/equity/SOURCE_CAPABILITY_MATRIX.md).`;
    sum.error_category = 'not_configured';
    await db.query(`UPDATE equity.providers SET health='not_configured' WHERE provider_id=$1`, [req.provider]);
    return finish();
  }
  let rows: DailyRow[];
  let providerSymbol: string;
  try {
    providerSymbol = req.provider === 'eodhd' ? eodhdTicker(req.exchange, symbol, req.providerSymbol) : alphaVantageSymbol(req.exchange, symbol, req.providerSymbol);
    rows = req.provider === 'eodhd' ? await fetchEodhd(fetchFn, key, providerSymbol, req.from) : await fetchAlphaVantage(fetchFn, key, providerSymbol);
  } catch (err) {
    const e = err instanceof EquityProviderError ? err : new EquityProviderError(req.provider, 'provider_error', (err as Error).message);
    sum.error = e.message;
    sum.error_category = e.category;
    const health = e.category === 'rate_limited' ? 'rate_limited' : e.category === 'entitlement' || e.category === 'auth' ? 'not_entitled' : e.category === 'not_found' ? 'degraded' : 'failing';
    await db.query(`UPDATE equity.providers SET health=$2, last_error_at=$3, last_error=$4, last_error_category=$5 WHERE provider_id=$1`, [req.provider, health, now.toISOString(), e.message.slice(0, 500), e.category === 'not_configured' ? null : e.category]);
    return finish();
  }
  sum.received = rows.length;
  const today = now.toISOString().slice(0, 10);
  const seen = new Set<string>();
  const valid: DailyRow[] = [];
  for (const r of rows) {
    const c = checkRow(r, today);
    const dup = seen.has(r.date);
    seen.add(r.date);
    if (!c.ok || dup) {
      sum.rejected++;
      if (!req.dryRun) await db.query(`INSERT INTO equity.quarantine (job_id, record, reasons) VALUES ($1,$2,$3)`, [job_id, JSON.stringify(r), dup ? ['duplicate_date'] : c.reasons]);
      continue;
    }
    valid.push(r);
  }
  valid.sort((a, b) => a.date.localeCompare(b.date));
  sum.first_date = valid[0]?.date ?? null;
  sum.last_date = valid[valid.length - 1]?.date ?? null;
  if (!valid.length) {
    sum.error = rows.length ? 'Every row failed validation; nothing was stored.' : 'The provider returned no rows.';
    sum.error_category = 'malformed';
    return finish();
  }
  // Instrument and validated provider symbol (a successful response for this exact identifier).
  const inst = req.dryRun
    ? await db.maybeOne<{ instrument_id: string }>(`SELECT instrument_id FROM equity.instruments WHERE exchange=$1 AND symbol=$2`, [req.exchange, symbol])
    : await db.one<{ instrument_id: string }>(`INSERT INTO equity.instruments (kind, exchange, symbol, name) VALUES ($1,$2,$3,$4) ON CONFLICT (exchange, symbol) DO UPDATE SET name=coalesce(EXCLUDED.name, equity.instruments.name) RETURNING instrument_id`, [req.kind, req.exchange, symbol, req.name ?? null]);
  if (inst && !req.dryRun) await db.query(`INSERT INTO equity.provider_symbols (provider_id, provider_symbol, instrument_id, validated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (provider_id, provider_symbol) DO UPDATE SET validated_at=EXCLUDED.validated_at`, [req.provider, providerSymbol, inst.instrument_id, now.toISOString()]);
  const bases: { basis: 'raw' | 'adjusted_split_dividend'; rows: DailyRow[] }[] = [{ basis: 'raw', rows: valid }];
  if (def.adjusted) {
    const adj = valid.map(adjustRow).filter((x): x is DailyRow => x !== null);
    if (adj.length) bases.push({ basis: 'adjusted_split_dividend', rows: adj });
  }
  for (const b of bases) {
    let seriesId: string | null = null;
    if (inst) {
      const s = req.dryRun
        ? await db.maybeOne<{ series_id: string }>(`SELECT series_id FROM equity.price_series WHERE instrument_id=$1 AND provider_id=$2 AND basis=$3`, [inst.instrument_id, req.provider, b.basis])
        : await db.one<{ series_id: string }>(`INSERT INTO equity.price_series (instrument_id, provider_id, classification, basis) VALUES ($1,$2,'REAL_UNVERIFIED',$3) ON CONFLICT (instrument_id, provider_id, basis) DO UPDATE SET updated_at=now() RETURNING series_id`, [inst.instrument_id, req.provider, b.basis]);
      seriesId = s?.series_id ?? null;
    }
    sum.series.push({ basis: b.basis, series_id: seriesId });
    const existing = new Map<string, { open: number; high: number; low: number; close: number; volume: number | null }>();
    if (seriesId) for (const e of await db.query<{ trade_date: string; open: number; high: number; low: number; close: number; volume: number | null }>(`SELECT trade_date, open::float8 AS open, high::float8 AS high, low::float8 AS low, close::float8 AS close, volume::float8 AS volume FROM equity.prices WHERE series_id=$1`, [seriesId])) existing.set(e.trade_date, e);
    let prev: number | null = null;
    const counted = b.basis === 'raw';
    const write = async (fn: () => Promise<void>) => { if (!req.dryRun && seriesId) await fn(); };
    await db.tx(async (t) => {
      for (const r of b.rows) {
        const suspect = prev !== null && Math.abs(r.close / prev - 1) > SUSPECT_MOVE;
        prev = r.close;
        if (suspect && counted) sum.suspect++;
        const old = existing.get(r.date);
        const same = old && [old.open, old.high, old.low, old.close].every((v, i) => Math.abs(v - [r.open, r.high, r.low, r.close][i]!) < 1e-6) && (old.volume ?? null) === (r.volume ?? null);
        if (same) { if (counted) sum.unchanged++; continue; }
        if (old && counted) sum.corrected++;
        else if (counted) sum.stored++;
        await write(async () => {
          if (old) await t.query(`INSERT INTO equity.price_revisions (series_id, trade_date, previous, job_id) VALUES ($1,$2,$3,$4)`, [seriesId, r.date, JSON.stringify(old), job_id]);
          await t.query(
            `INSERT INTO equity.prices (series_id, trade_date, open, high, low, close, volume, validation, job_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (series_id, trade_date) DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close, volume=EXCLUDED.volume, validation=EXCLUDED.validation, job_id=EXCLUDED.job_id, revised_at=now()`,
            [seriesId, r.date, r.open, r.high, r.low, r.close, r.volume, suspect ? 'suspect' : 'valid', job_id]);
        });
      }
      await write(async () => {
        await t.query(`UPDATE equity.price_series s SET first_date=x.f, last_date=x.l, observations=x.n, last_import_at=$2, updated_at=now() FROM (SELECT min(trade_date) f, max(trade_date) l, count(*)::int n FROM equity.prices WHERE series_id=$1) x WHERE s.series_id=$1`, [seriesId, now.toISOString()]);
      });
    });
  }
  sum.status = sum.rejected ? 'partial' : 'succeeded';
  if (!req.dryRun) await db.query(`UPDATE equity.providers SET health='healthy', last_success_at=$2 WHERE provider_id=$1`, [req.provider, now.toISOString()]);
  return finish();
}
