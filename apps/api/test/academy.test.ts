import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { totpCode } from '../src/lib/crypto.js';
import { CURRICULUM } from '../src/modules/academy/curriculum.js';
import { syncCurriculum } from '../src/modules/academy/service.js';
import { DEV_ADMIN_TOTP_SECRET, DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { FIXTURE_CLOCK, fixtureContext } from './fixture.js';

let ctx: AppContext;
let app: FastifyInstance;
beforeAll(async () => {
  ctx = await fixtureContext();
  app = await buildApp(ctx);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});

const signedIn = async (email: string) => {
  const c = new Client(app);
  expect((await c.login(email, DEV_PASSWORD)).status).toBe(200);
  return c;
};
/** Correct responses looked up server-side (the API never sends them before submission). */
const answerKey = async (refs: { question_id: string; version: number }[]) => {
  const rows = await ctx.db.query<{ question_id: string; version: number; correct: Record<string, unknown> }>(`SELECT question_id, version, correct FROM acad.questions WHERE (question_id, version) IN (SELECT * FROM json_to_recordset($1::json) AS r(question_id text, version int))`, [JSON.stringify(refs)]);
  return (id: string) => {
    const c = rows.find((r) => r.question_id === id)!.correct;
    return 'index' in c ? { index: c.index } : 'indexes' in c ? { indexes: c.indexes } : { value: c.value };
  };
};
const wrongFor = (q: any) => (q.qtype === 'numeric' ? { value: -999 } : q.qtype === 'multi_select' ? { indexes: [] } : { index: 19 });

describe('Academy catalogue (curriculum from the database)', () => {
  it('lists the four courses in order, labelled as draft while content is in review', async () => {
    const r = await new Client(app).get('/v1/academy/courses');
    expect(r.status).toBe(200);
    expect(r.json.courses.map((c: any) => c.title)).toEqual(['ATLAS: MARKET DECODER', 'ATLAS: EQUITY DETECTIVE', 'ATLAS: SIGNAL ENGINEER', 'ATLAS: MARKET ARCHITECT']);
    expect(r.json.courses.every((c: any) => c.draft === true)).toBe(true);
    expect(r.json.courses.map((c: any) => c.lessons)).toEqual([9, 8, 6, 6]);
    expect(r.json.not_a_qualification).toMatch(/not a professional qualification/);
  });
  it('course detail explains prerequisites and the five-question check', async () => {
    const r = await new Client(app).get('/v1/academy/courses/equity-detective');
    expect(r.json.prerequisites).toMatch(/financial statements/);
    expect(r.json.diagnostic.questions).toBe(5);
    expect(r.json.preceding_course.title).toBe('ATLAS: MARKET DECODER');
    expect(r.json.completion_statement).toMatch(/not a professional qualification/);
    expect((await new Client(app).get('/v1/academy/courses/no-such-course')).status).toBe(404);
  });
});

describe('placement diagnostic (5 questions, transparent result)', () => {
  it('requires sign-in, hides answers until submission, resumes instead of re-drawing', async () => {
    expect((await new Client(app).post('/v1/academy/courses/market-decoder/diagnostic')).status).toBe(401);
    const u = await signedIn('free@atlas.test');
    const start = await u.post('/v1/academy/courses/market-decoder/diagnostic');
    expect(start.status).toBe(200);
    expect(start.json.questions).toHaveLength(5);
    expect(new Set(start.json.questions.map((q: any) => q.skill)).size).toBeGreaterThanOrEqual(4);
    for (const q of start.json.questions) {
      expect(q).not.toHaveProperty('correct');
      expect(q).not.toHaveProperty('explanation');
      expect(q).not.toHaveProperty('misconception');
    }
    const again = await u.post('/v1/academy/courses/market-decoder/diagnostic');
    expect(again.json.resumed).toBe(true);
    expect(again.json.attempt_id).toBe(start.json.attempt_id);
    expect(again.json.questions.map((q: any) => q.question_id)).toEqual(start.json.questions.map((q: any) => q.question_id));
  });

  it('all correct → high readiness, explanations returned, direct enrolment; versions pinned', async () => {
    const u = await signedIn('pro@atlas.test');
    const start = await u.post('/v1/academy/courses/market-decoder/diagnostic');
    const key = await answerKey(start.json.questions);
    const res = await u.post(`/v1/academy/diagnostics/${start.json.attempt_id}/submit`, { answers: start.json.questions.map((q: any) => ({ question_id: q.question_id, response: key(q.question_id) })) });
    expect(res.status).toBe(200);
    expect(res.json.readiness).toBe('high');
    expect(res.json.reasons[0]).toMatch(/100%/);
    expect(res.json.outcomes.every((o: any) => o.explanation && o.correct_answer)).toBe(true);
    expect(res.json.caveat).toMatch(/rough readiness estimate/);
    const stored = await ctx.db.one<{ question_refs: any[]; engine_version: string; course_version: number }>(`SELECT question_refs, engine_version, course_version FROM acad.diagnostic_attempts WHERE attempt_id=$1`, [start.json.attempt_id]);
    expect(stored.question_refs.every((r) => r.version >= 1)).toBe(true);
    expect(stored.engine_version).toBe('acad-engine-1');
    expect((await u.post(`/v1/academy/diagnostics/${start.json.attempt_id}/submit`, { answers: [] })).status).toBe(409);
    const enrol = await u.post('/v1/academy/courses/market-decoder/enrol', { attempt_id: start.json.attempt_id });
    expect(enrol.json.enrolment.entry_route).toBe('direct');
    expect((await u.post('/v1/academy/courses/market-decoder/enrol', { attempt_id: start.json.attempt_id })).json.already).toBe(true);
  });

  it('low readiness recommends the preceding course and needs an explicit choice, but never blocks', async () => {
    const u = await signedIn('plus@atlas.test');
    const start = await u.post('/v1/academy/courses/equity-detective/diagnostic');
    const res = await u.post(`/v1/academy/diagnostics/${start.json.attempt_id}/submit`, { answers: start.json.questions.map((q: any) => ({ question_id: q.question_id, response: wrongFor(q) })) });
    expect(res.json.readiness).toBe('low');
    expect(res.json.recommendation.text).toContain('ATLAS: MARKET DECODER');
    expect(res.json.skills_to_review.length).toBeGreaterThan(0);
    expect(res.json.outcomes.every((o: any) => o.misconception)).toBe(true);
    expect((await u.post('/v1/academy/courses/equity-detective/enrol', { attempt_id: start.json.attempt_id })).status).toBe(409);
    const ok = await u.post('/v1/academy/courses/equity-detective/enrol', { attempt_id: start.json.attempt_id, acknowledge: true });
    expect(ok.json.enrolment.entry_route).toBe('learner_override');
  });

  it('retakes draw different questions and are limited to three a week', async () => {
    const u = await signedIn('plus@atlas.test');
    const seen: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const s = await u.post('/v1/academy/courses/signal-engineer/diagnostic');
      expect(s.status).toBe(200);
      seen.push(s.json.questions.map((q: any) => q.question_id));
      await u.post(`/v1/academy/diagnostics/${s.json.attempt_id}/submit`, { answers: [] });
    }
    expect(seen[1]!.filter((id) => seen[0]!.includes(id))).toEqual([]);
    const blocked = await u.post('/v1/academy/courses/signal-engineer/diagnostic');
    expect(blocked.status).toBe(429);
    expect(blocked.json.next_allowed_at).toBeTruthy();
  });

  it('another user cannot read, submit or enrol with someone else\'s attempt (404)', async () => {
    const a = await signedIn('free@atlas.test');
    const b = await signedIn('pro@atlas.test');
    const s = await a.post('/v1/academy/courses/market-architect/diagnostic');
    expect((await b.get(`/v1/academy/diagnostics/${s.json.attempt_id}`)).status).toBe(404);
    expect((await b.post(`/v1/academy/diagnostics/${s.json.attempt_id}/submit`, { answers: [] })).status).toBe(404);
    expect((await b.post('/v1/academy/courses/market-architect/enrol', { attempt_id: s.json.attempt_id, acknowledge: true })).status).toBe(404);
    expect((await a.get(`/v1/academy/diagnostics/${s.json.attempt_id}`)).json.result).toBeNull();
    await a.post(`/v1/academy/diagnostics/${s.json.attempt_id}/submit`, { answers: [] });
    const reopened = (await a.get(`/v1/academy/diagnostics/${s.json.attempt_id}`)).json;
    expect(reopened.result.outcomes).toHaveLength(5);
    expect(reopened.result.outcomes.every((o: any) => o.stem && o.qtype && o.explanation)).toBe(true);
    expect((await b.get(`/v1/academy/diagnostics/${s.json.attempt_id}`)).status).toBe(404);
  });

  it('rejects malformed answers', async () => {
    const u = await signedIn('free@atlas.test');
    const s = await u.post('/v1/academy/courses/market-decoder/diagnostic');
    expect((await u.post(`/v1/academy/diagnostics/${s.json.attempt_id}/submit`, { answers: [{ question_id: 'not-in-attempt', response: { index: 0 } }] })).status).toBe(400);
    expect((await u.post(`/v1/academy/diagnostics/${s.json.attempt_id}/submit`, { answers: [{ question_id: 'x', response: { index: 0, extra: 1 } }] })).status).toBe(400);
  });
});

