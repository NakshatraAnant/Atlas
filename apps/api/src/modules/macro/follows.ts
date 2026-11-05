import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';

// Follows for macro and commodity series, the Home "what changed" panel and the opt-in weekly digest.
// A follower is told once per new observation period (never for the backlog that existed when they
// followed), and only if release notices are on in Settings. Everything is built from stored data.

export const FOLLOW_KEY = /^(macro:[A-Z0-9_]{2,40}|commodity:(fred|eia):[A-Za-z0-9_.-]{2,40})$/;
const MAX_FOLLOWS = 50;

interface Target { key: string; title: string; href: string; latest: string | null; value: number | null; unit: string | null }

/** Name, link and latest stored observation for a follow key, or null when ATLAS has no such series. */
export async function followTarget(db: Db, key: string): Promise<Target | null> {
  if (key.startsWith('macro:')) {
    const id = key.slice(6);
    const s = await db.maybeOne<{ title: string; units: string | null; d: string | null; v: number | null }>(
      `SELECT s.title, s.units, to_char(o.obs_date,'YYYY-MM-DD') AS d, o.value::float8 AS v FROM macro.series s
         LEFT JOIN LATERAL (SELECT obs_date, value FROM macro.observations WHERE series_id=s.series_id ORDER BY obs_date DESC LIMIT 1) o ON true WHERE s.series_id=$1`, [id]);
    return s ? { key, title: s.title, href: `/app/macro/${id}`, latest: s.d, value: s.v, unit: s.units } : null;
  }
  const id = key.slice(10);
  const s = await db.maybeOne<{ name: string; unit: string; source_id: string; source_series: string; d: string | null; v: number | null }>(
    `SELECT s.name, s.unit, s.source_id, s.source_series, to_char(o.obs_date,'YYYY-MM-DD') AS d, o.value::float8 AS v FROM commodity.series s
       LEFT JOIN LATERAL (SELECT obs_date, value FROM commodity.observations WHERE series_id=s.series_id ORDER BY obs_date DESC LIMIT 1) o ON true WHERE s.series_id=$1`, [id]);
  return s ? { key, title: s.name, href: `/app/commodities/${s.source_id}/${s.source_series}`, latest: s.d, value: s.v, unit: s.unit } : null;
}

const prefOn = (prefs: Record<string, any> | null | undefined, name: 'releases' | 'digest', dflt: boolean) => {
  const v = prefs?.notify?.[name];
  return typeof v === 'boolean' ? v : dflt;
};

/** After a refresh: one notice per follower per newer observation period. Returns notices written. */
export async function notifyFollowers(db: Db): Promise<number> {
  const follows = await db.query<{ user_id: string; series_key: string; notified_through: string | null; display_prefs: Record<string, unknown> }>(
    `SELECT f.user_id, f.series_key, to_char(f.notified_through,'YYYY-MM-DD') AS notified_through, u.display_prefs FROM app.series_follows f JOIN app.users u USING (user_id) WHERE u.deleted_at IS NULL`);
  const cache = new Map<string, Target | null>();
  let sent = 0;
  for (const f of follows) {
    if (!cache.has(f.series_key)) cache.set(f.series_key, await followTarget(db, f.series_key));
    const t = cache.get(f.series_key);
    if (!t?.latest || (f.notified_through && t.latest <= f.notified_through)) continue;
    // Advance the marker even when notices are off, so turning them on later does not replay old releases.
    await db.query(`UPDATE app.series_follows SET notified_through=$3 WHERE user_id=$1 AND series_key=$2`, [f.user_id, f.series_key, t.latest]);
    if (!f.notified_through || !prefOn(f.display_prefs, 'releases', true)) continue;
    const value = t.value === null ? '' : `: ${t.value.toLocaleString('en-IN', { maximumFractionDigits: 3 })}${t.unit ? ` (${t.unit})` : ''}`;
    await db.query(`INSERT INTO app.notifications (user_id, kind, title, body, href) VALUES ($1,'series_release',$2,$3,$4)`,
      [f.user_id, `New data: ${t.title}`.slice(0, 200), `A newer observation for ${t.latest} is stored${value}.`, t.href]);
    sent++;
  }
  return sent;
}

