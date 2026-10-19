import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, conflict, notFound, parse } from '../../lib/http.js';
import { requireRole, requireUser } from '../auth/service.js';
import { audit } from '../ops/audit.js';
import { evaluateTune, GAME_BY_ID, GAMES, gradeClassify, publicGame } from './games.js';
import { currentCourses, visibleStatuses } from './service.js';

// Capstones, completion records and games. Every learner record is scoped to the session user;
// artefacts linked to a capstone must belong to that user. Completion records state exactly what
// was assessed and that they are not a qualification.

const ARTEFACT_TABLE: Record<string, string> = {
  note: `SELECT 1 FROM app.notes WHERE note_id=$1 AND user_id=$2 AND deleted_at IS NULL`,
  backtest: `SELECT 1 FROM bt.backtest_runs WHERE run_id=$1 AND user_id=$2 AND deleted_at IS NULL`,
  hypothesis: `SELECT 1 FROM app.hypotheses WHERE hypothesis_id=$1 AND user_id=$2 AND deleted_at IS NULL`,
  watchlist: `SELECT 1 FROM app.watchlists WHERE watchlist_id=$1 AND user_id=$2 AND deleted_at IS NULL`,
};
export const COMPLETION_RULES = { lessons_completed_pct: 100, objectives_mastered_pct: 80, capstone: 'submitted' } as const;

interface CapstoneRow { course_id: string; version: number; title: string; brief: string; deliverables: string[]; rubric: { criterion: string; levels: string[] }[]; artefact_kinds: string[]; status: string }

