import type { FastifyInstance, InjectOptions } from 'fastify';

/** Minimal browser-like client for app.inject: cookie jar + CSRF double-submit header. */
export class Client {
  cookies = new Map<string, string>();
  constructor(private readonly app: FastifyInstance) {}
  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method: InjectOptions['method'], url: string, body?: unknown, headers: Record<string, string> = {}) {
    if (method !== 'GET' && !this.cookies.has('atlas_csrf')) await this.req('GET', '/v1/auth/csrf');
    const res = await this.app.inject({ method, url, payload: body === undefined ? undefined : (body as object), headers: { cookie: this.cookieHeader(), ...(method !== 'GET' ? { 'x-csrf-token': this.cookies.get('atlas_csrf') ?? '' } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } });
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0) || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    let json: any = null;
    try { json = res.json(); } catch { /* not json */ }
    return { status: res.statusCode, json, body: res.body, headers: res.headers };
  }
  get(url: string, headers?: Record<string, string>) { return this.req('GET', url, undefined, headers); }
  post(url: string, body: unknown = {}, headers?: Record<string, string>) { return this.req('POST', url, body, headers); }
  patch(url: string, body: unknown = {}) { return this.req('PATCH', url, body); }
  put(url: string, body: unknown = {}) { return this.req('PUT', url, body); }
  del(url: string, body?: unknown) { return this.req('DELETE', url, body); }
  async login(email: string, password: string, totp?: string) {
    return this.post('/v1/auth/login', { email, password, ...(totp ? { totp } : {}) });
  }
}
