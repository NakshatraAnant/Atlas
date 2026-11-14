// QA crawler for the running ATLAS installation (http://localhost:3000).
// Signs in as a customer (and, for /admin, an operator with two-step sign-in), visits every route at
// desktop and mobile sizes, saves a screenshot of each, and records console errors, failed requests
// (HTTP >= 400 or network failures), pages that render almost nothing, and horizontal overflow.
// Usage: npx tsx scripts/qa/crawl.mts <outDir> [--mobile] [--only=/app,/app/macro]
// Uses development accounts from apps/api/src/seed.ts; never prints passwords or provider keys.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { totpCode } from '../../apps/api/src/lib/crypto.js';
import { DEV_ADMIN_TOTP_SECRET, DEV_PASSWORD } from '../../apps/api/src/seed.js';

const BASE = process.env.ATLAS_URL ?? 'http://localhost:3000';
const out = process.argv[2] ?? 'artifacts/qa';
const mobile = process.argv.includes('--mobile');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');

export const ROUTES = [
  '/', '/status', '/pricing', '/methodology', '/help', '/login', '/signup',
  '/app', '/app/equities', '/app/equities/INDEX/NIFTY50', '/app/equities/statements', '/app/crypto', '/app/crypto/assets', '/app/crypto/assets/bitcoin', '/app/crypto/defi', '/app/crypto/onchain', '/app/crypto/events', '/app/crypto/research', '/app/crypto/sources',
  '/app/commodities', '/app/commodities/fred/DCOILBRENTEU', '/app/commodities/eia/WCESTUS1', '/app/macro', '/app/macro/DGS10', '/app/macro/explorer', '/app/research-hub', '/app/research/datasets',
  '/app/academy', '/app/academy/progress', '/app/academy/commodity-decoder', '/app/academy/lesson/cm-l1', '/app/academy/lesson/cm-l3', '/app/academy/lesson/cm-l5', '/app/academy/lesson/md-l13', '/app/academy/lesson/se-l5', '/app/academy/lesson/ma-l2', '/app/academy/market-decoder', '/app/learn', '/app/universe', '/app/network', '/app/pulse', '/app/academy/constellation', '/onboarding', '/app/data-health', '/app/notifications', '/app/account', '/app/settings',
];

async function signIn(page: Page, email: string, totp?: string) {
  await page.goto(`${BASE}/login`);
  const r = await page.evaluate(async ({ email, password, totp }) => {
    await fetch('/v1/auth/csrf', { credentials: 'same-origin' });
    const t = document.cookie.match(/atlas_csrf=([^;]+)/)?.[1] ?? '';
    const res = await fetch('/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': t }, body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }), credentials: 'same-origin' });
    return res.status;
  }, { email, password: DEV_PASSWORD, totp });
  if (r !== 200) throw new Error(`sign-in failed for ${email}: ${r}`);
}

interface Finding { route: string; viewport: string; console_errors: string[]; failed_requests: string[]; text_length: number; h1: string | null; overflow: boolean; load_ms: number }

async function visit(page: Page, route: string, viewport: string): Promise<Finding> {
  const errors: string[] = [];
  const failed: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); };
  const onResponse = (r: { status(): number; url(): string }) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); };
  // A browser cancels a media request once it has the metadata (preload="metadata") or when the page is
  // left; that is ERR_ABORTED on a video URL and not a failure. Every other failed request is reported.
  const onFailed = (r: { url(): string; failure(): { errorText: string } | null }) => {
    const path = new URL(r.url()).pathname;
    if (/\/videos\/[\w-]+\/video$/.test(path) && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    failed.push(`FAILED ${path} ${r.failure()?.errorText ?? ''}`);
  };
  page.on('console', onConsole);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  const t0 = Date.now();
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch((e) => errors.push(`navigation: ${(e as Error).message.slice(0, 200)}`));
  await page.waitForTimeout(800);
  const load = Date.now() - t0;
  const info = await page.evaluate(() => ({
    text: (document.querySelector('main')?.innerText ?? document.body.innerText).length,
    h1: document.querySelector('h1')?.textContent ?? null,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
  }));
  const name = (route === '/' ? 'root' : route.slice(1).replace(/[/:]/g, '_')) + `-${viewport}.png`;
  await page.screenshot({ path: join(out, name), fullPage: false });
  page.off('console', onConsole);
  page.off('response', onResponse);
  page.off('requestfailed', onFailed);
  return { route, viewport, console_errors: errors, failed_requests: [...new Set(failed)], text_length: info.text, h1: info.h1, overflow: info.overflow, load_ms: load };
}

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 };
  const vpName = mobile ? 'mobile' : 'desktop';
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  await signIn(page, 'pro@atlas.test');
  const findings: Finding[] = [];
  for (const r of ROUTES.filter((x) => !only || only.includes(x))) findings.push(await visit(page, r, vpName));
  // Operator console with a separate, two-step-verified session.
  const actx = await browser.newContext({ viewport });
  const apage = await actx.newPage();
  await signIn(apage, 'admin@atlas.test', totpCode(DEV_ADMIN_TOTP_SECRET, Date.now()));
  if (!only || only.includes('/admin')) findings.push(await visit(apage, '/admin', vpName));
  await browser.close();
  writeFileSync(join(out, `findings-${vpName}.json`), JSON.stringify(findings, null, 2));
  const bad = findings.filter((f) => f.console_errors.length || f.failed_requests.length || f.text_length < 80 || f.overflow);
  console.log(`${findings.length} pages; ${bad.length} with findings`);
  for (const f of bad) console.log(`${f.route} [${f.viewport}] text=${f.text_length} overflow=${f.overflow} errors=${f.console_errors.length} failed=${f.failed_requests.join('; ')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
