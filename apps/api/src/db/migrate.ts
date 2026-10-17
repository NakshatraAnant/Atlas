import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

// Versioned, checksummed, forward-only migrations. An applied migration whose file has
// changed is a hard error: history is never rewritten (expand → migrate → contract).

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  await db.exec(`CREATE SCHEMA IF NOT EXISTS ops;
    CREATE TABLE IF NOT EXISTS ops.schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied = new Map((await db.query<{ version: string; checksum: string }>('SELECT version, checksum FROM ops.schema_migrations')).map((r) => [r.version, r.checksum]));
  const result: MigrationResult = { applied: [], alreadyApplied: [] };
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = applied.get(file);
    if (prior) {
      if (prior !== checksum) throw new Error(`Migration ${file} was modified after being applied (checksum mismatch)`);
      result.alreadyApplied.push(file);
      continue;
    }
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO ops.schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
    });
    result.applied.push(file);
  }
  return result;
}
