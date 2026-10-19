import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { runDailyCycle, schedulerTick } from '../src/pipeline/daily.js';
import type { VendorAdapter } from '../src/pipeline/vendor.js';
import { FIXTURE, fixtureContext, testVendor } from './fixture.js';

// Daily catch-up after missed runs, idempotent re-runs and safe retry after a late vendor file,
// driven through the real scheduler with a simulated clock. The fixture's data ends on
// FIXTURE.asOf (Wed 14 Oct 2026); the API was "off" until Tue 20 Oct 22:00 IST.

const AFTER_GAP = new Date('2026-10-20T16:30:00Z'); // 22:00 IST
const MISSED = ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'];

let ctx: AppContext;
beforeAll(async () => {
  ctx = await fixtureContext();
});
afterAll(async () => ctx?.db.close());

const pctx = (now: Date) => ({ db: ctx.db, store: ctx.store, cfg: ctx.cfg, log: ctx.log, now: () => now });
const counts = async () =>
  ctx.db.one<{ prices: number; daily: number; metrics: number; briefings: number; runs: number }>(
    `SELECT (SELECT count(*)::int FROM market.price_eod) AS prices, (SELECT count(*)::int FROM calc.security_daily) AS daily,
            (SELECT count(*)::int FROM calc.metric_values) AS metrics, (SELECT count(*)::int FROM calc.briefings) AS briefings,
            (SELECT count(*)::int FROM ops.job_runs WHERE job_name='daily_cycle') AS runs`,
  );

describe('daily catch-up, idempotency and retry (scheduler)', () => {
  it('catches up every missed trading day in order, skipping the weekend', async () => {
    expect((await ctx.db.one<{ d: string }>(`SELECT max(trade_date) AS d FROM market.price_eod`)).d).toBe(FIXTURE.asOf);
    const results = await schedulerTick(pctx(AFTER_GAP), testVendor());
    expect(results.map((r) => r.date)).toEqual(MISSED);
    expect(results.every((r) => r.briefing === 'published')).toBe(true);
    for (const d of MISSED) {
      // Covered securities still listed that day (delisted ones are kept for survivorship-free history but stop trading).
      const covered = (await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ref.securities s JOIN ref.companies c USING (company_id) WHERE c.coverage='full' AND s.listed_on <= $1::date AND (s.delisted_on IS NULL OR s.delisted_on > $1::date)`, [d])).n;
      expect(covered).toBeGreaterThan(10);
      const day = await ctx.db.one<{ prices: number; daily: number; briefing: string; job: string }>(
        `SELECT (SELECT count(*)::int FROM market.price_eod WHERE trade_date=$1::date AND exchange_code='NSE') AS prices,
                (SELECT count(*)::int FROM calc.security_daily WHERE trade_date=$1::date) AS daily,
                (SELECT status FROM calc.briefings WHERE trade_date=$1::date) AS briefing,
                (SELECT status FROM ops.job_runs WHERE job_name='daily_cycle' AND run_key=$1::text) AS job`,
        [d],
      );
      expect(day.prices).toBeGreaterThanOrEqual(covered);
      expect(day.daily).toBe(covered);
      expect(day.briefing).toBe('published');
      expect(day.job).toBe('succeeded');
    }
    const failedCalcs = await ctx.db.query(`SELECT 1 FROM calc.calc_runs WHERE status <> 'succeeded'`);
    expect(failedCalcs).toEqual([]);
  });

  it('is idempotent: running the scheduler again does nothing and writes no duplicates', async () => {
    const before = await counts();
    expect(await schedulerTick(pctx(AFTER_GAP), testVendor())).toEqual([]);
    expect(await runDailyCycle(pctx(AFTER_GAP), testVendor(), '2026-10-19', { simulatedClock: true })).toEqual({ date: '2026-10-19', skipped: 'already ran' });
    expect(await counts()).toEqual(before);
  });

  it('a late vendor file holds the briefing, records the failure, and the next tick retries safely', async () => {
    const real = testVendor();
    let late = true;
    const flaky: VendorAdapter = {
      name: real.name,
      isSynthetic: real.isSynthetic,
      fetch: async (dataset, req) => (late && dataset === 'eod_prices' ? null : real.fetch(dataset, req)),
    };
    const at = new Date('2026-10-21T16:30:00Z'); // Wed 21 Oct, 22:00 IST
    const first = await schedulerTick(pctx(at), flaky);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ date: '2026-10-21', briefing: 'held' });
    const job = await ctx.db.one<{ status: string; error: string }>(`SELECT status, error FROM ops.job_runs WHERE job_name='daily_cycle' AND run_key='2026-10-21'`);
    expect(job).toEqual({ status: 'failed', error: 'prices not validated' });
    expect(await ctx.db.maybeOne(`SELECT 1 FROM ops.ops_alerts WHERE dedupe_key='eod-late-2026-10-21'`)).toBeTruthy();
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM market.price_eod WHERE trade_date='2026-10-21'`)).n).toBe(0);

    late = false;
    const retry = await schedulerTick(pctx(new Date('2026-10-21T17:00:00Z')), flaky);
    expect(retry.map((r) => [r.date, r.briefing])).toEqual([['2026-10-21', 'published']]);
    expect((await ctx.db.one<{ status: string }>(`SELECT status FROM ops.job_runs WHERE job_name='daily_cycle' AND run_key='2026-10-21'`)).status).toBe('succeeded');
    const dupes = await ctx.db.query(`SELECT security_id, trade_date FROM market.price_eod GROUP BY 1, 2, exchange_code HAVING count(*) > 1`);
    expect(dupes).toEqual([]);
  });
});
