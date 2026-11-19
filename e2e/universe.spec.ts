import { expect, test } from '@playwright/test';
import { signIn, watchErrors } from './helpers';

// The immersive layer (session 14): arrival, Focus/Explore modes, Universe, Intelligence Network, Market
// Pulse, Knowledge Constellation, Research Studio layout. Each page must work with whatever data the
// environment stores, show either the 3D view or its fallback, and never invent values.

test('arrival: headline and Enter ATLAS lead to sign-up; a signed-in visitor skips it', async ({ page }) => {
  const w = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /see beyond the markets/i })).toBeVisible();
  const enter = page.getByRole('button', { name: /Enter ATLAS/i });
  await expect(enter).toBeVisible();
  await enter.click();
  await page.waitForURL('**/signup');
  await signIn(page);
  await page.goto('/');
  await page.waitForURL('**/app');
  w.assertClean();
});

test('Focus and Explore modes switch, persist across a reload, and change the Home layout', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page);
  const sw = page.getByRole('group', { name: 'Experience mode' });
  await sw.getByRole('button', { name: 'Explore' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'explore');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'explore');
  await sw.getByRole('button', { name: 'Focus' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'focus');
  w.assertClean();
});

test('Universe, Network, Pulse and Constellation open from the menus and respond to selection', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await nav.getByRole('button', { name: 'Discover' }).click();
  await nav.getByRole('menuitem', { name: /ATLAS Universe/ }).click();
  await page.waitForURL('**/app/universe');
  await expect(page.getByRole('heading', { name: /Explore what ATLAS knows/ })).toBeVisible();
  await page.locator('.uni-quick button', { hasText: 'Digital assets' }).click();
  await expect(page.locator('.uni-detail h2')).toHaveText('Digital assets');
  await expect(page.locator('.uni-missing')).toContainText('Not available');

  await page.goto('/app/network');
  await expect(page.getByRole('heading', { name: /See how markets moved together/ })).toBeVisible();
  await expect(page.locator('.uni-panel')).toContainText(/series/);
  await page.getByRole('button', { name: '3 years' }).click();
  await expect(page.getByRole('button', { name: '3 years' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/app/pulse');
  await expect(page.getByRole('heading', { name: /What moved/ })).toBeVisible();

  await page.goto('/app/academy/constellation');
  await expect(page.getByRole('heading', { name: /Your learning, as a sky/ })).toBeVisible();
  await expect(page.locator('.uni-panel')).toContainText(/of \d+ lessons/);
  w.assertClean();
});

test('Research Studio: keyboard switching, remembered tool, side panel and quick note', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/research-hub');
  await expect(page.getByRole('tab', { name: 'Workbench' })).toBeVisible();
  await page.keyboard.press('Alt+3');
  await expect(page.getByRole('tab', { selected: true })).toHaveText(/Portfolios/);
  await page.reload();
  await expect(page.getByRole('tab', { selected: true })).toHaveText(/Portfolios/);
  const side = page.getByRole('complementary', { name: 'Studio side panel' });
  await expect(side).toBeVisible();
  await side.getByRole('textbox', { name: 'Quick note heading' }).fill('E2E studio quick note');
  await side.getByRole('button', { name: 'Save note' }).click();
  await expect(side.getByRole('status')).toHaveText('Saved to your notebook.');
  await page.getByRole('button', { name: 'Side panel' }).click();
  await expect(side).toBeHidden();
  w.assertClean();
});
