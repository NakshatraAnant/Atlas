// Fixed-window rate limiter. In-memory for a single API instance; production with more than one
// instance must swap in the Redis adapter with the same interface (Blueprint §4.2: rate-limit counters in Redis).

export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number, now?: number): { allowed: boolean; remaining: number; resetMs: number };
}

export class MemoryRateLimiter implements RateLimiter {
  private sweepAt = 0;
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  hit(key: string, limit: number, windowMs: number, now = Date.now()) {
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    // At most one sweep a minute: sweeping on every hit made each request O(buckets) under load.
    if (this.buckets.size > 50_000 && now >= this.sweepAt) {
      this.sweepAt = now + 60_000;
      for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
    }
    return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), resetMs: b.resetAt - now };
  }
}
