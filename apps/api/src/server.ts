import { buildApp } from './app.js';
import { createContext, startBackgroundJobs } from './bootstrap.js';

const ctx = await createContext();
const app = await buildApp(ctx);
const stopJobs = process.env.ATLAS_BACKGROUND_JOBS === 'false' ? () => undefined : startBackgroundJobs(ctx);
await app.listen({ port: ctx.cfg.API_PORT, host: '127.0.0.1' });
ctx.log.info('ATLAS API listening', { port: ctx.cfg.API_PORT, synthetic: ctx.cfg.allowSyntheticData, ai: ctx.ai.provider, payments: ctx.payments.name });

const shutdown = async () => {
  stopJobs();
  await app.close();
  await ctx.db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
