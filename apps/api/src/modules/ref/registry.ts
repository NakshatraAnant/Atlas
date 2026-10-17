import type { Db } from '../../db/db.js';

// Dataset and licence registry (Blueprint §3.3, PRD CPL-06/CPL-07). Rights are data, enforced in
// code by rights.ts. Real vendor contracts are registered as pending with every right false:
// nothing from them can be displayed, exported or sent to a model until a signed licence exists.

export const SYNTHETIC_LICENCE_ID = '00000000-0000-4000-8000-00000000d001';
export const CALC_LICENCE_ID = '00000000-0000-4000-8000-00000000d002';

export interface SourceSeed {
  source_id: string;
  provider: string;
  dataset: string;
  licence_id: string | null;
  is_synthetic: boolean;
  description: string;
  schedule: string;
  delay_note: string;
  freshness_target_minutes: number;
  coverage_note: string;
  known_limitations: string;
  status: 'active' | 'degraded' | 'disabled';
  vendor_reference: string | null;
}

export const SYNTHETIC_SOURCES: SourceSeed[] = [
  { source_id: 'syn_master', dataset: 'master', description: 'Security master, identifiers, classification', schedule: 'Daily 06:00 IST', delay_note: 'End of day', freshness_target_minutes: 1440 },
  { source_id: 'syn_calendar', dataset: 'calendar', description: 'Trading calendar', schedule: 'Daily 06:00 IST', delay_note: 'Published ahead', freshness_target_minutes: 1440 * 7 },
  { source_id: 'syn_eod', dataset: 'eod_prices', description: 'End-of-day prices and volumes (raw, as traded)', schedule: 'Trading days 18:30–19:30 IST', delay_note: 'End of day, available by 19:30 IST', freshness_target_minutes: 26 * 60 },
  { source_id: 'syn_corp_actions', dataset: 'corporate_actions', description: 'Splits, bonuses, rights, dividends, mergers, delistings, symbol changes', schedule: 'Trading days 18:30 IST', delay_note: 'Before the next session’s adjusted prices', freshness_target_minutes: 26 * 60 },
  { source_id: 'syn_index', dataset: 'index', description: 'Index levels (price and total return) and point-in-time constituents', schedule: 'Trading days 19:00 IST', delay_note: 'End of day', freshness_target_minutes: 26 * 60 },
  { source_id: 'syn_fundamentals', dataset: 'fundamentals', description: 'Standardised quarterly and annual statements, consolidated and standalone', schedule: 'Daily 23:00 IST', delay_note: 'Within 1 business day of filing', freshness_target_minutes: 3 * 1440 },
  { source_id: 'syn_xbrl', dataset: 'xbrl_sample', description: 'XBRL filings used only to verify a sample of vendor values', schedule: 'Daily 23:00 IST', delay_note: 'On filing', freshness_target_minutes: 3 * 1440 },
  { source_id: 'syn_shareholding', dataset: 'shareholding', description: 'Quarterly shareholding pattern including pledges', schedule: 'Daily 23:00 IST', delay_note: 'Within 1 business day of filing', freshness_target_minutes: 3 * 1440 },
  { source_id: 'syn_announcements', dataset: 'announcements', description: 'Corporate announcements with original documents', schedule: 'Every 15 minutes in market hours; end of day', delay_note: 'Within 60 minutes of arrival', freshness_target_minutes: 26 * 60 },
  { source_id: 'syn_insider', dataset: 'insider_trades', description: 'Insider-trading disclosures', schedule: 'Daily', delay_note: 'Within 1 business day', freshness_target_minutes: 3 * 1440 },
  { source_id: 'syn_audit', dataset: 'audit_events', description: 'Auditor changes and audit opinions', schedule: 'Daily', delay_note: 'Within 1 business day', freshness_target_minutes: 7 * 1440 },
  { source_id: 'syn_rbi', dataset: 'risk_free', description: '91-day T-bill cut-off yield (risk-free rate)', schedule: 'Weekly', delay_note: 'As published', freshness_target_minutes: 10 * 1440 },
  { source_id: 'syn_macro', dataset: 'macro_calendar', description: 'RBI policy, CPI and GDP release calendar; results calendar', schedule: 'Daily', delay_note: 'As published', freshness_target_minutes: 7 * 1440 },
].map((s) => ({
  ...s,
  provider: 'ATLAS synthetic vendor (development only)',
  licence_id: SYNTHETIC_LICENCE_ID,
  is_synthetic: true,
  coverage_note: 'Fictional companies generated deterministically; not real market data',
  known_limitations: 'Synthetic data exercises the pipeline and the product. It must never be shown to customers as real data and is refused in production.',
  status: 'active' as const,
  vendor_reference: 'synthetic-vendor v1 (seeded)',
}));

