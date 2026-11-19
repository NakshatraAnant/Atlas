import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AppContext } from './context.js';
import { ApiError, sendProblem } from './lib/http.js';
import { CSRF_COOKIE, SESSION_COOKIE, resolveSession } from './modules/auth/service.js';
import { accountRoutes } from './modules/accounts/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { billingRoutes } from './modules/billing/routes.js';
import { academyRoutes } from './modules/academy/routes.js';
import { academyExtraRoutes } from './modules/academy/extraRoutes.js';
import { learningRoutes } from './modules/academy/learningRoutes.js';
import { academyChartRoutes } from './modules/academy/charts3d.js';
import { datasetRoutes } from './modules/datasets/routes.js';
import { dataHealthRoutes } from './modules/datahealth/healthRoutes.js';
import { terminalRoutes } from './modules/research/terminal.js';
import { contentRoutes } from './modules/content/routes.js';
import { dataRoutes } from './modules/research/dataRoutes.js';
import { labRoutes } from './modules/research/labRoutes.js';
import { workspaceRoutes } from './modules/research/workspaceRoutes.js';
import { cryptoRoutes } from './modules/crypto/routes.js';
import { equityRoutes } from './modules/equity/routes.js';
import { crossRoutes } from './modules/research/crossRoutes.js';
import { objectRoutes } from './modules/research/objectRoutes.js';
import { fundamentalsRoutes } from './modules/research/fundamentalsRoutes.js';
import { commodityRoutes } from './modules/commodity/routes.js';
import { macroRoutes } from './modules/macro/macro.js';
import { explorerRoutes } from './modules/macro/explorer.js';
import { networkRoutes } from './modules/macro/network.js';
import { pulseRoutes } from './modules/macro/pulse.js';
import { followRoutes } from './modules/macro/follows.js';
import { mandiRoutes } from './modules/commodity/mandi.js';
import { providerRoutes } from './modules/ops/providerRoutes.js';
import { searchRoutes } from './modules/ops/searchRoutes.js';

// HTTP application (Blueprint §7). Versioned under /v1; RFC 9457 errors; secure cookies;
// CSRF double-submit check on state-changing requests; per-route rate limits; idempotency keys;
// correlation IDs and request metrics for observability (NFR-09).

declare module 'fastify' {
  interface FastifyContextConfig {
    rateLimit?: { limit: number; windowMs: number; key: 'ip' | 'user' };
    rawBody?: boolean;
    csrfExempt?: boolean;
    idempotent?: boolean;
  }
}

export interface RequestMetrics {
  record(route: string, status: number, ms: number): void;
  snapshot(): { route: string; count: number; errors: number; p50: number; p95: number }[];
}

