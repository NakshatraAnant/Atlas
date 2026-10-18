import { createContext } from '../bootstrap.js';
import { DEV_USERS, seedAll } from '../seed.js';

const t = Date.now();
const ctx = await createContext();
const r = await seedAll(ctx, { dailyDays: Number(process.env.SEED_DAILY_DAYS ?? 3) });
console.log(`Seeded ATLAS development data as of ${r.asOf} in ${Math.round((Date.now() - t) / 1000)} s.`);
console.log(`Development accounts: ${DEV_USERS.map((u) => u.email).join(', ')} (password and admin TOTP secret are in apps/api/src/seed.ts).`);
await ctx.db.close();
