import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { evaluateTune, GAMES, gradeClassify, publicGame } from '../src/modules/academy/games.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

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
const key = async (refs: { question_id: string; version: number }[]) => {
  const rows = await ctx.db.query<{ question_id: string; correct: Record<string, unknown> }>(`SELECT question_id, correct FROM acad.questions WHERE (question_id, version) IN (SELECT * FROM json_to_recordset($1::json) AS r(question_id text, version int))`, [JSON.stringify(refs)]);
  return (id: string) => {
    const c = rows.find((r) => r.question_id === id)!.correct;
    return 'index' in c ? { index: c.index } : 'indexes' in c ? { indexes: c.indexes } : { value: c.value };
  };
};

describe('games (deterministic, server-graded)', () => {
  it('there are seven games, each tied to a course objective', async () => {
    expect(GAMES.map((g) => g.id).sort()).toEqual(['bias-trap', 'build-the-business', 'evidence-challenge', 'market-replay', 'portfolio-under-pressure', 'statement-surgeon', 'valuation-lab']);
    for (const g of GAMES) expect(await ctx.db.maybeOne(`SELECT 1 FROM acad.objectives WHERE objective_id=$1 AND course_id=$2`, [g.objective_id, g.course_id])).toBeTruthy();
  });
  it('classify games never expose answers publicly and grade exactly', () => {
    for (const g of GAMES.filter((x) => x.mechanic === 'classify')) {
      const pub = JSON.stringify(publicGame(g));
      expect(pub).not.toContain('"correct"');
      expect(pub).not.toContain('"why"');
      if (g.mechanic !== 'classify') continue;
      expect(gradeClassify(g, g.items.map((i) => i.correct)).correct).toBe(g.items.length);
      expect(gradeClassify(g, g.items.map((i) => (i.correct + 1) % g.options.length)).correct).toBe(0);
    }
  });
  it('every tune round is solvable on its parameter grid, and Build the Business is not solved by its defaults', () => {
    for (const g of GAMES) {
      if (g.mechanic !== 'tune') continue;
      for (const r of g.rounds) {
        const grids = r.params.map((p) => { const v: number[] = []; for (let x = p.min; x <= p.max + 1e-9; x += p.step) v.push(Math.round(x * 1000) / 1000); return v; });
        let solved = false;
        const walk = (i: number, acc: Record<string, number>) => {
          if (solved) return;
          if (i === r.params.length) { solved = evaluateTune(g.id, r.fixed, acc).ok; return; }
          for (const v of grids[i]!) walk(i + 1, { ...acc, [r.params[i]!.key]: v });
        };
        walk(0, {});
        expect(solved, `${g.id}: ${r.prompt}`).toBe(true);
      }
    }
    const b = GAMES.find((g) => g.id === 'build-the-business')!;
    if (b.mechanic === 'tune') expect(evaluateTune(b.id, b.rounds[0]!.fixed, Object.fromEntries(b.rounds[0]!.params.map((p) => [p.key, p.default]))).ok).toBe(false);
  });
  it('valuation lab: 4% growth reproduces the lesson DCF (₹1,382.73 crore ≈ EV ₹1,383 crore)', () => {
    const g = GAMES.find((x) => x.id === 'valuation-lab')!;
    if (g.mechanic !== 'tune') throw new Error('unexpected');
    const o = evaluateTune(g.id, g.rounds[0]!.fixed, { growth: 4 });
    expect(o.ok).toBe(true);
    expect(o.metrics.value).toBeCloseTo(1382.73, 2);
  });
  it('play stores a score for the user and does not touch mastery', async () => {
    const u = await signedIn('free@atlas.test');
    const before = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM acad.objective_mastery`);
    const g = (await u.get('/v1/academy/games/bias-trap')).json;
    expect(g.items[0]).not.toHaveProperty('correct');
    const r = await u.post('/v1/academy/games/bias-trap/play', { answers: [0, 1, 2, 3, 4, 0, 1, 2] });
    expect(r.json).toMatchObject({ correct: 8, total: 8 });
    expect((await u.post('/v1/academy/games/bias-trap/play', { answers: [0] })).status).toBe(400);
    const list = await u.get('/v1/academy/games');
    expect(list.json.games.find((x: any) => x.id === 'bias-trap').last.correct).toBe(8);
    expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM acad.objective_mastery`)).n).toBe(before.n);
    const t = await u.post('/v1/academy/games/portfolio-under-pressure/play', { rounds: [{ w_eq: 40, w_bd: 40, w_au: 20 }, { w_eq: 90, w_bd: 5, w_au: 5 }] });
    expect(t.json).toMatchObject({ correct: 1, total: 2 });
    expect((await new Client(app).post('/v1/academy/games/bias-trap/play', { answers: [] })).status).toBe(401);
  });
});

