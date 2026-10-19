import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { runRetention } from '../src/bootstrap.js';
import type { AppContext } from '../src/context.js';
import { dailyMissionMet, levelFor, localDate, streak, weeklyStreak, weekStart, XP_RULES, xpForLevel } from '../src/modules/academy/learning.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

describe('learning engine rules (pure)', () => {
  it('levels follow 50·n·(n−1) XP', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000]);
    expect(levelFor(0)).toMatchObject({ level: 1, next_level_at: 100 });
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(650)).toMatchObject({ level: 4, level_start: 600, next_level_at: 1000 });
  });

  it('local dates follow the learner timezone across midnight', () => {
    // 19:00 UTC on 19 Oct is 00:30 IST on 20 Oct.
    expect(localDate('2026-10-19T19:00:00Z', 'Asia/Kolkata')).toBe('2026-10-20');
    expect(localDate('2026-10-19T19:00:00Z', 'UTC')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // Sunday → Monday of that week
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
  });

  it('a streak survives until today ends, bridges one rest day per week, and ends after two missed days', () => {
    const d = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;
    // Active 15–18, today (19th) not yet: streak 4, still alive.
    expect(streak([d(15), d(16), d(17), d(18)], d(19))).toMatchObject({ current: 4, today_active: false });
    // One missed day (17th) between active days is a rest day: 14,15,16,_,18,19 → 5.
    expect(streak([d(14), d(15), d(16), d(18), d(19)], d(19))).toMatchObject({ current: 5, rest_days_in_current: 1 });
    // Two rest days within a week are not both bridged.
    expect(streak([d(12), d(14), d(16), d(17)], d(17)).current).toBe(3);
    // Missed yesterday but active the day before: today can still bridge it.
    expect(streak([d(16), d(17)], d(19))).toMatchObject({ current: 2, rest_days_in_current: 1 });
    expect(streak([d(17)], d(19))).toMatchObject({ current: 1, rest_days_in_current: 1 });
    // Two consecutive missed days end it.
    expect(streak([d(10), d(11), d(12)], d(15)).current).toBe(0);
    expect(streak([d(10), d(11), d(12)], d(15)).longest).toBe(3);
  });

  it('weekly streak counts consecutive weeks meeting the goal', () => {
    const days = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-19'];
    expect(weeklyStreak(days, '2026-10-20', 3)).toMatchObject({ current: 2, this_week_days: 1 });
    expect(weeklyStreak(days, '2026-10-20', 4).current).toBe(0);
  });

  it('the daily mission needs real learning, not one review', () => {
    expect(dailyMissionMet([{ kind: 'lesson_completed' }])).toBe(true);
    expect(dailyMissionMet([{ kind: 'review_recalled' }])).toBe(false);
    expect(dailyMissionMet([{ kind: 'review_recalled' }, { kind: 'review_recalled' }, { kind: 'review_recalled' }])).toBe(true);
  });
});

