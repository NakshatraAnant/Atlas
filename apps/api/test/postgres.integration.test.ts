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
});
