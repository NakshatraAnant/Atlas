import type { Db } from '../../db/db.js';
import { SOURCES } from './registry.js';

// The only way ATLAS talks to crypto providers. It owns:
//   - a per-source request budget (sliding one-minute window) with capacity reserved for critical calls
//   - a TTL cache and de-duplication of identical in-flight requests
//   - back-off after 429/418/5xx (Retry-After respected), so a failing provider is not hammered
//   - usage counters (crypto.request_usage) and source health (crypto.sources)
// It never invents a response: every failure surfaces as a ProviderError for the caller to record.

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export type ProviderErrorKind = 'budget_exhausted' | 'backing_off' | 'rate_limited' | 'http' | 'network' | 'timeout' | 'malformed' | 'disabled';

export class ProviderError extends Error {
  constructor(readonly sourceId: string, readonly kind: ProviderErrorKind, message: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(message);
  }
}

export interface RequestOptions {
  /** Critical refreshes may use the reserved share of the budget. */
  critical?: boolean;
  /** Serve from cache if a response younger than this exists. 0 disables caching. */
  ttlMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  /** Parse as text instead of JSON (RSS). */
  text?: boolean;
}

interface CacheEntry { at: number; value: unknown }

const RESERVED_SHARE = 0.25;
const MAX_CACHE_ENTRIES = 500;

export class ProviderClient {
  private readonly windows = new Map<string, number[]>();
  private readonly backoffUntil = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly budgets = new Map<string, number>(SOURCES.map((s) => [s.source_id, s.budget_per_minute]));

