import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { forEachPitBatch, loadPit } from '../src/modules/fundamentals/pit.js';
import { finishCalcRun, startCalcRun } from '../src/pipeline/calc/adjust.js';
import { computeSecurityDaily } from '../src/pipeline/calc/daily.js';
import { computeCompanyMetrics } from '../src/pipeline/calc/metrics.js';
import { computeMarketDaily, windowDaysFor } from '../src/pipeline/calc/market.js';
import { FIXTURE, fixtureContext } from './fixture.js';

// Regression for the embedded-engine crash (session 4): point-in-time fundamentals used to be
// loaded for every company in ONE query, whose result overflowed PGlite's protocol buffer at 120
// companies. Loading is now batched. These tests prove batching changes no calculated value.

const fingerprintSql = readFileSync(new URL('../src/db/calc-fingerprint.sql', import.meta.url), 'utf8');
type Fp = { adjusted_md5: string; daily_rows: number; daily_md5: string; metric_rows: number; metric_md5: string; market_rows: number; market_md5: string; sector_md5: string };

let ctx: AppContext;
beforeAll(async () => {
  ctx = await fixtureContext();
});
afterAll(async () => ctx?.db.close());

const fp = async () => ctx.db.one<Fp>(fingerprintSql);
const rerun = async (pitBatch: number) => {
  const id = await startCalcRun(ctx.db, 'test-rebatch', 'test');
  await computeSecurityDaily(ctx.db, { calcRunId: id, pitBatch });
  await computeCompanyMetrics(ctx.db, { asOf: FIXTURE.asOf, calcRunId: id, pitBatch });
  await finishCalcRun(ctx.db, id, 'succeeded', {});
  return fp();
};

describe('bounded point-in-time loading (embedded-engine crash regression)', () => {
  it('batched loading returns exactly the same fundamentals as one unbatched load', async () => {
    const ids = (await ctx.db.query<{ company_id: string }>(`SELECT DISTINCT company_id FROM fund.financial_periods ORDER BY 1`)).map((r) => r.company_id);
    expect(ids.length).toBeGreaterThan(3);
    const whole = await loadPit(ctx.db, ids);
    const seen: string[][] = [];
    await forEachPitBatch(ctx.db, ids, async (pits, batch) => {
      seen.push(batch);
      for (const id of batch) expect(JSON.stringify(pits.get(id)!.all.map((p) => [p.period_id, [...p.values]]))).toBe(JSON.stringify(whole.get(id)!.all.map((p) => [p.period_id, [...p.values]])));
    }, 3);
    expect(seen.flat()).toEqual(ids);
    expect(Math.max(...seen.map((b) => b.length))).toBe(3);
  });

  it('daily calculations recomputed in batches equal those the previous (unbatched) code stored', async () => {
    const stored = await fp();
    expect(stored.daily_rows).toBeGreaterThan(1000);
    const batched = await rerun(1);
    expect(batched.daily_rows).toBe(stored.daily_rows);
    expect(batched.daily_md5).toBe(stored.daily_md5);
    expect(batched.adjusted_md5).toBe(stored.adjusted_md5);
  });

  it('batch size has no effect on any calculated value (batch 1 == batch 1000)', async () => {
    const one = await rerun(1);
    const all = await rerun(1000);
    expect(all).toEqual(one);
    expect(one.metric_rows).toBeGreaterThan(100);
  });
});

describe('market stage windows are sized by a row budget (500-company crash regression)', () => {
  it('window length shrinks with universe size and stays within 7..366 days', () => {
    expect(windowDaysFor(16)).toBe(366);
    expect(windowDaysFor(500)).toBeLessThan(80);
    expect(windowDaysFor(100000)).toBe(7);
  });
  it('market and sector results are identical with 7-day windows and the default windows', async () => {
    const run = async (windowDays?: number) => {
      const id = await startCalcRun(ctx.db, 'test-window', 'test');
      await computeMarketDaily(ctx.db, { calcRunId: id, windowDays });
      await finishCalcRun(ctx.db, id, 'succeeded', {});
      return fp();
    };
    const stored = await fp();
    type S = { trade_date: string; sector: string; ret_equal: number; ret_cap: number; constituents: number; advances: number; declines: number };
    const storedSectors = await ctx.db.query<S>(`SELECT trade_date, sector, ret_equal, ret_cap, constituents, advances, declines FROM calc.sector_daily ORDER BY 1, 2`);
    const small = await run(7);
    const dflt = await run();
    expect(small.market_md5).toBe(dflt.market_md5);
    expect(small.sector_md5).toBe(dflt.sector_md5);
    expect(dflt.market_md5).toBe(stored.market_md5);
    // The previous code summed rows in arbitrary order, so stored sector returns may differ from the
    // now-deterministic order only by floating-point noise in the last stored decimal.
    const now = await ctx.db.query<S>(`SELECT trade_date, sector, ret_equal, ret_cap, constituents, advances, declines FROM calc.sector_daily ORDER BY 1, 2`);
    expect(now.length).toBe(storedSectors.length);
    let maxDiff = 0;
    now.forEach((r, i) => {
      const o = storedSectors[i]!;
      expect([r.trade_date, r.sector, r.constituents, r.advances, r.declines]).toEqual([o.trade_date, o.sector, o.constituents, o.advances, o.declines]);
      maxDiff = Math.max(maxDiff, Math.abs(r.ret_equal - o.ret_equal), Math.abs(r.ret_cap - o.ret_cap));
    });
    expect(maxDiff).toBeLessThanOrEqual(1e-9);
    expect(dflt.market_rows).toBeGreaterThan(100);
  });
});

describe('synthetic universe size follows the seeded database (ADR-018)', () => {
  it('uses the seeded count even when SYNTHETIC_COMPANIES says otherwise', async () => {
    const { syntheticUniverseSize } = await import('../src/bootstrap.js');
    const prev = process.env.SYNTHETIC_COMPANIES;
    process.env.SYNTHETIC_COMPANIES = '500';
    const warnings: string[] = [];
    try {
      expect(await syntheticUniverseSize(ctx.db, { warn: (m) => warnings.push(m) })).toBe(FIXTURE.companies);
      expect(warnings).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.SYNTHETIC_COMPANIES;
      else process.env.SYNTHETIC_COMPANIES = prev;
    }
  });
});
