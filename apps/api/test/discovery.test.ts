import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { explore, periodChanges, weekEnd, type Loaded } from '../src/modules/macro/explorer.js';
import { notifyFollowers, weeklyDigests } from '../src/modules/macro/follows.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Universal search, the macro relationship explorer, series follows with release notices, the weekly
// digest, display preferences and the Home "what changed" panel. Observations are written directly to
// the test database; no test touches the network.

let clockMs = Date.parse('2026-10-28T06:00:00Z');
const now = () => new Date(clockMs);
const day = (s: string) => Date.parse(`${s}T00:00:00Z`);

let ctx: AppContext;
let app: FastifyInstance;
let pro: Client;
let free: Client;
const uid = async (email: string) => (await ctx.db.one<{ user_id: string }>(`SELECT user_id FROM app.users WHERE email=$1`, [email])).user_id;

/** Monthly observations on the last day of each month, Jan 2023 onwards, from a generator of values. */
async function monthly(seriesId: string, units: string, values: number[], publishedLag = 20) {
  await ctx.db.query(`INSERT INTO macro.series (series_id, category, title, units, frequency) VALUES ($1,'rates',$2,$3,'Monthly') ON CONFLICT (series_id) DO UPDATE SET units=EXCLUDED.units, frequency='Monthly'`, [seriesId, `Test series ${seriesId}`, units]);
  await ctx.db.query(`DELETE FROM macro.observations WHERE series_id=$1`, [seriesId]);
  for (let i = 0; i < values.length; i++) {
    const d = new Date(Date.UTC(2023, i + 1, 0)).toISOString().slice(0, 10);
    const p = new Date(Date.UTC(2023, i + 1, publishedLag)).toISOString().slice(0, 10);
    await ctx.db.query(`INSERT INTO macro.observations (series_id, obs_date, value, published_at, retrieved_at) VALUES ($1,$2,$3,$4,now())`, [seriesId, d, values[i], p]);
  }
  await ctx.db.query(`UPDATE macro.series SET observations=$2, enabled=true WHERE series_id=$1`, [seriesId, values.length]);
}

beforeAll(async () => {
  ctx = await fixtureContext({ clock: now });
  app = await buildApp(ctx);
  pro = new Client(app);
  await pro.login('pro@atlas.test', DEV_PASSWORD);
  free = new Client(app);
  await free.login('free@atlas.test', DEV_PASSWORD);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});

describe('explorer arithmetic', () => {
  const mk = (pts: [string, number][], percentUnits = false): Loaded => ({ key: 'k', label: 'k', units: '', source: '', frequency: 'Monthly', obs: pts.map(([d, v]) => ({ t: day(d), v })), percentUnits });

  it('percent series change in percentage points; others in %; gaps give no change', () => {
    const pp = periodChanges(mk([['2024-01-31', 4], ['2024-02-29', 4.25], ['2024-04-30', 4.5]]).obs, 'monthly', true);
    expect(pp.get('2024-02')!.change).toBeCloseTo(0.25, 10);
    expect(pp.get('2024-04')!.change).toBeNull(); // March is missing: no change across the gap
    const pc = periodChanges(mk([['2024-01-31', 100], ['2024-02-29', 110]]).obs, 'monthly', false);
    expect(pc.get('2024-02')!.change).toBeCloseTo(0.1, 10);
  });

  it('a month is represented by its last observation; a week by its last session', () => {
    const m = periodChanges(mk([['2024-01-10', 1], ['2024-01-31', 2], ['2024-02-15', 3]]).obs, 'monthly', true);
    expect(m.get('2024-01')!.level).toBe(2);
    const w = weekEnd(mk([['2024-03-04', 1], ['2024-03-08', 2], ['2024-03-11', 3]]).obs); // Mon, Fri, next Mon
    expect(w.map((o) => o.v)).toEqual([2, 3]);
  });

  it('identical percentage moves correlate at +1, opposite moves at −1; fewer than 12 periods give no figure', () => {
    const levels = Array.from({ length: 30 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i * 1.7)) ** i);
    const dates = levels.map((_, i) => new Date(Date.UTC(2022, i + 1, 0)).toISOString().slice(0, 10));
    const a = mk(dates.map((d, i) => [d, levels[i]!]));
    const b = mk(dates.map((d, i) => [d, 3 * levels[i]!]));
    const inv = mk(dates.map((d, i) => [d, 1 / levels[i]!]));
    const r = explore(a, b, 'monthly', 12);
    expect(r.n).toBe(29);
    expect(r.correlation).toBeCloseTo(1, 8);
    expect(r.rolling).toHaveLength(29 - 12 + 1);
    expect(explore(a, inv, 'monthly', 12).correlation!).toBeLessThan(-0.95); // 1/x moves are nearly, not exactly, opposite
    const short = explore(mk(dates.slice(0, 10).map((d, i) => [d, levels[i]!])), mk(dates.slice(0, 10).map((d, i) => [d, levels[i]! * 2])), 'monthly', 6);
    expect(short.correlation).toBeNull();
  });
});

