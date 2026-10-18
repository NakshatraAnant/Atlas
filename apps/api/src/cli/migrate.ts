import { dbOptions, loadConfig } from '../config.js';
import { openDb } from '../db/db.js';
import { migrate } from '../db/migrate.js';

const cfg = loadConfig();
const db = await openDb(dbOptions(cfg));
console.log(JSON.stringify(await migrate(db)));
await db.close();
