import { dbOptions, loadConfig, type Config } from './config.js';
import { cachedRights, type AppContext } from './context.js';
import { openDb, type Db } from './db/db.js';
import { migrate } from './db/migrate.js';
import { syncCurriculum } from './modules/academy/service.js';
import { createLogger } from './lib/logger.js';
import { LocalObjectStore, MemoryObjectStore, type ObjectStore } from './lib/objectStore.js';
import { MemoryRateLimiter } from './lib/rateLimit.js';
import { AnthropicGateway, DeterministicGateway, type ModelGateway } from './modules/ai/gateway.js';
import { checkAiCost } from './modules/ai/service.js';
import { processBacktestQueue } from './modules/backtest/service.js';
import { RazorpayGateway, SandboxGateway, type PaymentGateway } from './modules/billing/gateway.js';
import { reconcileSubscriptions, settlePeriods } from './modules/billing/service.js';
import { deliverOutbox, OutboxOnlyTransport } from './modules/notify/email.js';
import { schedulerTick } from './pipeline/daily.js';
import { SyntheticVendor, type VendorAdapter } from './pipeline/vendor.js';

export interface ContextOptions {
  cfg?: Config;
  db?: Db;
  store?: ObjectStore;
  vendor?: VendorAdapter;
  clock?: () => Date;
  ai?: ModelGateway;
  memory?: boolean;
}

export async function createContext(opts: ContextOptions = {}): Promise<AppContext> {
  const cfg = opts.cfg ?? loadConfig();
  const log = createLogger(cfg.LOG_LEVEL, { service: 'atlas-api' });
  const db = opts.db ?? (await openDb(dbOptions(cfg, { memory: opts.memory })));
  await migrate(db);
  // Curriculum is version-controlled content; syncing is idempotent and only adds new versions.
  await syncCurriculum(db);
  const clock = opts.clock ?? (() => new Date());
  const store = opts.store ?? (opts.memory ? new MemoryObjectStore() : new LocalObjectStore(cfg.OBJECT_STORE_DIR));
  let payments: PaymentGateway;
  if (cfg.PAYMENT_GATEWAY === 'razorpay') payments = new RazorpayGateway(cfg.RAZORPAY_KEY_ID, cfg.RAZORPAY_KEY_SECRET, cfg.RAZORPAY_WEBHOOK_SECRET, JSON.parse(process.env.RAZORPAY_PLAN_IDS ?? '{}'));
  else payments = new SandboxGateway(db, cfg.SANDBOX_WEBHOOK_SECRET, cfg.WEB_ORIGIN, clock);
  const ai = opts.ai ?? (cfg.AI_PROVIDER === 'anthropic' && cfg.ANTHROPIC_API_KEY ? new AnthropicGateway(cfg.ANTHROPIC_API_KEY, cfg.AI_MODEL, cfg.AI_USD_INR) : new DeterministicGateway());
  const vendor = opts.vendor ?? new SyntheticVendor({ companies: Number(process.env.SYNTHETIC_COMPANIES ?? 120), injectFaults: process.env.SYNTHETIC_INJECT_FAULTS === 'true' });
  if (vendor.isSynthetic && !cfg.allowSyntheticData) throw new Error('A synthetic vendor cannot be used in this environment');
  return { cfg, db, store, log, clock, limiter: new MemoryRateLimiter(), email: new OutboxOnlyTransport(), payments, ai, vendor, rights: cachedRights(db, cfg) };
}

