import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, notFound } from '../../lib/http.js';
import { track } from '../analytics/events.js';
import { consume, refund, requireFeature, type UserPlan } from '../billing/entitlements.js';
import { DEFAULT_COST_TABLE, ZERO_COSTS } from './costs.js';
import { benchmarkSeries, getSnapshot, indexUniverse, latestSnapshot, loadSecurities, regimeLabelsByDate, riskFreeDaily, screenUniverse, tradingCalendar } from './data.js';
import { ENGINE_VERSION, runEngine } from './engine.js';
import { calendarYearReturns, computeMetrics, drawdownSeries, regimeReturns } from './metrics.js';
import { TEMPLATE_BY_CODE, resolveParams, type TemplateSpec } from './templates.js';
import { ruleSetSchema } from './rules.js';
import { robustnessWarnings } from './warnings.js';

// Backtest service (PRD BKT-01..BKT-13). Runs are immutable records; re-running a saved run on
// the same snapshot reproduces an identical results hash.

export const backtestRequestSchema = z.object({
  template: z.enum(['ma_crossover', 'breakout_52w', 'rsi_mean_reversion', 'momentum_monthly', 'low_vol_monthly', 'custom_rules']),
  params: z.record(z.string(), z.number()).default({}),
  rules: ruleSetSchema.optional(),
  universe: z.discriminatedUnion('type', [
    z.object({ type: z.literal('security'), company_id: z.string().uuid() }),
    z.object({ type: z.literal('index'), index_code: z.string().max(20) }),
    z.object({ type: z.literal('screen'), screen_id: z.string().uuid() }),
  ]),
  period: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  costs: z.object({ included: z.boolean().default(true), slippage_bps: z.number().min(0).max(200).default(10), brokerage_bps: z.number().min(0).max(100).default(0) }).prefault({}),
  liquidity: z.object({ max_adv_pct: z.number().min(0.001).max(1).default(0.05), min_adv_cr: z.number().min(0).max(1000).default(1), mode: z.enum(['skip', 'cap']).default('skip') }).prefault({}),
  benchmark: z.string().max(20).optional(),
  capital_inr: z.number().min(10_000).max(1e10).default(1_000_000),
  snapshot_id: z.string().uuid().optional(),
  name: z.string().max(120).optional(),
});
export type BacktestRequest = z.infer<typeof backtestRequestSchema>;

export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  if (typeof v === 'number') return Number.isFinite(v) ? Number(v.toFixed(8)).toString() : 'null';
  return JSON.stringify(v);
}

export function resultsHash(input: { config: unknown; snapshotId: string; engine: string; costTable: string; metrics: unknown; finalEquity: number; trades: number }): string {
  return createHash('sha256').update(canonical({ ...input, finalEquity: Number(input.finalEquity.toFixed(4)) })).digest('hex');
}

async function defaultBenchmark(db: Db, req: BacktestRequest): Promise<string> {
  if (req.benchmark) {
    const ok = await db.maybeOne(`SELECT 1 FROM ref.index_definitions WHERE index_code=$1`, [req.benchmark]);
    if (!ok) throw badRequest('Unknown benchmark.');
    return req.benchmark;
  }
  // Total-return index where licensed (BKT-06).
  if (req.universe.type === 'index') {
    const tr = `${req.universe.index_code}TR`;
    if (await db.maybeOne(`SELECT 1 FROM ref.index_definitions WHERE index_code=$1`, [tr])) return tr;
    return req.universe.index_code;
  }
  return (await db.maybeOne(`SELECT 1 FROM ref.index_definitions WHERE index_code='DEMO500TR'`)) ? 'DEMO500TR' : 'DEMO500';
}

