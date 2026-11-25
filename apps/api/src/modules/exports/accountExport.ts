import type { AppContext } from '../../context.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';

// Personal data export (PRD ACC-07): the user's own content as JSON and CSV. Contains no licensed
// market data, so no licence rights are needed for this export path (EXP-03 rights test covers it).

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formula injection.
    // Numbers are written as numbers: "-5" is not a formula.
    const safe = typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export async function collectUserContent(ctx: AppContext, userId: string) {
  const db = ctx.db;
  const watchlists = await db.query(`SELECT w.watchlist_id, w.name, w.created_at, coalesce(json_agg(json_build_object('company', c.short_name, 'added_at', i.added_at)) FILTER (WHERE i.company_id IS NOT NULL), '[]') AS items
                                        FROM app.watchlists w LEFT JOIN app.watchlist_items i USING (watchlist_id) LEFT JOIN ref.companies c ON c.company_id=i.company_id
                                       WHERE w.user_id=$1 AND w.deleted_at IS NULL GROUP BY w.watchlist_id ORDER BY w.position`, [userId]);
  const notes = await db.query(`SELECT note_id, attached_type, attached_id, title, body, tags, snapshots, created_at, updated_at FROM app.notes WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [userId]);
  const screens = await db.query(`SELECT screen_id, name, definition, created_at FROM app.saved_screens WHERE user_id=$1 AND deleted_at IS NULL`, [userId]);
  const backtests = await db.query(`SELECT run_id, name, config, template_code, template_version, cost_table_version, benchmark_code, created_at, results_hash FROM bt.backtest_runs WHERE user_id=$1 AND deleted_at IS NULL`, [userId]);
  const workspaces = await db.query(`SELECT workspace_id, name, state, saved_as_of, created_at FROM app.workspaces WHERE user_id=$1 AND deleted_at IS NULL`, [userId]);
  const alerts = await db.query(`SELECT rule_id, kind, config, digest, status, created_at FROM app.alert_rules WHERE user_id=$1 AND deleted_at IS NULL`, [userId]);
  const hypotheses = await db.query(`SELECT hypothesis_id, statement, evidence, review_date, created_at FROM app.hypotheses WHERE user_id=$1 AND deleted_at IS NULL`, [userId]);
  const consents = await db.query(`SELECT kind, version, granted, at, source FROM app.consents WHERE user_id=$1 ORDER BY at`, [userId]);
  // Research hub, Digital Assets, uploads, follows and Academy records are the user's own content as well.
  const own: Record<string, Record<string, unknown>[]> = {};
  for (const [section, table, live] of [
    ['research_portfolios', 'research.portfolios', true], ['research_views', 'research.saved_views', true], ['research_notebook', 'research.notebook_entries', true],
    ['research_reports', 'research.reports', true], ['research_alerts', 'research.alert_rules', true], ['imported_statements', 'research.user_fundamentals', false],
    ['crypto_notes', 'crypto.research_notes', false], ['crypto_watchlist', 'crypto.watchlist_items', false], ['uploaded_datasets', 'app.user_datasets', true],
    ['followed_series', 'app.series_follows', false], ['academy_enrolments', 'acad.enrolments', false], ['academy_lesson_progress', 'acad.lesson_progress', false],
    ['academy_quiz_attempts', 'acad.quiz_attempts', false], ['academy_capstones', 'acad.capstone_submissions', false], ['academy_completions', 'acad.completion_records', false],
  ] as const) own[section] = await db.query(`SELECT * FROM ${table} WHERE user_id=$1${live ? ' AND deleted_at IS NULL' : ''}`, [userId]);
  own.research_portfolio_holdings = await db.query(`SELECT h.* FROM research.portfolio_holdings h JOIN research.portfolios p USING (portfolio_id) WHERE p.user_id=$1 AND p.deleted_at IS NULL`, [userId]);
  return { ...own, watchlists, notes, saved_screens: screens, backtest_configurations: backtests, workspaces, alert_rules: alerts, hypotheses, consents };
}

export async function requestAccountExport(ctx: AppContext, userId: string): Promise<{ exportId: string; status: string; downloadPath: string; expiresAt: string }> {
  const content = await collectUserContent(ctx, userId);
  const token = randomToken(24);
  const expires = new Date(ctx.clock().getTime() + 7 * 86_400_000).toISOString();
  const row = await ctx.db.one<{ export_id: string }>(`INSERT INTO app.exports (user_id, kind, status, token_hash, expires_at) VALUES ($1,'account_data','queued',$2,$3) RETURNING export_id`, [userId, sha256Hex(token), expires]);
  const json = JSON.stringify({ generated_at: ctx.clock().toISOString(), user_id: userId, format: 'atlas-account-export-v1', ...content }, null, 2);
  const csv = Object.entries(content).map(([section, rows]) => `# ${section}\n${toCsv(rows as Record<string, unknown>[])}`).join('\n\n');
  await ctx.store.put(`exports/${row.export_id}/atlas-export.json`, json);
  await ctx.store.put(`exports/${row.export_id}/atlas-export.csv`, csv);
  await ctx.db.query(`UPDATE app.exports SET status='ready', completed_at=now(), object_key=$2 WHERE export_id=$1`, [row.export_id, `exports/${row.export_id}/`]);
  return { exportId: row.export_id, status: 'ready', downloadPath: `/v1/exports/${row.export_id}/download?token=${token}`, expiresAt: expires };
}

export { toCsv };