describe('lessons, quizzes, mastery and spaced review', () => {
  it('serves a lesson following the seven-stage loop without quiz answers', async () => {
    const u = await signedIn('pro@atlas.test');
    const l = await u.get('/v1/academy/lessons/md-l3');
    expect(l.status).toBe(200);
    expect(l.json.blocks.map((b: any) => b.stage)).toEqual(['discover', 'observe', 'predict', 'investigate', 'decide', 'explain', 'review']);
    expect(l.json.quiz).toHaveLength(3);
    expect(JSON.stringify(l.json.quiz)).not.toContain('explanation');
    expect(l.json.draft).toBe(true);
    expect(l.json.prerequisites[0].lesson_id).toBe('md-l1');
  });

  it('completion is separate from mastery; three correct answers in a row master the objective', async () => {
    const u = await signedIn('pro@atlas.test');
    const l = await u.get('/v1/academy/lessons/md-l3');
    const key = await answerKey(l.json.quiz);
    expect((await u.post('/v1/academy/lessons/md-l3/quiz', { answers: [{ question_id: l.json.quiz[0].question_id, version: 99, response: null }] })).status).toBe(409);
    // First attempt: all wrong → lesson completed but objective not mastered.
    const wrong = await u.post('/v1/academy/lessons/md-l3/quiz', { answers: l.json.quiz.map((q: any) => ({ question_id: q.question_id, version: q.version, response: wrongFor(q) })) });
    expect(wrong.json.score).toBe(0);
    expect(wrong.json.outcomes[0].explanation).toBeTruthy();
    expect(wrong.json.mastery[0]).toMatchObject({ objective_id: 'md-o3', state: 'learning', evidence_count: 3 });
    const progress = await u.get('/v1/academy/progress');
    const md = progress.json.courses.find((c: any) => c.course_id === 'market-decoder');
    expect(md.lessons_completed).toBe(1);
    expect(md.mastered).toBe(0);
    // Then all correct: EWMA 0 → .5 → .75 → .875 ≥ .8 with 6 pieces of evidence → mastered.
    const right = await u.post('/v1/academy/lessons/md-l3/quiz', { answers: l.json.quiz.map((q: any) => ({ question_id: q.question_id, version: q.version, response: key(q.question_id) })) });
    expect(right.json.score).toBe(1);
    expect(right.json.mastery[0]).toMatchObject({ objective_id: 'md-o3', state: 'mastered', estimate: 0.875 });
    const sched = await ctx.db.one<{ box: number; due_at: string }>(`SELECT box, due_at FROM acad.review_schedule rs JOIN app.users u USING (user_id) WHERE u.email='pro@atlas.test' AND objective_id='md-o3'`);
    expect(sched.box).toBe(2);
    expect(sched.due_at).toBe(new Date(FIXTURE_CLOCK.getTime() + 3 * 86_400_000).toISOString());
  });

  it('due reviews are served (capped) and graded; a wrong review answer resets the box', async () => {
    const u = await signedIn('pro@atlas.test');
    expect((await u.get('/v1/academy/reviews')).json.items).toEqual([]);
    await ctx.db.query(`UPDATE acad.review_schedule SET due_at = $1 WHERE user_id = (SELECT user_id FROM app.users WHERE email='pro@atlas.test')`, [new Date(FIXTURE_CLOCK.getTime() - 60_000).toISOString()]);
    const due = await u.get('/v1/academy/reviews');
    expect(due.json.items).toHaveLength(1);
    expect(due.json.daily_cap).toBe(10);
    const q = due.json.items[0].question;
    expect(q).not.toHaveProperty('correct');
    const r = await u.post('/v1/academy/reviews', { answers: [{ question_id: q.question_id, version: q.version, response: wrongFor(q) }] });
    expect(r.status).toBe(200);
    expect(r.json.outcomes[0].correct).toBe(false);
    const sched = await ctx.db.one<{ box: number }>(`SELECT box FROM acad.review_schedule rs JOIN app.users u USING (user_id) WHERE u.email='pro@atlas.test' AND objective_id='md-o3'`);
    expect(sched.box).toBe(1);
    expect((await u.post('/v1/academy/reviews', { answers: [{ question_id: q.question_id, version: q.version, response: null }] })).status).toBe(409);
  });
});

