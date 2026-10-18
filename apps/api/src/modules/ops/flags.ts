import type { Db } from '../../db/db.js';
import { badRequest } from '../../lib/http.js';
import { audit } from './audit.js';

// Feature flags (PRD ADM-07, CPL-03, BIL-09, ANL-04). Legal-gated flags cannot be enabled without
// approver, approval date and document reference — enforced here and by a database constraint.

export interface FlagSeed {
  key: string;
  description: string;
  legalGated: boolean;
  enabled?: boolean;
}

export const FLAGS: FlagSeed[] = [
  // Legal-gated (business plan §11.3 via PRD): off until counsel signs off.
  { key: 'research_summary_panel', description: 'Company research summary panel (CMP-11). PRD §13.2 decision 4 lists it for legal review; enabled in development only with a recorded dev approval.', legalGated: true },
  { key: 'valuation_scenario_tool', description: 'User valuation scenarios (CMP-08a)', legalGated: true },
  { key: 'price_volume_alerts', description: 'End-of-day price and volume threshold alerts (ALR-02)', legalGated: true },
  { key: 'similar_sessions_forward_returns', description: 'Show what happened after similar past sessions (MKT-06)', legalGated: true },
  { key: 'strategy_signals_and_alerts', description: 'Current strategy signals and strategy alerts (BKT-12) — excluded from Release 1.0', legalGated: true },
  // Operational flags
  { key: 'annual_billing', description: 'Annual plans (BIL-09) — off until the M8 retention gate and annual refund terms are defined', legalGated: false },
  { key: 'google_sign_in', description: 'Google sign-in (ACC-01) — requires an OAuth client', legalGated: false },
  { key: 'ai_llm_narrative', description: 'Use the configured LLM provider for answer narrative (AIA). Off → deterministic composer; release gate AIA-13 applies.', legalGated: false },
  { key: 'ai_table_only_mode', description: 'Kill switch: answers become data tables without narrative (Blueprint §10.3 runbook)', legalGated: false },
  { key: 'paywall_experiment', description: 'A/B experiment on the upgrade prompt copy (ANL-04)', legalGated: false, enabled: true },
  { key: 'pre_market_briefing', description: 'Pre-market briefing (MKT-09, Should)', legalGated: false },
  { key: 'hibp_password_check', description: 'Online breached-password range check (requires outbound access)', legalGated: false },
];

export async function seedFlags(db: Db): Promise<void> {
  for (const f of FLAGS) {
    await db.query(`INSERT INTO ops.feature_flags (flag_key, description, legal_gated, enabled) VALUES ($1,$2,$3,$4) ON CONFLICT (flag_key) DO NOTHING`, [f.key, f.description, f.legalGated, f.enabled ?? false]);
  }
}

export interface FlagState {
  enabled: boolean;
  legalGated: boolean;
  planScope: string[];
  userAllowlist: string[];
  approval: { approver: string; approved_on: string; document_ref: string; environment?: string } | null;
}

export async function getFlag(db: Db, key: string): Promise<FlagState> {
  const f = await db.maybeOne<{ enabled: boolean; legal_gated: boolean; plan_scope: string[]; user_allowlist: string[]; approval: FlagState['approval'] }>(`SELECT enabled, legal_gated, plan_scope, user_allowlist, approval FROM ops.feature_flags WHERE flag_key=$1`, [key]);
  if (!f) return { enabled: false, legalGated: false, planScope: [], userAllowlist: [], approval: null };
  return { enabled: f.enabled, legalGated: f.legal_gated, planScope: f.plan_scope, userAllowlist: f.user_allowlist, approval: f.approval };
}

export async function isEnabled(db: Db, key: string, ctx: { userId?: string | null; plan?: string; production?: boolean } = {}): Promise<boolean> {
  const f = await getFlag(db, key);
  if (!f.enabled) return false;
  if (f.legalGated && !f.approval) return false;
  // A development-only approval record never unlocks a legal-gated feature in production.
  if (f.legalGated && ctx.production && f.approval?.environment === 'development') return false;
  if (f.userAllowlist.length && (!ctx.userId || !f.userAllowlist.includes(ctx.userId))) return false;
  if (f.planScope.length && (!ctx.plan || !f.planScope.includes(ctx.plan))) return false;
  return true;
}

export async function setFlag(
  db: Db,
  key: string,
  change: { enabled: boolean; planScope?: string[]; userAllowlist?: string[]; approval?: { approver: string; approved_on: string; document_ref: string; environment?: string } | null },
  actor: { userId: string; role: string; reason: string },
): Promise<void> {
  const f = await getFlag(db, key);
  if (change.enabled && f.legalGated) {
    const a = change.approval ?? f.approval;
    if (!a || !a.approver?.trim() || !a.approved_on || !a.document_ref?.trim()) {
      throw badRequest('This feature is legal-gated. Enabling it requires the approver, the approval date and the document reference (CPL-03).');
    }
  }
  await db.query(
    `UPDATE ops.feature_flags SET enabled=$2, plan_scope=COALESCE($3, plan_scope), user_allowlist=COALESCE($4, user_allowlist), approval=COALESCE($5, approval), updated_at=now(), updated_by=$6 WHERE flag_key=$1`,
    [key, change.enabled, change.planScope ?? null, change.userAllowlist ?? null, change.approval ? JSON.stringify(change.approval) : null, actor.userId],
  );
  await audit(db, { actorUserId: actor.userId, actorRole: actor.role, action: change.enabled ? 'flag.enable' : 'flag.disable', targetType: 'feature_flag', targetId: key, reason: actor.reason, details: { approval: change.approval ?? null } });
}
