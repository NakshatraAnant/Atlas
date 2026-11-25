import { mkdirSync, readFileSync } from 'node:fs';
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
    return (await this.root.transaction(async (t) => fn(new PgliteDb(t as unknown as PGlite, this.root, true)))) as T;
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
    let broken = false;
    try {
      await client.query('BEGIN');
      const out = await fn(new PgDb(this.pool, client));
      await client.query('COMMIT');
      return out;
    } catch (err) {
      // A failed rollback means the connection is unusable: discard it and report the original error.
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw err;
    } finally {
      client.release(broken);
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
  /** Load a PGlite data-directory dump (tests). */
  loadDataDir?: Blob;
  /** PGlite only: don't wait for each write to reach disk (bulk loads; a crash can lose recent writes). */
  relaxedDurability?: boolean;
  /** TLS for databaseUrl; omitted uses whatever the connection string specifies. */
  ssl?: { mode: 'disable' | 'require' | 'verify-full'; caCertPath?: string };
}

function pgSsl(ssl: OpenDbOptions['ssl']): pg.PoolConfig['ssl'] {
  if (!ssl) return undefined;
  if (ssl.mode === 'disable') return false;
  if (ssl.mode === 'require') return { rejectUnauthorized: false };
  if (!ssl.caCertPath) throw new Error('DATABASE_SSL=verify-full needs DATABASE_CA_CERT');
  return { rejectUnauthorized: true, ca: readFileSync(ssl.caCertPath, 'utf8') };
}

export async function openDb(opts: OpenDbOptions): Promise<Db> {
  if (opts.databaseUrl) {
    const types = {
      getTypeParser: (oid: number, format?: 'text' | 'binary') => {
        if (oid === OID.int8 || oid === OID.numeric) return toNumber;
        if (oid === OID.date) return keepString;
        if (oid === OID.timestamptz || oid === OID.timestamp) return toIso;
        return pg.types.getTypeParser(oid, (format ?? 'text') as 'text');
      },
    };
    // An explicit ssl setting wins over sslmode in the URL (node-postgres would otherwise let the URL override it).
    const ssl = pgSsl(opts.ssl);
    const connectionString = ssl === undefined ? opts.databaseUrl : stripSslParams(opts.databaseUrl);
    const pool = new pg.Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10), types: types as pg.CustomTypesConfig, connectionTimeoutMillis: 10_000, ...(ssl === undefined ? {} : { ssl }) });
    // Without a listener, a dropped idle connection (restart, failover) is an uncaught exception that ends the process.
    pool.on('error', (err) => process.stderr.write(`${new Date().toISOString()} idle database connection lost: ${err.message}\n`));
    await pool.query('SELECT 1');
    return new PgDb(pool);
  }
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const lite = await PGlite.create({
    dataDir: opts.pgliteDir,
    loadDataDir: opts.loadDataDir,
    relaxedDurability: opts.relaxedDurability,
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

function stripSslParams(url: string): string {
  const u = new URL(url);
  for (const k of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) u.searchParams.delete(k);
  return u.toString();
}

/** Dump a PGlite database to a tarball (test fixtures). */
export async function dumpPglite(db: Db): Promise<Blob> {
  const inner = (db as unknown as { root: PGlite }).root;
  if (!inner || typeof inner.dumpDataDir !== 'function') throw new Error('dumpPglite requires a PGlite database');
  return (await inner.dumpDataDir('gzip')) as Blob;
}
