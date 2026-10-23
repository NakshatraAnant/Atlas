import { expect, test } from '@playwright/test';
import { signIn, watchErrors } from './helpers';

// Commodities on the e2e database: background jobs are off and no network sources are called, so no
// series has observations. The pages must show the three categories separately and honest empty states,
// never invented values.

test('Commodities: categories kept apart, unavailable data stated, empty series explained', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/commodities');
  await expect(page.getByRole('heading', { name: 'Commodities', exact: true })).toBeVisible();
  for (const h of ['Global benchmark prices', 'Indian exchange-traded futures (MCX, NCDEX)', 'Physical and fundamental data (EIA)', 'Not available']) await expect(page.getByRole('heading', { name: h })).toBeVisible();
  await expect(page.locator('main')).toContainText('licensed');
  await expect(page.locator('main')).toContainText('Gold and silver benchmark prices');
  await page.getByRole('tab', { name: 'Term structure' }).click();
  await expect(page.locator('main')).toContainText('EIA_API_KEY');
  await page.getByRole('tab', { name: 'Spreads' }).click();
  await expect(page.locator('main')).toContainText('Both legs need stored daily data');
  await page.getByRole('tab', { name: 'Series' }).click();
  await page.getByRole('link', { name: 'WTI crude oil, Cushing OK (spot)' }).click();
  await expect(page.getByRole('heading', { name: 'WTI crude oil, Cushing OK (spot)' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Not imported yet');
  await expect(page.locator('main')).toContainText('FRED series DCOILWTICO');
  w.assertClean();
});

test('Academy: the commodities track lists COMMODITY MARKETS DECODER and its first lesson opens', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'plus@atlas.test', '/app/academy');
  await expect(page.getByRole('heading', { name: 'Track 3 · Commodities' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'COMMODITY MARKETS DECODER', exact: true })).toBeVisible();
  await page.goto('/app/academy/lesson/cm-l1');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('What a commodity price actually is');
  w.assertClean();
});
