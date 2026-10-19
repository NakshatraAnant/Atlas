import type { Config } from '../config.js';
import type { Db } from '../db/db.js';
import type { Logger } from '../lib/logger.js';
import type { ObjectStore } from '../lib/objectStore.js';

export interface PipelineCtx {
  db: Db;
  store: ObjectStore;
  cfg: Pick<Config, 'allowSyntheticData'>;
  log: Logger;
  now: () => Date;
}

export type CheckSeverity = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  check: string;
  severity: CheckSeverity;
  detail: string;
  count?: number;
}

export interface HandlerResult {
  rowsIn: number;
  rowsValid: number;
  rowsQuarantined: number;
  checks: CheckResult[];
  /** blocked = dataset-level failure; nothing from this file is published. */
  status: 'succeeded' | 'partial' | 'blocked';
  affected?: { securities?: number[]; companies?: string[]; dates?: string[] };
}

export async function raiseQualityIssue(
  db: Db,
  issue: { kind: string; severity: 'warn' | 'fail'; dataset: string; entityRef?: string | null; title: string; details?: Record<string, unknown> },
): Promise<string> {
  const row = await db.one<{ issue_id: string }>(
    `INSERT INTO calc.quality_issues (kind, severity, dataset, entity_ref, title, details) VALUES ($1,$2,$3,$4,$5,$6) RETURNING issue_id`,
    [issue.kind, issue.severity, issue.dataset, issue.entityRef ?? null, issue.title, JSON.stringify(issue.details ?? {})],
  );
  return row.issue_id;
}

export async function raiseOpsAlert(db: Db, alert: { kind: string; severity: 'SEV1' | 'SEV2' | 'SEV3' | 'info'; message: string; details?: Record<string, unknown>; dedupeKey?: string }): Promise<void> {
  await db.query(
    `INSERT INTO ops.ops_alerts (kind, severity, message, details, dedupe_key) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (dedupe_key) WHERE acknowledged_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING`,
    [alert.kind, alert.severity, alert.message, JSON.stringify(alert.details ?? {}), alert.dedupeKey ?? null],
  );
}

/**
 * Resource trace for pipeline stages (ATLAS_PIPELINE_TRACE=1): process memory (heap, and
 * arrayBuffers, which includes the embedded database's WASM memory) and database size. Used to
 * diagnose the embedded engine's memory ceiling; cheap enough to leave in production code.
 */
export async function traceStage(ctx: Pick<PipelineCtx, 'db' | 'log'>, stage: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (process.env.ATLAS_PIPELINE_TRACE !== '1') return;
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  const size = await ctx.db.one<{ mb: number; wal_mb: number }>(`SELECT round(pg_database_size(current_database()) / 1048576.0)::int AS mb, coalesce((SELECT round(sum(size) / 1048576.0)::int FROM pg_ls_waldir()), -1) AS wal_mb`).catch(() => ({ mb: -1, wal_mb: -1 }));
  ctx.log.info('pipeline trace', { stage, rss_mb: mb(m.rss), heap_mb: mb(m.heapUsed), array_buffers_mb: mb(m.arrayBuffers), db_mb: size.mb, wal_mb: size.wal_mb, ...extra });
}
