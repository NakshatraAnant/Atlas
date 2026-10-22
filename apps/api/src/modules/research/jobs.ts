import type { AppContext } from '../../context.js';
import { equityKeys, refreshEquities } from '../equity/routes.js';
import { evaluateAlerts } from './objectRoutes.js';

// Background jobs for research: alert evaluation (every 5 minutes) and the incremental refresh of
// imported Indian equities (every 6 hours, only for providers whose key is configured). Each job has
// its own guard so a slow provider never blocks alert evaluation, and failures are logged, not hidden.
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
  const refresh = guard('equity_refresh', () => refreshEquities(ctx.db, ctx.equityFetch, equityKeys(ctx), ctx.clock()));
  timers.push(setTimeout(() => void refresh(), 60_000));
  timers.push(setInterval(refresh, 6 * 3_600_000));
  return () => timers.forEach((t) => clearInterval(t));
}
