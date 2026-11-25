import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { totpCode } from '../src/lib/crypto.js';
import { DEV_ADMIN_TOTP_SECRET, DEV_PASSWORD } from '../src/seed.js';
import { fixtureContext, FIXTURE_CLOCK } from './fixture.js';
import { Client } from './http.js';

// Every registered route, called with hostile but well-formed HTTP input, must answer with a client error
// or success, never a 5xx other than a deliberate 503. Destructive session routes run in their own client.

let ctx: AppContext;
let app: FastifyInstance;
const routes: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string }[] = [];
const SKIP = new Set(['POST /v1/auth/logout', 'POST /v1/me/sessions/revoke-all', 'DELETE /v1/me', 'POST /admin/v1/pipeline/rerun']);

beforeAll(async () => {
  ctx = await fixtureContext();
  app = await buildApp(ctx);
  await app.ready();
  const stack: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^([│ ]*)(?:├──|└──) (.*?) \(([A-Z, ]+)\)/.exec(line);
    const bare = m ? null : /^([│ ]*)(?:├──|└──) (.*)$/.exec(line);
    const hit = m ?? bare;
    if (!hit) continue;
    const depth = hit[1]!.length / 4;
    stack.length = depth;
    stack[depth] = hit[2]!.trim();
    if (!m) continue;
    const url = stack.join('');
    for (const method of m[3]!.split(',').map((s) => s.trim())) if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) routes.push({ method: method as 'GET', url });
  }
});
afterAll(async () => { await app.close(); await ctx.db.close(); });

const UUID = '00000000-0000-4000-8000-000000000000';
const PARAMS = [UUID, 'x', '%00', '..%2f..%2fetc', "'%20OR%201=1--", '%F0%9F%98%80', '9'.repeat(30), 'a'.repeat(99)];
const VALUES = ['', '-1', '999999999999999999999', 'NaN', '2026-99-99', '9999-12-31', '\u0000', "'", '%', UUID, '[]', 'bitcoin'];
const QKEYS = ['q', 'from', 'to', 'date', 'range', 'page', 'per', 'limit', 'offset', 'cursor', 'sort', 'key', 'keys', 'ids', 'status', 'kind', 'as_of', 'series', 'a', 'b', 'window', 'days'];
const BODIES: unknown[] = [{}, [], null, { id: 'x' }, { name: '\u0000', title: '\u0000', q: '\u0000' }, { keys: [], ids: ['x'], date: '2026-99-99', from: '2026-99-99', to: '1', value: 1e308 }, 'text', 5];

describe('no route answers 5xx to bad input', () => {
  it('finds the routes', () => expect(routes.length).toBeGreaterThan(150));

  for (const who of ['pro', 'admin'] as const) {
    it(`as ${who}`, async () => {
      const c = new Client(app);
      const r = who === 'pro' ? await c.login('pro@atlas.test', DEV_PASSWORD) : await c.login('admin@atlas.test', DEV_PASSWORD, totpCode(DEV_ADMIN_TOTP_SECRET, FIXTURE_CLOCK.getTime()));
      expect(r.status).toBe(200);
      const bad = new Map<string, string>();
      const call = async (method: 'GET', url: string, route: string, body?: unknown) => {
        const res = await c.req(method, url, body);
        if (res.status >= 500 && res.status !== 503) bad.set(`${method} ${route} ${res.status}`, `${url.slice(0, 120)} ${JSON.stringify(body ?? null)?.slice(0, 120)}`);
      };
      for (const { method, url } of routes) {
        if (SKIP.has(`${method} ${url}`) || /\*/.test(url)) continue;
        if (who === 'pro' && url.startsWith('/admin')) continue;
        if (who === 'admin' && !url.startsWith('/admin')) continue;
        const paths = /:/.test(url) ? PARAMS.map((p) => url.replace(/:[A-Za-z]+/g, p)) : [url];
        for (const p of paths) {
          if (method === 'GET') await call(method, p, url);
          else await call(method as 'GET', p, url, {});
        }
        const base = url.replace(/:[A-Za-z]+/g, UUID);
        if (method === 'GET') for (const v of VALUES) await call('GET', `${base}?${QKEYS.map((k) => `${k}=${encodeURIComponent(v)}`).join('&')}`, url);
        else for (const b of BODIES) await call(method as 'GET', base, url, b);
      }
      expect(Object.fromEntries(bad)).toEqual({});
    }, 600_000);
  }
});
