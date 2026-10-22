import { createReadStream, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, conflict, notFound, parse, tooMany, unavailable } from '../../lib/http.js';
import { track } from '../analytics/events.js';
import { requireRole, requireUser } from '../auth/service.js';
import { audit } from '../ops/audit.js';
import {
  ACADEMY_ENGINE_VERSION, attemptsRemaining, isCorrect, nextReview, publicQuestion, REVIEW_DAILY_CAP, scoreDiagnostic, seedFrom, selectDiagnostic, updateMastery,
  type BankQuestion, type MasteryState, type ReadinessRules, type Response,
} from './engine.js';
import { courseTrack } from './curriculum.js';
import { currentCourses, diagnosticBank, lessonQuiz, questionsByRefs, visibleStatuses, type CourseVersionRow } from './service.js';
import { loadVideos, parseRange, VIDEO_FILES, videoPath, type VideoFile } from './videos.js';

// ATLAS Academy API. Authorisation: every learner record is read and written with the session
// user's id in the WHERE clause, so another user's attempt id returns 404 (tested). Correct
// answers and explanations are only returned after a submission.

const DIAGNOSTIC_MINUTES = 30;
const responseSchema = z.union([
  z.object({ index: z.number().int().min(0).max(20) }).strict(),
  z.object({ indexes: z.array(z.number().int().min(0).max(20)).max(20) }).strict(),
  z.object({ value: z.number().finite() }).strict(),
  z.null(),
]);
const answerSchema = z.object({ question_id: z.string().max(40), version: z.number().int().positive(), response: responseSchema });
const courseParam = z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) });
const REVIEW_CHECKS = ['factual', 'calculation', 'pedagogy', 'accessibility', 'rights', 'alignment', 'technical'] as const;

interface LessonRow {
  lesson_id: string;
  version: number;
  module_id: string;
  position: number;
  title: string;
  minutes: number;
  objective_ids: string[];
  prerequisite_lesson_ids: string[];
  blocks: unknown[];
  references_list: unknown[];
  mastery_rule: string;
  status: string;
  course_id: string;
}

/** Statuses a course can be listed with (retired versions are never listed). */
const LISTED_STATUSES = ['draft', 'in_review', 'published'];

