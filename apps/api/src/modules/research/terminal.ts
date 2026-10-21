import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { notFound, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { freshness } from '../provenance/evidence.js';

// Market terminal: one end-of-day snapshot of everything the workstation shows, read from stored
// records only. `version` changes only when new data is stored, so the UI animates a value only when
// the underlying record changed. Nothing here is live; the payload says so.

const MOVER_LIMIT = 8;

export async function terminalRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  app.get('/v1/market/terminal', async (req) => {
    requireUser(req);
    const q = parse(z.object({ sessions: z.coerce.number().int().refine((n) => [20, 60, 120, 250].includes(n)).default(60) }), req.query);
    const asOf = (await db.maybeOne<{ d: string | null }>(`SELECT max(trade_date) AS d FROM market.price_eod`))?.d;
    if (!asOf) throw notFound('No end-of-day prices have been imported yet.');
    const prevDay = (await db.maybeOne<{ d: string | null }>(`SELECT max(trade_date) AS d FROM market.price_eod WHERE trade_date < $1`, [asOf]))?.d ?? null;
    const calc = await db.maybeOne<{ calc_run_id: string; finished_at: string | null }>(`SELECT calc_run_id, finished_at FROM calc.calc_runs ORDER BY started_at DESC LIMIT 1`);
    const fresh = (await freshness(db, ctx.clock())).find((f) => f.dataset === 'eod_prices');
    const synthetic = (await db.one<{ s: boolean }>(`SELECT coalesce(bool_and(is_synthetic), false) AS s FROM ref.sources WHERE dataset = 'eod_prices'`)).s;

    // Index panels: latest close, previous close and the last N sessions for the chart.
    const indexDefs = await db.query<{ index_code: string; name: string }>(`SELECT index_code, name FROM ref.index_definitions ORDER BY index_code`);
    const indexRows = await db.query<{ index_code: string; trade_date: string; close: number }>(
      `SELECT index_code, trade_date, close::float8 AS close FROM (
         SELECT index_code, trade_date, close, row_number() OVER (PARTITION BY index_code ORDER BY trade_date DESC) AS rn FROM market.index_levels WHERE trade_date <= $1
       ) x WHERE rn <= $2 ORDER BY index_code, trade_date`,
      [asOf, q.sessions],
    );
    const indices = indexDefs.map((d) => {
      const series = indexRows.filter((r) => r.index_code === d.index_code).map((r) => ({ date: r.trade_date, close: r.close }));
      const last = series[series.length - 1];
      const prev = series[series.length - 2];
      return {
        code: d.index_code, name: d.name,
        close: last?.close ?? null, prev_close: prev?.close ?? null, date: last?.date ?? null,
        change_pct: last && prev ? last.close / prev.close - 1 : null,
        series,
      };
    }).filter((i) => i.close !== null);

    const breadth = await db.maybeOne(`SELECT universe_code, trade_date, traded, advances, declines, unchanged, new_highs, new_lows, turnover_cr::float8 AS turnover_cr FROM calc.market_daily WHERE trade_date=$1 ORDER BY universe_code LIMIT 1`, [asOf]);

    // Movers on the latest session, among listed companies with a previous close.
    const moverBase = `
      SELECT c.company_id, c.short_name, c.sector, si.symbol, p.close::float8 AS close, p.prev_close::float8 AS prev_close,
             (p.close / p.prev_close - 1)::float8 AS change_pct, p.volume::float8 AS volume, p.traded_value::float8 AS traded_value
        FROM market.price_eod p
        JOIN ref.securities s USING (security_id)
        JOIN ref.companies c ON c.company_id = s.company_id
        LEFT JOIN LATERAL (SELECT symbol FROM ref.security_identifiers i WHERE i.security_id = s.security_id AND i.exchange_code = p.exchange_code AND i.valid_from <= p.trade_date AND (i.valid_to IS NULL OR i.valid_to >= p.trade_date) ORDER BY valid_from DESC LIMIT 1) si ON true
       WHERE p.trade_date = $1 AND p.exchange_code = 'NSE' AND p.prev_close > 0 AND c.coverage = 'full'`;
    const gainers = await db.query(`${moverBase} ORDER BY change_pct DESC, c.short_name LIMIT ${MOVER_LIMIT}`, [asOf]);
    const losers = await db.query(`${moverBase} ORDER BY change_pct ASC, c.short_name LIMIT ${MOVER_LIMIT}`, [asOf]);
    const active = await db.query(`${moverBase} ORDER BY traded_value DESC, c.short_name LIMIT ${MOVER_LIMIT}`, [asOf]);

    const sectors = await db.query(`SELECT sector, ret_cap::float8 AS ret_cap, advances, declines, constituents FROM calc.sector_daily WHERE trade_date=$1 ORDER BY ret_cap DESC, sector`, [asOf]);

    // Disclosure feed: newest announcements, with their stated publication time and source link if any.
    const feed = await db.query(
      `SELECT a.announcement_id, a.company_id, c.short_name AS company, a.category, a.subject, a.published_at, a.document_url, a.source_id
         FROM disc.announcements a JOIN ref.companies c ON c.company_id = a.company_id
        WHERE a.published_at <= $1 ORDER BY a.published_at DESC, a.announcement_id LIMIT 25`,
      [ctx.clock().toISOString()],
    );
    const lastRun = await db.maybeOne(`SELECT status, started_at, finished_at, data_date FROM ops.ingestion_runs WHERE dataset='eod_prices' ORDER BY started_at DESC LIMIT 1`);

    return {
      data_kind: 'end_of_day',
      synthetic,
      as_of: asOf,
      previous_session: prevDay,
      freshness: fresh ? { stale: fresh.stale, label: fresh.label } : null,
      version: `${asOf}:${calc?.calc_run_id ?? 'none'}`,
      generated_at: ctx.clock().toISOString(),
      notice: 'End-of-day data, updated once per trading day after validation. Nothing on this screen is live.',
      sessions: q.sessions,
      indices,
      breadth,
      movers: { gainers, losers, active },
      sectors,
      feed: { kind: 'company announcements', items: feed },
      pipeline: { last_eod_run: lastRun, last_calc_finished_at: calc?.finished_at ?? null },
    };
  });
}