describe('capstone and completion record', () => {
  it('validates the self-assessment and that linked artefacts belong to the submitter', async () => {
    const a = await signedIn('plus@atlas.test');
    const b = await signedIn('pro@atlas.test');
    const cap = await a.get('/v1/academy/courses/market-decoder/capstone');
    expect(cap.status).toBe(200);
    expect(cap.json.rubric).toHaveLength(4);
    const othersNote = (await b.post('/v1/notes', { title: 'not yours' })).json.note_id;
    const text = 'The index rose 0.6% on the session while advances outnumbered declines by roughly 3 to 2, so the move was broad rather than driven by a few heavyweights.';
    const assess = Object.fromEntries(cap.json.rubric.map((r: any) => [r.criterion, 2]));
    expect((await a.post('/v1/academy/courses/market-decoder/capstone', { body: text, artefacts: [], self_assessment: {} })).status).toBe(400);
    expect((await a.post('/v1/academy/courses/market-decoder/capstone', { body: text, artefacts: [{ kind: 'note', id: othersNote }], self_assessment: assess })).status).toBe(404);
    expect((await a.post('/v1/academy/courses/market-decoder/capstone', { body: text, artefacts: [], self_assessment: assess })).status).toBe(400);
    const mine = (await a.post('/v1/notes', { title: 'Session explained', body: text })).json.note_id;
    const ok = await a.post('/v1/academy/courses/market-decoder/capstone', { body: text, artefacts: [{ kind: 'note', id: mine }], self_assessment: assess });
    expect(ok.json.status).toBe('submitted');
    expect((await b.get('/v1/academy/courses/market-decoder/capstone')).json.submissions).toEqual([]);
  });

  it('issues a completion record only when every rule is met, stating what was assessed', async () => {
    const u = await signedIn('plus@atlas.test');
    const before = await u.get('/v1/academy/courses/market-decoder/completion');
    expect(before.json.eligible).toBe(false);
    expect((await u.post('/v1/academy/courses/market-decoder/completion')).status).toBe(409);
    const course = (await u.get('/v1/academy/courses/market-decoder')).json;
    for (const m of course.modules) {
      for (const l of m.lessons) {
        const lesson = (await u.get(`/v1/academy/lessons/${l.lesson_id}`)).json;
        const k = await key(lesson.quiz);
        const r = await u.post(`/v1/academy/lessons/${l.lesson_id}/quiz`, { answers: lesson.quiz.map((q: any) => ({ question_id: q.question_id, version: q.version, response: k(q.question_id) })) });
        expect(r.json.score).toBe(1);
      }
    }
    const after = await u.get('/v1/academy/courses/market-decoder/completion');
    expect(after.json.lessons_completed).toBe(after.json.lessons);
    expect(after.json.mastered).toBe(after.json.objectives.length);
    expect(after.json.eligible).toBe(true);
    const rec = await u.post('/v1/academy/courses/market-decoder/completion');
    expect(rec.json.already).toBe(false);
    expect(rec.json.record.statement).toMatch(/not a professional qualification/);
    expect(rec.json.record.assessed.content_status).toBe('draft (pending expert review)');
    expect(rec.json.record.assessed.capstone.assessment).toBe('self-assessed against the published rubric');
    expect(rec.json.record.assessed.objectives.every((o: any) => o.demonstrated)).toBe(true);
    expect((await u.post('/v1/academy/courses/market-decoder/completion')).json.already).toBe(true);
    const other = await signedIn('free@atlas.test');
    expect((await other.get('/v1/academy/courses/market-decoder/completion')).json.record).toBeNull();
  });

  it('admin review marks a submission as reviewed and is audited', async () => {
    const { totpCode } = await import('../src/lib/crypto.js');
    const { DEV_ADMIN_TOTP_SECRET } = await import('../src/seed.js');
    const { FIXTURE_CLOCK } = await import('./fixture.js');
    const admin = new Client(app);
    await admin.login('admin@atlas.test', DEV_PASSWORD, totpCode(DEV_ADMIN_TOTP_SECRET, FIXTURE_CLOCK.getTime()));
    const list = await admin.get('/admin/v1/academy/capstones');
    const sid = list.json.submissions[0].submission_id;
    const rubric = (await ctx.db.one<{ rubric: { criterion: string }[] }>(`SELECT c.rubric FROM acad.capstones c JOIN acad.capstone_submissions s ON s.course_id=c.course_id AND s.capstone_version=c.version WHERE s.submission_id=$1`, [sid])).rubric;
    const r = await admin.post(`/admin/v1/academy/capstones/${sid}/review`, { scores: Object.fromEntries(rubric.map((x) => [x.criterion, 3])), comments: 'Accurate, evidence-linked and clearly written.', reviewer_name: 'A Reviewer' });
    expect(r.json.status).toBe('reviewed');
    expect(await ctx.db.maybeOne(`SELECT 1 FROM ops.audit_log WHERE action='academy.capstone.review' AND target_id=$1`, [sid])).toBeTruthy();
  });
});