async function benchmarkMismatch(db: Db, req: BacktestRequest, benchmark: string, securityId: number | null, startDate: string): Promise<string | null> {
  const b = await db.maybeOne<{ universe_size_class: string; name: string }>(`SELECT universe_size_class, name FROM ref.index_definitions WHERE index_code=$1`, [benchmark]);
  if (!b) return null;
  let cls: string | null = null;
  if (req.universe.type === 'index') cls = (await db.maybeOne<{ universe_size_class: string }>(`SELECT universe_size_class FROM ref.index_definitions WHERE index_code=$1`, [req.universe.index_code]))?.universe_size_class ?? null;
  else if (securityId) {
    const inSmall = await db.maybeOne(`SELECT 1 FROM ref.index_constituents WHERE index_code='DEMOSC' AND security_id=$1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to > $2)`, [securityId, startDate]);
    const inLarge = await db.maybeOne(`SELECT 1 FROM ref.index_constituents WHERE index_code='DEMOLC' AND security_id=$1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to > $2)`, [securityId, startDate]);
    cls = inLarge ? 'large' : inSmall ? 'small' : 'mid';
  }
  if (cls && b.universe_size_class !== 'broad' && cls !== b.universe_size_class && (cls === 'small' || b.universe_size_class === 'small' || cls === 'large')) {
    return `The universe is ${cls}-cap but the benchmark (${b.name}) is ${b.universe_size_class}-cap; differences may reflect size rather than the strategy.`;
  }
  return null;
}

export interface CreateRunResult {
  runId: string;
  status: 'queued' | 'succeeded' | 'running' | 'failed';
  position?: number;
}

