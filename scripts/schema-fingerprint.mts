// Prints the schema fingerprint of a freshly migrated local database (compare with hosted Supabase).
import { readFileSync } from 'node:fs';
import { openDb } from '../apps/api/src/db/db.js';
import { migrate } from '../apps/api/src/db/migrate.js';
const db = await openDb({ databaseUrl: process.env.DATABASE_URL || undefined });
if (db.kind === 'pglite') await migrate(db);
const sql = readFileSync(new URL('../apps/api/src/db/fingerprint.sql', import.meta.url), 'utf8');
console.log(JSON.stringify(await db.query(sql)));
await db.close();
