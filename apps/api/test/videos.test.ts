import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { loadVideos, parseRange, type VideoMeta } from '../src/modules/academy/videos.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Academy videos: rendered files (scripts/video/render.mts) served behind the lesson's own gate.
const cfg = (showDrafts: 'true' | 'false') =>
  loadConfig({ NODE_ENV: 'test', APP_SECRET: 'test-secret-test-secret-test-secret-test', LOG_LEVEL: 'silent', RATE_LIMIT_MULTIPLIER: '1000', WEB_ORIGIN: 'http://localhost:3000', ACADEMY_SHOW_DRAFTS: showDrafts } as NodeJS.ProcessEnv);
const COURSES = ['market-decoder', 'equity-detective', 'signal-engineer', 'market-architect'];

describe('video helpers', () => {
  it('parses byte ranges and rejects unsatisfiable ones', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=9-3', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
  });

  it('lists a video only when its file exists with the recorded size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-video-'));
    const base = { course_id: 'c', lesson_id: 'l', title: 't', objective: 'o', duration_s: 1, width: 1, height: 1, fps: 1, codecs: '', voice: '', script_sha: '', status: 'in_review', rendered_at: '' };
    const meta: VideoMeta[] = [{ ...base, id: 'present', bytes: 4 }, { ...base, id: 'missing', bytes: 4 }, { ...base, id: 'truncated', bytes: 99 }];
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
    writeFileSync(join(dir, 'present.webm'), 'abcd');
    writeFileSync(join(dir, 'truncated.webm'), 'abcd');
    expect(loadVideos(join(dir, 'meta.json'), dir).map((v) => v.id)).toEqual(['present']);
    expect(loadVideos(join(dir, 'nope.json'), dir)).toEqual([]);
  });
});

describe('rendered Academy videos', () => {
  const videos = loadVideos();
  it('at least one rendered video exists for each of the four courses', () => {
    for (const c of COURSES) expect(videos.some((v) => v.course_id === c), `video for ${c}`).toBe(true);
  });
  it('every listed video is a real WebM with poster, captions and transcript', () => {
    for (const v of videos) {
      const dir = join(import.meta.dirname, '..', 'media', 'academy-videos');
      expect(readFileSync(join(dir, `${v.id}.webm`)).readUInt32BE(0)).toBe(0x1a45dfa3);
      expect(readFileSync(join(dir, `${v.id}.png`)).readUInt32BE(0)).toBe(0x89504e47);
      const vtt = readFileSync(join(dir, `${v.id}.vtt`), 'utf8');
      expect(vtt.startsWith('WEBVTT')).toBe(true);
      expect(vtt.split('-->').length - 1).toBeGreaterThan(5);
      expect(readFileSync(join(dir, `${v.id}.txt`), 'utf8')).toMatch(/Learning objective:/);
      expect(v.duration_s).toBeGreaterThan(30);
    }
  });
});

describe('video access follows the lesson gate', () => {
  const env: { ctx?: AppContext; app?: FastifyInstance; hidden?: AppContext; hiddenApp?: FastifyInstance } = {};
  const v = loadVideos()[0];
  beforeAll(async () => {
    env.ctx = await fixtureContext({ cfg: cfg('true') });
    env.app = await buildApp(env.ctx);
    env.hidden = await fixtureContext({ cfg: cfg('false') });
    env.hiddenApp = await buildApp(env.hidden);
  });
  afterAll(async () => {
    await env.app?.close();
    await env.ctx?.db.close();
    await env.hiddenApp?.close();
    await env.hidden?.db.close();
  });

  it('the lesson lists its video, and a signed-in learner can stream and seek it', async () => {
    expect(v).toBeDefined();
    const u = new Client(env.app!);
    expect((await u.login('free@atlas.test', DEV_PASSWORD)).status).toBe(200);
    const l = await u.get(`/v1/academy/lessons/${v!.lesson_id}`);
    expect(l.status).toBe(200);
    expect(l.json.videos.map((x: any) => x.id)).toContain(v!.id);
    const full = await u.get(`/v1/academy/videos/${v!.id}/video`);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/webm');
    expect(Number(full.headers['content-length'])).toBe(v!.bytes);
    const part = await u.get(`/v1/academy/videos/${v!.id}/video`, { range: 'bytes=0-1023' });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-1023/${v!.bytes}`);
    expect(Number(part.headers['content-length'])).toBe(1024);
    expect((await u.get(`/v1/academy/videos/${v!.id}/video`, { range: `bytes=${v!.bytes}-` })).status).toBe(416);
    expect((await u.get(`/v1/academy/videos/${v!.id}/captions`)).body.startsWith('WEBVTT')).toBe(true);
  });

  it('signed-out viewers, unknown ids and bad file names are refused', async () => {
    expect((await new Client(env.app!).get(`/v1/academy/videos/${v!.id}/video`)).status).toBe(401);
    const u = new Client(env.app!);
    await u.login('free@atlas.test', DEV_PASSWORD);
    expect((await u.get('/v1/academy/videos/no-such-video/video')).status).toBe(404);
    expect((await u.get(`/v1/academy/videos/${v!.id}/..%2F..%2Fpackage.json`)).status).toBe(400);
  });

  it('with review-stage content hidden (production), the video of an unreviewed lesson is not served', async () => {
    const u = new Client(env.hiddenApp!);
    await u.login('free@atlas.test', DEV_PASSWORD);
    expect((await u.get(`/v1/academy/videos/${v!.id}/video`)).status).toBe(404);
  });
});