export async function academyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const statuses = visibleStatuses(ctx.cfg.academyShowDrafts);
  const isDraft = (status: string) => status !== 'published';
  const videos = loadVideos();

  const course = async (id: string): Promise<CourseVersionRow> => {
    const c = (await currentCourses(db, statuses)).find((x) => x.course_id === id);
    if (!c) throw notFound('No such course.');
    return c;
  };
  const latestLesson = async (lessonId: string): Promise<LessonRow | undefined> =>
    db.maybeOne<LessonRow>(
      `SELECT l.lesson_id, l.version, l.module_id, l.position, l.title, l.minutes, l.objective_ids, l.prerequisite_lesson_ids, l.blocks, l.references_list, l.mastery_rule, l.status, m.course_id
         FROM acad.lessons l JOIN acad.modules m USING (module_id)
        WHERE l.lesson_id=$1 AND l.status = ANY($2) ORDER BY l.version DESC LIMIT 1`,
      [lessonId, statuses],
    );

  // ───── Catalogue ─────
  // Every current course is always listed so learners can find the Academy even before content is
  // published. Whether its lessons can be opened is decided here, on the server (available).
  app.get('/v1/academy/courses', async (req) => {
    const courses = await currentCourses(db, LISTED_STATUSES);
    const counts = await db.query<{ course_id: string; modules: number; lessons: number }>(
      `SELECT m.course_id, count(DISTINCT m.module_id)::int AS modules, count(DISTINCT l.lesson_id) FILTER (WHERE l.status = ANY($1))::int AS lessons
         FROM acad.modules m LEFT JOIN acad.lessons l USING (module_id) GROUP BY m.course_id`,
      [statuses],
    );
    const minutes = await db.query<{ course_id: string; minutes: number }>(
      `SELECT course_id, coalesce(sum(minutes), 0)::int AS minutes FROM (
         SELECT DISTINCT ON (l.lesson_id) m.course_id, l.minutes FROM acad.lessons l JOIN acad.modules m USING (module_id)
          WHERE l.status = ANY($1) ORDER BY l.lesson_id, l.version DESC) x GROUP BY course_id`,
      [statuses],
    );
    const enrolments = req.user ? await db.query<{ course_id: string; entry_route: string; enrolled_at: string }>(`SELECT course_id, entry_route, enrolled_at FROM acad.enrolments WHERE user_id=$1`, [req.user.userId]) : [];
    const lastDiag = req.user
      ? await db.query<{ course_id: string; readiness: string | null; submitted_at: string | null }>(`SELECT DISTINCT ON (course_id) course_id, readiness, submitted_at FROM acad.diagnostic_attempts WHERE user_id=$1 AND submitted_at IS NOT NULL ORDER BY course_id, submitted_at DESC`, [req.user.userId])
      : [];
    return {
      courses: courses.map((c) => ({
        course_id: c.course_id, version: c.version, title: c.title, tagline: c.tagline, description: c.description, audience: c.audience, position: c.position, ...courseTrack(c.course_id),
        draft: isDraft(c.status), status: c.status, available: statuses.includes(c.status),
        modules: counts.find((x) => x.course_id === c.course_id)?.modules ?? 0,
        lessons: statuses.includes(c.status) ? (counts.find((x) => x.course_id === c.course_id)?.lessons ?? 0) : 0,
        minutes: statuses.includes(c.status) ? (minutes.find((x) => x.course_id === c.course_id)?.minutes ?? 0) : 0,
        enrolment: enrolments.find((e) => e.course_id === c.course_id) ?? null,
        last_diagnostic: lastDiag.find((d) => d.course_id === c.course_id) ?? null,
      })),
      not_a_qualification: 'Academy courses are education, not a professional qualification or investment advice.',
      preview_mode: ctx.cfg.academyShowDrafts,
      review_note: ctx.cfg.academyShowDrafts
        ? 'Preview mode: this local environment shows content that is still in expert review. It is labelled draft and is not expert-approved.'
        : 'Courses open once their lessons pass the seven-point expert review. Until then they are listed here but cannot be started.',
    };
  });

  app.get('/v1/academy/courses/:id', async (req) => {
    const { id } = parse(courseParam, req.params);
    const listed = (await currentCourses(db, LISTED_STATUSES)).find((x) => x.course_id === id);
    if (!listed) throw notFound('No such course.');
    if (!statuses.includes(listed.status)) {
      const outline = await db.query<{ module_id: string; position: number; title: string; summary: string }>(`SELECT module_id, position, title, summary FROM acad.modules WHERE course_id=$1 ORDER BY position`, [id]);
      return {
        course_id: listed.course_id, version: listed.version, title: listed.title, tagline: listed.tagline, description: listed.description, audience: listed.audience, prerequisites: listed.prerequisites,
        completion_statement: listed.completion_statement, draft: true, status: listed.status, available: false,
        unavailable_reason: 'This course is in expert review. Its lessons open once they pass the seven-point review.',
        modules: outline.map((m) => ({ ...m, lessons: [] })), objectives: [], learner: null, preceding_course: null,
        diagnostic: { questions: listed.readiness_rules.questions, minutes: DIAGNOSTIC_MINUTES, max_attempts_per_week: listed.readiness_rules.max_attempts_per_week, rules: listed.readiness_rules },
      };
    }
    const c = await course(id);
    const modules = await db.query<{ module_id: string; position: number; title: string; summary: string }>(`SELECT module_id, position, title, summary FROM acad.modules WHERE course_id=$1 ORDER BY position`, [id]);
    const lessons = await db.query<{ lesson_id: string; module_id: string; position: number; title: string; minutes: number; status: string; objective_ids: string[] }>(
      `SELECT DISTINCT ON (l.lesson_id) l.lesson_id, l.module_id, l.position, l.title, l.minutes, l.status, l.objective_ids
         FROM acad.lessons l JOIN acad.modules m USING (module_id) WHERE m.course_id=$1 AND l.status = ANY($2) ORDER BY l.lesson_id, l.version DESC`,
      [id, statuses],
    );
    const objectives = await db.query<{ objective_id: string; statement: string; skill: string }>(`SELECT objective_id, statement, skill FROM acad.objectives WHERE course_id=$1 ORDER BY position`, [id]);
    const preceding = c.preceding_course_id ? (await currentCourses(db, statuses)).find((x) => x.course_id === c.preceding_course_id) : undefined;
    let learner = null;
    if (req.user) {
      const uid = req.user.userId;
      const progress = await db.query<{ lesson_id: string; completed_at: string | null; last_block: number }>(`SELECT lesson_id, completed_at, last_block FROM acad.lesson_progress WHERE user_id=$1`, [uid]);
      const mastery = await db.query<{ objective_id: string; state: string; estimate: number; evidence_count: number }>(`SELECT objective_id, state, estimate, evidence_count FROM acad.objective_mastery WHERE user_id=$1`, [uid]);
      const enrolment = await db.maybeOne(`SELECT entry_route, enrolled_at, completed_at, diagnostic_attempt_id FROM acad.enrolments WHERE user_id=$1 AND course_id=$2`, [uid, id]);
      const attempts = await db.query<{ attempt_id: string; started_at: string; submitted_at: string | null; readiness: string | null }>(`SELECT attempt_id, started_at, submitted_at, readiness FROM acad.diagnostic_attempts WHERE user_id=$1 AND course_id=$2 ORDER BY started_at DESC LIMIT 10`, [uid, id]);
      const remaining = attemptsRemaining(attempts.map((a) => new Date(a.started_at)), ctx.clock(), c.readiness_rules);
      learner = { enrolment, attempts, diagnostic: remaining, progress: progress.filter((p) => lessons.some((l) => l.lesson_id === p.lesson_id)), mastery: mastery.filter((m) => objectives.some((o) => o.objective_id === m.objective_id)) };
    }
    return {
      course_id: c.course_id, version: c.version, title: c.title, tagline: c.tagline, description: c.description, audience: c.audience, prerequisites: c.prerequisites,
      completion_statement: c.completion_statement, draft: isDraft(c.status), status: c.status, available: true,
      preceding_course: preceding ? { course_id: preceding.course_id, title: preceding.title } : null,
      diagnostic: { questions: c.readiness_rules.questions, minutes: DIAGNOSTIC_MINUTES, max_attempts_per_week: c.readiness_rules.max_attempts_per_week, rules: c.readiness_rules },
      objectives,
      modules: modules.map((m) => ({ ...m, lessons: lessons.filter((l) => l.module_id === m.module_id).sort((a, b) => a.position - b.position).map((l) => ({ ...l, draft: isDraft(l.status) })) })),
      learner,
    };
  });

  // ───── Placement diagnostic ─────
  app.post('/v1/academy/courses/:id/diagnostic', async (req) => {
    const u = requireUser(req);
    const { id } = parse(courseParam, req.params);
    const c = await course(id);
    const now = ctx.clock();
    const open = await db.maybeOne<{ attempt_id: string; question_refs: { question_id: string; version: number }[]; expires_at: string }>(
      `SELECT attempt_id, question_refs, expires_at FROM acad.diagnostic_attempts WHERE user_id=$1 AND course_id=$2 AND submitted_at IS NULL AND expires_at > $3 ORDER BY started_at DESC LIMIT 1`,
      [u.userId, id, now.toISOString()],
    );
    if (open) {
      // Resume rather than re-draw: re-drawing would let a learner fish for easier questions.
      const qs = await questionsByRefs(db, open.question_refs);
      return { attempt_id: open.attempt_id, expires_at: open.expires_at, resumed: true, questions: qs.map(publicQuestion), caveat: scoreCaveat() };
    }
    const prior = await db.query<{ started_at: string; question_refs: { question_id: string }[] }>(`SELECT started_at, question_refs FROM acad.diagnostic_attempts WHERE user_id=$1 AND course_id=$2 ORDER BY started_at DESC`, [u.userId, id]);
    const limit = attemptsRemaining(prior.map((p) => new Date(p.started_at)), now, c.readiness_rules);
    if (limit.remaining === 0) throw tooMany('You have used this week\'s readiness checks for this course. You can still start the course or review its prerequisites.', { next_allowed_at: limit.next_allowed_at });
    const bank = await diagnosticBank(db, id, statuses);
    if (bank.length < c.readiness_rules.questions) throw unavailable('The readiness check for this course is not available yet.');
    const seen = new Set(prior.slice(0, 2).flatMap((p) => p.question_refs.map((r) => r.question_id)));
    const seed = seedFrom(`${u.userId}|${id}|${prior.length}|${now.toISOString()}`);
    const picked = selectDiagnostic(bank, c.readiness_rules.questions, seen, seed);
    const refs = picked.map((q) => ({ question_id: q.question_id, version: q.version }));
    const expires = new Date(now.getTime() + DIAGNOSTIC_MINUTES * 60_000).toISOString();
    const row = await db.one<{ attempt_id: string }>(
      `INSERT INTO acad.diagnostic_attempts (user_id, course_id, course_version, question_refs, rules, started_at, expires_at, engine_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING attempt_id`,
      [u.userId, id, c.version, JSON.stringify(refs), JSON.stringify({ ...c.readiness_rules, selection_seed: seed }), now.toISOString(), expires, ACADEMY_ENGINE_VERSION],
    );
    await track(db, 'academy_diagnostic_started', { course: id, attempt_number: prior.length + 1 }, { userId: u.userId, origin: 'server', at: now });
    return { attempt_id: row.attempt_id, expires_at: expires, resumed: false, questions: picked.map(publicQuestion), attempts_remaining_after_this: limit.remaining - 1, caveat: scoreCaveat() };
  });

  app.post('/v1/academy/diagnostics/:attemptId/submit', async (req) => {
    const u = requireUser(req);
    const { attemptId } = parse(z.object({ attemptId: z.string().uuid() }), req.params);
    const body = parse(z.object({ answers: z.array(z.object({ question_id: z.string().max(40), response: responseSchema })).max(20) }), req.body);
    const now = ctx.clock();
    return db.tx(async (t) => {
      const a = await t.maybeOne<{ course_id: string; question_refs: { question_id: string; version: number }[]; rules: ReadinessRules; expires_at: string; submitted_at: string | null }>(
        `SELECT course_id, question_refs, rules, expires_at, submitted_at FROM acad.diagnostic_attempts WHERE attempt_id=$1 AND user_id=$2 FOR UPDATE`,
        [attemptId, u.userId],
      );
      if (!a) throw notFound();
      if (a.submitted_at) throw conflict('This readiness check was already submitted.');
      if (new Date(a.expires_at) <= now) throw conflict('This readiness check expired. Start a new one when you are ready.');
      const questions = await questionsByRefs(t, a.question_refs);
      const byId = new Map(body.answers.map((x) => [x.question_id, x.response as Response]));
      const unknown = body.answers.filter((x) => !a.question_refs.some((r) => r.question_id === x.question_id));
      if (unknown.length) throw badRequest('Answers must refer to the questions in this attempt.');
      const responses = questions.map((q) => byId.get(q.question_id) ?? null);
      const c = (await currentCourses(t, ['published', 'in_review', 'retired'])).find((x) => x.course_id === a.course_id);
      const preceding = c?.preceding_course_id ? (await currentCourses(t, statuses)).find((x) => x.course_id === c.preceding_course_id) : undefined;
      const result = scoreDiagnostic(questions, responses, a.rules, { precedingCourseTitle: preceding?.title ?? null });
      await t.query(`UPDATE acad.diagnostic_attempts SET submitted_at=$3, responses=$4, result=$5, readiness=$6 WHERE attempt_id=$1 AND user_id=$2`, [attemptId, u.userId, now.toISOString(), JSON.stringify(responses), JSON.stringify(result), result.readiness]);
      await track(t, 'academy_diagnostic_completed', { course: a.course_id, readiness: result.readiness, ratio: result.ratio }, { userId: u.userId, origin: 'server', at: now });
      return { attempt_id: attemptId, course_id: a.course_id, preceding_course: preceding ? { course_id: preceding.course_id, title: preceding.title } : null, ...result, outcomes: enrich(result.outcomes, questions, responses) };
    });
  });

  app.get('/v1/academy/diagnostics/:attemptId', async (req) => {
    const u = requireUser(req);
    const { attemptId } = parse(z.object({ attemptId: z.string().uuid() }), req.params);
    const a = await db.maybeOne<{ course_id: string; submitted_at: string | null; result: ReturnType<typeof scoreDiagnostic> | null; readiness: string | null; started_at: string; question_refs: { question_id: string; version: number }[]; responses: Response[] | null }>(
      `SELECT course_id, submitted_at, result, readiness, started_at, question_refs, responses FROM acad.diagnostic_attempts WHERE attempt_id=$1 AND user_id=$2`,
      [attemptId, u.userId],
    );
    if (!a) throw notFound();
    if (!a.submitted_at || !a.result) return { course_id: a.course_id, started_at: a.started_at, submitted_at: null, result: null };
    const questions = await questionsByRefs(db, a.question_refs);
    const c = await course(a.course_id).catch(() => null);
    const preceding = c?.preceding_course_id ? (await currentCourses(db, statuses)).find((x) => x.course_id === c.preceding_course_id) : undefined;
    return { course_id: a.course_id, started_at: a.started_at, submitted_at: a.submitted_at, readiness: a.readiness, result: { ...a.result, attempt_id: attemptId, preceding_course: preceding ? { course_id: preceding.course_id, title: preceding.title } : null, outcomes: enrich(a.result.outcomes, questions, a.responses ?? []) } };
  });

  // ───── Enrolment (never blocked by a readiness result; low readiness needs an explicit choice) ─────
  app.post('/v1/academy/courses/:id/enrol', async (req) => {
    const u = requireUser(req);
    const { id } = parse(courseParam, req.params);
    const body = parse(z.object({ attempt_id: z.string().uuid().optional(), acknowledge: z.boolean().optional() }), req.body ?? {});
    const c = await course(id);
    const existing = await db.maybeOne(`SELECT course_id, entry_route, enrolled_at FROM acad.enrolments WHERE user_id=$1 AND course_id=$2`, [u.userId, id]);
    if (existing) return { enrolment: existing, already: true };
    let route: 'direct' | 'after_review' | 'learner_override' | 'no_diagnostic' = 'no_diagnostic';
    if (body.attempt_id) {
      const a = await db.maybeOne<{ readiness: string | null; course_id: string }>(`SELECT readiness, course_id FROM acad.diagnostic_attempts WHERE attempt_id=$1 AND user_id=$2`, [body.attempt_id, u.userId]);
      if (!a || a.course_id !== id) throw notFound('No such readiness check for this course.');
      if (!a.readiness) throw badRequest('Submit the readiness check first, or enrol without it.');
      route = a.readiness === 'high' ? 'direct' : a.readiness === 'borderline' ? 'after_review' : 'learner_override';
    }
    if ((route === 'learner_override' || route === 'no_diagnostic') && !body.acknowledge) {
      throw conflict(route === 'no_diagnostic' ? 'Take the five-question readiness check, or confirm you want to start without it.' : 'Your readiness check suggested reviewing prerequisites first. Confirm that you want to start anyway.');
    }
    const row = await db.one(
      `INSERT INTO acad.enrolments (user_id, course_id, course_version, entry_route, diagnostic_attempt_id, enrolled_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING course_id, entry_route, enrolled_at`,
      [u.userId, id, c.version, route, body.attempt_id ?? null, ctx.clock().toISOString()],
    );
    await track(db, 'academy_enrolled', { course: id, entry_route: route }, { userId: u.userId, origin: 'server', at: ctx.clock() });
    return { enrolment: row, already: false };
  });

  // ───── Lessons ─────
  app.get('/v1/academy/lessons/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const l = await latestLesson(id);
    if (!l) throw notFound();
    const quiz = await lessonQuiz(db, id, statuses);
    const progress = await db.maybeOne(`SELECT lesson_version, started_at, last_block, completed_at FROM acad.lesson_progress WHERE user_id=$1 AND lesson_id=$2`, [u.userId, id]);
    const prereqs = l.prerequisite_lesson_ids.length
      ? await db.query<{ lesson_id: string; title: string; completed: boolean }>(
          `SELECT DISTINCT ON (l.lesson_id) l.lesson_id, l.title, (p.completed_at IS NOT NULL) AS completed FROM acad.lessons l LEFT JOIN acad.lesson_progress p ON p.lesson_id=l.lesson_id AND p.user_id=$2 WHERE l.lesson_id = ANY($1) ORDER BY l.lesson_id, l.version DESC`,
          [l.prerequisite_lesson_ids, u.userId],
        )
      : [];
    const objectives = await db.query(`SELECT objective_id, statement FROM acad.objectives WHERE objective_id = ANY($1)`, [l.objective_ids]);
    const c = await course(l.course_id);
    return {
      lesson_id: l.lesson_id, version: l.version, course: { course_id: c.course_id, title: c.title }, title: l.title, minutes: l.minutes, draft: isDraft(l.status),
      objectives, prerequisites: prereqs, blocks: l.blocks, references: l.references_list, mastery_rule: l.mastery_rule,
      quiz: quiz.map(publicQuestion), progress,
      videos: videos.filter((v) => v.lesson_id === l.lesson_id).map((v) => ({
        id: v.id, title: v.title, objective: v.objective, duration_s: v.duration_s, width: v.width, height: v.height, status: v.status,
        src: `/v1/academy/videos/${v.id}/video`, poster: `/v1/academy/videos/${v.id}/poster`, captions: `/v1/academy/videos/${v.id}/captions`, transcript: `/v1/academy/videos/${v.id}/transcript`,
      })),
    };
  });

  // Video files: same gate as the lesson (signed in, lesson visible at this review status). Range
  // requests are honoured so the player can seek.
  app.get('/v1/academy/videos/:id/:file', async (req, reply) => {
    requireUser(req);
    const { id, file } = parse(z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/), file: z.enum(['video', 'poster', 'captions', 'transcript']) }), req.params);
    const v = videos.find((x) => x.id === id);
    if (!v || !(await latestLesson(v.lesson_id))) throw notFound();
    const path = videoPath(v, file as VideoFile);
    if (!path) throw notFound();
    const size = statSync(path).size;
    reply.header('content-type', VIDEO_FILES[file as VideoFile].type).header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=3600').header('accept-ranges', 'bytes');
    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') return reply.code(416).header('content-range', `bytes */${size}`).send();
    if (!range) return reply.header('content-length', size).send(createReadStream(path));
    return reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${size}`).header('content-length', range.end - range.start + 1).send(createReadStream(path, range));
  });

  app.post('/v1/academy/lessons/:id/progress', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const { block } = parse(z.object({ block: z.number().int().min(0).max(50) }), req.body);
    const l = await latestLesson(id);
    if (!l) throw notFound();
    await db.query(
      `INSERT INTO acad.lesson_progress (user_id, lesson_id, lesson_version, last_block, started_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET last_block=GREATEST(acad.lesson_progress.last_block, EXCLUDED.last_block)`,
      [u.userId, id, l.version, Math.min(block, l.blocks.length), ctx.clock().toISOString()],
    );
    return { ok: true };
  });

  app.post('/v1/academy/lessons/:id/quiz', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const body = parse(z.object({ answers: z.array(answerSchema).min(1).max(20) }), req.body);
    const l = await latestLesson(id);
    if (!l) throw notFound();
    const quiz = await lessonQuiz(db, id, statuses);
    const expected = new Set(quiz.map((q) => `${q.question_id}@${q.version}`));
    if (body.answers.length !== quiz.length || body.answers.some((a) => !expected.has(`${a.question_id}@${a.version}`))) {
      throw conflict('This quiz has changed since you opened it. Reload the lesson to get the current questions.');
    }
    const now = ctx.clock();
    return db.tx(async (t) => {
      const graded = gradeAll(quiz, body.answers);
      const mastery = await applyEvidence(t, u.userId, graded, now);
      const score = graded.filter((g) => g.correct).length / graded.length;
      await t.query(
        `INSERT INTO acad.quiz_attempts (user_id, lesson_id, lesson_version, kind, question_refs, responses, result, score, submitted_at, engine_version) VALUES ($1,$2,$3,'lesson_quiz',$4,$5,$6,$7,$8,$9)`,
        [u.userId, id, l.version, JSON.stringify(quiz.map((q) => ({ question_id: q.question_id, version: q.version }))), JSON.stringify(body.answers), JSON.stringify(graded.map((g) => ({ question_id: g.q.question_id, correct: g.correct }))), score, now.toISOString(), ACADEMY_ENGINE_VERSION],
      );
      // Completion means "finished the lesson and attempted its quiz"; mastery is tracked separately.
      await t.query(
        `INSERT INTO acad.lesson_progress (user_id, lesson_id, lesson_version, last_block, started_at, completed_at) VALUES ($1,$2,$3,$4,$5,$5)
         ON CONFLICT (user_id, lesson_id) DO UPDATE SET completed_at=COALESCE(acad.lesson_progress.completed_at, EXCLUDED.completed_at), last_block=GREATEST(acad.lesson_progress.last_block, EXCLUDED.last_block)`,
        [u.userId, id, l.version, l.blocks.length, now.toISOString()],
      );
      await track(t, 'academy_quiz_submitted', { lesson: id, score, kind: 'lesson_quiz' }, { userId: u.userId, origin: 'server', at: now });
      await track(t, 'lesson_completed', { lesson: id, score: graded.filter((g) => g.correct).length }, { userId: u.userId, origin: 'server', at: now });
      return { score, correct: graded.filter((g) => g.correct).length, of: graded.length, outcomes: graded.map(outcome), mastery };
    });
  });

  // ───── Spaced review ─────
  app.get('/v1/academy/reviews', async (req) => {
    const u = requireUser(req);
    const now = ctx.clock();
    const due = await db.query<{ objective_id: string; box: number; due_at: string; statement: string }>(
      `SELECT r.objective_id, r.box, r.due_at, o.statement FROM acad.review_schedule r JOIN acad.objectives o USING (objective_id) WHERE r.user_id=$1 AND r.due_at <= $2 ORDER BY r.due_at LIMIT $3`,
      [u.userId, now.toISOString(), REVIEW_DAILY_CAP],
    );
    const total = await db.one<{ n: number; next_due: string | null }>(`SELECT count(*) FILTER (WHERE due_at <= $2)::int AS n, min(due_at) FILTER (WHERE due_at > $2) AS next_due FROM acad.review_schedule WHERE user_id=$1`, [u.userId, now.toISOString()]);
    const items = [];
    for (const d of due) {
      const pool = await db.query<{ question_id: string; version: number }>(`SELECT DISTINCT ON (question_id) question_id, version FROM acad.questions WHERE objective_id=$1 AND purpose='quiz' AND status = ANY($2) ORDER BY question_id, version DESC`, [d.objective_id, statuses]);
      if (!pool.length) continue;
      const pick = pool[seedFrom(`${u.userId}|${d.objective_id}|${d.due_at}`) % pool.length]!;
      const [q] = await questionsByRefs(db, [pick]);
      items.push({ objective_id: d.objective_id, objective: d.statement, box: d.box, question: publicQuestion(q!) });
    }
    return { due_total: total.n, daily_cap: REVIEW_DAILY_CAP, next_due_at: total.next_due, items };
  });

  app.post('/v1/academy/reviews', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ answers: z.array(answerSchema).min(1).max(REVIEW_DAILY_CAP) }), req.body);
    const now = ctx.clock();
    const questions = await questionsByRefs(db, body.answers.map((a) => ({ question_id: a.question_id, version: a.version }))).catch(() => {
      throw badRequest('Unknown question.');
    });
    const due = await db.query<{ objective_id: string }>(`SELECT objective_id FROM acad.review_schedule WHERE user_id=$1 AND due_at <= $2`, [u.userId, now.toISOString()]);
    if (questions.some((q) => !q.objective_id || !due.some((d) => d.objective_id === q.objective_id))) throw conflict('Only questions for reviews that are due can be submitted.');
    return db.tx(async (t) => {
      const graded = gradeAll(questions, body.answers);
      const mastery = await applyEvidence(t, u.userId, graded, now);
      for (const g of graded) {
        const lessonId = (await t.one<{ lesson_id: string }>(`SELECT lesson_id FROM acad.questions WHERE question_id=$1 AND version=$2`, [g.q.question_id, g.q.version])).lesson_id;
        const lv = (await t.one<{ v: number }>(`SELECT max(version)::int AS v FROM acad.lessons WHERE lesson_id=$1`, [lessonId])).v;
        await t.query(
          `INSERT INTO acad.quiz_attempts (user_id, lesson_id, lesson_version, kind, question_refs, responses, result, score, submitted_at, engine_version) VALUES ($1,$2,$3,'review',$4,$5,$6,$7,$8,$9)`,
          [u.userId, lessonId, lv, JSON.stringify([{ question_id: g.q.question_id, version: g.q.version }]), JSON.stringify([g.response]), JSON.stringify([{ correct: g.correct }]), g.correct ? 1 : 0, now.toISOString(), ACADEMY_ENGINE_VERSION],
        );
        await track(t, 'academy_quiz_submitted', { lesson: lessonId, score: g.correct ? 1 : 0, kind: 'review' }, { userId: u.userId, origin: 'server', at: now });
      }
      return { outcomes: graded.map(outcome), mastery };
    });
  });

  // ───── Learner summary: completion and mastery reported separately ─────
  app.get('/v1/academy/progress', async (req) => {
    const u = requireUser(req);
    const rows = await db.query<{ course_id: string; title: string; entry_route: string; lessons: number; lessons_completed: number; objectives: number; mastered: number }>(
      `SELECT e.course_id, cv.title, e.entry_route,
              (SELECT count(DISTINCT l.lesson_id)::int FROM acad.lessons l JOIN acad.modules m USING (module_id) WHERE m.course_id=e.course_id AND l.status = ANY($2)) AS lessons,
              (SELECT count(*)::int FROM acad.lesson_progress p JOIN (SELECT DISTINCT l.lesson_id FROM acad.lessons l JOIN acad.modules m USING (module_id) WHERE m.course_id=e.course_id) cl USING (lesson_id) WHERE p.user_id=e.user_id AND p.completed_at IS NOT NULL) AS lessons_completed,
              (SELECT count(*)::int FROM acad.objectives o WHERE o.course_id=e.course_id) AS objectives,
              (SELECT count(*)::int FROM acad.objective_mastery om JOIN acad.objectives o USING (objective_id) WHERE om.user_id=e.user_id AND o.course_id=e.course_id AND om.state='mastered') AS mastered
         FROM acad.enrolments e JOIN acad.courses c USING (course_id) JOIN acad.course_versions cv ON cv.course_id=c.course_id AND cv.version=c.current_version
        WHERE e.user_id=$1 ORDER BY c.position`,
      [u.userId, statuses],
    );
    const reviews = await db.one<{ due: number }>(`SELECT count(*)::int AS due FROM acad.review_schedule WHERE user_id=$1 AND due_at <= $2`, [u.userId, ctx.clock().toISOString()]);
    return { courses: rows, reviews_due: Math.min(reviews.due, REVIEW_DAILY_CAP), note: 'Lesson completion shows what you have worked through; mastery shows what you have demonstrated in graded answers over time.' };
  });

  // ───── Admin: content review and publication (seven-point review, audited) ─────
  app.get('/admin/v1/academy/review-queue', async (req) => {
    requireRole(req, ['admin']);
    const lessons = await db.query(`SELECT l.lesson_id, l.version, l.title, m.course_id, l.status, l.created_at FROM acad.lessons l JOIN acad.modules m USING (module_id) WHERE l.status IN ('draft','in_review') ORDER BY m.course_id, l.lesson_id`);
    const questions = await db.query(`SELECT course_id, purpose, count(*)::int AS n FROM acad.questions WHERE status IN ('draft','in_review') GROUP BY course_id, purpose ORDER BY course_id, purpose`);
    return { lessons, questions, checks: REVIEW_CHECKS };
  });

  app.post('/admin/v1/academy/lessons/:id/versions/:version/publish', async (req) => {
    const a = requireRole(req, ['admin']);
    const p = parse(z.object({ id: z.string().max(40), version: z.coerce.number().int().positive() }), req.params);
    const body = parse(
      z.object({ checks: z.object(Object.fromEntries(REVIEW_CHECKS.map((k) => [k, z.literal(true)])) as Record<(typeof REVIEW_CHECKS)[number], z.ZodLiteral<true>>), reviewer_name: z.string().trim().min(3).max(120), notes: z.string().max(2000).optional() }),
      req.body,
    );
    const now = ctx.clock();
    const updated = await db.tx(async (t) => {
      const l = await t.maybeOne<{ status: string }>(`SELECT status FROM acad.lessons WHERE lesson_id=$1 AND version=$2 FOR UPDATE`, [p.id, p.version]);
      if (!l) throw notFound();
      if (l.status !== 'in_review') throw conflict(`Only lessons in review can be published (this one is ${l.status}).`);
      const review = { ...body.checks, reviewed_by: a.userId, reviewer_name: body.reviewer_name, reviewed_on: now.toISOString().slice(0, 10), notes: body.notes ?? null };
      await t.query(`UPDATE acad.lessons SET status='published', published_at=$3, review=$4 WHERE lesson_id=$1 AND version=$2`, [p.id, p.version, now.toISOString(), JSON.stringify(review)]);
      await t.query(`UPDATE acad.questions SET status='published' WHERE lesson_id=$1 AND purpose='quiz' AND status='in_review'`, [p.id]);
      return review;
    });
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'academy.lesson.publish', targetType: 'lesson', targetId: `${p.id}@${p.version}`, reason: `Seven-point review by ${body.reviewer_name}`, details: { checks: REVIEW_CHECKS } });
    return { lesson_id: p.id, version: p.version, status: 'published', review: updated };
  });
}

/** Adds the question text to stored outcomes (only after submission). */
const enrich = (outcomes: ReturnType<typeof scoreDiagnostic>['outcomes'], questions: BankQuestion[], responses: Response[]) =>
  outcomes.map((o, i) => ({ ...o, qtype: questions[i]!.qtype, stem: questions[i]!.stem, options: questions[i]!.options, unit: 'value' in questions[i]!.correct ? (questions[i]!.correct.unit ?? null) : null, your_response: responses[i] ?? null }));

const scoreCaveat = () => 'Five questions give a rough readiness estimate only. Answers are shown after you submit.';

interface Graded {
  q: BankQuestion;
  response: Response;
  correct: boolean;
}

function gradeAll(questions: BankQuestion[], answers: z.infer<typeof answerSchema>[]): Graded[] {
  return questions.map((q) => {
    const a = answers.find((x) => x.question_id === q.question_id && x.version === q.version);
    const response = (a?.response ?? null) as Response;
    return { q, response, correct: isCorrect(q, response) };
  });
}

const outcome = (g: Graded) => ({ question_id: g.q.question_id, version: g.q.version, stem: g.q.stem, options: g.q.options, your_response: g.response, correct: g.correct, correct_answer: g.q.correct, explanation: g.q.explanation, misconception: g.correct ? null : g.q.misconception });

/** Updates mastery per answer and the review schedule per objective (correct only if every answer for it was). */
async function applyEvidence(t: Db, userId: string, graded: Graded[], now: Date) {
  const byObjective = new Map<string, boolean[]>();
  for (const g of graded) if (g.q.objective_id) byObjective.set(g.q.objective_id, [...(byObjective.get(g.q.objective_id) ?? []), g.correct]);
  const out: { objective_id: string; state: string; estimate: number; evidence_count: number; next_review_at: string }[] = [];
  for (const [objectiveId, results] of byObjective) {
    let m = (await t.maybeOne<MasteryState>(`SELECT evidence_count, correct_count, estimate, state FROM acad.objective_mastery WHERE user_id=$1 AND objective_id=$2 FOR UPDATE`, [userId, objectiveId])) ?? null;
    if (m) m = { ...m, estimate: Number(m.estimate) };
    for (const r of results) m = updateMastery(m, r);
    await t.query(
      `INSERT INTO acad.objective_mastery (user_id, objective_id, evidence_count, correct_count, estimate, state, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, objective_id) DO UPDATE SET evidence_count=EXCLUDED.evidence_count, correct_count=EXCLUDED.correct_count, estimate=EXCLUDED.estimate, state=EXCLUDED.state, updated_at=EXCLUDED.updated_at`,
      [userId, objectiveId, m!.evidence_count, m!.correct_count, m!.estimate, m!.state, now.toISOString()],
    );
    const prev = await t.maybeOne<{ box: number }>(`SELECT box FROM acad.review_schedule WHERE user_id=$1 AND objective_id=$2`, [userId, objectiveId]);
    const next = nextReview(prev?.box ?? null, results.every(Boolean), now);
    await t.query(
      `INSERT INTO acad.review_schedule (user_id, objective_id, box, due_at, last_reviewed_at, last_correct) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, objective_id) DO UPDATE SET box=EXCLUDED.box, due_at=EXCLUDED.due_at, last_reviewed_at=EXCLUDED.last_reviewed_at, last_correct=EXCLUDED.last_correct`,
      [userId, objectiveId, next.box, next.due_at, now.toISOString(), results.every(Boolean)],
    );
    out.push({ objective_id: objectiveId, state: m!.state, estimate: m!.estimate, evidence_count: m!.evidence_count, next_review_at: next.due_at });
  }
  return out;
}
