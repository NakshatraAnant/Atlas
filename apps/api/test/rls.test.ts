import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';

// Database-level deny-by-default (ADR-012, migration 004). The API enforces authorisation;
// these tests prove the database refuses any other role even if a grant slips in later.

const ATLAS_SCHEMAS = ['ref', 'market', 'fund', 'disc', 'calc', 'bt', 'ai', 'app', 'ops', 'acad'];

describe('row-level security (deny by default)', () => {
  let db: Db;
  beforeAll(async () => {
    db = await openDb({});
    await migrate(db);
  });
  afterAll(async () => db.close());

  it('enables RLS on every ATLAS table, including tables added by later migrations', async () => {
    const rows = await db.query<{ table_name: string; rls: boolean }>(
      `SELECT n.nspname || '.' || c.relname AS table_name, c.relrowsecurity AS rls
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY ($1)`,
      [ATLAS_SCHEMAS],
    );
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.filter((r) => !r.rls).map((r) => r.table_name)).toEqual([]);
  });

  it('defines no permissive policy, so non-owner roles get nothing', async () => {
    const policies = await db.query(`SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = ANY ($1)`, [ATLAS_SCHEMAS]);
    expect(policies).toEqual([]);
  });

  it('a non-owner role with an explicit SELECT grant still reads zero rows and cannot write', async () => {
    await db.exec(`INSERT INTO app.users (email, password_hash) VALUES ('owner-only@example.test', 'x')`);
    await db.exec(`DROP ROLE IF EXISTS atlas_probe; CREATE ROLE atlas_probe NOLOGIN;
      GRANT USAGE ON SCHEMA app TO atlas_probe; GRANT SELECT, INSERT, UPDATE, DELETE ON app.users TO atlas_probe;`);
    const asProbe = async <T>(sql: string) =>
      db.tx(async (t) => {
        await t.exec('SET LOCAL ROLE atlas_probe');
        return t.query<T>(sql);
      });
    const visible = await asProbe<{ n: number }>(`SELECT count(*)::int AS n FROM app.users`);
    expect(visible).toEqual([{ n: 0 }]);
    // Without a policy, UPDATE/DELETE silently match no rows and INSERT is rejected.
    await asProbe(`UPDATE app.users SET role = 'admin'`);
    await asProbe(`DELETE FROM app.users`);
    await expect(asProbe(`INSERT INTO app.users (email, password_hash, role) VALUES ('evil@example.test', 'x', 'admin')`)).rejects.toThrow(/row-level security/);
    const owner = await db.query<{ role: string }>(`SELECT role FROM app.users WHERE email = 'owner-only@example.test'`);
    expect(owner).toEqual([{ role: 'user' }]);
  });
});