/** Opt-in weekly digest (at most one per 7 days): followed series that changed and the week's learning. */
export async function weeklyDigests(db: Db, now: Date): Promise<number> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const users = await db.query<{ user_id: string }>(
    `SELECT u.user_id FROM app.users u WHERE u.deleted_at IS NULL AND (u.display_prefs->'notify'->>'digest') = 'true'
       AND NOT EXISTS (SELECT 1 FROM app.notifications n WHERE n.user_id=u.user_id AND n.kind='weekly_digest' AND n.created_at > $1)`, [new Date(now.getTime() - 6.5 * 86_400_000).toISOString()]);
  let sent = 0;
  for (const u of users) {
    const follows = await db.query<{ series_key: string }>(`SELECT series_key FROM app.series_follows WHERE user_id=$1`, [u.user_id]);
    const updated: string[] = [];
    for (const f of follows) {
      const t = await followTarget(db, f.series_key);
      if (t?.latest && t.latest >= weekAgo.slice(0, 10)) updated.push(t.title);
    }
    const learn = await db.one<{ n: number; xp: number }>(`SELECT count(*)::int AS n, COALESCE(sum(xp),0)::int AS xp FROM acad.learning_events WHERE user_id=$1 AND occurred_at > $2`, [u.user_id, weekAgo]);
    const research = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM research.activity WHERE user_id=$1 AND occurred_at > $2`, [u.user_id, weekAgo]);
    const parts = [
      follows.length ? `${updated.length} of your ${follows.length} followed series have newer data${updated.length ? ` (${updated.slice(0, 3).join(', ')}${updated.length > 3 ? ', …' : ''})` : ''}.` : 'You are not following any series yet.',
      `This week: ${learn.n} learning step${learn.n === 1 ? '' : 's'} (${learn.xp} XP) and ${research.n} research activit${research.n === 1 ? 'y' : 'ies'}.`,
    ];
    await db.query(`INSERT INTO app.notifications (user_id, kind, title, body, href, created_at) VALUES ($1,'weekly_digest','Your weekly summary',$2,'/app',$3)`, [u.user_id, parts.join(' '), now.toISOString()]);
    sent++;
  }
  return sent;
}

export async function followRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/follows', async (req) => {
    const u = requireUser(req);
    const rows = await ctx.db.query<{ series_key: string; created_at: string }>(`SELECT series_key, created_at FROM app.series_follows WHERE user_id=$1 ORDER BY created_at`, [u.userId]);
    const items = [];
    for (const r of rows) {
      const t = await followTarget(ctx.db, r.series_key);
      if (t) items.push({ ...t, followed_at: r.created_at });
    }
    return { items };
  });

  app.put('/v1/follows', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ key: z.string().regex(FOLLOW_KEY), follow: z.boolean() }), req.body);
    if (!b.follow) {
      await ctx.db.query(`DELETE FROM app.series_follows WHERE user_id=$1 AND series_key=$2`, [u.userId, b.key]);
      return { following: false };
    }
    const t = await followTarget(ctx.db, b.key);
    if (!t) throw notFound('ATLAS does not store that series.');
    const n = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.series_follows WHERE user_id=$1`, [u.userId]);
    if (n.n >= MAX_FOLLOWS) throw badRequest(`You can follow up to ${MAX_FOLLOWS} series.`);
    await ctx.db.query(`INSERT INTO app.series_follows (user_id, series_key, notified_through) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [u.userId, b.key, t.latest]);
    return { following: true };
  });

  // Home: what changed recently, from stored data only. Releases are macro observations whose FRED
  // vintage date falls in the last 7 days; moves are the largest one-month commodity changes.
  app.get('/v1/home/attention', async (req) => {
    const u = requireUser(req);
    const now = ctx.clock();
    const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const releases = await ctx.db.query<{ series_id: string; title: string; units: string | null; d: string; v: number; p: string }>(
      `SELECT DISTINCT ON (o.series_id) o.series_id, s.title, s.units, to_char(o.obs_date,'YYYY-MM-DD') AS d, o.value::float8 AS v, to_char(o.published_at,'YYYY-MM-DD') AS p
         FROM macro.observations o JOIN macro.series s USING (series_id) WHERE o.published_at >= $1 AND s.frequency NOT ILIKE 'daily%' ORDER BY o.series_id, o.obs_date DESC`, [since]);
    const moves = await ctx.db.query<{ series_id: string; name: string; source_id: string; source_series: string; unit: string; d: string; v: number; prev: number }>(
      `SELECT s.series_id, s.name, s.source_id, s.source_series, s.unit, to_char(l.obs_date,'YYYY-MM-DD') AS d, l.value::float8 AS v, p.value::float8 AS prev
         FROM commodity.series s
         JOIN LATERAL (SELECT obs_date, value FROM commodity.observations WHERE series_id=s.series_id ORDER BY obs_date DESC LIMIT 1) l ON true
         JOIN LATERAL (SELECT value FROM commodity.observations WHERE series_id=s.series_id AND obs_date <= l.obs_date - 28 ORDER BY obs_date DESC LIMIT 1) p ON true
        WHERE s.enabled AND s.price_type IN ('spot','average_price','index') AND s.frequency='daily' AND l.obs_date >= $1::date - 14 AND p.value > 0`, [since]);
    const follows = await ctx.db.query<{ series_key: string }>(`SELECT series_key FROM app.series_follows WHERE user_id=$1 ORDER BY created_at`, [u.userId]);
    const following = [];
    for (const f of follows.slice(0, 12)) {
      const t = await followTarget(ctx.db, f.series_key);
      if (t) following.push(t);
    }
    return {
      as_of: now.toISOString(),
      releases: releases.sort((a, b) => b.p.localeCompare(a.p)).slice(0, 8).map((r) => ({ title: r.title, href: `/app/macro/${r.series_id}`, period: r.d, value: r.v, units: r.units, published: r.p })),
      moves: moves.map((m) => ({ title: m.name, href: `/app/commodities/${m.source_id}/${m.source_series}`, date: m.d, value: m.v, unit: m.unit, change: m.v / m.prev - 1 }))
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5),
      following,
      notes: ['Releases: observations FRED first published in the last 7 days (its vintage date), monthly and slower series only.', 'Moves: change over about one month for daily commodity benchmarks.'],
    };
  });
}
