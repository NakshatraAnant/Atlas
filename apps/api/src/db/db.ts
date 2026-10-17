import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import pg from 'pg';

// One database interface over two drivers: PGlite (PostgreSQL 16 compiled to WASM, used for
// local development and tests) and node-postgres against managed PostgreSQL in production.
// Type parsing is normalised so both drivers return identical JS values:
//   numeric/int8 -> number, date -> 'YYYY-MM-DD', timestamptz -> ISO-8601 string.

export interface Db {
  readonly kind: 'pglite' | 'pg';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
  maybeOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const OID = { int8: 20, numeric: 1700, date: 1082, timestamptz: 1184, timestamp: 1114 } as const;
const toNumber = (v: string) => (v === null ? null : Number(v));
const toIso = (v: string) => (v === null ? null : new Date(v.includes('T') || v.includes('+') ? v : `${v}Z`).toISOString());
const keepString = (v: string) => v;

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
  }
}

function wrapRows<T>(rows: T[], sql: string, mode: 'one' | 'maybe'): T | undefined {
  if (rows.length > 1) throw new Error(`Expected at most one row, got ${rows.length}: ${sql.slice(0, 80)}`);
  if (mode === 'one' && rows.length === 0) throw new NotFoundError();
  return rows[0];
}

class PgliteDb implements Db {
  readonly kind = 'pglite' as const;
  constructor(private readonly handle: PGlite | { query: PGlite['query']; exec: PGlite['exec'] }, private readonly root: PGlite, private readonly inTx = false) {}
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.handle.query<T>(sql, params);
    return r.rows;
  }
  async one<T>(sql: string, params: unknown[] = []): Promise<T> {
    return wrapRows(await this.query<T>(sql, params), sql, 'one') as T;
  }
  async maybeOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return wrapRows(await this.query<T>(sql, params), sql, 'maybe');
  }
  async exec(sql: string): Promise<void> {
    await this.handle.exec(sql);
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    return this.root.transaction(async (t) => fn(new PgliteDb(t as unknown as PGlite, this.root, true)));
  }
  async close(): Promise<void> {
    if (!this.inTx) await this.root.close();
  }
}

class PgDb implements Db {
  readonly kind = 'pg' as const;
  constructor(private readonly pool: pg.Pool, private readonly client?: pg.PoolClient) {}
  private get runner(): pg.Pool | pg.PoolClient {
    return this.client ?? this.pool;
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.runner.query(sql, params as unknown[]);
    return r.rows as T[];
  }
  async one<T>(sql: string, params: unknown[] = []): Promise<T> {
    return wrapRows(await this.query<T>(sql, params), sql, 'one') as T;
  }
  async maybeOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return wrapRows(await this.query<T>(sql, params), sql, 'maybe');
  }
  async exec(sql: string): Promise<void> {
    await this.runner.query(sql);
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (this.client) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(new PgDb(this.pool, client));
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    if (!this.client) await this.pool.end();
  }
}

export interface OpenDbOptions {
  databaseUrl?: string;
  /** Directory for persistent PGlite data; omit for in-memory. */
  pgliteDir?: string;
}

export async function openDb(opts: OpenDbOptions): Promise<Db> {
  if (opts.databaseUrl) {
    const types = {
      getTypeParser: (oid: number, format?: 'text' | 'binary') => {
        if (oid === OID.int8 || oid === OID.numeric) return toNumber;
        if (oid === OID.date) return keepString;
        if (oid === OID.timestamptz || oid === OID.timestamp) return toIso;
        return pg.types.getTypeParser(oid, format);
      },
    };
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10, types: types as pg.CustomTypesConfig });
    await pool.query('SELECT 1');
    return new PgDb(pool);
  }
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const lite = await PGlite.create({
    dataDir: opts.pgliteDir,
    extensions: { pg_trgm },
    parsers: {
      [OID.int8]: toNumber,
      [OID.numeric]: toNumber,
      [OID.date]: keepString,
      [OID.timestamptz]: toIso,
      [OID.timestamp]: toIso,
    },
  });
  return new PgliteDb(lite, lite);
}