export const CALC_SOURCE: SourceSeed = {
  source_id: 'atlas_calc',
  provider: 'ATLAS calculation service',
  dataset: 'derived_metrics',
  licence_id: CALC_LICENCE_ID,
  is_synthetic: false,
  description: 'Metrics, indicators, breadth and sector aggregates computed by ATLAS from licensed inputs',
  schedule: 'After each validated ingestion',
  delay_note: 'Same as inputs',
  freshness_target_minutes: 26 * 60,
  coverage_note: 'Same as inputs',
  known_limitations: 'Inherits the rights and limitations of its inputs',
  status: 'active',
  vendor_reference: null,
};

// Candidate production datasets (Blueprint §3.1–3.2). Registered as pending: all rights false.
export const PENDING_VENDOR_LICENCES = [
  { counterparty: 'NSE Data & Analytics', contract_ref: 'PENDING — EOD data, Capital Market (website medium)', permitted_use: 'Pending written licence; tariff ₹1,00,000/yr published effective 1 Apr 2026', datasets: ['eod_prices'] },
  { counterparty: 'NSE Data & Analytics', contract_ref: 'PENDING — EOD corporate data', permitted_use: 'Pending written licence; tariff ₹5,00,000/yr', datasets: ['corporate_actions', 'announcements'] },
  { counterparty: 'NSE Data & Analytics', contract_ref: 'PENDING — Master data', permitted_use: 'Pending written licence; tariff ₹2,15,000/yr', datasets: ['master', 'calendar'] },
  { counterparty: 'NSE Data & Analytics', contract_ref: 'PENDING — Historical trade data, Capital Market', permitted_use: 'Pending written licence; tariff ₹1,10,000/yr', datasets: ['eod_prices_history'] },
  { counterparty: 'Fundamentals vendor (to be selected: CMOTS / ACE Equity / Capitaline / CMIE Prowess)', contract_ref: 'PENDING — vendor evaluation (Blueprint §3.4)', permitted_use: 'Pending quotation; assumed ₹8,00,000/yr', datasets: ['fundamentals', 'shareholding', 'insider_trades', 'audit_events'] },
  { counterparty: 'NSE Indices / Asia Index', contract_ref: 'PENDING — index levels and constituents', permitted_use: 'Pending quotation; assumed ₹3,00,000/yr', datasets: ['index', 'index_weights'] },
];

const SYNTHETIC_RIGHTS: { dataset: string; field_pattern: string; store: boolean; display: boolean; derive: boolean; export: boolean; ai: boolean; publicWeb: boolean }[] = [
  { dataset: '*', field_pattern: '*', store: true, display: true, derive: true, export: false, ai: true, publicWeb: false },
  // Raw prices are never exportable (EXP-03); breadth and index levels may appear on public sample pages.
  { dataset: 'eod_prices', field_pattern: '*', store: true, display: true, derive: true, export: false, ai: true, publicWeb: false },
  { dataset: 'index', field_pattern: 'level', store: true, display: true, derive: true, export: false, ai: true, publicWeb: true },
  // Constituent weights are not licensed: index-contribution views stay hidden (MKT-02).
  { dataset: 'index_weights', field_pattern: '*', store: false, display: false, derive: false, export: false, ai: false, publicWeb: false },
  // India VIX is not licensed in this configuration (MKT-04): hidden by a dataset-level flag.
  { dataset: 'volatility_index', field_pattern: '*', store: false, display: false, derive: false, export: false, ai: false, publicWeb: false },
  // Insider disclosures: displayable but not sent to the model provider (proves CPL-07 in tests).
  { dataset: 'insider_trades', field_pattern: '*', store: true, display: true, derive: true, export: false, ai: false, publicWeb: false },
  // Pledge detail is displayable but withheld from AI processing.
  { dataset: 'shareholding', field_pattern: 'pledged_pct_of_promoter', store: true, display: true, derive: true, export: false, ai: false, publicWeb: false },
  { dataset: 'shareholding', field_pattern: '*', store: true, display: true, derive: true, export: false, ai: true, publicWeb: false },
  { dataset: 'announcements', field_pattern: 'document', store: true, display: true, derive: false, export: false, ai: true, publicWeb: false },
];

