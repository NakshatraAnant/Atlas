import { createHash } from 'node:crypto';
import type { Db } from '../db/db.js';
import { addDays, dayOfWeek, istInstant, istNow } from '../lib/dates.js';
import { detectEvents, dispatchAlerts, sendDigests } from '../modules/alerts/alerts.js';
import { generateAndStoreBriefing } from '../modules/market/briefing.js';
import { queueEmail } from '../modules/notify/email.js';
import type { PipelineCtx } from './context.js';
import { raiseOpsAlert } from './context.js';
import { INGEST_ORDER, ingestDataset, type IngestOutcome } from './ingest.js';
import { runCalculations } from './run.js';
import type { VendorAdapter } from './vendor.js';

// Daily schedule (Blueprint §5.2, IST, trading days):
//  18:30–19:30 poll end-of-day files → 19:30–20:10 validate and calculate → 20:10–20:25 briefing
//  and number checks → 20:30 publish → 20:45 briefing email → 21:00 alerts. Hard cut-off 21:00,
//  then a delay notice. Each step is idempotent (ops.job_runs unique on job and date).

export const SCHEDULE = { pollFrom: 18 * 60 + 30, validateBy: 20 * 60 + 10, publishAt: 20 * 60 + 30, emailAt: 20 * 60 + 45, cutoff: 21 * 60 };

async function isTradingDay(db: Db, date: string): Promise<boolean> {
  const r = await db.maybeOne<{ is_trading_day: boolean }>(`SELECT is_trading_day FROM ref.trading_calendar WHERE exchange_code='NSE' AND trade_date=$1`, [date]);
  return r?.is_trading_day ?? (dayOfWeek(date) !== 0 && dayOfWeek(date) !== 6);
}

async function claimJob(db: Db, name: string, key: string): Promise<boolean> {
  const r = await db.query(`INSERT INTO ops.job_runs (job_name, run_key, status) VALUES ($1,$2,'running') ON CONFLICT (job_name, run_key) DO NOTHING RETURNING job_run_id`, [name, key]);
  if (r.length) return true;
  // Allow a retry of a failed run.
  const retry = await db.query(`UPDATE ops.job_runs SET status='running', started_at=now(), error=NULL WHERE job_name=$1 AND run_key=$2 AND status='failed' RETURNING job_run_id`, [name, key]);
  return retry.length > 0;
}

async function finishJob(db: Db, name: string, key: string, status: 'succeeded' | 'failed' | 'skipped', details: Record<string, unknown>, error?: string): Promise<void> {
  await db.query(`UPDATE ops.job_runs SET status=$3, finished_at=now(), details=$4, error=$5 WHERE job_name=$1 AND run_key=$2`, [name, key, status, JSON.stringify(details), error ?? null]);
}

export interface DailyCycleResult {
  date: string;
  skipped?: string;
  ingest?: IngestOutcome[];
  briefing?: string;
  alerts?: { created: number; emailed: number; digested: number; suppressed: number };
  validatedAt?: string;
}

