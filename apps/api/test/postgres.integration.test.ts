import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContext } from '../src/bootstrap.js';
import type { AppContext } from '../src/context.js';
import { openDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { MemoryObjectStore } from '../src/lib/objectStore.js';
import { seedAll } from '../src/seed.js';
import { FIXTURE, FIXTURE_CLOCK, testConfig, testVendor } from './fixture.js';

// Real PostgreSQL (the production driver path: node-postgres). Opt-in because it needs a server:
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/atlas_test npm test -w @atlas/api
// The database must be EMPTY; the test migrates and seeds it. Never point this at Supabase prod.

const url = process.env.TEST_DATABASE_URL;
const fingerprintSql = readFileSync(new URL('../src/db/fingerprint.sql', import.meta.url), 'utf8');

describe.skipIf(!url)('PostgreSQL integration (node-postgres driver)', () => {
  let pgDb: Db;
  let lite: Db;
  beforeAll(async () => {
    pgDb = await openDb({ databaseUrl: url });
    const existing = await pgDb.maybeOne(`SELECT 1 FROM pg_namespace WHERE nspname = 'app'`);
    if (existing) throw new Error('TEST_DATABASE_URL must point to an empty database');
    lite = await openDb({});
  });
  afterAll(async () => {
    await pgDb?.close();
    await lite?.close();
  });

  it('applies every migration and is idempotent on re-run', async () => {
    const first = await migrate(pgDb);
    expect(first.applied.length).toBeGreaterThanOrEqual(5);
    const second = await migrate(pgDb);
    expect(second.applied).toEqual([]);
  });

  it('produces exactly the same schema as the embedded database', async () => {
    await migrate(lite);
    const [a] = await pgDb.query(fingerprintSql);
    const [b] = await lite.query(fingerprintSql);
    expect(a).toEqual(b);
  });

  it('normalises types identically to PGlite (numeric, bigint, date, timestamptz)', async () => {
    const sql = `SELECT 12.3456::numeric(10,4) AS n, 9007199254740::bigint AS b, DATE '2026-03-31' AS d, TIMESTAMPTZ '2026-03-31 18:00:00+05:30' AS t`;
    expect(await pgDb.query(sql)).toEqual(await lite.query(sql));
  });

  it('denies a non-owner role even with explicit grants (RLS)', async () => {
    await pgDb.exec(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_probe') THEN CREATE ROLE atlas_probe NOLOGIN; END IF; END $$;
      GRANT USAGE ON SCHEMA app TO atlas_probe; GRANT SELECT, INSERT ON app.users TO atlas_probe;`);
    await pgDb.exec(`INSERT INTO app.users (email, password_hash) VALUES ('pg-owner-only@example.test', 'x')`);
    const rows = await pgDb.tx(async (t) => {
      await t.exec('SET LOCAL ROLE atlas_probe');
      return t.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.users`);
    });
    expect(rows).toEqual([{ n: 0 }]);
    await pgDb.exec(`DELETE FROM app.users WHERE email = 'pg-owner-only@example.test'`);
  });

  it('rolls back a failed transaction completely', async () => {
    await expect(
      pgDb.tx(async (t) => {
        await t.exec(`INSERT INTO app.email_suppressions (email, reason) VALUES ('tx@example.test', 'test')`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await pgDb.query(`SELECT 1 FROM app.email_suppressions WHERE email = 'tx@example.test'`)).toEqual([]);
  });

  describe('full synthetic seed through the production driver', () => {
    let ctx: AppContext;
    beforeAll(async () => {
      ctx = await createContext({ cfg: testConfig(), db: pgDb, store: new MemoryObjectStore(), vendor: testVendor(), clock: () => FIXTURE_CLOCK });
      await seedAll(ctx, { asOf: FIXTURE.asOf, dailyDays: FIXTURE.dailyDays });
    }, 900_000);

    it('loads the same reference universe and calculations as the embedded fixture', async () => {
      const counts = await pgDb.one<{ companies: number; prices: number; metrics: number; briefings: number }>(
        `SELECT (SELECT count(*)::int FROM ref.companies WHERE coverage='full') AS companies,
                (SELECT count(*)::int FROM market.price_eod) AS prices,
                (SELECT count(*)::int FROM calc.metric_values) AS metrics,
                (SELECT count(*)::int FROM calc.briefings WHERE status = 'published') AS briefings`,
      );
      expect(counts.companies).toBe(FIXTURE.companies);
      expect(counts.prices).toBeGreaterThan(1000);
      expect(counts.metrics).toBeGreaterThan(100);
      expect(counts.briefings).toBeGreaterThan(0);
    });

    it('labels every seeded company and security as synthetic', async () => {
      const real = await pgDb.query(`SELECT company_id FROM ref.companies WHERE NOT is_synthetic UNION ALL SELECT company_id::text::uuid FROM ref.securities WHERE NOT is_synthetic`);
      expect(real).toEqual([]);
    });

    it('trigram company search works on PostgreSQL', async () => {
      const [c] = await pgDb.query<{ short_name: string }>(`SELECT short_name FROM ref.companies ORDER BY short_name LIMIT 1`);
      const typo = c!.short_name.slice(0, -1);
      const hits = await pgDb.query<{ short_name: string }>(`SELECT short_name FROM ref.companies ORDER BY similarity(lower(short_name), lower($1)) DESC LIMIT 3`, [typo]);
      expect(hits.map((h) => h.short_name)).toContain(c!.short_name);
    });
  });

  describe('concurrency and idempotency on the new write paths (crypto, equity, research, learning)', () => {
    let ctx: AppContext;
    let userId = '';
    beforeAll(async () => {
      ctx = await createContext({ cfg: testConfig(), db: pgDb, store: new MemoryObjectStore(), vendor: testVendor(), clock: () => new Date('2026-10-23T12:00:00Z') });
      userId = (await pgDb.one<{ user_id: string }>(`INSERT INTO app.users (email, password_hash) VALUES ('pg-concurrency@example.test', 'x') RETURNING user_id`)).user_id;
    });

    it('parallel imports of the same equity rows store each day once', async () => {
      const { importEquityPrices } = await import('../src/modules/equity/ingest.js');
      const rows = Array.from({ length: 40 }, (_, i) => { const d = new Date(Date.UTC(2026, 0, 5 + i)); const p = 100 + i; return { date: d.toISOString().slice(0, 10), open: p, high: p + 1, low: p - 1, close: p, adjusted_close: p, volume: 10 }; });
      const fetchFn = async () => ({ status: 200, ok: true, text: async () => JSON.stringify(rows) });
      const req = { provider: 'eodhd' as const, exchange: 'NSE' as const, symbol: 'PGTEST', kind: 'equity' as const };
      const results = await Promise.allSettled([1, 2, 3].map(() => importEquityPrices(pgDb, fetchFn, { eodhd: 't', alphavantage: '' }, req, new Date('2026-10-23T12:00:00Z'))));
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      const n = await pgDb.one<{ raw: number; series: number }>(`SELECT (SELECT count(*)::int FROM equity.prices p JOIN equity.price_series s USING (series_id) WHERE s.basis='raw') AS raw, (SELECT count(*)::int FROM equity.price_series) AS series`);
      expect(n).toEqual({ raw: 40, series: 2 });
    });

    it('concurrent quota charges on real connections never exceed a budget or the daily limit', async () => {
      const { spend, eodhdPolicy, quotaStatus } = await import('../src/modules/equity/quota.js');
      const policy = eodhdPolicy();
      const t = new Date('2026-10-23T12:00:00Z');
      const cats = ['refresh', 'backfill', 'validation', 'manual'] as const;
      const results = await Promise.all(Array.from({ length: 60 }, (_, i) => spend(pgDb, policy, cats[i % 4]!, 1, t, { useReserve: true })));
      // refresh 12 + backfill 2 + validation 2 + manual 2 + reserve 2 (manual only) = 20.
      expect(results.filter((r) => r.ok)).toHaveLength(20);
      const q = await quotaStatus(pgDb, policy, t);
      expect(q).toMatchObject({ spent_local: 20, remaining: 0 });
    });

    it('the same research activity and XP award recorded concurrently exist once', async () => {
      const { recordActivity } = await import('../src/modules/research/activity.js');
      const { syncLearningEvents } = await import('../src/modules/academy/learning.js');
      const at = new Date('2026-10-23T10:00:00Z');
      await Promise.all(Array.from({ length: 8 }, () => recordActivity(pgDb, userId, 'report_created', 'pg-report-1', at)));
      await Promise.all(Array.from({ length: 4 }, () => syncLearningEvents(pgDb, userId)));
      const a = await pgDb.one<{ n: number }>(`SELECT count(*)::int AS n FROM research.activity WHERE user_id=$1`, [userId]);
      const e = await pgDb.one<{ n: number; xp: number }>(`SELECT count(*)::int AS n, coalesce(sum(xp),0)::int AS xp FROM acad.learning_events WHERE user_id=$1 AND kind='report_created'`, [userId]);
      expect(a.n).toBe(1);
      expect(e).toEqual({ n: 1, xp: 30 });
    });

    it('parallel alert evaluations notify once per observation', async () => {
      const { evaluateAlerts } = await import('../src/modules/research/objectRoutes.js');
      await pgDb.query(`INSERT INTO research.alert_rules (user_id, kind, instrument_key, threshold) VALUES ($1,'price_above','equity:NSE:PGTEST',1)`, [userId]);
      await Promise.all([1, 2, 3].map(() => evaluateAlerts(pgDb, new Date('2026-10-23T12:00:00Z'), userId)));
      const ev = await pgDb.one<{ n: number }>(`SELECT count(*)::int AS n FROM research.alert_events WHERE user_id=$1`, [userId]);
      const notes = await pgDb.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.notifications WHERE user_id=$1 AND kind='research_alert'`, [userId]);
      expect(ev.n).toBe(1);
      expect(notes.n).toBe(1);
    });

    it('concurrent crypto candle writes for the same series do not duplicate', async () => {
      const { storeCandles, Job } = await import('../src/modules/crypto/ingest.js');
      const rt = ctx.crypto!.rt;
      const a = await pgDb.one<{ asset_id: string }>(`INSERT INTO crypto.assets (canonical_key, name, symbol, metadata_source) VALUES ('pg-coin','PG Coin','PGC','coingecko') RETURNING asset_id`);
      const s = await pgDb.one<{ series_id: string }>(`INSERT INTO crypto.price_series (source_id, kind, asset_id, quote_currency, interval) VALUES ('coingecko','reference_close',$1,'USD','1d') RETURNING series_id`, [a.asset_id]);
      const candles = Array.from({ length: 30 }, (_, i) => ({ open_time: Date.UTC(2026, 0, 1 + i), open: null, high: null, low: null, close: 10 + i, volume: 1 }));
      const job = await pgDb.one<{ job_id: string }>(`INSERT INTO crypto.ingestion_jobs (source_id, job_type, status) VALUES ('coingecko','pg_test','running') RETURNING job_id`);
      await Promise.all([1, 2].map(() => storeCandles(rt, new Job(rt, job.job_id, 'coingecko'), s.series_id, candles, 'pg_test')));
      const n = await pgDb.one<{ n: number }>(`SELECT count(*)::int AS n FROM crypto.ohlcv WHERE series_id=$1`, [s.series_id]);
      expect(n.n).toBe(30);
    });
  });
});
