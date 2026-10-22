import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Regression for "the user cannot see the courses": every content item is still in expert review,
// so with drafts hidden the catalogue used to be empty and every course URL returned 404.
const TITLES = ['ATLAS: MARKET DECODER', 'ATLAS: EQUITY DETECTIVE', 'ATLAS: SIGNAL ENGINEER', 'ATLAS: MARKET ARCHITECT', 'ATLAS: CRYPTO MARKET DECODER', 'ATLAS: TOKENOMICS DETECTIVE', 'ATLAS: ON-CHAIN SIGNAL ENGINEER', 'ATLAS: DIGITAL ASSET ARCHITECT'];
const cfg = (showDrafts: 'true' | 'false') =>
  loadConfig({ NODE_ENV: 'test', APP_SECRET: 'test-secret-test-secret-test-secret-test', LOG_LEVEL: 'silent', RATE_LIMIT_MULTIPLIER: '1000', WEB_ORIGIN: 'http://localhost:3000', ACADEMY_SHOW_DRAFTS: showDrafts } as NodeJS.ProcessEnv);

describe('Academy discovery with drafts hidden (published-only, as in production)', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  beforeAll(async () => {
    ctx = await fixtureContext({ cfg: cfg('false') });
    app = await buildApp(ctx);
  });
  afterAll(async () => {
    await app?.close();
    await ctx?.db.close();
  });

  it('still lists every course, marked unavailable, with an explanation instead of an empty page', async () => {
    const r = await new Client(app).get('/v1/academy/courses');
    expect(r.status).toBe(200);
    expect(r.json.courses.map((c: any) => c.title)).toEqual(TITLES);
    expect(r.json.courses.every((c: any) => c.available === false && c.lessons === 0 && c.status === 'in_review')).toBe(true);
    expect(r.json.preview_mode).toBe(false);
    expect(r.json.review_note).toMatch(/expert review/);
  });

  it('a course URL shows the outline but no lessons, and nothing unreviewed can be opened or started', async () => {
    const d = await new Client(app).get('/v1/academy/courses/market-decoder');
    expect(d.status).toBe(200);
    expect(d.json.available).toBe(false);
    expect(d.json.modules.length).toBeGreaterThan(0);
    expect(d.json.modules.every((m: any) => m.lessons.length === 0)).toBe(true);
    const u = new Client(app);
    expect((await u.login('free@atlas.test', DEV_PASSWORD)).status).toBe(200);
    expect((await u.get('/v1/academy/lessons/md-l1')).status).toBe(404);
    expect((await u.post('/v1/academy/courses/market-decoder/diagnostic')).status).toBe(404);
    expect((await u.post('/v1/academy/courses/market-decoder/enrol', { acknowledge: true })).status).toBe(404);
  });

  it('an unknown course is still a 404', async () => {
    expect((await new Client(app).get('/v1/academy/courses/no-such-course')).status).toBe(404);
  });
});

describe('Academy discovery in local preview mode (drafts shown, labelled)', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  beforeAll(async () => {
    ctx = await fixtureContext({ cfg: cfg('true') });
    app = await buildApp(ctx);
  });
  afterAll(async () => {
    await app?.close();
    await ctx?.db.close();
  });

  it('lists every course as an available draft with real lesson counts and durations', async () => {
    const r = await new Client(app).get('/v1/academy/courses');
    expect(r.json.courses.map((c: any) => c.title)).toEqual(TITLES);
    expect(r.json.courses.every((c: any) => c.available && c.draft && c.lessons > 0 && c.minutes > 0)).toBe(true);
    expect(r.json.preview_mode).toBe(true);
    expect(r.json.review_note).toMatch(/not expert-approved/);
  });

  it('every course detail opens with its lessons', async () => {
    for (const id of ['market-decoder', 'equity-detective', 'signal-engineer', 'market-architect', 'crypto-decoder', 'tokenomics-detective', 'onchain-engineer', 'asset-architect']) {
      const d = await new Client(app).get(`/v1/academy/courses/${id}`);
      expect(d.status).toBe(200);
      expect(d.json.available).toBe(true);
      expect(d.json.modules.flatMap((m: any) => m.lessons).length).toBeGreaterThan(0);
    }
  });
});
