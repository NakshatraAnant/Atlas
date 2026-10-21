import { expect, test } from '@playwright/test';
import { signIn, watchErrors } from './helpers';

// Journey C: inspect market activity on the end-of-day terminal.

test('terminal shows stored end-of-day values, period switching, hover details and an honest data label', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app/terminal');
  await expect(page.locator('.term-bar')).toContainText('END OF DAY');
  await expect(page.locator('main')).toContainText('Nothing on this screen is live');
  // Displayed index value equals the stored value returned by the API.
  const api = await (await page.request.get('/v1/market/terminal?sessions=60')).json();
  const first = api.indices[0];
  await expect(page.locator('.term-index').first()).toContainText(first.name);
  const shown = (await page.locator('.term-index .val').first().textContent())!.replace(/,/g, '');
  expect(Number(shown)).toBeCloseTo(first.close, 2);
  // Period switch reloads the chart with the requested number of sessions.
  await page.getByRole('button', { name: '20 sessions', exact: true }).click();
  await expect(page.locator('main')).toContainText(/closing level, last 20 sessions/);
  // Hover shows a crosshair tooltip with a date and the value.
  const svg = page.locator('figure.chart svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  const tip = svg.locator('g[pointer-events="none"]');
  await expect(tip.locator('rect')).toHaveCount(1);
  await expect(tip.locator('text', { hasText: /^\d{4}-\d{2}-\d{2}$/ })).toHaveCount(1);
  // Feed items link to their company.
  await page.locator('.term-feed a').first().click();
  await page.waitForURL(/\/app\/companies\//);
  w.assertClean();
});

test('a value animates only when a newer stored record changes it, and never on stale data', async ({ page }) => {
  await signIn(page, 'pro@atlas.test', '/app/terminal');
  await expect(page.locator('.term-index .val').first()).toBeVisible();
  // A refetch that returns the same stored data (same version, same values) animates nothing.
  await page.getByRole('button', { name: '120 sessions', exact: true }).click();
  await expect(page.locator('main')).toContainText(/last 120 sessions/);
  await expect(page.locator('.tick.flash-up, .tick.flash-dn')).toHaveCount(0);
  await expect(page.locator('.term-bar')).toContainText('no new data since this page opened');
  // A newer stored record while the data is stale (the fixture is stale): the value updates, no animation.
  let fresh = false;
  let bump = 0;
  await page.route('**/v1/market/terminal*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    bump += 100;
    body.version = `${body.version}-${bump}`;
    body.indices[0].close = body.indices[0].close + bump;
    if (fresh) body.freshness = { stale: false, label: 'End of day' };
    await route.fulfill({ response: res, json: body });
  });
  await page.getByRole('button', { name: '60 sessions', exact: true }).click();
  await expect(page.locator('.term-bar')).toContainText('new data');
  await page.waitForTimeout(300);
  await expect(page.locator('.tick.flash-up, .tick.flash-dn')).toHaveCount(0);
  // The same kind of change on fresh data animates.
  fresh = true;
  await page.getByRole('button', { name: '20 sessions', exact: true }).click();
  await expect(page.locator('.term-index .tick.flash-up').first()).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