  constructor(private readonly db: Db, private readonly fetchImpl: FetchLike, private readonly now: () => number = () => Date.now(), private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  setBudget(sourceId: string, perMinute: number): void {
    this.budgets.set(sourceId, perMinute);
  }

  /** Remaining requests in the current window (for diagnostics and tests). */
  budgetState(sourceId: string): { limit: number; used: number; remaining: number; backoff_ms: number } {
    const limit = this.budgets.get(sourceId) ?? 1;
    const used = this.recent(sourceId).length;
    return { limit, used, remaining: Math.max(0, limit - used), backoff_ms: Math.max(0, (this.backoffUntil.get(sourceId) ?? 0) - this.now()) };
  }

  private recent(sourceId: string): number[] {
    const t = this.now();
    const w = (this.windows.get(sourceId) ?? []).filter((x) => t - x < 60_000);
    this.windows.set(sourceId, w);
    return w;
  }

  /** Wait (bounded) for a budget slot; returns false if none frees up within maxWaitMs. */
  private async acquire(sourceId: string, critical: boolean, maxWaitMs: number): Promise<boolean> {
    const limit = this.budgets.get(sourceId) ?? 1;
    const usable = critical ? limit : Math.max(1, Math.floor(limit * (1 - RESERVED_SHARE)));
    // Bounded by time actually slept (not by the clock), so a stalled or frozen clock cannot loop forever.
    let slept = 0;
    for (;;) {
      const w = this.recent(sourceId);
      if (w.length < usable) {
        w.push(this.now());
        return true;
      }
      const wait = Math.max(5, 60_000 - (this.now() - w[0]!) + 5);
      if (slept + wait > maxWaitMs) return false;
      await this.sleep(wait);
      slept += wait;
    }
  }

  async request<T = unknown>(sourceId: string, url: string, opts: RequestOptions = {}): Promise<T> {
    const key = `${opts.method ?? 'GET'} ${url} ${opts.body ? JSON.stringify(opts.body) : ''}`;
    const ttl = opts.ttlMs ?? 0;
    const hit = this.cache.get(key);
    if (ttl > 0 && hit && this.now() - hit.at < ttl) {
      void this.usage(sourceId, 'cache_hits');
      return hit.value as T;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const p = this.doRequest<T>(sourceId, url, opts).then((v) => {
      if (ttl > 0) {
        this.cache.set(key, { at: this.now(), value: v });
        if (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
      }
      return v;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doRequest<T>(sourceId: string, url: string, opts: RequestOptions): Promise<T> {
    const until = this.backoffUntil.get(sourceId) ?? 0;
    if (until > this.now()) throw new ProviderError(sourceId, 'backing_off', `Backing off ${sourceId} after earlier failures for ${Math.ceil((until - this.now()) / 1000)} s.`, undefined, until - this.now());
    if (!(await this.acquire(sourceId, !!opts.critical, 65_000))) {
      await this.usage(sourceId, 'refused_budget');
      throw new ProviderError(sourceId, 'budget_exhausted', `Request budget for ${sourceId} is exhausted for this minute (${this.budgets.get(sourceId)}/min).`);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    const at = new Date(this.now()).toISOString();
    await this.usage(sourceId, 'requests');
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, { method: opts.method ?? 'GET', headers: { accept: opts.text ? 'application/rss+xml, application/xml, text/xml' : 'application/json', 'user-agent': 'ATLAS-local-research/0.1', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...opts.headers }, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl.signal });
    } catch (err) {
      const timeout = (err as Error).name === 'AbortError';
      await this.fail(sourceId, at, timeout ? 'timeout' : 'network', `${timeout ? 'Timed out' : 'Network error'}: ${(err as Error).message}`);
      throw new ProviderError(sourceId, timeout ? 'timeout' : 'network', `${sourceId}: ${timeout ? 'request timed out' : (err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 || res.status === 418) {
      const ra = Number(res.headers.get('retry-after'));
      const ms = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000;
      this.backoffUntil.set(sourceId, this.now() + ms);
      await this.usage(sourceId, 'rate_limited');
      await this.fail(sourceId, at, 'rate_limited', `HTTP ${res.status} rate limited; backing off ${Math.round(ms / 1000)} s`);
      throw new ProviderError(sourceId, 'rate_limited', `${sourceId} rate limited (HTTP ${res.status}).`, res.status, ms);
    }
    const body = await res.text();
    if (!res.ok) {
      if (res.status >= 500) this.backoffUntil.set(sourceId, this.now() + this.nextBackoff(sourceId));
      await this.fail(sourceId, at, 'http', `HTTP ${res.status}: ${body.slice(0, 200)}`);
      throw new ProviderError(sourceId, 'http', `${sourceId} returned HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
    }
    let value: unknown = body;
    if (!opts.text) {
      try {
        value = JSON.parse(body);
      } catch {
        await this.fail(sourceId, at, 'malformed', 'Response was not valid JSON');
        throw new ProviderError(sourceId, 'malformed', `${sourceId} returned a response that is not JSON.`);
      }
    }
    this.failures.set(sourceId, 0);
    await this.db.query(`UPDATE crypto.sources SET last_request_at=$2, last_success_at=$2, consecutive_failures=0, health=CASE WHEN enabled THEN 'healthy' ELSE 'disabled' END WHERE source_id=$1`, [sourceId, at]);
    return value as T;
  }

  /** Bounded exponential back-off for repeated server errors: 30 s, 60 s, … up to 15 min. */
  private nextBackoff(sourceId: string): number {
    const n = (this.failures.get(sourceId) ?? 0) + 1;
    this.failures.set(sourceId, n);
    return Math.min(15 * 60_000, 30_000 * 2 ** (n - 1));
  }

  private async fail(sourceId: string, at: string, kind: string, message: string): Promise<void> {
    await this.usage(sourceId, 'errors');
    await this.db.query(
      `UPDATE crypto.sources SET last_request_at=$2, last_error_at=$2, last_error=$3, consecutive_failures=consecutive_failures+1,
         health=CASE WHEN $4 = 'rate_limited' THEN 'rate_limited' WHEN consecutive_failures + 1 >= 3 THEN 'failing' ELSE 'degraded' END
       WHERE source_id=$1`,
      [sourceId, at, message.slice(0, 500), kind],
    );
  }

  private async usage(sourceId: string, col: 'requests' | 'errors' | 'rate_limited' | 'cache_hits' | 'refused_budget'): Promise<void> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    await this.db.query(`INSERT INTO crypto.request_usage (source_id, day, ${col}) VALUES ($1,$2,1) ON CONFLICT (source_id, day) DO UPDATE SET ${col} = crypto.request_usage.${col} + 1`, [sourceId, day]);
  }
}

/** A fetch that always fails: used in tests so no test can reach the network by accident. */
export const offlineFetch: FetchLike = async (url) => {
  throw new Error(`Network access is disabled in this environment (${url})`);
};
