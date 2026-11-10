import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

// Regression (session 13): a dropped proxy connection showed panels as "could not be loaded". Reads are now
// retried once when the web proxy (not the API) failed; API errors and writes are never retried.
const reply = (status: number, body: string, type: string) => new Response(body, { status, headers: { 'content-type': type } });

afterEach(() => vi.unstubAllGlobals());

describe('api() retry rule', () => {
  it('retries a GET once after a non-JSON 5xx from the proxy', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply(500, 'Internal Server Error', 'text/plain')).mockResolvedValueOnce(reply(200, '{"ok":true}', 'application/json'));
    vi.stubGlobal('fetch', f);
    expect(await api('/v1/x')).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('retries a GET once after a dropped connection', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(reply(200, '{"ok":1}', 'application/json'));
    vi.stubGlobal('fetch', f);
    expect(await api('/v1/x')).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('does not retry an API error (JSON problem) and reports it', async () => {
    const f = vi.fn().mockResolvedValue(reply(503, '{"title":"Unavailable","detail":"d"}', 'application/problem+json'));
    vi.stubGlobal('fetch', f);
    await expect(api('/v1/x')).rejects.toMatchObject({ status: 503 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('gives up after the second failure with a network error', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', f);
    await expect(api('/v1/x')).rejects.toMatchObject({ status: 0 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('never retries a write', async () => {
    vi.stubGlobal('document', { cookie: 'atlas_csrf=t' });
    const f = vi.fn().mockResolvedValue(reply(500, 'Internal Server Error', 'text/plain'));
    vi.stubGlobal('fetch', f);
    await expect(api('/v1/x', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 500 });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
