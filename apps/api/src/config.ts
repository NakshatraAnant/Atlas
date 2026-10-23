import { z } from 'zod';
import { DEFAULT_EODHD_BUDGETS, parseBudgets, type QuotaCategory } from './modules/equity/quota.js';

// Centralised configuration (engineering standard 5.1). Every setting is validated at
// start-up; production refuses unsafe defaults instead of silently continuing.

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().optional().default(''),
  /** TLS for DATABASE_URL: 'verify-full' (checks the server certificate against DATABASE_CA_CERT), 'require' (encrypted, certificate not checked; development only) or 'disable'. Empty uses the driver default. */
  DATABASE_SSL: z.enum(['', 'disable', 'require', 'verify-full']).default(''),
  /** Path to the CA certificate (PEM) for DATABASE_SSL=verify-full, e.g. the Supabase root certificate. */
  DATABASE_CA_CERT: z.string().optional().default(''),
  PGLITE_DIR: z.string().default('./data/pglite'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  APP_SECRET: z.string().min(32).default('dev-only-secret-dev-only-secret-dev-only-secret'),
  OBJECT_STORE_DIR: z.string().default('./data/objects'),
  EMAIL_TRANSPORT: z.enum(['outbox', 'ses']).default('outbox'),
  AI_PROVIDER: z.enum(['deterministic', 'anthropic']).default('deterministic'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_COST_BUDGET_INR_PER_ANSWER: z.coerce.number().positive().default(5),
  AI_USD_INR: z.coerce.number().positive().default(85),
  PAYMENT_GATEWAY: z.enum(['sandbox', 'razorpay']).default('sandbox'),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  SANDBOX_WEBHOOK_SECRET: z.string().default('sandbox-webhook-secret-dev-only'),
  GST_RATE: z.coerce.number().min(0).max(1).default(0.18),
  SUPPLIER_STATE_CODE: z.string().default('29'),
  SUPPLIER_GSTIN: z.string().optional().default(''),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  ALLOW_SYNTHETIC_DATA: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).optional()),
  /** Serve Academy content that is still in review (labelled as draft). Defaults to on outside production. */
  ACADEMY_SHOW_DRAFTS: z.enum(['true', 'false']).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Scales route rate limits (tests use a high value; never set above 1 in production). */
  RATE_LIMIT_MULTIPLIER: z.coerce.number().min(1).max(100000).default(1),
  // ATLAS Digital Assets (docs/crypto). Free public sources; an optional free CoinGecko Demo key raises its limit.
  COINGECKO_DEMO_API_KEY: z.string().optional().default(''),
  /** Scheduled crypto ingestion. Defaults to on outside tests. */
  CRYPTO_INGESTION: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).optional()),
  /** Binance WebSocket price feed for CRYPTO_LIVE_SYMBOLS. Defaults to on outside tests. */
  CRYPTO_LIVE_FEED: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).optional()),
  CRYPTO_LIVE_SYMBOLS: z.string().default('BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT'),
  CRYPTO_UNIVERSE_SIZE: z.coerce.number().int().min(10).max(500).default(100),
  CRYPTO_HISTORY_ASSETS: z.coerce.number().int().min(1).max(100).default(25),
  CRYPTO_BACKFILL_REQUESTS_PER_RUN: z.coerce.number().int().min(1).max(200).default(30),
  ETHEREUM_RPC_URL: z.string().url().default('https://ethereum-rpc.publicnode.com'),
  // Indian equity reference data (your own keys; docs/equity/SOURCE_CAPABILITY_MATRIX.md). Never sent to the browser.
  EODHD_API_TOKEN: z.string().optional().default(''),
  /** Accepted as an alias of EODHD_API_TOKEN (EODHD_API_TOKEN wins when both are set). */
  EODHD_API_KEY: z.string().optional().default(''),
  /** Daily API-call allowance of your EODHD plan (free plan: 20) and how it is split by purpose. */
  EODHD_DAILY_LIMIT: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).max(10_000_000).default(20)),
  EODHD_QUOTA_BUDGETS: z.string().optional().default(''),
  /** Scheduled refresh of the tracked Indian equity universe. Defaults to on outside tests. */
  EQUITY_REFRESH: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).optional()),
  ALPHAVANTAGE_API_KEY: z.string().optional().default(''),
  /** Annual risk-free rate used for Sharpe/Sortino (decimal, e.g. 0.065). Shown next to every ratio. */
  RESEARCH_RISK_FREE_RATE: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().min(0).max(0.5).default(0)),
});

