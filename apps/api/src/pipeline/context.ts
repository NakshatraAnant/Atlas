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
