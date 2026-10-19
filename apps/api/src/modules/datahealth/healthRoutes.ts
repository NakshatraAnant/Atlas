import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { requireUser } from '../auth/service.js';
import { freshness } from '../provenance/evidence.js';
import { PROVIDER_ASSESSMENT_VERSION, PROVIDER_ASSESSMENTS } from './providers.js';

// Data health: what data ATLAS holds, where it came from, how fresh and complete it is, what failed,
// and which real-data sources are blocked and why. Read-only and free of credentials; re-run controls
// stay in the admin pipeline monitor (two-step verification, audited).
export async function dataHealthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  app.get('/v1/data/health', async (req) => {
    requireUser(req);
    const now = ctx.clock();
    const sources = await db.query<{ source_id: string; provider: string; dataset: string; is_synthetic: boolean; status: string; last_success_at: string | null; last_data_date: string | null; schedule: string; licence_status: string | null }>(
      `SELECT s.source_id, s.provider, s.dataset, s.is_synthetic, s.status, s.last_success_at, s.last_data_date, s.schedule, l.status AS licence_status FROM ref.sources s LEFT JOIN ref.licences l USING (licence_id) ORDER BY s.dataset, s.source_id`,
    );
    const fresh = await freshness(db, now);
    const companies = await db.one<{ total: number; synthetic: number; real: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE is_synthetic)::int AS synthetic, count(*) FILTER (WHERE NOT is_synthetic)::int AS real FROM ref.companies WHERE coverage='full'`,
    );
    const prices = await db.one<{ first: string | null; last: string | null; days: number; rows: number }>(
      `SELECT min(trade_date) AS first, max(trade_date) AS last, count(DISTINCT trade_date)::int AS days, count(*)::int AS rows FROM market.price_eod`,
    );
    const expected = prices.first
      ? (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ref.trading_calendar WHERE exchange_code='NSE' AND is_trading_day AND trade_date BETWEEN $1 AND $2`, [prices.first, prices.last])).n
      : 0;
    const missingDates = prices.first
      ? await db.query<{ trade_date: string }>(
          `SELECT c.trade_date FROM ref.trading_calendar c WHERE c.exchange_code='NSE' AND c.is_trading_day AND c.trade_date BETWEEN $1 AND $2
             AND NOT EXISTS (SELECT 1 FROM market.price_eod p WHERE p.trade_date = c.trade_date) ORDER BY c.trade_date DESC LIMIT 20`,
          [prices.first, prices.last],
        )
      : [];
    const runs7d = await db.query<{ status: string; n: number; rows_valid: number; rows_quarantined: number }>(
      `SELECT status, count(*)::int AS n, coalesce(sum(rows_valid),0)::int AS rows_valid, coalesce(sum(rows_quarantined),0)::int AS rows_quarantined FROM ops.ingestion_runs WHERE started_at > $1 GROUP BY status ORDER BY status`,
      [new Date(now.getTime() - 7 * 86_400_000).toISOString()],
    );
    const recentRuns = await db.query(
      `SELECT run_id, source_id, dataset, data_date, status, started_at, finished_at, rows_in, rows_valid, rows_quarantined, left(coalesce(error, ''), 300) AS error FROM ops.ingestion_runs ORDER BY started_at DESC LIMIT 25`,
    );
    const jobs = await db.query(
      `SELECT DISTINCT ON (job_name) job_name, run_key, status, started_at, finished_at, left(coalesce(error, ''), 300) AS error FROM ops.job_runs ORDER BY job_name, started_at DESC`,
    );
    const failures = await db.query(
      `SELECT job_name, run_key, started_at, left(coalesce(error, ''), 300) AS error FROM ops.job_runs WHERE status='failed' ORDER BY started_at DESC LIMIT 10`,
    );
    const quality = await db.query<{ severity: string; status: string; n: number }>(`SELECT severity, status, count(*)::int AS n FROM calc.quality_issues GROUP BY severity, status ORDER BY severity, status`);
    const quarantined = await db.one<{ open: number }>(`SELECT count(*) FILTER (WHERE resolved_at IS NULL)::int AS open FROM market.price_quarantine`);
    // Judge the data mode on raw input sources; derived metrics inherit their inputs' status.
    const raw = sources.filter((s) => s.dataset !== 'derived_metrics');
    const allSynthetic = raw.length > 0 && raw.every((s) => s.is_synthetic);
    const pendingLicences = await db.query(`SELECT counterparty, contract_ref, status, permitted_use FROM ref.licences WHERE status IN ('draft', 'under_negotiation') ORDER BY counterparty, contract_ref`);
    return {
      generated_at: now.toISOString(),
      data_mode: allSynthetic ? 'synthetic' : raw.some((s) => s.is_synthetic) ? 'mixed' : 'real',
      real_data: {
        connected: companies.real > 0,
        summary: companies.real > 0
          ? `${companies.real} companies come from non-synthetic sources.`
          : 'No real market data is connected. Every company, price and filing shown in ATLAS is synthetic development data. The official exchange websites prohibit automated collection (see the provider assessments); a licensed feed is needed.',
      },
      coverage: { companies, prices: { ...prices, expected_trading_days: expected, missing_trading_days: Math.max(0, expected - prices.days), recent_missing_dates: missingDates.map((d) => d.trade_date) } },
      sources: sources.map((s) => ({ ...s, freshness: fresh.find((f) => f.source_id === s.source_id) ?? null })),
      ingestion: { last_7_days: runs7d, recent_runs: recentRuns, open_quarantined_rows: quarantined.open },
      scheduler: {
        jobs,
        recent_failures: failures,
        how_it_runs: 'Jobs run inside the local API process: missed trading days are caught up before the API starts and the post-close cycle runs after 18:30 IST while the API is running. Nothing runs while the computer is off or asleep; the next start catches up. Repeated failures are not retried in a tight loop: the scheduler checks once a minute and each cycle is idempotent.',
      },
      quality: { issues: quality },
      providers: { version: PROVIDER_ASSESSMENT_VERSION, assessments: PROVIDER_ASSESSMENTS, pending_licences: pendingLicences },
    };
  });
}
