import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { notFound, parse } from '../../lib/http.js';
import { requireRole, requireUser } from '../auth/service.js';
import { importEquityPrices, type EquityKeys } from './ingest.js';
import { EQUITY_PROVIDERS, type FetchFn } from './providers.js';

// Indian equities, real data only (equity schema). The synthetic development companies elsewhere in
// ATLAS are never shown here. Imports use the local owner's own provider keys and are limited to
// administrators/data operators because free plans allow very few calls a day.

export function equityKeys(ctx: AppContext): EquityKeys {
  return { eodhd: ctx.cfg.EODHD_API_TOKEN, alphavantage: ctx.cfg.ALPHAVANTAGE_API_KEY };
}

export async function equityRoutes(app: FastifyInstance, ctx: AppContext, fetchFn: FetchFn): Promise<void> {
  const db = ctx.db;
  app.get('/v1/equity/status', async (req) => {
    requireUser(req);
    const providers = await db.query(`SELECT provider_id, name, docs_url, terms_url, docs_checked_on, coverage_note, limits_note, licence_note, priority, health, last_success_at, last_error_at, last_error, last_error_category FROM equity.providers ORDER BY priority`);
    const keys = equityKeys(ctx);
    const instruments = await db.query(`SELECT i.exchange, i.symbol, i.name, i.kind, s.provider_id, s.classification, s.basis, s.first_date, s.last_date, s.observations, s.last_import_at
        FROM equity.instruments i JOIN equity.price_series s USING (instrument_id) ORDER BY i.exchange, i.symbol, s.basis`);
    const jobs = await db.query(`SELECT job_id, provider_id, kind, dry_run, status, started_at, finished_at, received, stored, unchanged, corrected, rejected, error, error_category, detail FROM equity.import_jobs ORDER BY started_at DESC LIMIT 20`);
    const counts = await db.one<{ instruments: number; prices: number; quarantined: number; revisions: number }>(`SELECT (SELECT count(*)::int FROM equity.instruments) AS instruments, (SELECT count(*)::int FROM equity.prices) AS prices, (SELECT count(*)::int FROM equity.quarantine) AS quarantined, (SELECT count(*)::int FROM equity.price_revisions) AS revisions`);
    return {
      providers: providers.map((p: any) => ({ ...p, configured: !!keys[p.provider_id as keyof EquityKeys], env: EQUITY_PROVIDERS.find((d) => d.provider_id === p.provider_id)?.env })),
      instruments, jobs, counts,
      classification: { REAL_VERIFIED: 'Cross-checked against a second independent source (none yet).', REAL_UNVERIFIED: 'From one permitted provider; not cross-checked.', USER_IMPORTED: 'Your own uploaded files (My research → Your own data); private to you.', SYNTHETIC_DEMO: 'The fictional development companies elsewhere in ATLAS. Never mixed into this page, research, portfolios or alerts.' },
      market_status_note: 'ATLAS does not infer whether the market is open from this computer’s clock: values here are end-of-day provider closes dated by the provider.',
      synthetic_notice: 'Company pages, the screener and the Market section still show synthetic development data until a fundamentals and corporate-actions licence is in place.',
    };
  });

  app.get('/v1/equity/instruments/:exchange/:symbol', async (req) => {
    requireUser(req);
    const p = parse(z.object({ exchange: z.enum(['NSE', 'BSE', 'INDEX']), symbol: z.string().regex(/^[A-Z0-9&_.-]{1,30}$/) }), req.params);
    const inst = await db.maybeOne(`SELECT instrument_id, exchange, symbol, name, kind, isin, currency, created_at FROM equity.instruments WHERE exchange=$1 AND symbol=$2`, [p.exchange, p.symbol]);
    if (!inst) throw notFound('No real data imported for this instrument.');
    const series = await db.query(`SELECT series_id, provider_id, classification, basis, first_date, last_date, observations, last_import_at FROM equity.price_series WHERE instrument_id=$1 ORDER BY basis`, [(inst as { instrument_id: string }).instrument_id]);
    const prices = await db.query(`SELECT s.basis, p.trade_date, p.open::float8 AS open, p.high::float8 AS high, p.low::float8 AS low, p.close::float8 AS close, p.volume::float8 AS volume, p.validation, p.imported_at, p.revised_at
        FROM equity.prices p JOIN equity.price_series s USING (series_id) WHERE s.instrument_id=$1 ORDER BY p.trade_date DESC, s.basis LIMIT 60`, [(inst as { instrument_id: string }).instrument_id]);
    const symbols = await db.query(`SELECT provider_id, provider_symbol, validated_at FROM equity.provider_symbols WHERE instrument_id=$1`, [(inst as { instrument_id: string }).instrument_id]);
    return { instrument: inst, provider_symbols: symbols, series, recent_prices: prices };
  });

  app.post('/admin/v1/equity/import', { config: { rateLimit: { limit: 10, windowMs: 60_000, key: 'user' } } }, async (req) => {
    const u = requireRole(req, ['admin', 'data_ops']);
    const b = parse(z.object({ provider: z.enum(['eodhd', 'alphavantage']), exchange: z.enum(['NSE', 'BSE', 'INDEX']), symbol: z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z0-9&_.-]{1,30}$/)), kind: z.enum(['equity', 'index']).default('equity'), name: z.string().max(120).optional(), provider_symbol: z.string().max(40).regex(/^[A-Za-z0-9&_.^-]+$/).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dry_run: z.boolean().default(false) }), req.body);
    return importEquityPrices(db, fetchFn, equityKeys(ctx), { provider: b.provider, exchange: b.exchange, symbol: b.symbol, kind: b.kind, name: b.name, providerSymbol: b.provider_symbol, from: b.from, dryRun: b.dry_run, requestedBy: u.userId }, ctx.clock());
  });
}

/** Incremental daily refresh of already-imported instruments (bounded; skipped when no key is configured). */
export async function refreshEquities(db: Db, fetchFn: FetchFn, keys: EquityKeys, now: Date, max = 8): Promise<{ attempted: number }> {
  const due = await db.query<{ exchange: string; symbol: string; kind: 'equity' | 'index'; provider_id: 'eodhd' | 'alphavantage'; provider_symbol: string; last_date: string | null }>(
    `SELECT DISTINCT ON (i.instrument_id, s.provider_id) i.exchange, i.symbol, i.kind, s.provider_id, ps.provider_symbol, s.last_date
       FROM equity.price_series s JOIN equity.instruments i USING (instrument_id) JOIN equity.provider_symbols ps ON ps.instrument_id=i.instrument_id AND ps.provider_id=s.provider_id
      WHERE s.basis='raw' AND (s.last_import_at IS NULL OR s.last_import_at < $1) ORDER BY i.instrument_id, s.provider_id, s.last_import_at NULLS FIRST LIMIT $2`,
    [new Date(now.getTime() - 20 * 3_600_000).toISOString(), max]);
  let attempted = 0;
  for (const d of due) {
    if (!keys[d.provider_id]) continue;
    attempted++;
    await importEquityPrices(db, fetchFn, keys, { provider: d.provider_id, exchange: d.exchange as 'NSE', symbol: d.symbol, kind: d.kind, providerSymbol: d.provider_symbol, from: d.last_date ?? undefined }, now);
  }
  return { attempted };
}
