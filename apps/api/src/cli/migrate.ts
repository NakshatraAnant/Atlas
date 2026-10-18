import { loadConfig } from '../config.js';
import { openDb } from '../db/db.js';
import { migrate } from '../db/migrate.js';

const cfg = loadConfig();
const db = await openDb({ databaseUrl: cfg.DATABASE_URL || undefined, pgliteDir: cfg.PGLITE_DIR });
console.log(JSON.stringify(await migrate(db)));
await db.close();
