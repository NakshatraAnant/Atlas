import { expect, test } from '@playwright/test';
import { signIn, watchErrors } from './helpers';

// Research hub, Indian equities and progress journeys on the e2e database (crypto data ingested from
// recorded provider responses; no Indian equity provider key configured, as on a fresh install).

test('Research hub: compare two crypto assets against a benchmark, with provenance and method', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/research-hub');
  await expect(page.getByRole('heading', { name: 'Research hub' })).toBeVisible();
  await expect(page.locator('.rs-chip')).toHaveCount(2); // bitcoin and ethereum preselected
  await page.getByLabel('Range').selectOption('max');
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page.locator('main')).toContainText('shared dates');
  await expect(page.locator('main')).toContainText('Rebased to 1.0');
  await expect(page.getByRole('table', { name: /Instruments and provenance/ })).toContainText('Real, single source');
  await page.getByText('Method and assumptions').first().click();
  await expect(page.locator('main')).toContainText('not a forecast');
  w.assertClean();
});

test('Notebook: a hypothesis is saved, survives a reload, and its review is not yet allowed', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'plus@atlas.test', '/app/research-hub?tab=notebook');
  await page.getByRole('button', { name: 'Hypothesis' }).click();
  await page.getByLabel('Title').fill('E2E: ether tracks bitcoin');
  await page.getByLabel('Thesis').fill('Ether will keep moving with bitcoin over the next quarter.');
  await page.getByLabel('Evidence for').fill('High rolling correlation in the stored history.');
  await page.getByLabel('Evidence against').fill('Correlations have broken down in past stress episodes.');
  await page.getByLabel('Review date').fill('2027-03-31');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.locator('main')).toContainText('E2E: ether tracks bitcoin');
  await page.reload();
  await expect(page.locator('main')).toContainText('Ether will keep moving with bitcoin');
  await page.getByText(/Review \(due 2027-03-31\)/).click();
  await page.getByLabel('Outcome: what actually happened').fill('Too early to say anything about this at all.');
  await page.getByLabel('Lessons').fill('Reviews need time to pass before they mean anything.');
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(page.locator('main')).toContainText('at least one day after recording');
  w.assertClean();
});

test('Alerts: a price alert triggers from stored data once and appears in notices', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/research-hub?tab=alerts');
  await page.getByLabel('Threshold').fill('1');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('main')).toContainText('price above · crypto:bitcoin');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.locator('main')).toContainText(/1 triggered/);
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.locator('main')).toContainText(/0 triggered/);
  await page.goto('/app/notifications');
  await expect(page.locator('main')).toContainText('Research alert');
  w.assertClean();
});

test('Indian equities: no provider configured is stated plainly, with setup steps and no fabricated prices', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/equities');
  await expect(page.getByRole('heading', { name: 'Indian equities: real data' })).toBeVisible();
  await expect(page.locator('main')).toContainText('No provider is configured');
  await expect(page.locator('main')).toContainText('EODHD_API_TOKEN');
  await expect(page.locator('main')).toContainText('Nothing imported yet.');
  // Quota, schedule and data operations are visible without a key; no provider call is needed to show them.
  await expect(page.locator('main')).toContainText('EODHD calls left today');
  await page.getByRole('tab', { name: 'Data operations' }).click();
  await expect(page.getByRole('heading', { name: /Daily budget \(EODHD/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tracked universe' })).toBeVisible();
  await page.getByRole('tab', { name: 'Explorer and screen' }).click();
  await expect(page.getByRole('heading', { name: 'Explorer and screen' })).toBeVisible();
  w.assertClean();
});

test('Financial statements: import is validated, private and cited; demo sections carry a persistent warning', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/equities/statements');
  await expect(page.getByRole('heading', { name: 'Financial statements you import' })).toBeVisible();
  await page.getByLabel('CSV text').fill(['instrument,period_end,period_type,line_item,value,unit,source_note', 'NSE:E2ETEST,2025-03-31,annual,revenue,100,crore,E2E test value', 'NSE:E2ETEST,2025-03-31,annual,net_profit,10,crore,E2E test value'].join('\n'));
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.locator('main')).toContainText('2 rows valid, 0 rejected');
  await page.getByRole('button', { name: /Import 2 rows/ }).click();
  await expect(page.getByRole('link', { name: 'NSE:E2ETEST' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('main')).toContainText('None yet.');
  await page.goto('/app/market');
  await expect(page.getByRole('note')).toContainText('Demo data.');
  w.assertClean();
});

test('Progress: rank, competence requirements and skill map come from the server', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/academy/progress');
  await expect(page.getByRole('heading', { name: 'Skill map' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Next rank');
  await expect(page.locator('main')).toContainText('Research communication');
  await expect(page.getByRole('heading', { name: 'Research in progress' })).toBeVisible();
  w.assertClean();
});
