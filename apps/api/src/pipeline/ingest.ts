import { sha256 } from '../lib/objectStore.js';
import type { HandlerResult, PipelineCtx } from './context.js';
import { raiseOpsAlert } from './context.js';
import { handleAnnouncements, handleInsiderTrades } from './handlers/disclosures.js';
import { handleAuditEvents, handleFundamentals, handleShareholding, handleXbrl } from './handlers/fundamentals.js';
import { handleCorporateActions, handleIndex, handlePrices } from './handlers/prices.js';
import { handleCalendar, handleMacroCalendar, handleMaster, handleRiskFree } from './handlers/reference.js';
import type { DatasetName, FetchRequest, VendorAdapter, VendorFile } from './vendor.js';

// Stages 1–5 of the pipeline (Blueprint §5.1): source → ingestion (raw saved unchanged with a
// checksum and an ops.ingestion_runs row) → validation → normalisation → storage with provenance.

export interface IngestOutcome {
  dataset: DatasetName;
  runId: string | null;
  status: 'succeeded' | 'partial' | 'failed' | 'blocked' | 'duplicate' | 'no_file';
  result?: HandlerResult;
  error?: string;
}

export async function ingestFile(ctx: PipelineCtx, file: VendorFile, vendorIsSynthetic: boolean): Promise<IngestOutcome> {
  const db = ctx.db;
  if (vendorIsSynthetic && !ctx.cfg.allowSyntheticData) {
    throw new Error('Synthetic vendor data is refused in this environment (production safety guard)');
  }
  const checksum = sha256(file.body);
  const dup = await db.maybeOne<{ run_id: string }>(`SELECT run_id FROM ops.ingestion_runs WHERE source_id=$1 AND checksum=$2 AND status IN ('succeeded','partial')`, [file.sourceId, checksum]);
  if (dup) return { dataset: file.dataset, runId: dup.run_id, status: 'duplicate' };
  const key = `raw/${file.sourceId}/${file.dataDate}/${checksum.slice(0, 16)}_${file.fileName}`;
  const stored = await ctx.store.put(key, file.body);
  const run = await db.one<{ run_id: string }>(
    `INSERT INTO ops.ingestion_runs (source_id, dataset, data_date, status, file_key, checksum, bytes) VALUES ($1,$2,$3,'running',$4,$5,$6) RETURNING run_id`,
    [file.sourceId, file.dataset, file.dataDate, stored.key, checksum, stored.bytes],
  );
  const runId = run.run_id;
  try {
    const parsed = JSON.parse(file.body) as { meta: { asOf: string; mode: 'history' | 'daily' }; records: unknown[] };
    if (!parsed || !Array.isArray(parsed.records)) throw new Error('schema: file has no records array');
    const recs = parsed.records as never[];
    const base = { sourceId: file.sourceId, runId, asOf: file.dataDate, mode: file.mode };
    let result: HandlerResult;
    switch (file.dataset) {
      case 'master': result = await handleMaster(ctx, recs, file.sourceId, vendorIsSynthetic); break;
      case 'calendar': result = await handleCalendar(ctx, recs, file.sourceId); break;
      case 'eod_prices': result = await handlePrices(ctx, recs, base); break;
      case 'corporate_actions': result = await handleCorporateActions(ctx, recs, base); break;
      case 'index': result = await handleIndex(ctx, recs, { sourceId: file.sourceId, isSynthetic: vendorIsSynthetic }); break;
      case 'fundamentals': result = await handleFundamentals(ctx, recs, base); break;
      case 'xbrl_sample': result = await handleXbrl(ctx, recs, base); break;
      case 'shareholding': result = await handleShareholding(ctx, recs, base); break;
      case 'announcements': result = await handleAnnouncements(ctx, recs, base); break;
      case 'insider_trades': result = await handleInsiderTrades(ctx, recs, base); break;
      case 'audit_events': result = await handleAuditEvents(ctx, recs, base); break;
      case 'risk_free': result = await handleRiskFree(ctx, recs, file.sourceId, runId); break;
      case 'macro_calendar': result = await handleMacroCalendar(ctx, recs, file.sourceId); break;
    }
    await db.query(
      `UPDATE ops.ingestion_runs SET status=$2, finished_at=now(), rows_in=$3, rows_valid=$4, rows_quarantined=$5, checks=$6 WHERE run_id=$1`,
      [runId, result.status, result.rowsIn, result.rowsValid, result.rowsQuarantined, JSON.stringify(result.checks)],
    );
    if (result.status !== 'blocked') {
      await db.query(`UPDATE ref.sources SET last_success_at = now(), last_data_date = GREATEST(COALESCE(last_data_date, $2::date), $2::date) WHERE source_id = $1`, [file.sourceId, file.dataDate]);
    }
    ctx.log.info('ingestion finished', { dataset: file.dataset, run_id: runId, status: result.status, rows_valid: result.rowsValid, rows_quarantined: result.rowsQuarantined });
    return { dataset: file.dataset, runId, status: result.status, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(`UPDATE ops.ingestion_runs SET status='failed', finished_at=now(), error=$2 WHERE run_id=$1`, [runId, message]);
    await raiseOpsAlert(db, { kind: 'ingestion_failed', severity: 'SEV2', message: `Ingestion of ${file.dataset} for ${file.dataDate} failed: ${message}`, details: { run_id: runId }, dedupeKey: `ingest-failed-${file.dataset}-${file.dataDate}` });
    ctx.log.error('ingestion failed', { dataset: file.dataset, run_id: runId, error: message });
    return { dataset: file.dataset, runId, status: 'failed', error: message };
  }
}

export async function ingestDataset(ctx: PipelineCtx, vendor: VendorAdapter, dataset: DatasetName, req: FetchRequest): Promise<IngestOutcome> {
  const file = await vendor.fetch(dataset, req);
  if (!file) return { dataset, runId: null, status: 'no_file' };
  return ingestFile(ctx, file, vendor.isSynthetic);
}

/** Order matters: reference data first so prices and filings can be mapped. */
export const INGEST_ORDER: DatasetName[] = ['calendar', 'master', 'corporate_actions', 'eod_prices', 'index', 'fundamentals', 'xbrl_sample', 'shareholding', 'announcements', 'insider_trades', 'audit_events', 'risk_free', 'macro_calendar'];