describe('learner dashboard (/v1/academy/me)', () => {
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
    return (id: string) => { const c = rows.find((r) => r.question_id === id)!.correct; return 'index' in c ? { index: c.index } : 'indexes' in c ? { indexes: c.indexes } : { value: c.value }; };
  };
  const wrong = (q: any) => (q.qtype === 'numeric' ? { value: -999 } : q.qtype === 'multi_select' ? { indexes: [] } : { index: 19 });

  it('requires sign-in', async () => {
    expect((await new Client(app).get('/v1/academy/me')).status).toBe(401);
  });

  it('a new learner starts at level 1 with honest empty state and a rule-based first step', async () => {
    const u = await signedIn('plus@atlas.test');
    const me = (await u.get('/v1/academy/me')).json;
    expect(me.xp).toMatchObject({ level: 1, xp: 0 });
    expect(me.streak.daily.current).toBe(0);
    expect(me.achievements.every((a: any) => a.unlocked_at === null)).toBe(true);
    expect(me.recommendation.kind).toBe('start');
    expect(me.recommendation.reason).toMatch(/^Rule 6/);
    expect(me.xp_rules.length).toBe(Object.keys(XP_RULES).length);
    expect(me.notes.join(' ')).toMatch(/not AI-generated/);
  });

  it('XP is earned once per qualifying record, error recovery is rewarded, and repeats earn nothing', async () => {
    const u = await signedIn('free@atlas.test');
    const l = await u.get('/v1/academy/lessons/md-l3');
    const k = await key(l.json.quiz);
    const submit = (resp: (q: any) => unknown) => u.post('/v1/academy/lessons/md-l3/quiz', { answers: l.json.quiz.map((q: any) => ({ question_id: q.question_id, version: q.version, response: resp(q) })) });
    expect((await submit(wrong)).status).toBe(200);
    const after1 = (await u.get('/v1/academy/me')).json;
    expect(after1.xp.xp).toBe(XP_RULES.lesson_completed.xp + XP_RULES.daily_mission.xp);
    expect((await submit((q) => k(q.question_id))).status).toBe(200);
    const after2 = (await u.get('/v1/academy/me')).json;
    // + perfect quiz + recovered from earlier mistakes + objective md-o3 mastered.
    expect(after2.xp.xp).toBe(after1.xp.xp + XP_RULES.quiz_perfect.xp + XP_RULES.error_recovered.xp + XP_RULES.objective_mastered.xp);
    // Submitting the same perfect quiz again and reloading earns nothing more.
    await submit((q) => k(q.question_id));
    expect((await u.get('/v1/academy/me')).json.xp.xp).toBe(after2.xp.xp);
    const rows = await ctx.db.query<{ kind: string; n: number }>(`SELECT kind, count(*)::int AS n FROM acad.learning_events e JOIN app.users u USING (user_id) WHERE u.email='free@atlas.test' GROUP BY kind ORDER BY kind`);
    expect(rows).toEqual([
      { kind: 'daily_mission', n: 1 }, { kind: 'error_recovered', n: 1 }, { kind: 'lesson_completed', n: 1 }, { kind: 'objective_mastered', n: 1 }, { kind: 'quiz_perfect', n: 1 },
    ]);
    const ach = after2.achievements;
    for (const id of ['first-lesson', 'first-mastery', 'learned-from-mistake']) expect(ach.find((a: any) => a.id === id).unlocked_at).toBeTruthy();
    expect(ach.find((a: any) => a.id === 'market-foundations')).toMatchObject({ unlocked_at: null, progress: [1, 9] });
    expect(after2.streak.daily).toMatchObject({ current: 1, today_active: true });
    expect(after2.missions.find((m: any) => m.id === 'daily').done).toBe(true);
    expect(after2.recommendation.kind).toBe('next');
  });

  it("one learner's ledger is never visible to another", async () => {
    const other = await signedIn('plus@atlas.test');
    const me = (await other.get('/v1/academy/me')).json;
    expect(me.xp.xp).toBe(0);
    expect(me.recent).toEqual([]);
  });

  it('settings are validated on the server', async () => {
    const u = await signedIn('plus@atlas.test');
    expect((await u.put('/v1/academy/me/settings', { timezone: 'Mars/Olympus', weekly_goal_days: 3 })).status).toBe(400);
    expect((await u.put('/v1/academy/me/settings', { timezone: 'Asia/Kolkata', weekly_goal_days: 9 })).status).toBe(400);
    expect((await u.put('/v1/academy/me/settings', { timezone: 'Europe/London', weekly_goal_days: 4 })).status).toBe(200);
    expect((await u.get('/v1/academy/me')).json.settings).toEqual({ timezone: 'Europe/London', weekly_goal_days: 4 });
  });

  it('account erasure removes Academy learning records and the ledger', async () => {
    const uid = (await ctx.db.one<{ user_id: string }>(`SELECT user_id FROM app.users WHERE email='free@atlas.test'`)).user_id;
    await ctx.db.query(`INSERT INTO app.account_deletions (user_id, requested_at, erase_after) VALUES ($1, now() - interval '40 days', now() - interval '1 day') ON CONFLICT (user_id) DO UPDATE SET erase_after = EXCLUDED.erase_after, erased_at = NULL`, [uid]);
    await runRetention(ctx);
    for (const t of ['acad.learning_events', 'acad.achievement_unlocks', 'acad.quiz_attempts', 'acad.lesson_progress', 'acad.objective_mastery']) {
      expect((await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE user_id=$1`, [uid])).n).toBe(0);
    }
  });
});
