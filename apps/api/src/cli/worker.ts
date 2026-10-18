import { createContext, startBackgroundJobs } from '../bootstrap.js';

// Standalone worker for multi-instance deployments: runs the scheduler and queues without the HTTP server.
const ctx = await createContext();
const stop = startBackgroundJobs(ctx);
ctx.log.info('ATLAS worker started');
process.on('SIGTERM', async () => { stop(); await ctx.db.close(); process.exit(0); });