/** In-process scheduler for single-instance deployments; production runs the same jobs in the worker. */
export function startBackgroundJobs(ctx: AppContext): () => void {
  const timers: NodeJS.Timeout[] = [];
  let busy = false;
  const guard = (name: string, fn: () => Promise<unknown>) => async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      ctx.log.error('background job failed', { job: name, error: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
    }
  };
  const pctx = { db: ctx.db, store: ctx.store, cfg: ctx.cfg, log: ctx.log, now: ctx.clock };
  timers.push(setInterval(guard('backtests', () => processBacktestQueue(ctx, `api-${process.pid}`, 2)), 1500));
  timers.push(setInterval(guard('outbox', () => deliverOutbox(ctx.db, ctx.email)), 5000));
  timers.push(setInterval(guard('scheduler', () => schedulerTick(pctx, ctx.vendor)), 60_000));
  timers.push(setInterval(guard('reconcile', () => reconcileSubscriptions(ctx)), 10 * 60_000));
  timers.push(setInterval(guard('settle', () => settlePeriods(ctx)), 60 * 60_000));
  timers.push(setInterval(guard('ai_cost', () => checkAiCost(ctx)), 60 * 60_000));
  timers.push(setInterval(guard('retention', () => runRetention(ctx)), 6 * 60 * 60_000));
  return () => timers.forEach(clearInterval);
}

/** Retention and deletion (Blueprint §6.7, ACC-07, AIA-08). */
export async function runRetention(ctx: AppContext): Promise<Record<string, number>> {
  const db = ctx.db;
  const conv = await db.query<{ conversation_id: string }>(`SELECT conversation_id FROM ai.conversations WHERE (deleted_at IS NOT NULL AND purge_after <= now()) OR (deleted_at IS NULL AND purge_after <= now())`);
  for (const c of conv) {
    await db.tx(async (t) => {
      await t.query(`DELETE FROM ai.claims WHERE message_id IN (SELECT message_id FROM ai.messages WHERE conversation_id=$1)`, [c.conversation_id]);
      await t.query(`DELETE FROM ai.tool_calls WHERE message_id IN (SELECT message_id FROM ai.messages WHERE conversation_id=$1)`, [c.conversation_id]);
      await t.query(`DELETE FROM ai.feedback WHERE message_id IN (SELECT message_id FROM ai.messages WHERE conversation_id=$1)`, [c.conversation_id]);
      await t.query(`DELETE FROM ai.messages WHERE conversation_id=$1`, [c.conversation_id]);
      await t.query(`DELETE FROM ai.conversations WHERE conversation_id=$1`, [c.conversation_id]);
    });
  }
  const erase = await db.query<{ user_id: string }>(`SELECT user_id FROM app.account_deletions WHERE erased_at IS NULL AND erase_after <= now()`);
  for (const e of erase) {
    await db.tx(async (t) => {
      // Personal data erased; tax invoices and payment records are kept as the law requires (pseudonymised user row).
      await t.query(`UPDATE app.users SET email = 'deleted-' || user_id || '@deleted.invalid', password_hash=NULL, display_name=NULL, totp_secret=NULL, recovery_codes='[]', interests='{}', display_prefs='{}', google_sub=NULL WHERE user_id=$1`, [e.user_id]);
      for (const tbl of ['app.watchlist_items WHERE watchlist_id IN (SELECT watchlist_id FROM app.watchlists WHERE user_id=$1)', 'app.watchlists WHERE user_id=$1', 'app.notes WHERE user_id=$1', 'app.workspaces WHERE user_id=$1', 'app.saved_screens WHERE user_id=$1', 'app.hypotheses WHERE user_id=$1', 'app.research_history WHERE user_id=$1', 'app.learning_progress WHERE user_id=$1', 'app.peer_sets WHERE user_id=$1', 'app.last_visits WHERE user_id=$1', 'app.company_views WHERE user_id=$1', 'app.notifications WHERE user_id=$1']) {
        await t.query(`DELETE FROM ${tbl}`, [e.user_id]);
      }
      await t.query(`UPDATE app.analytics_events SET user_id=NULL, anon_id='erased' WHERE user_id=$1`, [e.user_id]);
      await t.query(`UPDATE app.account_deletions SET erased_at=now() WHERE user_id=$1`, [e.user_id]);
    });
  }
  const sessions = await db.query(`DELETE FROM app.sessions WHERE expires_at < now() - interval '30 days' RETURNING 1`);
  const events = await db.query(`DELETE FROM app.analytics_events WHERE occurred_at < now() - interval '24 months' RETURNING 1`);
  return { conversations: conv.length, accounts: erase.length, sessions: sessions.length, analytics_events: events.length };
}
