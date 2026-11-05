import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { lastRuns } from '../src/modules/crypto/scheduler.js';
import { fixtureContext } from './fixture.js';

// Regression (session 13): the scheduler's lastRuns() ran a correlated subquery once per row of the whole
// crypto.ingestion_jobs table on every 30-second tick. On the live database this blocked the API for
// seconds at a time (a 33.8 s page request, proxy 500s). The rewrite must return the same answers in
// linear time.

let ctx: AppContext;
beforeAll(async () => {
  ctx = await fixtureContext();
});
afterAll(async () => {
  await ctx?.db.close();
});

const OLD_QUERY = `SELECT DISTINCT ON (job_type) job_type, started_at, status,
    (SELECT max(finished_at) FROM crypto.ingestion_jobs x WHERE x.job_type=j.job_type AND x.status IN ('succeeded','partial')) AS last_success
  FROM crypto.ingestion_jobs j ORDER BY job_type, started_at DESC`;

describe('crypto scheduler lastRuns', () => {
  it('returns the latest run and the last success per job type (known answers)', async () => {
    await ctx.db.query(`DELETE FROM crypto.ingestion_jobs WHERE job_type IN ('t_a','t_b','t_c')`);
    const src = (await ctx.db.one<{ source_id: string }>(`SELECT source_id FROM crypto.sources LIMIT 1`)).source_id;
    const ins = (type: string, status: string, started: string, finished: string | null) =>
      ctx.db.query(`INSERT INTO crypto.ingestion_jobs (source_id, job_type, trigger, status, started_at, finished_at) VALUES ($1,$2,'test',$3,$4,$5)`, [src, type, status, started, finished]);
    await ins('t_a', 'succeeded', '2026-11-01T00:00:00Z', '2026-11-01T00:01:00Z');
    await ins('t_a', 'failed', '2026-11-02T00:00:00Z', '2026-11-02T00:00:30Z');
    await ins('t_b', 'partial', '2026-11-01T00:00:00Z', '2026-11-01T00:05:00Z');
    await ins('t_b', 'succeeded', '2026-11-03T00:00:00Z', '2026-11-03T00:02:00Z');
    await ins('t_c', 'failed', '2026-11-04T00:00:00Z', '2026-11-04T00:00:10Z');
    const m = await lastRuns(ctx.db);
    const iso = (x: string | null | undefined) => (x ? new Date(x).toISOString() : null);
    expect([m.get('t_a')!.status, iso(m.get('t_a')!.started_at), iso(m.get('t_a')!.last_success)]).toEqual(['failed', '2026-11-02T00:00:00.000Z', '2026-11-01T00:01:00.000Z']);
    expect([m.get('t_b')!.status, iso(m.get('t_b')!.last_success)]).toEqual(['succeeded', '2026-11-03T00:02:00.000Z']);
    expect([m.get('t_c')!.status, iso(m.get('t_c')!.last_success)]).toEqual(['failed', null]);
  });

  it('matches the previous query exactly and stays fast on a large job history', async () => {
    const src = (await ctx.db.one<{ source_id: string }>(`SELECT source_id FROM crypto.sources LIMIT 1`)).source_id;
    // About two weeks of the live schedule: on-chain jobs every 2 and 5 minutes dominate.
    await ctx.db.query(
      `INSERT INTO crypto.ingestion_jobs (source_id, job_type, trigger, status, started_at, finished_at)
       SELECT $1, (ARRAY['p_onchain_eth','p_onchain_btc','p_markets','p_details'])[1 + (g % 4)], 'test',
              CASE WHEN g % 17 = 0 THEN 'failed' WHEN g % 11 = 0 THEN 'partial' ELSE 'succeeded' END,
              timestamptz '2026-10-20T00:00:00Z' + g * interval '1 minute', timestamptz '2026-10-20T00:00:30Z' + g * interval '1 minute'
         FROM generate_series(1, 8000) g`, [src]);
    const t0 = performance.now();
    const fast = await lastRuns(ctx.db);
    const newMs = performance.now() - t0;
    const t1 = performance.now();
    const old = await ctx.db.query<{ job_type: string; started_at: string; status: string; last_success: string | null }>(OLD_QUERY);
    const oldMs = performance.now() - t1;
    for (const o of old) {
      const n = fast.get(o.job_type)!;
      expect([n.status, String(n.started_at), String(n.last_success)]).toEqual([o.status, String(o.started_at), String(o.last_success)]);
    }
    expect(fast.size).toBe(old.length);
    console.log(`lastRuns on ${8000}+ rows: new ${newMs.toFixed(0)} ms, previous ${oldMs.toFixed(0)} ms`);
    expect(newMs).toBeLessThan(oldMs);
    expect(newMs).toBeLessThan(1500);
  });
});
