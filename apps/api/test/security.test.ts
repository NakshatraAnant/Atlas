import { describe, expect, it } from 'vitest';
import { isLoopbackOrigin } from '../src/app.js';

describe('origin checks (CSRF defence in depth)', () => {
  it('accepts only exact loopback hosts', () => {
    for (const o of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://localhost']) expect(isLoopbackOrigin(o)).toBe(true);
    for (const o of ['http://localhost.attacker.example', 'http://127.0.0.1.nip.io', 'http://evil.com/localhost', 'file://localhost', 'null', '']) expect(isLoopbackOrigin(o)).toBe(false);
  });
});

describe('oversized request bodies (regression, session 13)', () => {
  // Measured before the fix: 1.4 million invalid items blocked the API for 18 s and produced a 128 MB error body.
  it('a list far longer than any schema allows is refused before validation, quickly', async () => {
    const { buildApp } = await import('../src/app.js');
    const { fixtureContext } = await import('./fixture.js');
    const { Client } = await import('./http.js');
    const { DEV_PASSWORD } = await import('../src/seed.js');
    const ctx = await fixtureContext();
    const app = await buildApp(ctx);
    try {
      const c = new Client(app);
      await c.login('pro@atlas.test', DEV_PASSWORD);
      let t = performance.now();
      const big = await c.patch('/v1/me', { display_prefs: { screener_columns: new Array(1_400_000).fill(1) } });
      expect(big.status).toBe(413);
      expect(performance.now() - t).toBeLessThan(5_000);
      const keys = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, 1]));
      expect((await c.patch('/v1/me', { display_prefs: keys })).status).toBe(413);
      // Within the limit, validation still runs, and the error lists at most 20 issues.
      t = performance.now();
      const bad = await c.patch('/v1/me', { display_prefs: { screener_columns: new Array(9_000).fill(1) } });
      expect(bad.status).toBe(400);
      expect(bad.json.errors.length).toBeLessThanOrEqual(20);
      expect(bad.json.errors_truncated).toBeGreaterThan(20);
      expect(JSON.stringify(bad.json).length).toBeLessThan(20_000);
      expect(performance.now() - t).toBeLessThan(5_000);
      // Ordinary requests are unaffected.
      expect((await c.patch('/v1/me', { display_prefs: { screener_columns: ['pe', 'roe'] } })).status).toBe(200);
    } finally {
      await app.close();
      await ctx.db.close();
    }
  }, 120_000);
});
