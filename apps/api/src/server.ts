import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { createContext, startBackgroundJobs } from './bootstrap.js';
import { startResearchJobs } from './modules/research/jobs.js';

const ctx = await createContext();
const app = await buildApp(ctx);
const stopJobs = process.env.ATLAS_BACKGROUND_JOBS === 'false' ? () => undefined : startBackgroundJobs(ctx);
// Crypto ingestion and the live feed have their own scheduler so a long backfill never blocks backtests.
const stopResearch = process.env.ATLAS_BACKGROUND_JOBS === 'false' ? () => undefined : startResearchJobs(ctx);
const stopCrypto = process.env.ATLAS_BACKGROUND_JOBS === 'false' || !ctx.crypto ? () => undefined : ctx.crypto.start();
await app.listen({ port: ctx.cfg.API_PORT, host: '127.0.0.1' });
ctx.log.info('ATLAS API listening', { port: ctx.cfg.API_PORT, synthetic: ctx.cfg.allowSyntheticData, ai: ctx.ai.provider, payments: ctx.payments.name });

let stopping = false;
const shutdown = async (reason: string) => {
  if (stopping) return;
  stopping = true;
  ctx.log.info('ATLAS API shutting down', { reason });
  stopJobs();
  stopCrypto();
  stopResearch();
  await app.close();
  // Closing the database flushes the embedded PGlite store to disk; a hard kill can lose recent writes.
  await ctx.db.close();
  ctx.log.info('ATLAS API stopped cleanly');
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// A failed promise somewhere in a background job is logged, not fatal; an uncaught exception is logged
// with its stack and the process exits so the launcher's supervisor can restart it cleanly.
process.on('unhandledRejection', (reason) => {
  ctx.log.error('unhandled promise rejection', { error: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}`.slice(0, 2000) : String(reason).slice(0, 500) });
});
process.on('uncaughtException', (err) => {
  ctx.log.error('uncaught exception: exiting', { error: `${err.message}\n${err.stack ?? ''}`.slice(0, 2000) });
  void ctx.db.close().finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 3000).unref();
});
process.on('exit', (code) => {
  if (!stopping) process.stderr.write(`${new Date().toISOString()} ATLAS API exiting unexpectedly with code ${code}\n`);
});

// Local hosting (scripts/atlas.mjs) asks for a graceful stop by creating a file, because Windows
// cannot deliver SIGTERM to a detached process. This adds no network surface.
const runDir = process.env.ATLAS_RUN_DIR;
if (runDir) {
  const stopFile = join(runDir, 'api.stop');
  setInterval(() => {
    if (existsSync(stopFile)) {
      rmSync(stopFile, { force: true });
      void shutdown('stop file');
    }
  }, 500).unref();
}