export async function academyExtraRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const statuses = visibleStatuses(ctx.cfg.academyShowDrafts);
  const courseParam = z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) });
  const capstone = (courseId: string) => db.maybeOne<CapstoneRow>(`SELECT course_id, version, title, brief, deliverables, rubric, artefact_kinds, status FROM acad.capstones WHERE course_id=$1 AND status = ANY($2) ORDER BY version DESC LIMIT 1`, [courseId, statuses]);

  // ───── Capstones ─────
  app.get('/v1/academy/courses/:id/capstone', async (req) => {
    const u = requireUser(req);
    const { id } = parse(courseParam, req.params);
    const c = await capstone(id);
    if (!c) throw notFound('This course has no capstone yet.');
    const submissions = await db.query(`SELECT submission_id, capstone_version, status, self_assessment, review, submitted_at, reviewed_at FROM acad.capstone_submissions WHERE user_id=$1 AND course_id=$2 ORDER BY submitted_at DESC`, [u.userId, id]);
    return { ...c, draft: c.status !== 'published', submissions };
  });

  app.post('/v1/academy/courses/:id/capstone', async (req) => {
    const u = requireUser(req);
    const { id } = parse(courseParam, req.params);
    const c = await capstone(id);
    if (!c) throw notFound('This course has no capstone yet.');
    const body = parse(z.object({
      body: z.string().trim().min(50).max(20_000),
      artefacts: z.array(z.object({ kind: z.enum(['note', 'backtest', 'hypothesis', 'watchlist']), id: z.string().uuid() })).max(10).default([]),
      self_assessment: z.record(z.number().int().min(0).max(3)),
    }), req.body);
    for (const r of c.rubric) if (!(r.criterion in body.self_assessment)) throw badRequest(`Rate yourself on "${r.criterion}".`);
    if (Object.keys(body.self_assessment).some((k) => !c.rubric.some((r) => r.criterion === k))) throw badRequest('Self-assessment includes an unknown criterion.');
    for (const a of body.artefacts) {
      if (!c.artefact_kinds.includes(a.kind)) throw badRequest(`This capstone does not take ${a.kind} artefacts.`);
      // Not found and not yours are indistinguishable (no information about other users).
      if (!(await db.maybeOne(ARTEFACT_TABLE[a.kind]!, [a.id, u.userId]))) throw notFound(`That ${a.kind} was not found in your account.`);
    }
    for (const kind of c.artefact_kinds) if (!body.artefacts.some((a) => a.kind === kind)) throw badRequest(`Link at least one ${kind} from your ATLAS account.`);
    const row = await db.one<{ submission_id: string }>(
      `INSERT INTO acad.capstone_submissions (user_id, course_id, capstone_version, body, artefacts, self_assessment, submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING submission_id`,
      [u.userId, id, c.version, body.body, JSON.stringify(body.artefacts), JSON.stringify(body.self_assessment), ctx.clock().toISOString()],
    );
    return { submission_id: row.submission_id, status: 'submitted', note: 'Self-assessed. A reviewer may add a marked review; completion requires a submission, not a particular score.' };
  });

  app.get('/admin/v1/academy/capstones', async (req) => {
    requireRole(req, ['admin']);
    return { submissions: await db.query(`SELECT submission_id, course_id, capstone_version, status, submitted_at, self_assessment FROM acad.capstone_submissions ORDER BY submitted_at DESC LIMIT 100`) };
  });
  app.post('/admin/v1/academy/capstones/:sid/review', async (req) => {
    const a = requireRole(req, ['admin']);
    const { sid } = parse(z.object({ sid: z.string().uuid() }), req.params);
    const body = parse(z.object({ scores: z.record(z.number().int().min(0).max(3)), comments: z.string().trim().min(10).max(5000), reviewer_name: z.string().trim().min(3).max(120) }), req.body);
    const s = await db.maybeOne<{ course_id: string; capstone_version: number; status: string }>(`SELECT course_id, capstone_version, status FROM acad.capstone_submissions WHERE submission_id=$1`, [sid]);
    if (!s) throw notFound();
    const c = await db.one<CapstoneRow>(`SELECT rubric FROM acad.capstones WHERE course_id=$1 AND version=$2`, [s.course_id, s.capstone_version]);
    for (const r of c.rubric) if (!(r.criterion in body.scores)) throw badRequest(`Score "${r.criterion}".`);
    await db.query(`UPDATE acad.capstone_submissions SET status='reviewed', review=$2, reviewer_user_id=$3, reviewed_at=$4 WHERE submission_id=$1`, [sid, JSON.stringify({ scores: body.scores, comments: body.comments, reviewer_name: body.reviewer_name }), a.userId, ctx.clock().toISOString()]);
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'academy.capstone.review', targetType: 'capstone_submission', targetId: sid });
    return { status: 'reviewed' };
  });

  // ───── Completion records ─────
  const eligibility = async (userId: string, courseId: string) => {
    const lessons = await db.query<{ lesson_id: string }>(`SELECT DISTINCT l.lesson_id FROM acad.lessons l JOIN acad.modules m USING (module_id) WHERE m.course_id=$1 AND l.status = ANY($2)`, [courseId, statuses]);
    const done = await db.query<{ lesson_id: string }>(`SELECT lesson_id FROM acad.lesson_progress WHERE user_id=$1 AND completed_at IS NOT NULL AND lesson_id = ANY($2)`, [userId, lessons.map((l) => l.lesson_id)]);
    const objectives = await db.query<{ objective_id: string; statement: string; state: string | null; estimate: number | null; evidence_count: number | null }>(
      `SELECT o.objective_id, o.statement, m.state, m.estimate, m.evidence_count FROM acad.objectives o LEFT JOIN acad.objective_mastery m ON m.objective_id=o.objective_id AND m.user_id=$1 WHERE o.course_id=$2 ORDER BY o.position`,
      [userId, courseId],
    );
    const sub = await db.maybeOne<{ submission_id: string; status: string; capstone_version: number; review: unknown }>(`SELECT submission_id, status, capstone_version, review FROM acad.capstone_submissions WHERE user_id=$1 AND course_id=$2 ORDER BY submitted_at DESC LIMIT 1`, [userId, courseId]);
    const mastered = objectives.filter((o) => o.state === 'mastered').length;
    const lessonsPct = lessons.length ? (done.length / lessons.length) * 100 : 0;
    const masteredPct = objectives.length ? (mastered / objectives.length) * 100 : 0;
    const missing: string[] = [];
    if (lessonsPct < COMPLETION_RULES.lessons_completed_pct) missing.push(`Complete all lessons (${done.length} of ${lessons.length} done).`);
    if (masteredPct < COMPLETION_RULES.objectives_mastered_pct) missing.push(`Demonstrate mastery of at least ${COMPLETION_RULES.objectives_mastered_pct}% of objectives (${mastered} of ${objectives.length} so far).`);
    if (!sub) missing.push('Submit the capstone.');
    return { lessons: lessons.length, lessons_completed: done.length, objectives, mastered, capstone: sub ?? null, eligible: missing.length === 0, missing, rules: COMPLETION_RULES };
  };

  app.get('/v1/academy/courses/:id/completion', async (req) => {
    const u = requireUser(req);
    const { id } = parse(courseParam, req.params);
    const record = await db.maybeOne(`SELECT record_id, issued_at, assessed, statement FROM acad.completion_records WHERE user_id=$1 AND course_id=$2`, [u.userId, id]);
    return { record: record ?? null, ...(await eligibility(u.userId, id)) };
  });

  app.post('/v1/academy/courses/:id/completion', async (req) => {
    const u = requireUser(req);
    const { id } = parse(courseParam, req.params);
    const course = (await currentCourses(db, statuses)).find((c) => c.course_id === id);
    if (!course) throw notFound();
    const existing = await db.maybeOne(`SELECT record_id, issued_at, assessed, statement FROM acad.completion_records WHERE user_id=$1 AND course_id=$2`, [u.userId, id]);
    if (existing) return { record: existing, already: true };
    const e = await eligibility(u.userId, id);
    if (!e.eligible) throw conflict(`Not yet complete: ${e.missing.join(' ')}`);
    const assessed = {
      course: course.title, course_version: course.version, content_status: course.status === 'published' ? 'expert-reviewed' : 'draft (pending expert review)',
      lessons_completed: `${e.lessons_completed} of ${e.lessons}`,
      objectives: e.objectives.map((o) => ({ objective: o.statement, demonstrated: o.state === 'mastered', estimate: o.estimate, graded_answers: o.evidence_count ?? 0 })),
      capstone: { status: e.capstone!.status, assessment: e.capstone!.status === 'reviewed' ? 'reviewed by an ATLAS reviewer' : 'self-assessed against the published rubric' },
      rules: COMPLETION_RULES,
    };
    const row = await db.one(
      `INSERT INTO acad.completion_records (user_id, course_id, course_version, assessed, statement, issued_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING record_id, issued_at, assessed, statement`,
      [u.userId, id, course.version, JSON.stringify(assessed), course.completion_statement, ctx.clock().toISOString()],
    );
    await db.query(`UPDATE acad.enrolments SET completed_at=$3 WHERE user_id=$1 AND course_id=$2 AND completed_at IS NULL`, [u.userId, id, ctx.clock().toISOString()]);
    return { record: row, already: false };
  });

  // ───── Games ─────
  app.get('/v1/academy/games', async (req) => {
    const scores = req.user ? await db.query<{ game_id: string; correct: number; total: number; played_at: string }>(`SELECT DISTINCT ON (game_id) game_id, correct, total, played_at FROM acad.game_scores WHERE user_id=$1 ORDER BY game_id, played_at DESC`, [req.user.userId]) : [];
    return { games: GAMES.map((g) => ({ id: g.id, title: g.title, course_id: g.course_id, objective_id: g.objective_id, mechanic: g.mechanic, intro: g.intro, last: scores.find((s) => s.game_id === g.id) ?? null })), note: 'Practice games are scored on correctness only. Scores do not count towards mastery or completion.' };
  });
  app.get('/v1/academy/games/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const g = GAME_BY_ID.get(id);
    if (!g) throw notFound();
    return publicGame(g);
  });
  app.post('/v1/academy/games/:id/evaluate', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const g = GAME_BY_ID.get(id);
    if (!g || g.mechanic !== 'tune') throw notFound();
    const body = parse(z.object({ round: z.number().int().min(0), params: z.record(z.number().finite()) }), req.body);
    const r = g.rounds[body.round];
    if (!r) throw badRequest('Unknown round.');
    return evaluateTune(g.id, r.fixed, clampParams(r.params, body.params));
  });
  app.post('/v1/academy/games/:id/play', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const g = GAME_BY_ID.get(id);
    if (!g) throw notFound();
    let correct: number;
    let total: number;
    let details: unknown;
    if (g.mechanic === 'classify') {
      const { answers } = parse(z.object({ answers: z.array(z.number().int().min(0).max(20)).length(g.items.length) }), req.body);
      const r = gradeClassify(g, answers);
      ({ correct, total } = r);
      details = r.outcomes;
    } else {
      const { rounds } = parse(z.object({ rounds: z.array(z.record(z.number().finite())).length(g.rounds.length) }), req.body);
      const outcomes = g.rounds.map((r, i) => evaluateTune(g.id, r.fixed, clampParams(r.params, rounds[i]!)));
      correct = outcomes.filter((o) => o.ok).length;
      total = outcomes.length;
      details = outcomes;
    }
    await db.query(`INSERT INTO acad.game_scores (user_id, game_id, game_version, correct, total, details, played_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [u.userId, g.id, g.version, correct, total, JSON.stringify(details), ctx.clock().toISOString()]);
    return { correct, total, outcomes: details };
  });
}

/** Missing params fall back to defaults; values are clamped to the published ranges. */
function clampParams(spec: { key: string; min: number; max: number; default: number }[], input: Record<string, number>): Record<string, number> {
  return Object.fromEntries(spec.map((p) => [p.key, Math.min(p.max, Math.max(p.min, input[p.key] ?? p.default))]));
}
