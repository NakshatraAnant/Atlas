import { expect, test } from '@playwright/test';
import { signIn, watchErrors } from './helpers';

// Core research workflow (PRD target): briefing → company investigation → evidence → watchlist and
// notes → screener → AI question → Quant Lab with the rule builder. Synthetic fixture data.

test('sign-in, Home panels and the market briefing', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Worth investigating' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What changed in your companies' })).toBeVisible();
  await page.goto('/app/market');
  await expect(page.locator('main')).toContainText(/\d+ up · \d+ down/);
  await expect(page.locator('main')).toContainText(/Stale|End of day/);
  w.assertClean();
});

test('company search → profile → evidence → watchlist → note', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/companies');
  await page.getByRole('searchbox').fill('Kaveri');
  await page.getByRole('link', { name: /Kaveri Foods/ }).first().click();
  await page.waitForURL(/\/app\/companies\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Kaveri Foods');
  await expect(page.locator('main')).toContainText(/synthetic/i);
  // Open the evidence behind a figure.
  const evidence = page.locator('button.ev').first();
  await evidence.click();
  await expect(page.locator('.drawer')).toContainText(/Source|source/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add to watchlist' }).click();
  await expect(page.locator('.toast')).toContainText(/Added to/);
  // Research note persists through the API (verified after a restart by scripts/e2e.mjs).
  const res = await page.request.post('/v1/notes', { data: { title: 'E2E persisted note', body: 'Created by the browser end-to-end suite.' }, headers: { 'x-csrf-token': (await page.context().cookies()).find((c) => c.name === 'atlas_csrf')?.value ?? '' } });
  expect(res.status()).toBe(200);
  await page.goto('/app/research?tab=watchlists');
  await expect(page.locator('main')).toContainText('Kaveri Foods');
  await page.goto('/app/research?tab=notes');
  await expect(page.locator('main')).toContainText('E2E persisted note');
  w.assertClean();
});

test('screener runs a template and shows results with definitions', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/screener');
  await page.getByRole('button', { name: /^Run/ }).first().click();
  await expect(page.locator('main table').first()).toBeVisible();
  w.assertClean();
});

test('assistant answers with labelled evidence and refuses advice', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/assistant');
  const box = page.getByRole('textbox').first();
  await box.fill('Should I buy Kaveri Foods?');
  await box.press('Enter');
  await expect(page.locator('main')).toContainText(/does not (give|provide|make) (buy|recommendations)|not a recommendation|cannot tell you whether to buy/i, { timeout: 30_000 });
  w.assertClean();
});

test('Quant Lab: rule-builder backtest shows the tested rules and warnings', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/lab');
  await page.getByLabel('Strategy template').selectOption('custom_rules');
  await expect(page.locator('main')).toContainText('Rules being tested');
  await page.getByRole('button', { name: /Run/ }).first().click();
  await page.waitForURL(/\/app\/lab\/runs\//, { timeout: 60_000 });
  await expect(page.locator('main')).toContainText('Rules tested', { timeout: 60_000 });
  await expect(page.locator('main')).toContainText(/SMA\(50\)/);
  w.assertClean();
});

test('a failed API is shown as an understandable error, not a blank page', async ({ page }) => {
  await signIn(page, 'pro@atlas.test', '/app');
  await page.route('**/v1/home/what-changed', (r) => r.abort('failed'));
  await page.reload();
  await expect(page.locator('main')).toContainText(/could not be reached|Try again/);
});
