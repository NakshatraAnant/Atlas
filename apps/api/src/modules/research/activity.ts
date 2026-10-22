import type { Db } from '../../db/db.js';

// Authoritative research activity. Written only by server code after the work it describes has been
// performed and validated (never from a client-supplied claim). One row per (user, kind, ref), so
// repeating an action cannot earn anything twice. The learning engine derives research XP from here.

export type ActivityKind = 'note_written' | 'hypothesis_recorded' | 'hypothesis_reviewed' | 'journal_reflection' | 'benchmark_comparison' | 'correlation_study' | 'walkforward_backtest' | 'report_created' | 'portfolio_risk_review' | 'data_issue_investigated' | 'scenario_tested' | 'alert_configured';

export async function recordActivity(db: Db, userId: string, kind: ActivityKind, ref: string, at: Date, detail: Record<string, unknown> = {}): Promise<boolean> {
  const r = await db.query(`INSERT INTO research.activity (user_id, kind, ref, occurred_at, detail) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING 1`, [userId, kind, ref.slice(0, 200), at.toISOString(), JSON.stringify(detail)]);
  return r.length > 0;
}

/** A stable reference for a set of instruments (order-independent), so the same study counts once. */
export const studyRef = (parts: string[]) => [...parts].map((p) => p.split('@')[0]).sort().join('|').slice(0, 200);