export function createMetrics(): RequestMetrics {
  const data = new Map<string, { samples: number[]; count: number; errors: number }>();
  return {
    record(route, status, ms) {
      const d = data.get(route) ?? { samples: [], count: 0, errors: 0 };
      d.count++;
      if (status >= 500) d.errors++;
      d.samples.push(ms);
      if (d.samples.length > 2000) d.samples.splice(0, d.samples.length - 2000);
      data.set(route, d);
    },
    snapshot() {
      return [...data].map(([route, d]) => {
        const s = [...d.samples].sort((a, b) => a - b);
        const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
        return { route, count: d.count, errors: d.errors, p50: q(0.5), p95: q(0.95) };
      });
    },
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * API sections backed only by the synthetic development companies. With demo mode off they answer 403
 * "demo data disabled" instead of serving fictional figures. Real-data sections (crypto, Indian equities,
 * research hub, uploads, Academy) are unaffected.
 */
export const DEMO_ONLY_PREFIXES = ['/v1/companies', '/v1/market/', '/v1/screener', '/v1/screens', '/v1/backtests', '/v1/assistant', '/v1/home/what-changed', '/v1/home/worth-investigating', '/v1/evidence', '/v1/documents', '/v1/watchlists', '/v1/me/peer-sets', '/v1/hypotheses'];
export const isDemoOnly = (url: string) => DEMO_ONLY_PREFIXES.some((p) => url === p || url.startsWith(p.endsWith('/') ? p : `${p}/`) || url.startsWith(`${p}?`));
/** Exact loopback host match (a prefix test would accept http://localhost.attacker.example). */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Longest list a request body may contain (twice the largest schema limit, 5,000). */
export const MAX_JSON_ARRAY = 10_000;
/** Size of the largest list or object (items or keys) anywhere in a parsed JSON value (iterative, so deep nesting is safe). */
export function longestArray(v: unknown): number {
  let longest = 0;
  const stack: unknown[] = [v];
  while (stack.length) {
    const x = stack.pop();
    if (Array.isArray(x)) { if (x.length > longest) longest = x.length; if (longest > MAX_JSON_ARRAY) return longest; for (const y of x) if (y && typeof y === 'object') stack.push(y); }
    else if (x && typeof x === 'object') { const vals = Object.values(x); if (vals.length > longest) longest = vals.length; if (longest > MAX_JSON_ARRAY) return longest; for (const y of vals) if (y && typeof y === 'object') stack.push(y); }
  }
  return longest;
}

export async function buildApp(ctx: AppContext, opts: { metrics?: RequestMetrics } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: ctx.cfg.TRUST_PROXY === 'true',
    bodyLimit: 3 * 1024 * 1024,
    genReqId: (req) => (typeof req.headers['x-correlation-id'] === 'string' && /^[\w-]{8,64}$/.test(req.headers['x-correlation-id']) ? req.headers['x-correlation-id'] : randomUUID()),
  });
  const metrics = opts.metrics ?? createMetrics();
  await app.register(cookie);

  // Keep the raw body for webhook signature verification.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    if (!body) return done(null, {});
    let value: unknown;
    try {
      value = JSON.parse(body as string);
    } catch {
      return done(new ApiError(400, 'Bad request', 'The request body is not valid JSON.'), undefined);
    }
    // No request schema accepts more than 5,000 items in a list. A far longer array cannot be valid, and
    // validating it item by item blocked the single-threaded API for seconds (measured: 1.4 million items,
    // 18 s, a 128 MB error body). Such bodies are refused before validation.
    if (longestArray(value) > MAX_JSON_ARRAY) return done(new ApiError(413, 'Payload too large', `A list or object in the request has more than ${MAX_JSON_ARRAY.toLocaleString('en-GB')} entries.`), undefined);
    done(null, value);
  });

  app.addHook('onRequest', async (req, reply) => {
    (req as unknown as { startedAt: number }).startedAt = performance.now();
    reply.header('x-correlation-id', req.id);
    // Security headers (OWASP ASVS V14)
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cache-control', 'no-store');
    if (ctx.cfg.isProduction) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (!ctx.cfg.allowSyntheticData && isDemoOnly(req.url)) throw new ApiError(403, 'Demo data disabled', 'This section shows only the fictional development companies, and demo mode is off (ALLOW_SYNTHETIC_DATA=false). Real Indian prices are under Indian equities.', {}, 'https://atlas.example/problems/demo-disabled');
    req.user = await resolveSession(ctx, req.cookies[SESSION_COOKIE]);
    const cfg = req.routeOptions.config;
    // CSRF: SameSite=Lax cookies plus a double-submit token header on state-changing requests.
    if (!SAFE_METHODS.has(req.method) && !cfg?.csrfExempt) {
      const origin = req.headers.origin;
      if (origin && origin !== ctx.cfg.WEB_ORIGIN && (ctx.cfg.isProduction || !isLoopbackOrigin(origin))) {
        throw new ApiError(403, 'Forbidden', 'Cross-origin request rejected.');
      }
      const header = req.headers['x-csrf-token'];
      const cookieToken = req.cookies[CSRF_COOKIE];
      if (!cookieToken || !header || header !== cookieToken) throw new ApiError(403, 'Forbidden', 'Missing or invalid CSRF token. Reload the page and try again.', {}, 'https://atlas.example/problems/csrf');
    }
    // Rate limits: a default per user/IP, tighter on sensitive routes.
    const rl = cfg?.rateLimit ?? { limit: 300, windowMs: 60_000, key: 'user' as const };
    const key = `${req.routeOptions.url}:${rl.key === 'user' && req.user ? req.user.userId : req.ip}`;
    const r = ctx.limiter.hit(key, rl.limit * ctx.cfg.RATE_LIMIT_MULTIPLIER, rl.windowMs);
    reply.header('ratelimit-limit', String(rl.limit));
    reply.header('ratelimit-remaining', String(r.remaining));
    reply.header('ratelimit-reset', String(Math.ceil(r.resetMs / 1000)));
    if (!r.allowed) throw new ApiError(429, 'Too many requests', 'Too many requests. Wait a moment and try again.', { retry_after_seconds: Math.ceil(r.resetMs / 1000) }, 'https://atlas.example/problems/rate-limit');
  });

  // Idempotency for POSTs that create checkouts (Blueprint §7.1); backtests handle their own keys.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.routeOptions.config?.idempotent) return;
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !req.user) return;
    const prior = await ctx.db.maybeOne<{ response: unknown; status_code: number }>(`SELECT response, status_code FROM ops.idempotency_keys WHERE scope=$1 AND key=$2`, [`${req.user.userId}:${req.routeOptions.url}`, key.slice(0, 100)]);
    if (prior) {
      reply.header('idempotent-replay', 'true');
      return reply.status(prior.status_code).send(prior.response);
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.routeOptions.config?.idempotent && req.user && typeof req.headers['idempotency-key'] === 'string' && reply.statusCode < 400 && !reply.getHeader('idempotent-replay')) {
      try {
        await ctx.db.query(`INSERT INTO ops.idempotency_keys (scope, key, response, status_code) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [`${req.user.userId}:${req.routeOptions.url}`, (req.headers['idempotency-key'] as string).slice(0, 100), typeof payload === 'string' ? payload : JSON.stringify(payload ?? null), reply.statusCode]);
      } catch {
        // best effort
      }
    }
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    const ms = performance.now() - ((req as unknown as { startedAt?: number }).startedAt ?? performance.now());
    metrics.record(`${req.method} ${req.routeOptions.url ?? 'unknown'}`, reply.statusCode, ms);
    if (reply.statusCode >= 500 || ms > 2000) ctx.log.warn('slow or failed request', { correlation_id: req.id, route: req.routeOptions.url, status: reply.statusCode, ms: Math.round(ms), user_id: req.user?.userId });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return sendProblem(reply, req, err);
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) return sendProblem(reply, req, new ApiError(e.statusCode, 'Bad request', e.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'The request is too large.' : 'The request could not be processed.'));
    ctx.log.error('unhandled error', { correlation_id: req.id, route: req.routeOptions?.url, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    return sendProblem(reply, req, new ApiError(500, 'Internal error', 'Something went wrong on our side. The error has been logged with this correlation id.'));
  });
  app.setNotFoundHandler((req, reply) => sendProblem(reply, req, new ApiError(404, 'Not found', 'No such endpoint.')));

  // Health and readiness (engineering standard 5.1)
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (req, reply) => {
    try {
      await ctx.db.query('SELECT 1');
      const snap = await ctx.db.maybeOne(`SELECT 1 FROM calc.data_snapshots LIMIT 1`);
      return { status: 'ready', database: 'ok', data: snap ? 'loaded' : 'empty', synthetic_data: ctx.cfg.allowSyntheticData, ai_provider: ctx.ai.provider, payment_gateway: ctx.payments.name };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });
  app.get('/admin/v1/metrics', async (req) => {
    const { requireRole } = await import('./modules/auth/service.js');
    requireRole(req, ['admin', 'data_ops']);
    return { routes: metrics.snapshot(), memory_mb: Math.round(process.memoryUsage().rss / 1e6), uptime_s: Math.round(process.uptime()) };
  });

  await authRoutes(app, ctx);
  await accountRoutes(app, ctx);
  await billingRoutes(app, ctx);
  await dataRoutes(app, ctx);
  await workspaceRoutes(app, ctx);
  await labRoutes(app, ctx);
  await contentRoutes(app, ctx);
  await academyRoutes(app, ctx);
  await academyExtraRoutes(app, ctx);
  await learningRoutes(app, ctx);
  await academyChartRoutes(app, ctx);
  await datasetRoutes(app, ctx);
  await dataHealthRoutes(app, ctx);
  await terminalRoutes(app, ctx);
  await cryptoRoutes(app, ctx);
  await equityRoutes(app, ctx, ctx.equityFetch);
  await crossRoutes(app, ctx);
  await objectRoutes(app, ctx);
  await fundamentalsRoutes(app, ctx);
  await commodityRoutes(app, ctx);
  await explorerRoutes(app, ctx);
  await networkRoutes(app, ctx);
  await pulseRoutes(app, ctx);
  await followRoutes(app, ctx);
  await macroRoutes(app, ctx);
  await mandiRoutes(app, ctx);
  await providerRoutes(app, ctx);
  await searchRoutes(app, ctx);
  await adminRoutes(app, ctx);
  return app;
}
