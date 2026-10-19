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
