import { expect, test } from '@playwright/test';
import { signIn, watchErrors } from './helpers';

// Academy journey: catalogue → course → five-question readiness check → result → enrol → lesson
// with a lab → quiz → mastery feedback → games → capstone page.

test('Academy: readiness check, enrolment, lesson lab, quiz and mastery', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'free@atlas.test', '/app/academy');
  await expect(page.getByRole('heading', { name: 'MARKET DECODER' })).toBeVisible();
  await page.getByRole('link', { name: /MARKET DECODER/ }).click();
  await expect(page.locator('main')).toContainText('Before you start');
  await page.getByRole('link', { name: /readiness check/i }).click();
  await expect(page.getByRole('heading', { name: 'Readiness check' })).toBeVisible();
  const questions = page.locator('fieldset.qcard');
  await expect(questions).toHaveCount(5);
  // Answer every question (first option / a number); correctness is irrelevant to the journey.
  for (let i = 0; i < 5; i++) {
    const q = questions.nth(i);
    if (await q.locator('input[type=number]').count()) await q.locator('input[type=number]').fill('1');
    else await q.locator('input').first().check();
  }
  await page.getByRole('button', { name: 'See my result' }).click();
  await expect(page.locator('main')).toContainText(/rough readiness estimate/);
  await expect(page.locator('main')).toContainText('Your answers, explained');
  // Low or borderline results never block: start anyway.
  const start = page.getByRole('button', { name: /Start (the course|this course anyway)/ }).first();
  await start.click();
  await page.waitForURL(/\/app\/academy\/market-decoder$/);
  await expect(page.locator('main')).toContainText(/You are enrolled/);

  await page.goto('/app/academy/lesson/md-l5');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Diversification');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('main')).toContainText(/portfolio volatility is/i);
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Check your understanding' }).click();
  const quiz = page.locator('fieldset.qcard');
  await expect(quiz).toHaveCount(3);
  await quiz.nth(0).locator('input[type=number]').fill('18.25');
  await quiz.nth(1).getByLabel(/floor set by how closely/).check();
  for (const label of ['Holding companies from several different industries', 'Holding more companies in moderate amounts', 'Using a broad index fund']) await quiz.nth(2).getByLabel(label).check();
  await page.getByRole('button', { name: 'Check answers' }).click();
  await expect(page.locator('main')).toContainText('3 of 3 correct');
  await expect(page.locator('main')).toContainText(/Objective mastered|Still practising/);
  w.assertClean();
});

test('Academy: a game, the 3D/table DCF lab and the capstone page work', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'plus@atlas.test', '/app/academy/games');
  await page.getByRole('link', { name: /Bias Trap/ }).click();
  const items = page.locator('fieldset.qcard');
  await expect(items).toHaveCount(8);
  const answers = ['Look-ahead bias', 'Survivorship bias', 'Overfitting or data snooping', 'Benchmark mismatch', 'No obvious bias', 'Look-ahead bias', 'Survivorship bias', 'Overfitting or data snooping'];
  for (let i = 0; i < 8; i++) await items.nth(i).getByText(answers[i]!, { exact: true }).click();
  await page.getByRole('button', { name: 'Check answers' }).click();
  await expect(page.locator('main')).toContainText('8 of 8 correct');

  await page.goto('/app/academy/lesson/ma-l2');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('table', { name: /DCF value/ })).toBeVisible();
  await expect(page.locator('main')).toContainText('1,383');

  await page.goto('/app/academy/market-architect/capstone');
  await expect(page.getByRole('heading', { name: 'Defend a valuation range' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Course completion');
  w.assertClean();
});