export type Config = z.infer<typeof schema> & { allowSyntheticData: boolean; isProduction: boolean; academyShowDrafts: boolean; cryptoIngestion: boolean; cryptoLiveFeed: boolean; equityRefresh: boolean; eodhdBudgets: Record<QuotaCategory, number> };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const isProduction = parsed.NODE_ENV === 'production';
  const allowSyntheticData = parsed.ALLOW_SYNTHETIC_DATA ? parsed.ALLOW_SYNTHETIC_DATA === 'true' : !isProduction;
  const academyShowDrafts = parsed.ACADEMY_SHOW_DRAFTS ? parsed.ACADEMY_SHOW_DRAFTS === 'true' : !isProduction;
  const isTest = parsed.NODE_ENV === 'test';
  const cryptoIngestion = parsed.CRYPTO_INGESTION ? parsed.CRYPTO_INGESTION === 'true' : !isTest;
  const cryptoLiveFeed = parsed.CRYPTO_LIVE_FEED ? parsed.CRYPTO_LIVE_FEED === 'true' : !isTest;
  const equityRefresh = parsed.EQUITY_REFRESH ? parsed.EQUITY_REFRESH === 'true' : !isTest;
  // The alias is folded in here so every caller reads one name; neither value is ever logged.
  const EODHD_API_TOKEN = (parsed.EODHD_API_TOKEN || parsed.EODHD_API_KEY).trim();
  const eodhdBudgets = parsed.EODHD_QUOTA_BUDGETS ? parseBudgets(parsed.EODHD_QUOTA_BUDGETS, parsed.EODHD_DAILY_LIMIT)
    : parsed.EODHD_DAILY_LIMIT === 20 ? DEFAULT_EODHD_BUDGETS : scaleBudgets(parsed.EODHD_DAILY_LIMIT);
  const cfg: Config = { ...parsed, EODHD_API_TOKEN, EODHD_API_KEY: '', allowSyntheticData, isProduction, academyShowDrafts, cryptoIngestion, cryptoLiveFeed, equityRefresh, eodhdBudgets };
  if (isProduction) assertProductionSafe(cfg);
  return cfg;
}

/** Default split for a non-default limit: the free-plan proportions (60/10/10/10/10), remainder to refresh. */
function scaleBudgets(limit: number): Record<QuotaCategory, number> {
  const tenth = Math.floor(limit / 10);
  return { refresh: limit - 4 * tenth, backfill: tenth, validation: tenth, manual: tenth, reserve: tenth };
}

export function assertProductionSafe(cfg: Config): void {
  const problems: string[] = [];
  if (!cfg.DATABASE_URL) problems.push('DATABASE_URL must point to managed PostgreSQL in production');
  if (cfg.DATABASE_URL && (cfg.DATABASE_SSL !== 'verify-full' || !cfg.DATABASE_CA_CERT)) problems.push('DATABASE_SSL=verify-full with DATABASE_CA_CERT is required in production');
  if (cfg.APP_SECRET.startsWith('dev-only') || cfg.APP_SECRET.includes('change-me')) problems.push('APP_SECRET must be a managed secret');
  if (cfg.academyShowDrafts) problems.push('Unreviewed Academy content must not be served in production (ACADEMY_SHOW_DRAFTS)');
  if (cfg.allowSyntheticData) problems.push('Synthetic data must never be served in production (ALLOW_SYNTHETIC_DATA)');
  if (cfg.PAYMENT_GATEWAY === 'sandbox') problems.push('PAYMENT_GATEWAY=sandbox is not allowed in production');
  if (cfg.PAYMENT_GATEWAY === 'razorpay' && (!cfg.RAZORPAY_KEY_ID || !cfg.RAZORPAY_KEY_SECRET || !cfg.RAZORPAY_WEBHOOK_SECRET)) problems.push('Razorpay keys and webhook secret are required');
  if (cfg.EMAIL_TRANSPORT === 'outbox') problems.push('EMAIL_TRANSPORT must be a real provider in production');
  if (cfg.AI_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY is required for AI_PROVIDER=anthropic');
  if (problems.length) throw new Error(`Unsafe production configuration:\n- ${problems.join('\n- ')}`);
}

/** Options for openDb derived from configuration (one place, so the API, CLIs and worker agree). */
export function dbOptions(cfg: Config, opts: { memory?: boolean } = {}) {
  return {
    databaseUrl: cfg.DATABASE_URL || undefined,
    pgliteDir: opts.memory ? undefined : cfg.PGLITE_DIR,
    ssl: cfg.DATABASE_SSL ? { mode: cfg.DATABASE_SSL, caCertPath: cfg.DATABASE_CA_CERT || undefined } : undefined,
  } as const;
}

export const CODE_VERSION = process.env.ATLAS_CODE_VERSION ?? '0.1.0-dev';