/** Validate, enforce entitlements, consume one backtest and create the run record. */
export async function createRun(ctx: AppContext, user: { userId: string }, plan: UserPlan, req: BacktestRequest, opts: { idempotencyKey?: string; rerunOf?: string } = {}): Promise<CreateRunResult> {
  const t = TEMPLATE_BY_CODE.get(req.template);
  if (!t) throw badRequest('Unknown template.');
  const params = resolveParams(t, req.params);
  if (!t.universeKinds.includes(req.universe.type)) throw badRequest(`${t.name} runs on ${t.universeKinds.join(' or ')} universes.`);
  if (req.universe.type !== 'security' && plan.plan === 'free') requireFeature(plan, 'backtest_universe_strategies', 'Testing on a universe');
  if (t.kind === 'cross_sectional' || req.universe.type === 'screen') requireFeature(plan, 'backtest_universe_strategies', 'Universe strategies and screen universes');
  if (t.code === 'custom_rules') {
    // BKT-02: the rule builder is a Pro feature.
    requireFeature(plan, 'backtest_universe_strategies', 'The rule builder');
    if (!req.rules) throw badRequest('Add at least one entry and one exit condition.');
  } else if (req.rules) throw badRequest('Rules apply only to the custom-rules template.');
  if (req.period.from >= req.period.to) throw badRequest('The period start must be before its end.');
  if (opts.idempotencyKey) {
    const prior = await ctx.db.maybeOne<{ run_id: string; status: CreateRunResult['status'] }>(`SELECT run_id, status FROM bt.backtest_runs WHERE user_id=$1 AND idempotency_key=$2`, [user.userId, opts.idempotencyKey]);
    if (prior) return { runId: prior.run_id, status: prior.status };
  }
  const snap = req.snapshot_id ? await getSnapshot(ctx.db, req.snapshot_id) : await latestSnapshot(ctx.db);
  if (!snap) throw badRequest('No data snapshot is available yet.');
  const benchmark = await defaultBenchmark(ctx.db, req);
  await consume(ctx.db, user.userId, 'backtests', plan, ctx.clock());
  const costVersion = req.costs.included ? DEFAULT_COST_TABLE.version : ZERO_COSTS.version;
  const config = { ...req, params, benchmark, snapshot_id: snap.snapshot_id };
  try {
    const row = await ctx.db.one<{ run_id: string }>(
      `INSERT INTO bt.backtest_runs (user_id, idempotency_key, name, config, template_code, template_version, snapshot_id, engine_version, cost_table_version, benchmark_code, status, rerun_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11) RETURNING run_id`,
      [user.userId, opts.idempotencyKey ?? null, req.name ?? null, JSON.stringify(config), t.code, t.version, snap.snapshot_id, ENGINE_VERSION, costVersion, benchmark, opts.rerunOf ?? null],
    );
    const inline = req.universe.type === 'security';
    if (inline) {
      await executeRun(ctx, row.run_id);
      const done = await ctx.db.one<{ status: CreateRunResult['status'] }>(`SELECT status FROM bt.backtest_runs WHERE run_id=$1`, [row.run_id]);
      return { runId: row.run_id, status: done.status };
    }
    await ctx.db.query(`INSERT INTO ops.job_queue (kind, payload, idempotency_key, status, priority) VALUES ('backtest', $1, $2, 'queued', 5)`, [JSON.stringify({ run_id: row.run_id }), `backtest:${row.run_id}`]);
    const position = (await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ops.job_queue WHERE kind='backtest' AND status IN ('queued','running')`)).n;
    return { runId: row.run_id, status: 'queued', position };
  } catch (err) {
    await refund(ctx.db, user.userId, 'backtests', ctx.clock());
    throw err;
  }
}

export async function executeRun(ctx: AppContext, runId: string, onProgress?: (p: number) => Promise<void>): Promise<void> {
  const db = ctx.db;
  const run = await db.one<{ run_id: string; user_id: string; config: BacktestRequest & { benchmark: string; snapshot_id: string; params: Record<string, number> }; created_at: string }>(`SELECT run_id, user_id, config, created_at FROM bt.backtest_runs WHERE run_id=$1`, [runId]);
  const t0 = Date.now();
  await db.query(`UPDATE bt.backtest_runs SET status='running', started_at=now(), progress=5 WHERE run_id=$1`, [runId]);
  try {
    const cfg = run.config;
    const t = TEMPLATE_BY_CODE.get(cfg.template) as TemplateSpec;
    const snap = (await getSnapshot(db, cfg.snapshot_id))!;
    const to = cfg.period.to > snap.as_of_date ? snap.as_of_date : cfg.period.to;
    const calendar = await tradingCalendar(db, cfg.period.from, to);
    if (calendar.length < 30) throw badRequest('The period must include at least 30 trading sessions.');
    let universe: (i: number) => number[];
    let securityIds: number[];
    let delistedInUniverse = 0;
    let securityId: number | null = null;
    if (cfg.universe.type === 'security') {
      const s = await db.maybeOne<{ security_id: number }>(`SELECT s.security_id FROM ref.securities s JOIN ref.companies c USING (company_id) WHERE c.company_id=$1 AND c.coverage='full'`, [cfg.universe.company_id]);
      if (!s) throw badRequest('This company is not covered.');
      securityId = s.security_id;
      securityIds = [s.security_id];
      universe = () => [s.security_id];
    } else if (cfg.universe.type === 'index') {
      const u = await indexUniverse(db, cfg.universe.index_code, calendar, snap);
      securityIds = u.all;
      delistedInUniverse = u.delistedInUniverse;
      universe = (i) => u.members[i] ?? [];
    } else {
      const screen = await db.maybeOne<{ definition: { filters: { field: string; op: string; value: number; value2?: number }[]; sectors?: string[] } }>(`SELECT definition FROM app.saved_screens WHERE screen_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [cfg.universe.screen_id, run.user_id]);
      if (!screen) throw notFound('Saved screen not found.');
      const u = await screenUniverse(db, screen.definition, calendar, snap);
      securityIds = u.all;
      delistedInUniverse = u.delistedInUniverse;
      universe = (i) => u.members[i] ?? [];
    }
    await onProgress?.(25);
    await db.query(`UPDATE bt.backtest_runs SET progress=25 WHERE run_id=$1`, [runId]);
    const securities = await loadSecurities(db, securityIds, calendar, snap);
    await db.query(`UPDATE bt.backtest_runs SET progress=55 WHERE run_id=$1`, [runId]);
    const costs = cfg.costs.included ? { ...DEFAULT_COST_TABLE, brokerage_pct: (cfg.costs.brokerage_bps ?? 0) / 10_000 } : ZERO_COSTS;
    const base = { template: t, params: cfg.params, rules: cfg.rules, calendar, startIdx: 0, endIdx: calendar.length - 1, securities, universe, capital: cfg.capital_inr, liquidity: { maxAdvPct: cfg.liquidity.max_adv_pct, minAdvInr: cfg.liquidity.min_adv_cr * 1e7, mode: cfg.liquidity.mode } };
    const result = runEngine({ ...base, costs, costMultiplier: 1, slippageBps: cfg.costs.included ? cfg.costs.slippage_bps : 0 });
    const doubled = cfg.costs.included ? runEngine({ ...base, costs, costMultiplier: 2, slippageBps: cfg.costs.slippage_bps * 2 }) : null;
    await db.query(`UPDATE bt.backtest_runs SET progress=85 WHERE run_id=$1`, [runId]);
    const bench = await benchmarkSeries(db, cfg.benchmark, calendar);
    const rf = await riskFreeDaily(db, calendar);
    const metrics = computeMetrics(result, cfg.capital_inr, bench, rf);
    const doubledReturn = doubled ? (doubled.equity[doubled.equity.length - 1]! / cfg.capital_inr - 1) * 100 : null;
    const variants = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM bt.backtest_runs WHERE user_id=$1 AND created_at > $2::timestamptz - interval '6 hours' AND created_at <= $2 AND rerun_of IS NULL`, [run.user_id, run.created_at])).n;
    const mismatch = await benchmarkMismatch(db, cfg, cfg.benchmark, securityId, calendar[0]!);
    const warnings = robustnessWarnings({ metrics, roundTrips: result.roundTrips, doubledCostReturn: doubledReturn, universeKind: cfg.universe.type, delistedIncluded: result.delistedHeld, variantsThisSession: variants, costsExcluded: !cfg.costs.included, benchmarkMismatch: mismatch });
    const regimes = await regimeLabelsByDate(db, calendar[0]!, calendar[calendar.length - 1]!);
    const benchDef = await db.one<{ name: string; kind: string }>(`SELECT name, kind FROM ref.index_definitions WHERE index_code=$1`, [cfg.benchmark]);
    const series = {
      dates: result.dates,
      equity: result.equity.map((x) => Number(x.toFixed(4))),
      benchmark: bench.map((b) => Number(((b / bench[0]!) * cfg.capital_inr).toFixed(4))),
      drawdown: drawdownSeries(result.equity).map((x) => Number(x.toFixed(6))),
      invested: result.invested.map((x) => Number(x.toFixed(6))),
      universe_size: result.universeSizes,
    };
    const extras = {
      by_year: calendarYearReturns(result.dates, result.equity),
      by_regime: regimeReturns(result.dates, result.equity, regimes),
      benchmark: { code: cfg.benchmark, name: benchDef.name, type: benchDef.kind === 'total_return' ? 'Total return' : 'Price return' },
      universe: { type: cfg.universe.type, securities_considered: securityIds.length, delisted_in_universe: delistedInUniverse, delisted_held: result.delistedHeld },
      doubled_costs_total_return: doubledReturn,
      skipped_trades: result.trades.filter((x) => x.side === 'skipped').length,
      cost_breakdown: result.trades.reduce((acc, tr) => {
        if (tr.costs) for (const k of ['brokerage', 'stt', 'exchange', 'sebi', 'stamp', 'gst', 'dp', 'slippage'] as const) acc[k] = (acc[k] ?? 0) + tr.costs[k];
        return acc;
      }, {} as Record<string, number>),
      period: { from: calendar[0], to: calendar[calendar.length - 1], sessions: calendar.length },
    };
    const hash = resultsHash({ config: cfg, snapshotId: cfg.snapshot_id, engine: ENGINE_VERSION, costTable: costs.version, metrics, finalEquity: metrics.final_equity, trades: result.roundTrips.length });
    const key = `backtests/${runId}/series.json`;
    await ctx.store.put(key, JSON.stringify(series));
    await db.tx(async (tx) => {
      await tx.query(`DELETE FROM bt.backtest_trades WHERE run_id=$1`, [runId]);
      const rows = result.trades.map((tr) => ({ run_id: runId, seq: tr.seq, security_id: tr.securityId, symbol: tr.symbol, side: tr.side, trade_date: tr.date, price: tr.price, quantity: tr.quantity, gross_value: tr.grossValue, costs: tr.costs ?? {}, pnl: tr.pnl, reason: tr.reason }));
      const { bulkInsert } = await import('../../lib/bulk.js');
      await bulkInsert(tx, 'bt.backtest_trades', rows, { chunk: 2000 });
      await tx.query(`UPDATE bt.backtest_runs SET status='succeeded', progress=100, metrics=$2, warnings=$3, results_hash=$4, series_key=$5, finished_at=now(), runtime_ms=$6, error=NULL WHERE run_id=$1`, [runId, JSON.stringify({ ...metrics, ...extras }), JSON.stringify(warnings), hash, key, Date.now() - t0]);
    });
    await track(db, 'backtest_completed', { template: t.code, universe_size: securityIds.length, years: Number(metrics.years.toFixed(2)), warnings: warnings.length, runtime_ms: Date.now() - t0 }, { userId: run.user_id, origin: 'server' });
    await db.query(`INSERT INTO app.research_history (user_id, kind, ref_id, label) VALUES ($1,'backtest',$2,$3)`, [run.user_id, runId, `${t.name} backtest`]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(`UPDATE bt.backtest_runs SET status='failed', error=$2, finished_at=now(), runtime_ms=$3 WHERE run_id=$1`, [runId, message, Date.now() - t0]);
    // A run that failed for a data or validation reason does not count against the allowance.
    await refund(db, run.user_id, 'backtests', ctx.clock());
  }
}

export async function getRun(db: Db, runId: string, userId: string) {
  const run = await db.maybeOne<Record<string, unknown> & { user_id: string; series_key: string | null }>(`SELECT * FROM bt.backtest_runs WHERE run_id=$1 AND deleted_at IS NULL`, [runId]);
  if (!run || run.user_id !== userId) return null;
  return run;
}

export async function rerun(ctx: AppContext, user: { userId: string }, plan: UserPlan, runId: string): Promise<{ newRunId: string; identical: boolean | null; originalHash: string | null; newHash: string | null }> {
  const run = await getRun(ctx.db, runId, user.userId);
  if (!run) throw notFound();
  const cfg = run.config as BacktestRequest & { snapshot_id: string };
  const r = await createRun(ctx, user, plan, { ...cfg, snapshot_id: cfg.snapshot_id }, { rerunOf: runId });
  if (r.status === 'queued') return { newRunId: r.runId, identical: null, originalHash: run.results_hash as string, newHash: null };
  const n = await ctx.db.one<{ results_hash: string | null }>(`SELECT results_hash FROM bt.backtest_runs WHERE run_id=$1`, [r.runId]);
  return { newRunId: r.runId, identical: n.results_hash === run.results_hash, originalHash: run.results_hash as string, newHash: n.results_hash };
}

/** Background job runner for queued runs (Blueprint: workers). Single-flight per job via row locks. */
export async function processBacktestQueue(ctx: AppContext, workerId: string, max = 2): Promise<number> {
  let done = 0;
  for (let k = 0; k < max; k++) {
    const job = await ctx.db.maybeOne<{ job_id: string; payload: { run_id: string } }>(
      `UPDATE ops.job_queue SET status='running', locked_at=now(), locked_by=$1, attempts=attempts+1 WHERE job_id = (
         SELECT job_id FROM ops.job_queue WHERE kind='backtest' AND status='queued' AND run_after <= now() ORDER BY priority, created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING job_id, payload`,
      [workerId],
    );
    if (!job) break;
    try {
      await executeRun(ctx, job.payload.run_id, async (p) => {
        await ctx.db.query(`UPDATE ops.job_queue SET progress=$2 WHERE job_id=$1`, [job.job_id, p]);
      });
      await ctx.db.query(`UPDATE ops.job_queue SET status='done', finished_at=now(), progress=100 WHERE job_id=$1`, [job.job_id]);
    } catch (err) {
      await ctx.db.query(`UPDATE ops.job_queue SET status=CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END, error=$2, run_after=now() + interval '30 seconds' WHERE job_id=$1`, [job.job_id, err instanceof Error ? err.message : String(err)]);
    }
    done++;
  }
  return done;
}
