import { CODE_VERSION } from '../config.js';
import type { Db } from '../db/db.js';
import { seedMetricDefinitions } from '../modules/calc/definitions.js';
import { seedLineItems } from '../modules/fundamentals/lineItems.js';
import { seedRegistry } from '../modules/ref/registry.js';
import { finishCalcRun, rebuildAdjusted, startCalcRun } from './calc/adjust.js';
import { computeSecurityDaily } from './calc/daily.js';
import { computeMarketDaily, seedRegimeRules } from './calc/market.js';
import { computeCompanyMetrics } from './calc/metrics.js';
import type { PipelineCtx } from './context.js';
import { raiseOpsAlert } from './context.js';
import { INGEST_ORDER, ingestDataset, type IngestOutcome } from './ingest.js';
import type { VendorAdapter } from './vendor.js';

export async function seedReferenceData(db: Db): Promise<void> {
  await seedRegistry(db);
  await seedLineItems(db);
  await seedMetricDefinitions(db);
  await seedRegimeRules(db);
}

export interface CalcSummary {
  calcRunId: string;
  adjustedRows: number;
  dailyRows: number;
  marketDays: number;
  metricRows: number;
  ms: number;
}

export async function runCalculations(ctx: PipelineCtx, opts: { asOf: string; fromDate?: string; securityIds?: number[]; fullSecurityIds?: number[]; companyIds?: string[]; latestOnly?: boolean }): Promise<CalcSummary> {
  const t0 = Date.now();
  const calcRunId = await startCalcRun(ctx.db, opts.fromDate ? 'incremental' : 'full', CODE_VERSION);
  try {
    let adjustedRows = 0;
    if (opts.fullSecurityIds?.length) adjustedRows += (await rebuildAdjusted(ctx.db, { securityIds: opts.fullSecurityIds, calcRunId })).rows;
    const incremental = opts.securityIds?.filter((s) => !opts.fullSecurityIds?.includes(s));
    adjustedRows += (await rebuildAdjusted(ctx.db, { securityIds: opts.fromDate ? incremental : opts.securityIds, fromDate: opts.fromDate, calcRunId })).rows;
    let dailyRows = 0;
    if (opts.fullSecurityIds?.length) dailyRows += await computeSecurityDaily(ctx.db, { securityIds: opts.fullSecurityIds, calcRunId });
    dailyRows += await computeSecurityDaily(ctx.db, { securityIds: opts.fromDate ? incremental : opts.securityIds, fromDate: opts.fromDate, calcRunId });
    const marketDays = await computeMarketDaily(ctx.db, { fromDate: opts.fromDate, calcRunId });
    const metricRows = await computeCompanyMetrics(ctx.db, { asOf: opts.asOf, calcRunId, companyIds: opts.companyIds, latestOnly: opts.latestOnly });
    const summary = { calcRunId, adjustedRows, dailyRows, marketDays, metricRows, ms: Date.now() - t0 };
    await finishCalcRun(ctx.db, calcRunId, 'succeeded', summary);
    ctx.log.info('calculations finished', summary);
    return summary;
  } catch (err) {
    await finishCalcRun(ctx.db, calcRunId, 'failed', { error: err instanceof Error ? err.message : String(err) });
    await raiseOpsAlert(ctx.db, { kind: 'calc_failed', severity: 'SEV2', message: `Calculation run failed: ${err instanceof Error ? err.message : String(err)}`, dedupeKey: `calc-failed-${opts.asOf}` });
    throw err;
  }
}

/** Load full history up to `asOf` (bulk vendor history products), then calculate everything. */
export async function runHistoryLoad(ctx: PipelineCtx, vendor: VendorAdapter, asOf: string): Promise<{ ingest: IngestOutcome[]; calc: CalcSummary }> {
  const ingest: IngestOutcome[] = [];
  for (const ds of INGEST_ORDER) {
    const t = Date.now();
    const r = await ingestDataset(ctx, vendor, ds, { asOf, mode: 'history' });
    ctx.log.info('history dataset loaded', { dataset: ds, status: r.status, ms: Date.now() - t, rows: r.result?.rowsValid });
    ingest.push(r);
  }
  const calc = await runCalculations(ctx, { asOf });
  return { ingest, calc };
}
