import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { isValidTimeZone, learnerSummary } from './learning.js';
import { currentCourses, visibleStatuses } from './service.js';

// Learner dashboard: XP, level, streaks, calendar, missions, achievements, next action. Always scoped to
// the signed-in user; there is no route that reads another learner's ledger.
export async function learningRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const statuses = visibleStatuses(ctx.cfg.academyShowDrafts);

  app.get('/v1/academy/me', async (req) => {
    const u = requireUser(req);
    return learnerSummary(ctx.db, u.userId, ctx.clock(), statuses);
  });

  // Knowledge constellation: every visible course with its lessons in order and this learner's real progress.
  // A lesson is "done" only when its completion is recorded; nothing is inferred.
  app.get('/v1/academy/constellation', async (req) => {
    const u = requireUser(req);
    const courses = await currentCourses(ctx.db, statuses);
    const lessons = await ctx.db.query<{ lesson_id: string; course_id: string; title: string; minutes: number; mpos: number; lpos: number; done: boolean; started: boolean }>(
      `SELECT x.lesson_id, x.course_id, x.title, x.minutes, x.mpos, x.lpos, (p.completed_at IS NOT NULL) AS done, (p.lesson_id IS NOT NULL) AS started FROM (
         SELECT DISTINCT ON (l.lesson_id) l.lesson_id, m.course_id, l.title, l.minutes, m.position AS mpos, l.position AS lpos
           FROM acad.lessons l JOIN acad.modules m USING (module_id) WHERE l.status = ANY($1) ORDER BY l.lesson_id, l.version DESC) x
         LEFT JOIN acad.lesson_progress p ON p.lesson_id=x.lesson_id AND p.user_id=$2
        ORDER BY x.course_id, x.mpos, x.lpos`, [statuses, u.userId]);
    return {
      courses: courses.map((c) => {
        const ls = lessons.filter((l) => l.course_id === c.course_id).map(({ course_id: _c, mpos: _m, lpos: _l, ...l }) => l);
        return { course_id: c.course_id, title: c.title.replace('ATLAS: ', ''), position: c.position, preceding: c.preceding_course_id, lessons: ls, completed: ls.filter((l) => l.done).length };
      }),
    };
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
