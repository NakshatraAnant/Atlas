import type { AppContext } from '../../context.js';
import { refreshCommodities } from '../commodity/ingest.js';
import { commodityKeys } from '../commodity/routes.js';
import { scheduledEquityRefresh } from '../equity/routes.js';
import { evaluateAlerts } from './objectRoutes.js';

// Background jobs for research: alert evaluation (every 5 minutes) and the refresh of the tracked Indian
// equity universe (checked every 10 minutes; runs once per IST slot, only with a configured key, within
// the persistent daily quota). Each job has its own guard so a slow provider never blocks alert
// evaluation, and failures are logged, not hidden.
export function startResearchJobs(ctx: AppContext): () => void {
  const timers: NodeJS.Timeout[] = [];
  const guard = (name: string, fn: () => Promise<unknown>) => {
    let busy = false;
    return async () => {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } catch (err) {
        ctx.log.error('research job failed', { job: name, error: err instanceof Error ? err.message : String(err) });
      } finally {
        busy = false;
      }
    };
  };
  timers.push(setInterval(guard('alerts', () => evaluateAlerts(ctx.db, ctx.clock())), 5 * 60_000));
  const refresh = guard('equity_refresh', () => scheduledEquityRefresh(ctx));
  timers.push(setTimeout(() => void refresh(), 60_000));
  timers.push(setInterval(refresh, 10 * 60_000));
  // Commodities: each series at most once per 20 hours (FRED publishes daily); checked every 3 hours.
  if (ctx.cfg.commodityRefresh) {
    const commodities = guard('commodity_refresh', () => refreshCommodities(ctx.db, ctx.equityFetch, commodityKeys(ctx), ctx.clock(), { pauseMs: 1000 }));
    timers.push(setTimeout(() => void commodities(), 90_000));
    timers.push(setInterval(commodities, 3 * 3_600_000));
  }
  return () => timers.forEach((t) => clearInterval(t));
}
