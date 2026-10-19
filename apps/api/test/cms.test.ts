import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { totpCode } from '../src/lib/crypto.js';
import { DEV_ADMIN_TOTP_SECRET, DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { FIXTURE_CLOCK, fixtureContext } from './fixture.js';

// Content management (PRD ADM-06): methodology and help pages are edited as versioned drafts,
// checked for advice language, reviewed with a checklist, published and audited.

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
const admin = async () => {
  const c = new Client(app);
  expect((await c.login('admin@atlas.test', DEV_PASSWORD, totpCode(DEV_ADMIN_TOTP_SECRET, FIXTURE_CLOCK.getTime()))).status).toBe(200);
  return c;
};
const checks = { factual: true, methodology_consistent: true, advice_language: true, accessibility: true, rights: true };

describe('content management (ADM-06)', () => {
  it('only admins can manage content', async () => {
    const u = new Client(app);
    await u.login('pro@atlas.test', DEV_PASSWORD);
    expect((await u.get('/admin/v1/content')).status).toBe(403);
    expect((await u.post('/admin/v1/content', { kind: 'methodology', slug: 'backtests', title: 'x', sections: [{ heading: 'h', body: 'b' }] })).status).toBe(403);
  });

  it('draft → review → publish replaces the public page; the built-in text is the fallback until then', async () => {
    const a = await admin();
    const before = await new Client(app).get('/v1/methodology/pages/backtests');
    expect(before.json.version).toBe(0);
    const d = await a.post('/admin/v1/content', { kind: 'methodology', slug: 'backtests', title: 'Backtest methodology (revised)', sections: [{ heading: 'Engine', body: 'Signals use the adjusted close; orders fill at the next session’s open.' }] });
    expect(d.status).toBe(200);
    expect((await new Client(app).get('/v1/methodology/pages/backtests')).json.version).toBe(0);
    expect((await a.post(`/admin/v1/content/backtests/versions/${d.json.version}/publish`, { checks, reviewer_name: 'A Reviewer' })).status).toBe(409);
    expect((await a.post(`/admin/v1/content/backtests/versions/${d.json.version}/submit`)).json.status).toBe('in_review');
    expect((await a.post(`/admin/v1/content/backtests/versions/${d.json.version}/publish`, { checks: { ...checks, rights: false }, reviewer_name: 'A Reviewer' })).status).toBe(400);
    expect((await a.post(`/admin/v1/content/backtests/versions/${d.json.version}/publish`, { checks, reviewer_name: 'A Reviewer' })).status).toBe(200);
    const after = await new Client(app).get('/v1/methodology/pages/backtests');
    expect(after.json.title).toBe('Backtest methodology (revised)');
    expect(after.json.version).toBe(d.json.version);
    expect(after.json.data).toBeTruthy(); // live cost tables still attached
    const log = await ctx.db.query<{ action: string }>(`SELECT action FROM ops.audit_log WHERE target_id=$1 ORDER BY audit_id`, [`backtests@${d.json.version}`]);
    expect(log.map((l) => l.action)).toEqual(['content.draft', 'content.submit', 'content.publish']);
  });

  it('a draft with advice language cannot enter review', async () => {
    const a = await admin();
    const d = await a.post('/admin/v1/content', { kind: 'help', slug: 'what-is-a-screener', title: 'Screener tips', sections: [{ heading: 'Tip', body: 'You should buy this stock now; it is a strong buy with a target price of 500.' }] });
    const s = await a.post(`/admin/v1/content/what-is-a-screener/versions/${d.json.version}/submit`);
    expect(s.status).toBe(400);
    expect(s.json.violations.length).toBeGreaterThan(0);
  });

  it('published help articles are served and searchable', async () => {
    const a = await admin();
    const slug = (await new Client(app).get('/v1/help')).json.articles[0].slug;
    const d = await a.post('/admin/v1/content', { kind: 'help', slug, title: 'Updated help article', sections: [{ heading: 'Updated', body: 'Zebracrossing is a unique word for this test.' }] });
    await a.post(`/admin/v1/content/${slug}/versions/${d.json.version}/submit`);
    await a.post(`/admin/v1/content/${slug}/versions/${d.json.version}/publish`, { checks, reviewer_name: 'A Reviewer' });
    expect((await new Client(app).get(`/v1/help/${slug}`)).json.title).toBe('Updated help article');
    expect((await new Client(app).get('/v1/help?q=zebracrossing')).json.articles.map((x: any) => x.slug)).toEqual([slug]);
  });
});
