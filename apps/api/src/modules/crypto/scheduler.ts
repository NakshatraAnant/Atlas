import type { Db } from '../../db/db.js';
import * as I from './ingest.js';

// Source-specific refresh schedule. "Last run" is read from crypto.ingestion_jobs, so the schedule
// survives restarts. Jobs run one at a time so they share each provider's request budget fairly.
// Intervals are initial choices tuned to the free tiers (docs/crypto/SOURCE_CAPABILITY_MATRIX.md); they
// are not guarantees of provider freshness.

export interface JobSpec {
  type: string;
  source: string;
  everyMs: number;
  /** Lower runs first when several are due. */
  priority: number;
  /** Jobs that need others to have succeeded at least once. */
  needs?: string[];
  run: (rt: I.CryptoRuntime, job: I.Job) => Promise<void>;
  /** Freshness target shown in the UI for data this job maintains. */
  freshnessMinutes: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const JOBS: JobSpec[] = [
  { type: 'markets', source: 'coingecko', everyMs: 15 * MIN, priority: 1, run: I.syncMarkets, freshnessMinutes: 30 },
  { type: 'global', source: 'coingecko', everyMs: 15 * MIN, priority: 2, run: I.syncGlobal, freshnessMinutes: 30 },
  { type: 'markets_inr', source: 'coingecko', everyMs: 60 * MIN, priority: 5, needs: ['markets'], run: I.syncInrSnapshot, freshnessMinutes: 120 },
  { type: 'asset_details', source: 'coingecko', everyMs: 30 * MIN, priority: 6, needs: ['markets'], run: (rt, j) => I.syncDetails(rt, j), freshnessMinutes: 7 * 24 * 60 },
  { type: 'pairs_binance', source: 'coingecko', everyMs: 24 * HOUR, priority: 3, needs: ['markets'], run: (rt, j) => I.syncVenuePairs(rt, j, 'binance'), freshnessMinutes: 48 * 60 },
  { type: 'pairs_coinbase', source: 'coingecko', everyMs: 24 * HOUR, priority: 3, needs: ['markets'], run: (rt, j) => I.syncVenuePairs(rt, j, 'coinbase'), freshnessMinutes: 48 * 60 },
  { type: 'candles_binance', source: 'binance', everyMs: 60 * MIN, priority: 4, needs: ['pairs_binance'], run: (rt, j) => I.backfillVenueCandles(rt, j, 'binance'), freshnessMinutes: 26 * 60 },
  { type: 'candles_coinbase', source: 'coinbase', everyMs: 60 * MIN, priority: 4, needs: ['pairs_coinbase'], run: (rt, j) => I.backfillVenueCandles(rt, j, 'coinbase'), freshnessMinutes: 26 * 60 },
  { type: 'reference_history', source: 'coingecko', everyMs: 2 * HOUR, priority: 7, needs: ['markets'], run: (rt, j) => I.syncReferenceHistory(rt, j), freshnessMinutes: 26 * 60 },
  { type: 'defi_protocols', source: 'defillama', everyMs: 6 * HOUR, priority: 5, run: I.syncDefi, freshnessMinutes: 12 * 60 },
  { type: 'defi_history', source: 'defillama', everyMs: 24 * HOUR, priority: 8, needs: ['defi_protocols'], run: I.syncDefiHistories, freshnessMinutes: 48 * 60 },
  { type: 'onchain_ethereum', source: 'ethereum_rpc', everyMs: 2 * MIN, priority: 2, run: I.syncEthereum, freshnessMinutes: 10 },
  { type: 'onchain_bitcoin', source: 'mempool_space', everyMs: 5 * MIN, priority: 2, run: I.syncBitcoin, freshnessMinutes: 60 },
  { type: 'events_github', source: 'github_releases', everyMs: 6 * HOUR, priority: 9, run: I.syncGithubReleases, freshnessMinutes: 24 * 60 },
  { type: 'events_ethereum_blog', source: 'ethereum_blog', everyMs: 6 * HOUR, priority: 9, run: I.syncEthereumBlog, freshnessMinutes: 24 * 60 },
];

export const jobSpec = (type: string) => JOBS.find((j) => j.type === type);

export async function lastRuns(db: Db): Promise<Map<string, { started_at: string; status: string; last_success: string | null }>> {
  const rows = await db.query<{ job_type: string; started_at: string; status: string; last_success: string | null }>(
    `SELECT DISTINCT ON (job_type) job_type, started_at, status,
            (SELECT max(finished_at) FROM crypto.ingestion_jobs x WHERE x.job_type=j.job_type AND x.status IN ('succeeded','partial')) AS last_success
       FROM crypto.ingestion_jobs j ORDER BY job_type, started_at DESC`);
  return new Map(rows.map((r) => [r.job_type, r]));
}

/** Jobs due now, highest priority first. A failed job waits a fifth of its interval (at least 2 min) before retrying. */
export async function dueJobs(db: Db, now: number): Promise<JobSpec[]> {
  const last = await lastRuns(db);
  const enabled = new Set((await db.query<{ source_id: string }>(`SELECT source_id FROM crypto.sources WHERE enabled`)).map((r) => r.source_id));
  return JOBS.filter((j) => {
    if (!enabled.has(j.source)) return false;
    if (j.needs?.some((n) => !last.get(n)?.last_success)) return false;
    const l = last.get(j.type);
    if (!l) return true;
    const wait = l.status === 'failed' ? Math.max(2 * MIN, j.everyMs / 5) : j.everyMs;
    return now - Date.parse(l.started_at) >= wait;
  }).sort((a, b) => a.priority - b.priority);
}

export async function runNamed(rt: I.CryptoRuntime, type: string, trigger: 'schedule' | 'manual' | 'startup' | 'test'): Promise<I.JobResult> {
  const spec = jobSpec(type);
  if (!spec) throw new Error(`Unknown crypto job: ${type}`);
  return I.runJob(rt, spec.source, spec.type, trigger, (job) => spec.run(rt, job));
}

/** One scheduler tick: runs due jobs serially, bounded by maxJobs so a tick cannot run forever. */
export async function cryptoTick(rt: I.CryptoRuntime, maxJobs = 4): Promise<I.JobResult[]> {
  const out: I.JobResult[] = [];
  for (const spec of (await dueJobs(rt.db, rt.now())).slice(0, maxJobs)) out.push(await runNamed(rt, spec.type, 'schedule'));
  if (out.length) {
    const last = (await rt.db.maybeOne<{ t: string | null }>(`SELECT max(started_at) AS t FROM crypto.ingestion_jobs WHERE job_type='prune'`))?.t;
    if (!last || rt.now() - Date.parse(last) > 24 * HOUR) {
      await I.runJob(rt, 'atlas_observed', 'prune', 'schedule', async (job) => { job.detail = await I.prune(rt.db); });
    }
  }
  return out;
}