describe('content review, publication and versioning', () => {
  const admin = async () => {
    const c = new Client(app);
    expect((await c.login('admin@atlas.test', DEV_PASSWORD, totpCode(DEV_ADMIN_TOTP_SECRET, FIXTURE_CLOCK.getTime()))).status).toBe(200);
    return c;
  };
  const allChecks = { factual: true, calculation: true, pedagogy: true, accessibility: true, rights: true, alignment: true, technical: true };

  it('only an admin can publish, every check must pass, and publication is audited', async () => {
    const user = await signedIn('pro@atlas.test');
    expect((await user.post('/admin/v1/academy/lessons/md-l1/versions/1/publish', { checks: allChecks, reviewer_name: 'A Reviewer' })).status).toBe(403);
    const a = await admin();
    expect((await a.get('/admin/v1/academy/review-queue')).json.lessons.length).toBeGreaterThanOrEqual(3);
    expect((await a.post('/admin/v1/academy/lessons/md-l1/versions/1/publish', { checks: { ...allChecks, rights: false }, reviewer_name: 'A Reviewer' })).status).toBe(400);
    const ok = await a.post('/admin/v1/academy/lessons/md-l1/versions/1/publish', { checks: allChecks, reviewer_name: 'A Reviewer', notes: 'Checked every number by hand.' });
    expect(ok.status).toBe(200);
    expect((await a.post('/admin/v1/academy/lessons/md-l1/versions/1/publish', { checks: allChecks, reviewer_name: 'A Reviewer' })).status).toBe(409);
    expect((await user.get('/v1/academy/lessons/md-l1')).json.draft).toBe(false);
    const audit = await ctx.db.maybeOne(`SELECT 1 FROM ops.audit_log WHERE action='academy.lesson.publish' AND target_id='md-l1@1'`);
    expect(audit).toBeTruthy();
  });

  it('the database refuses a published lesson without a complete review record', async () => {
    await expect(ctx.db.query(`UPDATE acad.lessons SET status='published', review='{"factual":true}' WHERE lesson_id='md-l2' AND version=1`)).rejects.toThrow(/published_lesson_reviewed/);
  });

  it('answered question content cannot be edited in place; changed source content becomes a new version', async () => {
    await expect(ctx.db.query(`UPDATE acad.questions SET stem='edited' WHERE question_id='md-d01' AND version=1`)).rejects.toThrow(/add a new version/);
    const before = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM acad.questions`);
    expect(await syncCurriculum(ctx.db)).toMatchObject({ new_course_versions: 0, new_lesson_versions: 0, new_question_versions: 0 });
    const edited = structuredClone(CURRICULUM);
    edited[0]!.diagnostic[0]!.stem = 'A share price rises from ₹200 to ₹250. By what percentage did it rise?';
    expect((await syncCurriculum(ctx.db, edited)).new_question_versions).toBe(1);
    const versions = await ctx.db.query<{ version: number; status: string }>(`SELECT version, status FROM acad.questions WHERE question_id='md-d01' ORDER BY version`);
    expect(versions).toEqual([{ version: 1, status: 'retired' }, { version: 2, status: 'in_review' }]);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM acad.questions`)).n).toBe(before.n + 1);
    // A historical attempt that pinned v1 still resolves to the original wording.
    const pinned = await ctx.db.one<{ stem: string }>(`SELECT stem FROM acad.questions WHERE question_id='md-d01' AND version=1`);
    expect(pinned.stem).toContain('What is the percentage increase?');
  });
});
