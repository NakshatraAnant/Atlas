import { z } from 'zod';

// Centralised configuration (engineering standard 5.1). Every setting is validated at
// start-up; production refuses unsafe defaults instead of silently continuing.

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().optional().default(''),
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
  ALLOW_SYNTHETIC_DATA: z.enum(['true', 'false']).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Scales route rate limits (tests use a high value; never set above 1 in production). */
  RATE_LIMIT_MULTIPLIER: z.coerce.number().min(1).max(100000).default(1),
});

export type Config = z.infer<typeof schema> & { allowSyntheticData: boolean; isProduction: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const isProduction = parsed.NODE_ENV === 'production';
  const allowSyntheticData = parsed.ALLOW_SYNTHETIC_DATA ? parsed.ALLOW_SYNTHETIC_DATA === 'true' : !isProduction;
  const cfg: Config = { ...parsed, allowSyntheticData, isProduction };
  if (isProduction) assertProductionSafe(cfg);
  return cfg;
}

export function assertProductionSafe(cfg: Config): void {
  const problems: string[] = [];
  if (!cfg.DATABASE_URL) problems.push('DATABASE_URL must point to managed PostgreSQL in production');
  if (cfg.APP_SECRET.startsWith('dev-only') || cfg.APP_SECRET.includes('change-me')) problems.push('APP_SECRET must be a managed secret');
  if (cfg.allowSyntheticData) problems.push('Synthetic data must never be served in production (ALLOW_SYNTHETIC_DATA)');
  if (cfg.PAYMENT_GATEWAY === 'sandbox') problems.push('PAYMENT_GATEWAY=sandbox is not allowed in production');
  if (cfg.PAYMENT_GATEWAY === 'razorpay' && (!cfg.RAZORPAY_KEY_ID || !cfg.RAZORPAY_KEY_SECRET || !cfg.RAZORPAY_WEBHOOK_SECRET)) problems.push('Razorpay keys and webhook secret are required');
  if (cfg.EMAIL_TRANSPORT === 'outbox') problems.push('EMAIL_TRANSPORT must be a real provider in production');
  if (cfg.AI_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY is required for AI_PROVIDER=anthropic');
  if (problems.length) throw new Error(`Unsafe production configuration:\n- ${problems.join('\n- ')}`);
}

export const CODE_VERSION = process.env.ATLAS_CODE_VERSION ?? '0.1.0-dev';
