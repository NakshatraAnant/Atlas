// Prints the calculation fingerprint (apps/api/src/db/calc-fingerprint.sql) of a PGlite directory,
// to prove two pipeline runs produced identical results. Usage: npx tsx scripts/calc-fingerprint.mts <pglite-dir>
import { readFileSync } from 'node:fs';
import { openDb } from '../apps/api/src/db/db.js';
const dir = process.argv[2];
if (!dir) throw new Error('Pass a PGlite data directory');
const db = await openDb({ pgliteDir: dir });
const sql = readFileSync(new URL('../apps/api/src/db/calc-fingerprint.sql', import.meta.url), 'utf8');
console.log(JSON.stringify(await db.one(sql)));
await db.close();
