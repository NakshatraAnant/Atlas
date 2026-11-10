'use client';

// Browser API client. Same-origin requests (Next rewrites /v1 to the API), the session lives in an
// httpOnly cookie, and every state-changing request carries the double-submit CSRF token.

export interface Problem {
  status: number;
  title?: string;
  detail?: string;
  upgrade?: { plan: string; adds: string } | null;
  errors?: { path: string; message: string }[];
  correlation_id?: string;
  [k: string]: unknown;
}

export class ApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail ?? problem.title ?? `Request failed (${problem.status})`);
  }
  get status() {
    return this.problem.status;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null;
}

async function ensureCsrf(): Promise<string> {
  let t = readCookie('atlas_csrf');
  if (!t) {
    await fetch('/v1/auth/csrf', { credentials: 'same-origin' });
    t = readCookie('atlas_csrf');
  }
  return t ?? '';
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = await ensureCsrf();
  const send = () => fetch(path, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), credentials: 'same-origin', signal: init.signal });
  // A read is retried once when the web server's proxy, not the API, failed: a dropped connection or a
  // non-JSON 5xx (the API's own errors are JSON problems and are never retried). Writes are never retried.
  const transient = (r: Response | null) => r === null || (r.status >= 500 && !(r.headers.get('content-type') ?? '').includes('json'));
  let res: Response | null = null;
  for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt++) {
    if (attempt) await new Promise((ok) => setTimeout(ok, 800));
    try {
      res = await send();
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      res = null;
    }
    if (!transient(res)) break;
  }
  if (!res) throw new ApiError({ status: 0, title: 'Network error', detail: 'ATLAS could not be reached. Check that the application is running and try again.' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const problem = type.includes('json') ? ((await res.json()) as Problem) : { status: res.status, detail: await res.text() };
    throw new ApiError({ ...problem, status: res.status });
  }
  if (type.includes('json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export async function download(path: string, body: unknown, filename: string): Promise<void> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': await ensureCsrf() }, body: JSON.stringify(body ?? {}), credentials: 'same-origin' });
  if (!res.ok) throw new ApiError({ ...(await res.json().catch(() => ({}))), status: res.status } as Problem);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Server-sent events for the assistant (progress then answer). */
export async function streamAsk(body: unknown, onEvent: (event: string, data: any) => void): Promise<void> {
  const res = await fetch('/v1/assistant/ask', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-csrf-token': await ensureCsrf() }, body: JSON.stringify(body), credentials: 'same-origin' });
  if (!res.ok || !res.body) {
    const p = await res.json().catch(() => ({ status: res.status }));
    throw new ApiError({ ...p, status: res.status });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (data) onEvent(ev, JSON.parse(data));
    }
  }
}
