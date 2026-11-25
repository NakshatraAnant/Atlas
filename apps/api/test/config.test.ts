import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

// Production must refuse to start with synthetic data or unreviewed Academy content, whatever else
// is configured correctly. Both default to "allowed" only outside production.
const prod = (extra: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: 'production', APP_SECRET: 'a-managed-production-secret-of-sufficient-length', LOG_LEVEL: 'silent', WEB_ORIGIN: 'https://atlas.example',
    DATABASE_URL: 'postgres://u:p@db.example:5432/atlas', DATABASE_SSL: 'verify-full', DATABASE_CA_CERT: 'ca.pem',
    PAYMENT_GATEWAY: 'razorpay', RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', RAZORPAY_PLAN_IDS: '{"plus":"plan_1","pro":"plan_2"}', EMAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtps://u:p@mail.example', EMAIL_FROM: 'atlas@mail.example',
    ...extra,
  } as NodeJS.ProcessEnv);

describe('production safety (assertProductionSafe)', () => {
  it('defaults to no synthetic data and no drafts in production', () => {
    const cfg = prod();
    expect(cfg.allowSyntheticData).toBe(false);
    expect(cfg.academyShowDrafts).toBe(false);
  });
  it('refuses synthetic data in production', () => {
    expect(() => prod({ ALLOW_SYNTHETIC_DATA: 'true' })).toThrow(/Synthetic data must never be served in production/);
  });
  it('refuses unreviewed Academy content in production', () => {
    expect(() => prod({ ACADEMY_SHOW_DRAFTS: 'true' })).toThrow(/Unreviewed Academy content/);
  });
  it('refuses the embedded database and a development secret in production', () => {
    expect(() => prod({ DATABASE_URL: '' })).toThrow(/DATABASE_URL must point to managed PostgreSQL/);
    expect(() => prod({ APP_SECRET: 'dev-only-secret-dev-only-secret-dev-only' })).toThrow(/APP_SECRET must be a managed secret/);
  });
  it('allows synthetic data and drafts by default outside production', () => {
    const dev = loadConfig({ NODE_ENV: 'development', APP_SECRET: 'test-secret-test-secret-test-secret-test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
    expect(dev.allowSyntheticData).toBe(true);
    expect(dev.academyShowDrafts).toBe(true);
  });
});

describe('digital-assets settings', () => {
  it('empty values from a copied .env.example mean "not set", and tests never ingest or stream by default', () => {
    const dev = loadConfig({ NODE_ENV: 'development', CRYPTO_INGESTION: '', CRYPTO_LIVE_FEED: '', COINGECKO_DEMO_API_KEY: '' } as NodeJS.ProcessEnv);
    expect(dev.cryptoIngestion).toBe(true);
    expect(dev.cryptoLiveFeed).toBe(true);
    const test = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(test.cryptoIngestion).toBe(false);
    expect(test.cryptoLiveFeed).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development', CRYPTO_INGESTION: 'false' } as NodeJS.ProcessEnv).cryptoIngestion).toBe(false);
    expect(() => loadConfig({ NODE_ENV: 'development', CRYPTO_UNIVERSE_SIZE: '5000' } as NodeJS.ProcessEnv)).toThrow();
  });
  it('the real .env.example loads as-is, with the free EODHD plan defaults and demo mode on in development', () => {
    const env: Record<string, string> = {};
    for (const line of readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*?)\s*$/.exec(line);
      if (m) env[m[1]!] = m[2]!;
    }
    const c = loadConfig({ ...env, NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(c.EODHD_DAILY_LIMIT).toBe(20);
    expect(c.eodhdBudgets).toEqual({ refresh: 12, backfill: 2, validation: 2, manual: 2, reserve: 2 });
    expect(c.allowSyntheticData).toBe(true);
    expect(c.equityRefresh).toBe(true);
    expect(c.EODHD_API_TOKEN).toBe('');
  });
});