const CALC_RIGHTS = [
  // ATLAS-derived metrics are exportable by Pro users unless a specific input forbids it.
  { dataset: 'derived_metrics', field_pattern: '*', store: true, display: true, derive: true, export: true, ai: true, publicWeb: false },
  { dataset: 'derived_metrics', field_pattern: 'breadth.*', store: true, display: true, derive: true, export: true, ai: true, publicWeb: true },
  { dataset: 'derived_metrics', field_pattern: 'sector.*', store: true, display: true, derive: true, export: true, ai: true, publicWeb: true },
];

export async function seedRegistry(db: Db): Promise<void> {
  await db.query(
    `INSERT INTO ref.licences (licence_id, counterparty, contract_ref, status, start_date, end_date, review_date, attribution_text, permitted_use, notes)
     VALUES ($1, 'ATLAS (internal)', 'SYNTHETIC-DEV-001', 'dev_only', '2026-10-18', NULL, '2027-01-31', 'Synthetic development data — not real market data',
             'Development, testing and demonstration only. Never production.', 'Generated by the ATLAS synthetic vendor; refused when NODE_ENV=production.')
     ON CONFLICT (licence_id) DO NOTHING`,
    [SYNTHETIC_LICENCE_ID],
  );
  await db.query(
    `INSERT INTO ref.licences (licence_id, counterparty, contract_ref, status, start_date, attribution_text, permitted_use, notes)
     VALUES ($1, 'ATLAS (internal)', 'ATLAS-DERIVED', 'signed', '2026-10-18', 'Calculated by ATLAS', 'Metrics derived by ATLAS; rights are the intersection with input datasets.', 'Derived-data rights depend on each vendor contract (can_derive).')
     ON CONFLICT (licence_id) DO NOTHING`,
    [CALC_LICENCE_ID],
  );
  for (const r of SYNTHETIC_RIGHTS) {
    await db.query(
      `INSERT INTO ref.licence_rights (licence_id, dataset, field_pattern, can_store, can_display, can_derive, can_export, can_ai_process, can_public_web, retention_after_termination)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, interval '0 days') ON CONFLICT (licence_id, dataset, field_pattern) DO NOTHING`,
      [SYNTHETIC_LICENCE_ID, r.dataset, r.field_pattern, r.store, r.display, r.derive, r.export, r.ai, r.publicWeb],
    );
  }
  for (const r of CALC_RIGHTS) {
    await db.query(
      `INSERT INTO ref.licence_rights (licence_id, dataset, field_pattern, can_store, can_display, can_derive, can_export, can_ai_process, can_public_web)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (licence_id, dataset, field_pattern) DO NOTHING`,
      [CALC_LICENCE_ID, r.dataset, r.field_pattern, r.store, r.display, r.derive, r.export, r.ai, r.publicWeb],
    );
  }
  for (const p of PENDING_VENDOR_LICENCES) {
    const exists = await db.maybeOne(`SELECT 1 FROM ref.licences WHERE contract_ref = $1`, [p.contract_ref]);
    if (exists) continue;
    const lic = await db.one<{ licence_id: string }>(
      `INSERT INTO ref.licences (counterparty, contract_ref, status, permitted_use, notes) VALUES ($1,$2,'under_negotiation',$3,'All rights false until a signed licence is recorded.') RETURNING licence_id`,
      [p.counterparty, p.contract_ref, p.permitted_use],
    );
    for (const ds of p.datasets) {
      await db.query(`INSERT INTO ref.licence_rights (licence_id, dataset, field_pattern) VALUES ($1,$2,'*')`, [lic.licence_id, ds]);
    }
  }
  for (const s of [...SYNTHETIC_SOURCES, CALC_SOURCE]) {
    await db.query(
      `INSERT INTO ref.sources (source_id, provider, dataset, licence_id, is_synthetic, description, schedule, delay_note, freshness_target_minutes, coverage_note, known_limitations, status, vendor_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (source_id) DO NOTHING`,
      [s.source_id, s.provider, s.dataset, s.licence_id, s.is_synthetic, s.description, s.schedule, s.delay_note, s.freshness_target_minutes, s.coverage_note, s.known_limitations, s.status, s.vendor_reference],
    );
  }
  await db.query(`INSERT INTO ref.exchanges (exchange_code, name) VALUES ('NSE', 'National Stock Exchange of India'), ('BSE', 'BSE Limited') ON CONFLICT DO NOTHING`);
}
