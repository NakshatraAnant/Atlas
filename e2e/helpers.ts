import { expect, type Page } from '@playwright/test';

// Development accounts from apps/api/src/seed.ts (test values for this local application only).
export const DEV_PASSWORD = 'atlas-dev-Password-2026';

export async function signIn(page: Page, email = 'pro@atlas.test', next = '/app') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname.startsWith(next.split('?')[0]!));
}

/** Collects console errors and failed same-origin API responses (5xx) for a page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/v1/') && r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return { errors, assertClean: () => expect(errors, errors.join('\n')).toEqual([]) };
}

export interface PlaybackReport {
  duration: number; width: number; captions: string | undefined; mode: string | undefined; error: number | null;
  advanced: boolean; startedAt: number; reachedTime: number; waitedMs: number;
  seekedTo: number | null; ended: boolean; readyState: number; networkState: number;
}

/**
 * Plays a lesson video muted and waits for OBSERVED progress (timeupdate past `minSeconds`) instead of a
 * fixed sleep, so a busy machine slows the check down rather than failing it. Then seeks close to the
 * end and waits for `ended`. Every wait is bounded; on timeout the report says what state the element
 * was in (readyState, networkState, media error) so a failure is diagnosable.
 */
export async function verifyPlayback(video: import('@playwright/test').Locator, opts: { minSeconds?: number; timeoutMs?: number } = {}): Promise<PlaybackReport> {
  return video.evaluate(async (el: HTMLVideoElement, o: { minSeconds: number; timeoutMs: number }) => {
    const t0 = performance.now();
    const until = (pred: () => boolean, events: string[], ms: number) => new Promise<boolean>((resolve) => {
      if (pred()) return resolve(true);
      const done = (v: boolean) => { events.forEach((e) => el.removeEventListener(e, check)); clearTimeout(timer); resolve(v); };
      const check = () => { if (pred() || el.error) done(pred()); };
      events.forEach((e) => el.addEventListener(e, check));
      const timer = setTimeout(() => done(pred()), ms);
    });
    el.muted = true;
    await until(() => el.readyState >= 1, ['loadedmetadata', 'error'], o.timeoutMs);
    const startedAt = el.currentTime;
    await el.play().catch(() => undefined);
    const advanced = await until(() => el.currentTime >= startedAt + o.minSeconds, ['timeupdate', 'error'], o.timeoutMs);
    const reachedTime = el.currentTime;
    const waitedMs = Math.round(performance.now() - t0);
    let seekedTo: number | null = null;
    let ended = false;
    if (advanced && Number.isFinite(el.duration)) {
      el.currentTime = Math.max(0, el.duration - 1.5);
      await until(() => !el.seeking, ['seeked', 'error'], o.timeoutMs);
      seekedTo = el.currentTime;
      await el.play().catch(() => undefined);
      ended = await until(() => el.ended, ['ended', 'error'], o.timeoutMs);
    }
    el.pause();
    const tr = el.textTracks[0];
    return { duration: el.duration, width: el.videoWidth, captions: tr?.kind, mode: tr?.mode, error: el.error?.code ?? null, advanced, startedAt, reachedTime, waitedMs, seekedTo, ended, readyState: el.readyState, networkState: el.networkState };
  }, { minSeconds: opts.minSeconds ?? 0.5, timeoutMs: opts.timeoutMs ?? 30_000 });
}
