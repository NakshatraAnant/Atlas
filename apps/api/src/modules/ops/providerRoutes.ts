import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { freshnessOf } from '../../lib/freshness.js';
import { notFound, parse } from '../../lib/http.js';
import { providerStates } from '../../lib/providerGate.js';
import { requireRole, requireUser } from '../auth/service.js';
import { equityRuntime } from '../equity/routes.js';
import { quotaStatus } from '../equity/quota.js';
import { MACRO_SERIES } from '../macro/macro.js';
import { SERIES } from '../commodity/sources.js';

// Operator diagnostics for every data provider (Admin → Data providers). Backend-enforced: admin or
// data_ops with verified two-step sign-in. Never returns credentials, URLs with keys, or file paths
// beyond the backup file name.

export async function providerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  app.get('/admin/v1/providers', async (req) => {
    requireRole(req, ['admin', 'data_ops']);
    const now = ctx.clock();
    const states = await providerStates(db);
    const requests = await db.query(`SELECT provider_id, requested_at, endpoint, job, http_status, outcome, failure_category, cost, quota_event FROM ops.provider_requests ORDER BY requested_at DESC LIMIT 60`);
    const eodhd = await quotaStatus(db, equityRuntime(ctx).policies.eodhd, now);
    const coingecko = (await ctx.crypto?.rt.client.monthlyState('coingecko')) ?? null;
    const macro = await db.query<{ series_id: string; title: string; frequency: string | null; last_date: string | null; last_import_at: string | null; last_error: string | null }>(`SELECT series_id, title, frequency, to_char(last_date,'YYYY-MM-DD') AS last_date, last_import_at, last_error FROM macro.series WHERE enabled ORDER BY series_id`);
    const commodities = await db.query<{ series_id: string; name: string; frequency: string; last_date: string | null; last_import_at: string | null; last_error: string | null }>(`SELECT series_id, name, frequency, to_char(last_date,'YYYY-MM-DD') AS last_date, last_import_at, last_error FROM commodity.series WHERE enabled ORDER BY series_id`);
    const datasets = [
      ...macro.map((m) => ({ kind: 'macro', id: m.series_id, name: m.title, last_date: m.last_date, last_import_at: m.last_import_at, last_error: m.last_error, freshness: freshnessOf(m.last_date, m.frequency, now, m.last_error, { expectedAgeDays: MACRO_SERIES.find((x) => x.id === m.series_id)?.expected_age_days }) })),
      ...commodities.map((c) => ({ kind: 'commodity', id: c.series_id, name: c.name, last_date: c.last_date, last_import_at: c.last_import_at, last_error: c.last_error, freshness: freshnessOf(c.last_date, c.frequency, now, c.last_error, { discontinuedAfter: SERIES.find((x) => x.series_id === c.series_id)?.discontinued_after }) })),
    ];
    const jobs = {
      equity_runs: await db.query(`SELECT trigger, started_at, status, attempted, succeeded, failed, deferred_budget, calls_spent, stop_reason FROM equity.refresh_runs ORDER BY started_at DESC LIMIT 10`),
      commodity_failures: await db.query(`SELECT series_id, started_at, status, error, error_category FROM commodity.import_jobs WHERE status <> 'succeeded' ORDER BY started_at DESC LIMIT 15`),
      crypto_failures: await db.query(`SELECT job_type, source_id, started_at, error FROM crypto.ingestion_jobs WHERE status='failed' ORDER BY started_at DESC LIMIT 10`),
    };
    let backup: { file: string; created_at: string; size_mb: number; age_days: number } | null = null;
    try {
      const dir = join(process.cwd(), '..', '..', 'backups');
      const f = readdirSync(dir).filter((x) => x.endsWith('.tar.gz')).map((x) => ({ x, s: statSync(join(dir, x)) })).sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)[0];
      if (f) backup = { file: f.x, created_at: f.s.mtime.toISOString(), size_mb: Math.round(f.s.size / 1e5) / 10, age_days: Math.floor((now.getTime() - f.s.mtimeMs) / 86_400_000) };
    } catch {
      backup = null;
    }
    return {
      providers: states, quotas: { eodhd, coingecko }, requests, datasets,
      stale: datasets.filter((d) => !['fresh', 'discontinued'].includes(d.freshness.state)), jobs, backup,
      notes: {
        usage_confidence: 'provider_reported = the provider reported its own count (EODHD /api/user); estimated = counted by ATLAS (CoinGecko Demo, FRED, EIA, data.gov.in do not report usage to free keys).',
        reset: 'A reset time is shown only when the provider documents it (EODHD: midnight GMT). Otherwise ATLAS rechecks a paused provider hourly.',
      },
    };
  });

  /** Customer view: where each dataset comes from, how current it is, and attribution. No diagnostics. */
  app.get('/v1/data-sources', async (req) => {
    requireUser(req);
    const now = ctx.clock();
    // fred_csv is an internal fallback route for FRED, not a separate source for customers.
    const states = await db.query<{ provider_id: string; configured: boolean; status: string; last_success_at: string | null }>(`SELECT provider_id, configured, status, last_success_at FROM ops.provider_state WHERE provider_id <> 'fred_csv' ORDER BY provider_id`);
    const ABOUT: Record<string, { name: string; covers: string; attribution: string; frequency: string }> = {
      eodhd: { name: 'EOD Historical Data (EODHD)', covers: 'Indian indices NIFTY 50, SENSEX, NIFTY BANK (end of day). Individual NSE/BSE shares are not included in the current plan.', attribution: 'Data provided by EODHD.', frequency: 'End of day, after 20:00 IST' },
      fred: { name: 'FRED®, Federal Reserve Bank of St. Louis', covers: 'US and India macro series; EIA daily energy spot prices and IMF monthly commodity prices.', attribution: 'Source: FRED®, Federal Reserve Bank of St. Louis, and the original publishers.', frequency: 'As each series is published (daily to annual)' },
      eia: { name: 'U.S. Energy Information Administration', covers: 'US crude-oil and natural-gas inventories (weekly); historical WTI futures by contract position (to April 2024).', attribution: 'Source: U.S. Energy Information Administration.', frequency: 'Weekly' },
      coingecko: { name: 'CoinGecko', covers: 'Crypto prices, market capitalisation, volume (aggregated reference prices).', attribution: 'Data provided by CoinGecko.', frequency: 'About every 15 minutes, within the free plan’s monthly allowance' },
      data_gov_in: { name: 'Open Government Data Platform India (Agmarknet)', covers: 'Mandi (agricultural market) prices in India.', attribution: 'Source: Agmarknet via data.gov.in (Government Open Data License – India).', frequency: 'Daily reports' },
    };
    const plain = (s: { configured: boolean; status: string }) => (!s.configured ? 'Not connected' : s.status === 'operational' ? 'Updating normally' : ['rate_limited', 'quota_exhausted', 'recovering'].includes(s.status) ? 'Temporarily limited by the provider; resumes automatically' : s.status === 'unknown' ? 'Starting' : 'Updates delayed');
    const macro = await db.query<{ series_id: string; last_date: string | null; frequency: string | null; last_error: string | null }>(`SELECT series_id, to_char(last_date,'YYYY-MM-DD') AS last_date, frequency, last_error FROM macro.series WHERE enabled`);
    const comm = await db.query<{ series_id: string; last_date: string | null; frequency: string; last_error: string | null; source_id: string }>(`SELECT series_id, to_char(last_date,'YYYY-MM-DD') AS last_date, frequency, last_error, source_id FROM commodity.series WHERE enabled`);
    const tally = (xs: { state: string }[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x.state]: (m[x.state] ?? 0) + 1 }), {});
    return {
      providers: states.map((s) => ({ provider_id: s.provider_id, ...(ABOUT[s.provider_id] ?? { name: s.provider_id, covers: '', attribution: '', frequency: '' }), status: plain(s), last_update: s.last_success_at })),
      datasets: {
        macro: tally(macro.map((m) => freshnessOf(m.last_date, m.frequency, now, m.last_error, { expectedAgeDays: MACRO_SERIES.find((x) => x.id === m.series_id)?.expected_age_days }))),
        commodities: tally(comm.map((c) => freshnessOf(c.last_date, c.frequency, now, c.last_error, { discontinuedAfter: SERIES.find((x) => x.series_id === c.series_id)?.discontinued_after }))),
      },
      not_available: [
        { what: 'NSE and BSE exchange reports, individual Indian share prices', why: 'The exchanges’ terms prohibit automated collection and redistribution of their website data (checked 23 Oct 2026); a data licence is needed.' },
        { what: 'MCX commodity futures', why: 'MCX’s terms prohibit automated collection without written consent (checked 23 Oct 2026); MCX sells a data feed.' },
      ],
      freshness_rule: 'Fresh: the newest observation is as recent as that kind of series normally is (a few days for daily data, about two and a half months for monthly statistics). Delayed: up to 1.5 times that. Stale: older.',
    };
  });

  /** Clears a pause by hand (e.g. after fixing a key); the next request is a single health check. */
  app.post('/admin/v1/providers/:id/resume', async (req) => {
    requireRole(req, ['admin', 'data_ops']);
    const p = parse(z.object({ id: z.string().regex(/^[a-z0-9_]{2,40}$/) }), req.params);
    const r = await db.query(`UPDATE ops.provider_state SET next_eligible_at=$2, status=CASE WHEN configured THEN 'recovering' ELSE status END, paused_reason='resumed by an operator', updated_at=now() WHERE provider_id=$1 RETURNING provider_id`, [p.id, ctx.clock().toISOString()]);
    if (!r.length) throw notFound('Unknown provider.');
    return { ok: true, note: 'The next request will be a single health check; normal scheduling follows a success.' };
  });
}
