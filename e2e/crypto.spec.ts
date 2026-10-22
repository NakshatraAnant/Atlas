import { expect, test } from '@playwright/test';
import { signIn, verifyPlayback, watchErrors } from './helpers';

// ATLAS Digital Assets journeys. The e2e database holds digital-asset data imported by the real
// ingestion jobs from provider responses recorded on 22 Oct 2026 (scripts/e2e-crypto-seed.mts);
// ingestion and the live feed are off, so nothing here reaches the network.

test('Digital Assets: overview shows provider totals with source and freshness, and nothing claims to be live', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/crypto');
  await expect(page.getByRole('heading', { name: 'Digital Assets', level: 1 })).toBeVisible();
  const main = page.locator('main');
  await expect(main).toContainText('Total market capitalisation');
  await expect(main).toContainText('Powered by CoinGecko');
  await expect(main).toContainText('PERIODIC SNAPSHOTS');
  // The streaming panel is off in this environment and says so, instead of showing invented prices.
  await expect(main).toContainText(/Off|not running/);
  await expect(page.locator('.cx-live .cell')).toHaveCount(0);
  w.assertClean();
});

test('Digital Assets: search an asset, open it, check identity, chart observations and analytics honesty', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/crypto/assets');
  await page.getByLabel('Search name, symbol or id').fill('bitcoin');
  await expect(page.getByRole('link', { name: 'Bitcoin', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Bitcoin', exact: true }).click();
  await page.waitForURL('**/app/crypto/assets/bitcoin');
  await expect(page.locator('main')).toContainText('CoinGecko id bitcoin');
  // The chart's table view equals the stored observations served by the API.
  const series = page.getByLabel('Series');
  await series.selectOption((await series.locator('option', { hasText: 'Binance BTCUSDT' }).getAttribute('value'))!);
  await page.getByRole('button', { name: 'All stored' }).click();
  const api = await page.request.get(`/v1/crypto/assets/bitcoin/history?range=max&series=${await series.inputValue()}`);
  const stored = (await api.json()).observations as { t: string; close: number }[];
  expect(stored.length).toBe(5);
  await page.getByRole('button', { name: 'Show as table' }).click();
  const rows = page.locator('figure.chart table tbody tr');
  await expect(rows).toHaveCount(stored.length);
  await expect(rows.first()).toContainText(stored[stored.length - 1]!.t.slice(0, 10));
  // Analytics: with five stored days, longer windows are refused with a reason, never invented.
  await page.getByRole('tab', { name: 'Analytics' }).click();
  const calc = page.getByLabel('Calculated from');
  await calc.selectOption((await calc.locator('option', { hasText: 'Binance BTCUSDT' }).getAttribute('value'))!);
  await expect(page.locator('main')).toContainText('needs an observation within 3 days');
  await expect(page.locator('main')).toContainText('Formulas and assumptions');
  // Tokenomics: a defined maximum supply is shown with its source and methodology.
  await page.getByRole('tab', { name: 'Tokenomics' }).click();
  await expect(page.locator('main')).toContainText('21M BTC');
  await expect(page.locator('main')).toContainText('not independently verified');
  w.assertClean();
});

test('Digital Assets: watchlist persists across a reload; sources page shows job stages and provider terms', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'plus@atlas.test', '/app/crypto/assets/ethereum');
  const button = page.getByRole('button', { name: /watchlist/ });
  if ((await button.getAttribute('aria-pressed')) === 'true') await button.click();
  await page.getByRole('button', { name: '☆ Add to watchlist' }).click();
  await expect(page.getByRole('button', { name: '★ On watchlist' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '★ On watchlist' })).toBeVisible();
  await page.goto('/app/crypto/assets');
  await page.getByLabel('My watchlist only').check();
  await expect(page.getByRole('link', { name: 'Ethereum', exact: true })).toBeVisible();
  await page.goto('/app/crypto/sources');
  await expect(page.locator('main')).toContainText('Scheduled ingestion is off');
  await expect(page.locator('main')).toContainText('candles_binance');
  await expect(page.locator('main')).toContainText('refreshed at least every 24 hours');
  w.assertClean();
});

test('Crypto Academy: lesson video, toy-chain scene interaction, and the signing lab', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/academy/lesson/cd-l1');
  await expect(page.getByRole('heading', { name: /Watch: How blockchains and digital assets work/ })).toBeVisible();
  const state = await verifyPlayback(page.getByTestId('lesson-video'));
  expect(state.error, JSON.stringify(state)).toBeNull();
  expect(state.duration).toBeGreaterThan(100);
  expect(state.advanced, `playback did not advance: ${JSON.stringify(state)}`).toBe(true);
  expect(state.ended, `playback did not reach the end: ${JSON.stringify(state)}`).toBe(true);
  expect(state.captions).toBe('captions');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('main')).toContainText('Simulation.');
  await page.getByRole('button', { name: 'Edit the transaction in block #2' }).click();
  await expect(page.locator('main')).toContainText('Block #2 no longer matches its stored hash');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('main')).toContainText('Every block’s stored hash matches its contents');
  // Signing lab (lesson cd-l4): a changed message fails verification.
  await page.goto('/app/academy/lesson/cd-l4');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Sign with the private key' }).click();
  await expect(page.locator('main')).toContainText('Valid signature');
  await page.getByLabel('Message as received by a node').fill('Pay 9.10 to address B-7f3a, fee 0.0002, nonce 41');
  await expect(page.locator('main')).toContainText('Invalid: the message was changed');
  w.assertClean();
});