describe('explorer API', () => {
  it('compares two stored series, refuses weekly for monthly data, and records the study once', async () => {
    const base = Array.from({ length: 36 }, (_, i) => 4 + Math.sin(i / 3));
    await monthly('TESTA', 'Percent', base);
    await monthly('TESTB', 'Index', base.map((v) => 100 + 10 * v));
    const r = await pro.post('/v1/macro/explore', { a: 'macro:TESTA', b: 'macro:TESTB', frequency: 'monthly', window: 12 });
    expect(r.status).toBe(200);
    expect(r.json.n).toBe(35);
    expect(r.json.correlation).toBeGreaterThan(0.95);
    expect(r.json.a.change_unit).toBe('change in percentage points');
    expect(r.json.b.change_unit).toBe('% change');
    expect(r.json.caveats.join(' ')).toMatch(/causation/);
    const weekly = await pro.post('/v1/macro/explore', { a: 'macro:TESTA', b: 'macro:TESTB', frequency: 'weekly', window: 12 });
    expect(weekly.status).toBe(400);
    expect((await pro.post('/v1/macro/explore', { a: 'macro:TESTA', b: 'macro:TESTA' })).status).toBe(400);
    expect((await pro.post('/v1/macro/explore', { a: 'macro:NOPE', b: 'macro:TESTA' })).status).toBe(404);
    await pro.post('/v1/macro/explore', { a: 'macro:TESTA', b: 'macro:TESTB', frequency: 'monthly', window: 12 });
    const n = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM research.activity WHERE user_id=$1 AND kind='correlation_study' AND ref LIKE 'explorer|macro:TESTA|macro:TESTB%'`, [await uid('pro@atlas.test')]);
    expect(n.n).toBe(1);
    const opts = (await pro.get('/v1/macro/explorer/options')).json;
    expect(opts.groups[0].items.map((i: { key: string }) => i.key)).toContain('macro:TESTA');
  });

  it('requires a signed-in user', async () => {
    expect((await new Client(app).post('/v1/macro/explore', { a: 'macro:TESTA', b: 'macro:TESTB' })).status).toBe(401);
  });
});

describe('universal search', () => {
  it('finds stored series by alias and pages by name; explains known gaps', async () => {
    const r = (await pro.get('/v1/find?q=settings')).json;
    expect(r.hits.some((h: { href: string }) => h.href === '/app/settings')).toBe(true);
    const gold = (await pro.get('/v1/find?q=gold')).json;
    expect(gold.gaps.join(' ')).toMatch(/Gold and silver prices are not available/);
    const shares = (await pro.get('/v1/find?q=reliance')).json;
    expect(shares.gaps.join(' ')).toMatch(/Individual Indian shares/);
    const test = (await pro.get('/v1/find?q=TESTA')).json;
    expect(test.hits[0]).toMatchObject({ kind: 'macro', href: '/app/macro/TESTA' });
  });

  it("returns the user's own research and never anyone else's", async () => {
    await ctx.db.query(`INSERT INTO research.notebook_entries (user_id, kind, title) VALUES ($1,'note','Zebracorn thesis on yields')`, [await uid('pro@atlas.test')]);
    const mine = (await pro.get('/v1/find?q=zebracorn')).json;
    expect(mine.hits.filter((h: { kind: string }) => h.kind === 'research')).toHaveLength(1);
    const theirs = (await free.get('/v1/find?q=zebracorn')).json;
    expect(theirs.hits.filter((h: { kind: string }) => h.kind === 'research')).toHaveLength(0);
    expect((await new Client(app).get('/v1/find?q=zebracorn')).status).toBe(401);
  });

  it('ranks the markets chosen in Settings higher', async () => {
    expect((await pro.patch('/v1/me', { display_prefs: { markets: ['us'] } })).status).toBe(200);
    const r = (await pro.get('/v1/find?q=test')).json;
    expect(r.hits[0].kind).toBe('macro');
  });
});

describe('display preferences', () => {
  it('accepts known keys and rejects unknown keys, unknown panels and duplicates', async () => {
    const ok = await pro.patch('/v1/me', { display_prefs: { home_panels: ['macro', 'attention'], notify: { releases: true, digest: false }, show_streak: false, theme: 'light' } });
    expect(ok.status).toBe(200);
    const me = (await pro.get('/v1/me')).json;
    expect(me.profile.display_prefs).toMatchObject({ home_panels: ['macro', 'attention'], show_streak: false, theme: 'light', markets: ['us'] });
    expect((await pro.patch('/v1/me', { display_prefs: { evil: 'x'.repeat(10_000) } })).status).toBe(400);
    expect((await pro.patch('/v1/me', { display_prefs: { home_panels: ['nope'] } })).status).toBe(400);
    expect((await pro.patch('/v1/me', { display_prefs: { home_panels: ['macro', 'macro'] } })).status).toBe(400);
    // First-run welcome (session 13): dismissing it is stored without touching other preferences, and can be undone.
    expect((await pro.patch('/v1/me', { display_prefs: { tour_done: true } })).status).toBe(200);
    expect((await pro.get('/v1/me')).json.profile.display_prefs).toMatchObject({ tour_done: true, home_panels: ['macro', 'attention'], theme: 'light' });
    expect((await pro.patch('/v1/me', { display_prefs: { tour_done: false } })).status).toBe(200);
    expect((await pro.get('/v1/me')).json.profile.display_prefs.tour_done).toBe(false);
    expect((await pro.patch('/v1/me', { display_prefs: { tour_done: 'yes' } })).status).toBe(400);
    // Onboarding goal (session 13): one of three values, stored alongside the other preferences.
    expect((await pro.patch('/v1/me', { display_prefs: { goal: 'learn', markets: ['crypto'] } })).status).toBe(200);
    expect((await pro.get('/v1/me')).json.profile.display_prefs).toMatchObject({ goal: 'learn', markets: ['crypto'] });
    expect((await pro.patch('/v1/me', { display_prefs: { goal: 'trade' } })).status).toBe(400);
    expect((await pro.patch('/v1/me', { display_prefs: { theme: 'neon' } })).status).toBe(400);
  });
});

describe('follows, release notices and the weekly digest', () => {
  const notices = async (email: string, kind: string) => (await ctx.db.query<{ title: string; body: string; href: string }>(`SELECT title, body, href FROM app.notifications WHERE user_id=$1 AND kind=$2 ORDER BY created_at`, [await uid(email), kind]));

  it('validates the series and never notifies about the backlog that existed when following', async () => {
    expect((await pro.put('/v1/follows', { key: 'macro:NOSUCH', follow: true })).status).toBe(404);
    expect((await pro.put('/v1/follows', { key: 'drop table', follow: true })).status).toBe(400);
    expect((await pro.put('/v1/follows', { key: 'macro:TESTA', follow: true })).json).toEqual({ following: true });
    expect((await free.put('/v1/follows', { key: 'macro:TESTA', follow: true })).json).toEqual({ following: true });
    const list = (await pro.get('/v1/follows')).json.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'macro:TESTA', href: '/app/macro/TESTA', latest: '2025-12-31' });
    expect(await notifyFollowers(ctx.db)).toBe(0);
  });

  it('a newer observation produces one notice per follower, once; turning notices off is respected', async () => {
    await free.patch('/v1/me', { display_prefs: { notify: { releases: false } } });
    await ctx.db.query(`INSERT INTO macro.observations (series_id, obs_date, value, published_at, retrieved_at) VALUES ('TESTA','2026-01-31',4.5,'2026-10-27',now())`);
    expect(await notifyFollowers(ctx.db)).toBe(1);
    expect(await notifyFollowers(ctx.db)).toBe(0);
    const mine = await notices('pro@atlas.test', 'series_release');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'New data: Test series TESTA', href: '/app/macro/TESTA' });
    expect(mine[0]!.body).toMatch(/2026-01-31.*4\.5/);
    expect(await notices('free@atlas.test', 'series_release')).toHaveLength(0);
    // The marker advanced while notices were off, so turning them on does not replay that release.
    await free.patch('/v1/me', { display_prefs: { notify: { releases: true } } });
    expect(await notifyFollowers(ctx.db)).toBe(0);
  });

  it('Home "what changed" lists recent releases and the follows; unfollow removes them', async () => {
    const a = (await pro.get('/v1/home/attention')).json;
    expect(a.releases.map((r: { href: string }) => r.href)).toContain('/app/macro/TESTA');
    expect(a.following.map((f: { key: string }) => f.key)).toEqual(['macro:TESTA']);
    expect((await pro.put('/v1/follows', { key: 'macro:TESTA', follow: false })).json).toEqual({ following: false });
    expect((await pro.get('/v1/home/attention')).json.following).toEqual([]);
  });

  it('the weekly digest is opt-in and sent at most once a week', async () => {
    await pro.patch('/v1/me', { display_prefs: { notify: { releases: true, digest: true } } });
    const before = (await notices('free@atlas.test', 'weekly_digest')).length;
    expect(await weeklyDigests(ctx.db, now())).toBeGreaterThanOrEqual(1);
    expect(await notices('pro@atlas.test', 'weekly_digest')).toHaveLength(1);
    expect((await notices('free@atlas.test', 'weekly_digest')).length).toBe(before);
    expect(await weeklyDigests(ctx.db, now())).toBe(0);
    clockMs += 7 * 86_400_000;
    expect(await weeklyDigests(ctx.db, now())).toBeGreaterThanOrEqual(1);
    expect(await notices('pro@atlas.test', 'weekly_digest')).toHaveLength(2);
  });
});