/** Run the end-of-day cycle for `date`. `simulatedClock` backfills past dates on their own schedule. */
export async function runDailyCycle(ctx: PipelineCtx, vendor: VendorAdapter, date: string, opts: { simulatedClock?: boolean } = {}): Promise<DailyCycleResult> {
  const db = ctx.db;
  if (!(await isTradingDay(db, date))) {
    await generateAndStoreBriefing(db, date, ctx.now());
    return { date, skipped: 'holiday' };
  }
  if (!(await claimJob(db, 'daily_cycle', date))) return { date, skipped: 'already ran' };
  const startedAt = ctx.now().toISOString();
  try {
    const lastPrice = await db.maybeOne<{ d: string | null }>(`SELECT max(trade_date) AS d FROM market.price_eod WHERE trade_date < $1`, [date]);
    const since = lastPrice?.d ?? addDays(date, -1);
    const ingest: IngestOutcome[] = [];
    for (const ds of INGEST_ORDER) ingest.push(await ingestDataset(ctx, vendor, ds, { asOf: date, mode: 'daily', since: ds === 'master' || ds === 'calendar' || ds === 'macro_calendar' ? undefined : since }));
    const prices = ingest.find((i) => i.dataset === 'eod_prices');
    if (!prices || prices.status === 'no_file' || prices.status === 'blocked' || prices.status === 'failed') {
      await raiseOpsAlert(db, { kind: 'eod_late', severity: 'SEV2', message: `End-of-day prices for ${date} not validated (${prices?.status ?? 'missing'})`, dedupeKey: `eod-late-${date}` });
      await generateAndStoreBriefing(db, date, ctx.now());
      await finishJob(db, 'daily_cycle', date, 'failed', { ingest: ingest.map((i) => ({ d: i.dataset, s: i.status })) }, 'prices not validated');
      // Released for retry on the next scheduler tick (the vendor may deliver late).
      return { date, ingest, briefing: 'held' };
    }
    const newActions = ingest.find((i) => i.dataset === 'corporate_actions')?.result?.affected?.securities ?? [];
    const priced = prices.result?.affected?.securities ?? [];
    const fundCompanies = new Set([...(ingest.find((i) => i.dataset === 'fundamentals')?.result?.affected?.companies ?? []), ...(ingest.find((i) => i.dataset === 'shareholding')?.result?.affected?.companies ?? [])]);
    await runCalculations(ctx, { asOf: date, fromDate: date, securityIds: [...new Set([...priced, ...newActions])], fullSecurityIds: newActions, latestOnly: true });
    if (fundCompanies.size) await runCalculations(ctx, { asOf: date, fromDate: date, securityIds: [], companyIds: [...fundCompanies], latestOnly: false });
    const validatedAt = ctx.now();
    const publishAt = opts.simulatedClock ? new Date(istInstant(date, '20:30')) : validatedAt;
    const b = await generateAndStoreBriefing(db, date, publishAt);
    // Alerts from everything ingested in this cycle.
    const events = await detectEvents(db, startedAt);
    const alerts = await dispatchAlerts(db, events, opts.simulatedClock ? new Date(istInstant(date, '21:00')) : ctx.now());
    if (b.status === 'published') await emailBriefing(db, date);
    await maybeSnapshot(db, date);
    await finishJob(db, 'daily_cycle', date, 'succeeded', { ingest: ingest.map((i) => ({ d: i.dataset, s: i.status, v: i.result?.rowsValid, q: i.result?.rowsQuarantined })), briefing: b.status, alerts });
    return { date, ingest, briefing: b.status, alerts, validatedAt: validatedAt.toISOString() };
  } catch (err) {
    await finishJob(db, 'daily_cycle', date, 'failed', {}, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function emailBriefing(db: Db, date: string): Promise<void> {
  if (!(await claimJob(db, 'briefing_email', date))) return;
  const users = await db.query<{ user_id: string; email: string; briefing_email: string }>(
    `SELECT user_id, email, briefing_email FROM app.users WHERE status='active' AND email_verified_at IS NOT NULL AND (briefing_email='daily' OR (briefing_email='weekly' AND extract(isodow FROM $1::date) = 5))`,
    [date],
  );
  for (const u of users) {
    await queueEmail(db, { to: u.email, userId: u.user_id, template: 'briefing', category: 'briefing', subject: `ATLAS post-close briefing — ${date}`, text: `The post-close briefing for ${date} is published. Read it with every figure linked to its evidence: /app/briefings/${date}\n\nChange or stop briefing emails in Account → Preferences.` });
  }
  await finishJob(db, 'briefing_email', date, 'succeeded', { recipients: users.length });
}

/** Weekly immutable snapshot (Sunday, or the first cycle of a new ISO week) — ADR-006. */
export async function maybeSnapshot(db: Db, date: string, label?: string): Promise<string | null> {
  const week = await db.maybeOne<{ snapshot_id: string }>(`SELECT snapshot_id FROM calc.data_snapshots WHERE date_trunc('week', as_of_date) = date_trunc('week', $1::date) AND label LIKE 'weekly%'`, [date]);
  if (week && !label) return null;
  return createSnapshot(db, date, label ?? `weekly ${date}`);
}

export async function createSnapshot(db: Db, asOf: string, label: string): Promise<string> {
  const runs = await db.query<{ dataset: string; run_id: string; finished_at: string }>(
    `SELECT DISTINCT ON (dataset) dataset, run_id, finished_at FROM ops.ingestion_runs WHERE status IN ('succeeded','partial') ORDER BY dataset, finished_at DESC`,
  );
  const hash = createHash('sha256').update(JSON.stringify(runs.map((r) => [r.dataset, r.run_id]))).digest('hex');
  const row = await db.one<{ snapshot_id: string }>(
    `INSERT INTO calc.data_snapshots (label, as_of_date, ingestion_runs, content_hash) VALUES ($1,$2,$3,$4) RETURNING snapshot_id`,
    [label, asOf, JSON.stringify(runs), hash],
  );
  return row.snapshot_id;
}

/** Scheduler tick: run due cycles, catch up missed trading days, raise freshness alerts. */
export async function schedulerTick(ctx: PipelineCtx, vendor: VendorAdapter): Promise<DailyCycleResult[]> {
  const db = ctx.db;
  const { date: today, minutes } = istNow(ctx.now());
  const lastPrice = (await db.maybeOne<{ d: string | null }>(`SELECT max(trade_date) AS d FROM market.price_eod`))?.d;
  const out: DailyCycleResult[] = [];
  if (!lastPrice) return out;
  // Catch up every trading day after the last processed date; today's only after 18:30 IST.
  const due = await db.query<{ trade_date: string }>(
    `SELECT trade_date FROM ref.trading_calendar WHERE exchange_code='NSE' AND is_trading_day AND trade_date > $1 AND trade_date <= $2 ORDER BY trade_date`,
    [lastPrice, today],
  );
  for (const d of due) {
    if (d.trade_date === today && minutes < SCHEDULE.pollFrom) break;
    const r = await runDailyCycle(ctx, vendor, d.trade_date, { simulatedClock: d.trade_date !== today });
    out.push(r);
    if (r.briefing === 'held' && d.trade_date === today) break;
  }
  // Freshness: on a trading day after the 21:00 cut-off with no validated prices → delay notice (SEV2).
  if ((await isTradingDay(db, today)) && minutes >= SCHEDULE.cutoff) {
    const have = await db.maybeOne(`SELECT 1 FROM market.price_eod WHERE trade_date=$1 LIMIT 1`, [today]);
    if (!have) {
      await raiseOpsAlert(db, { kind: 'freshness_breach', severity: 'SEV2', message: `End-of-day prices for ${today} missed the 21:00 IST cut-off; delay notice shown`, dedupeKey: `freshness-${today}` });
      await generateAndStoreBriefing(db, today, ctx.now());
    }
  }
  await sendDigests(db, ctx.now());
  return out;
}
