import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { isValidTimeZone, learnerSummary } from './learning.js';
import { visibleStatuses } from './service.js';

// Learner dashboard: XP, level, streaks, calendar, missions, achievements, next action. Always scoped to
// the signed-in user; there is no route that reads another learner's ledger.
export async function learningRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const statuses = visibleStatuses(ctx.cfg.academyShowDrafts);

  app.get('/v1/academy/me', async (req) => {
    const u = requireUser(req);
    return learnerSummary(ctx.db, u.userId, ctx.clock(), statuses);
  });

  app.put('/v1/academy/me/settings', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ timezone: z.string().min(1).max(64), weekly_goal_days: z.number().int().min(1).max(7) }), req.body);
    if (!isValidTimeZone(body.timezone)) throw badRequest('Unknown timezone. Use an IANA name such as Asia/Kolkata.');
    await ctx.db.query(
      `INSERT INTO acad.learner_settings (user_id, timezone, weekly_goal_days, updated_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET timezone=EXCLUDED.timezone, weekly_goal_days=EXCLUDED.weekly_goal_days, updated_at=EXCLUDED.updated_at`,
      [u.userId, body.timezone, body.weekly_goal_days, ctx.clock().toISOString()],
    );
    return { settings: body };
  });
}
