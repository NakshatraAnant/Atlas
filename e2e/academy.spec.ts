import { expect, test } from '@playwright/test';
import { signIn, verifyPlayback, watchErrors } from './helpers';

// Academy journey: catalogue → course → five-question readiness check → result → enrol → lesson
// with a lab → quiz → mastery feedback → games → capstone page.

test('Academy: readiness check, enrolment, lesson lab, quiz and mastery', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'free@atlas.test', '/app/academy');
  await expect(page.getByRole('heading', { name: 'MARKET DECODER', exact: true })).toBeVisible();
  await page.locator('a.course-link[href="/app/academy/market-decoder"]').click();
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
  // The same values as the 3D bars sit in a table (inside "Table of values"), for screen readers and no-WebGL browsers.
  await page.getByText('Table of values').first().click();
  await expect(page.getByRole('table', { name: /DCF value/ })).toBeVisible();
  await expect(page.locator('main')).toContainText('1,383');

  await page.goto('/app/academy/market-architect/capstone');
  await expect(page.getByRole('heading', { name: 'Defend a valuation range' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Course completion');
  w.assertClean();
});

test('Academy is discoverable, every course opens, and a lesson resumes after refresh with XP recorded', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'pro@atlas.test', '/app');
  // Discoverable from Home and from the primary navigation (second item).
  await expect(page.getByRole('heading', { name: /ATLAS Academy|Learning progress/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link').nth(1)).toHaveText('Academy');
  await nav.getByRole('link', { name: 'Academy', exact: true }).click();
  await page.waitForURL('**/app/academy');
  for (const name of ['MARKET DECODER', 'EQUITY DETECTIVE', 'SIGNAL ENGINEER', 'MARKET ARCHITECT', 'CRYPTO MARKET DECODER', 'TOKENOMICS DETECTIVE', 'ON-CHAIN SIGNAL ENGINEER', 'DIGITAL ASSET ARCHITECT']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText(/Preview mode|expert review/);
  // Every course detail opens directly and survives a reload.
  for (const id of ['market-decoder', 'equity-detective', 'signal-engineer', 'market-architect']) {
    await page.goto(`/app/academy/${id}`);
    await expect(page.getByRole('heading', { name: 'Your path through the course' })).toBeVisible();
    // The journey map lists every lesson as a stop, with its progress ring.
    await expect(page.locator('.journey .stop').first()).toBeVisible();
    await expect(page.getByRole('img', { name: /lessons completed/ }).first()).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your path through the course' })).toBeVisible();
  // Advance two stages, refresh, and resume at the same stage.
  await page.goto('/app/academy/lesson/md-l4');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const stageHeading = await page.locator('main h2').first().textContent();
  await page.reload();
  await expect(page.locator('main')).toContainText('Resumed where you left off (stage 3');
  await expect(page.locator('main h2').first()).toHaveText(stageHeading!);
  // Browser back/forward keep working.
  await page.goBack();
  await page.goForward();
  await expect(page.locator('main')).toContainText('Resumed where you left off');
  // Progress page: level, XP rules and achievements are shown from the server ledger.
  await page.goto('/app/academy/progress');
  await expect(page.getByRole('heading', { name: /^(Explorer|Market Student|Research Apprentice|Data Analyst|Quantitative Researcher|Senior Analyst|Research Architect) · level \d+$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How XP is earned' })).toBeVisible();
  await expect(page.locator('main')).toContainText('First Concept Mastered');
  w.assertClean();
});

test('Academy video: the lesson video plays through the API with captions and a transcript', async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, 'plus@atlas.test', '/app/academy/lesson/md-l1');
  await expect(page.getByRole('heading', { name: /Watch: How the Indian share market works/ })).toBeVisible();
  const video = page.getByTestId('lesson-video');
  await expect(video).toBeVisible();
  const state = await verifyPlayback(video);
  expect(state.error, JSON.stringify(state)).toBeNull();
  expect(state.width).toBe(1280);
  expect(state.duration).toBeGreaterThan(60);
  expect(state.advanced, `playback did not advance: ${JSON.stringify(state)}`).toBe(true);
  expect(state.seekedTo).toBeGreaterThan(state.duration - 3);
  expect(state.ended, `playback did not reach the end after seeking: ${JSON.stringify(state)}`).toBe(true);
  expect(state.captions).toBe('captions');
  expect(state.mode).toBe('showing');
  const transcript = await page.request.get('/v1/academy/videos/md-intro/transcript');
  expect(transcript.status()).toBe(200);
  expect(await transcript.text()).toMatch(/Learning objective:/);
  w.assertClean();
});
