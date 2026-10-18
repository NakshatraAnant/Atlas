import { randomUUID } from 'node:crypto';
import { bulkInsert } from '../../lib/bulk.js';
import { FLOW_ITEMS, LINE_ITEM_BY_CODE } from '../../modules/fundamentals/lineItems.js';
import type { CheckResult, HandlerResult, PipelineCtx } from '../context.js';
import { raiseQualityIssue } from '../context.js';
import type { VendorAuditEvent, VendorShareholding } from '../synthetic/disclosures.js';
import type { VendorPeriod } from '../synthetic/fundamentals.js';

// Fundamentals quality checks (Blueprint §5.3) and source-conflict rule (§3.5):
//  - period validity: quarters sum to the year for flow items within 1% or ₹0.5 crore → warn + conflict record
//  - accounting identity: total assets = equity + liabilities within 0.5% → warn + conflict record
//  - ranges and signs: shares outstanding > 0; shareholding categories sum to 100 ± 0.1 → fail (quarantine)
//  - timestamp sanity: filing after period end and not in the future → fail (quarantine)
//  - source conflict: vendor vs XBRL differs by more than 0.5% or ₹0.5 crore (whichever is larger) → warn + badge
export const FUND_RULES = { periodSumPct: 0.01, periodSumAbsCr: 0.5, identityPct: 0.005, conflictPct: 0.005, conflictAbsCr: 0.5, shareholdingTolerance: 0.1 };

export function conflictTolerance(value: number): number {
  return Math.max(Math.abs(value) * FUND_RULES.conflictPct, FUND_RULES.conflictAbsCr);
}

const endOfDay = (d: string) => `${d}T18:29:59.999Z`;

export async function handleFundamentals(ctx: PipelineCtx, records: VendorPeriod[], meta: { sourceId: string; runId: string; asOf: string }): Promise<HandlerResult> {
  const db = ctx.db;
  const companies = new Map((await db.query<{ isin: string; company_id: string }>(`SELECT isin, company_id FROM ref.securities`)).map((r) => [r.isin, r.company_id]));
  const checks: CheckResult[] = [];
  const counts = { timestamp: 0, ranges: 0, unmapped: 0, identity: 0, periodSum: 0, unknownItem: 0 };
  let valid = 0;
  const affected = new Set<string>();
  const values: Record<string, unknown>[] = [];
  // Process in filing order so restatements follow their originals.
  const typeOrder = (p: VendorPeriod) => (p.period_type === 'Q' ? 0 : 1);
  const sorted = [...records].sort((a, b) => (a.filed_at < b.filed_at ? -1 : a.filed_at > b.filed_at ? 1 : a.version - b.version || typeOrder(a) - typeOrder(b)));
  // Preload the latest version of every period and the version-1 quarterly sums, so the loop needs no
  // per-record lookups (an earlier per-row query made a full history load quadratic).
  const pkey = (c: string, basis: string, type: string, fy: number, fq: number | null) => `${c}|${basis}|${type}|${fy}|${fq ?? ''}`;
  const latest = new Map<string, { period_id: string; version: number }>();
  for (const r of await db.query<{ period_id: string; version: number; company_id: string; basis: string; period_type: string; fiscal_year: number; fiscal_quarter: number | null }>(
    `SELECT DISTINCT ON (company_id, basis, period_type, fiscal_year, fiscal_quarter) period_id, version, company_id, basis, period_type, fiscal_year, fiscal_quarter
       FROM fund.financial_periods ORDER BY company_id, basis, period_type, fiscal_year, fiscal_quarter, version DESC`,
  )) latest.set(pkey(r.company_id, r.basis, r.period_type, r.fiscal_year, r.fiscal_quarter), { period_id: r.period_id, version: r.version });
  const qkey = (c: string, basis: string, fy: number) => `${c}|${basis}|${fy}`;
  const qsums = new Map<string, Map<string, { total: number; n: number }>>();
  const addQ = (k: string, code: string, v: number) => {
    const m = qsums.get(k) ?? new Map<string, { total: number; n: number }>();
    const e = m.get(code) ?? { total: 0, n: 0 };
    e.total += v;
    e.n += 1;
    m.set(code, e);
    qsums.set(k, m);
  };
  for (const r of await db.query<{ company_id: string; basis: string; fiscal_year: number; line_item_code: string; total: number; n: number }>(
    `SELECT fp.company_id, fp.basis, fp.fiscal_year, v.line_item_code, sum(v.value)::float8 AS total, count(*)::int AS n
       FROM fund.financial_periods fp JOIN fund.financial_values v USING (period_id)
      WHERE fp.period_type='Q' AND fp.version=1 AND v.value IS NOT NULL GROUP BY 1,2,3,4`,
  )) qsums.set(qkey(r.company_id, r.basis, r.fiscal_year), (qsums.get(qkey(r.company_id, r.basis, r.fiscal_year)) ?? new Map()).set(r.line_item_code, { total: r.total, n: r.n }));
  await db.tx(async (t) => {
    for (const p of sorted) {
      const companyId = companies.get(p.isin);
      if (!companyId) {
        counts.unmapped++;
        continue;
      }
      if (!(p.filed_at > `${p.period_end}T00:00:00Z`) || p.filed_at > endOfDay(meta.asOf)) {
        counts.timestamp++;
        await raiseQualityIssue(t, { kind: 'quarantine', severity: 'fail', dataset: 'fundamentals', entityRef: companyId, title: `Filing timestamp invalid for ${p.period_type} ${p.fiscal_year}${p.fiscal_quarter ? ` Q${p.fiscal_quarter}` : ''}`, details: { period: p } });
        continue;
      }
      if (p.values.shares_outstanding !== undefined && !(p.values.shares_outstanding > 0)) {
        counts.ranges++;
        await raiseQualityIssue(t, { kind: 'quarantine', severity: 'fail', dataset: 'fundamentals', entityRef: companyId, title: 'Shares outstanding must be positive', details: { period: p } });
        continue;
      }
      const key = pkey(companyId, p.basis, p.period_type, p.fiscal_year, p.fiscal_quarter);
      const prior = latest.get(key);
      if (prior && prior.version >= p.version) continue; // idempotent re-delivery
      const period = await t.one<{ period_id: string }>(
        `INSERT INTO fund.financial_periods (company_id, basis, period_type, fiscal_year, fiscal_quarter, period_start, period_end, filed_at, audited, version, is_current, restatement_of, source_id, ingestion_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13) RETURNING period_id`,
        [companyId, p.basis, p.period_type, p.fiscal_year, p.fiscal_quarter, p.period_start, p.period_end, p.filed_at, p.audited, p.version, prior?.period_id ?? null, meta.sourceId, meta.runId],
      );
      if (prior) await t.query(`UPDATE fund.financial_periods SET is_current = false WHERE period_id = $1`, [prior.period_id]);
      latest.set(key, { period_id: period.period_id, version: p.version });
      if (p.period_type === 'Q' && p.version === 1) for (const [code, v] of Object.entries(p.values)) if (v !== null && v !== undefined) addQ(qkey(companyId, p.basis, p.fiscal_year), code, v);
      let status: 'validated' | 'conflict' = 'validated';
      if (p.period_type === 'FY' && p.values.total_assets !== undefined && p.values.total_equity !== undefined && p.values.total_liabilities !== undefined) {
        const gap = Math.abs(p.values.total_assets - (p.values.total_equity + p.values.total_liabilities));
        if (gap > Math.abs(p.values.total_assets) * FUND_RULES.identityPct) {
          counts.identity++;
          status = 'conflict';
          await raiseQualityIssue(t, { kind: 'conflict', severity: 'warn', dataset: 'fundamentals', entityRef: companyId, title: `Accounting identity off by ₹${gap.toFixed(2)} crore in FY${p.fiscal_year}`, details: { period_id: period.period_id, rule: 'total assets = equity + liabilities within 0.5%' } });
        }
      }
      let periodSumIssues: string[] = [];
      if (p.period_type === 'FY' && p.version === 1) {
        const qs = [...(qsums.get(qkey(companyId, p.basis, p.fiscal_year)) ?? new Map<string, { total: number; n: number }>())].map(([line_item_code, e]) => ({ line_item_code, ...e }));
        periodSumIssues = qs
          .filter((q) => q.n === 4 && FLOW_ITEMS.has(q.line_item_code) && p.values[q.line_item_code] !== undefined)
          .filter((q) => Math.abs(q.total - p.values[q.line_item_code]!) > Math.max(Math.abs(p.values[q.line_item_code]!) * FUND_RULES.periodSumPct, FUND_RULES.periodSumAbsCr))
          .map((q) => q.line_item_code);
        if (periodSumIssues.length) {
          counts.periodSum++;
          await raiseQualityIssue(t, { kind: 'conflict', severity: 'warn', dataset: 'fundamentals', entityRef: companyId, title: `Quarters do not sum to FY${p.fiscal_year} for ${periodSumIssues.join(', ')}`, details: { period_id: period.period_id, rule: 'quarters sum to the annual figure within 1% or ₹0.5 crore' } });
        }
      }
      for (const [code, value] of Object.entries(p.values)) {
        const li = LINE_ITEM_BY_CODE.get(code);
        if (!li) {
          counts.unknownItem++;
          continue;
        }
        values.push({ period_id: period.period_id, line_item_code: code, version: 1, value, missing_reason: null, unit: li.unit, as_reported_at: p.filed_at, source_id: meta.sourceId, source_ref: `vendor:${code}`, quality_status: periodSumIssues.includes(code) ? 'conflict' : status });
      }
      for (const [code, reason] of Object.entries(p.missing)) {
        const li = LINE_ITEM_BY_CODE.get(code);
        if (!li) continue;
        values.push({ period_id: period.period_id, line_item_code: code, version: 1, value: null, missing_reason: reason, unit: li.unit, as_reported_at: p.filed_at, source_id: meta.sourceId, source_ref: `vendor:${code}`, quality_status: 'validated' });
      }
      valid++;
      affected.add(companyId);
    }
    await bulkInsert(t, 'fund.financial_values', values, { onConflict: 'ON CONFLICT DO NOTHING' });
  });
  checks.push(
    { check: 'identifier_continuity', severity: counts.unmapped ? 'fail' : 'pass', detail: `${counts.unmapped} periods for unknown companies`, count: counts.unmapped },
    { check: 'timestamp_sanity', severity: counts.timestamp ? 'fail' : 'pass', detail: `${counts.timestamp} periods quarantined`, count: counts.timestamp },
    { check: 'ranges_and_signs', severity: counts.ranges ? 'fail' : 'pass', detail: `${counts.ranges} periods quarantined`, count: counts.ranges },
    { check: 'accounting_identity', severity: counts.identity ? 'warn' : 'pass', detail: `${counts.identity} conflict records`, count: counts.identity },
    { check: 'period_validity', severity: counts.periodSum ? 'warn' : 'pass', detail: `${counts.periodSum} years where quarters do not sum`, count: counts.periodSum },
    { check: 'schema', severity: counts.unknownItem ? 'warn' : 'pass', detail: `${counts.unknownItem} unknown line items ignored`, count: counts.unknownItem },
  );
  const quarantined = counts.unmapped + counts.timestamp + counts.ranges;
  return { rowsIn: records.length, rowsValid: valid, rowsQuarantined: quarantined, checks, status: quarantined ? 'partial' : 'succeeded', affected: { companies: [...affected] } };
}

/** Compare XBRL verification values with vendor values and record conflicts (CMP-12). */
export async function handleXbrl(ctx: PipelineCtx, records: VendorPeriod[], meta: { sourceId: string }): Promise<HandlerResult> {
  const db = ctx.db;
  const companies = new Map((await db.query<{ isin: string; company_id: string }>(`SELECT isin, company_id FROM ref.securities`)).map((r) => [r.isin, r.company_id]));
  let compared = 0;
  let conflicts = 0;
  for (const p of records) {
    const companyId = companies.get(p.isin);
    if (!companyId) continue;
    const rows = await db.query<{ period_id: string; line_item_code: string; value: number | null }>(
      `SELECT fp.period_id, v.line_item_code, v.value FROM fund.financial_periods fp JOIN fund.financial_values v USING (period_id)
        WHERE fp.company_id=$1 AND fp.basis=$2 AND fp.period_type=$3 AND fp.fiscal_year=$4 AND fp.fiscal_quarter IS NOT DISTINCT FROM $5 AND fp.version=$6`,
      [companyId, p.basis, p.period_type, p.fiscal_year, p.fiscal_quarter, p.version],
    );
    for (const r of rows) {
      const x = p.values[r.line_item_code];
      if (x === undefined || r.value === null || LINE_ITEM_BY_CODE.get(r.line_item_code)?.unit !== 'INR_cr') continue;
      compared++;
      const diff = Math.abs(x - r.value);
      if (diff > conflictTolerance(r.value)) {
        conflicts++;
        await db.query(`UPDATE fund.financial_values SET quality_status='conflict' WHERE period_id=$1 AND line_item_code=$2`, [r.period_id, r.line_item_code]);
        const already = await db.maybeOne(`SELECT 1 FROM calc.quality_issues WHERE kind='conflict' AND details->>'period_id'=$1 AND details->>'line_item'=$2`, [r.period_id, r.line_item_code]);
        if (!already) {
          await raiseQualityIssue(db, {
            kind: 'conflict', severity: 'warn', dataset: 'fundamentals', entityRef: companyId,
            title: `Vendor and XBRL values differ for ${r.line_item_code} (${p.period_type} ${p.fiscal_year})`,
            details: { period_id: r.period_id, line_item: r.line_item_code, vendor_value: r.value, vendor_source: 'syn_fundamentals', xbrl_value: x, xbrl_source: meta.sourceId, tolerance_rule: 'differs by more than 0.5% or ₹0.5 crore, whichever is larger', displayed: 'vendor value (source precedence: vendor standardised values are primary)' },
          });
        }
      }
    }
  }
  return { rowsIn: records.length, rowsValid: records.length, rowsQuarantined: 0, checks: [{ check: 'source_conflict', severity: conflicts ? 'warn' : 'pass', detail: `${conflicts} of ${compared} compared values differ beyond tolerance`, count: conflicts }], status: 'succeeded' };
}

export async function handleShareholding(ctx: PipelineCtx, records: VendorShareholding[], meta: { sourceId: string; runId: string }): Promise<HandlerResult> {
  const db = ctx.db;
  const companies = new Map((await db.query<{ isin: string; company_id: string }>(`SELECT isin, company_id FROM ref.securities`)).map((r) => [r.isin, r.company_id]));
  let valid = 0;
  let bad = 0;
  const affected = new Set<string>();
  const existing = new Set((await db.query<{ k: string }>(`SELECT company_id || '|' || quarter_end::text AS k FROM fund.shareholding_snapshots`)).map((r) => r.k));
  const snaps: Record<string, unknown>[] = [];
  const vals: Record<string, unknown>[] = [];
  await db.tx(async (t) => {
    for (const s of records) {
      const companyId = companies.get(s.isin);
      const total = s.promoter + s.fii + s.dii + s.public + s.government + s.other;
      if (!companyId || Math.abs(total - 100) > FUND_RULES.shareholdingTolerance || [s.promoter, s.fii, s.dii, s.public].some((x) => x < 0)) {
        bad++;
        await raiseQualityIssue(t, { kind: 'quarantine', severity: 'fail', dataset: 'shareholding', entityRef: companyId ?? s.isin, title: `Shareholding for ${s.quarter_end} sums to ${total.toFixed(2)}% (rule: 100 ± 0.1)`, details: { record: s } });
        continue;
      }
      // First delivery wins: a snapshot already stored (or earlier in this batch) is not replaced.
      const key = `${companyId}|${s.quarter_end}`;
      if (existing.has(key)) continue;
      existing.add(key);
      const snapshot_id = randomUUID();
      snaps.push({ snapshot_id, company_id: companyId, quarter_end: s.quarter_end, filed_at: s.filed_at, source_id: meta.sourceId, ingestion_run_id: meta.runId });
      for (const [category, pct] of [['promoter', s.promoter], ['fii', s.fii], ['dii', s.dii], ['public', s.public], ['government', s.government], ['other', s.other]] as const) {
        vals.push({ snapshot_id, category, pct, pledged_pct_of_promoter: category === 'promoter' ? s.pledged_pct_of_promoter : null });
      }
      valid++;
      affected.add(companyId);
    }
    await bulkInsert(t, 'fund.shareholding_snapshots', snaps);
    await bulkInsert(t, 'fund.shareholding_values', vals);
  });
  return { rowsIn: records.length, rowsValid: valid, rowsQuarantined: bad, checks: [{ check: 'ranges_and_signs', severity: bad ? 'fail' : 'pass', detail: `${bad} snapshots quarantined (categories must sum to 100 ± 0.1)`, count: bad }], status: bad ? 'partial' : 'succeeded', affected: { companies: [...affected] } };
}

export async function handleAuditEvents(ctx: PipelineCtx, records: VendorAuditEvent[], meta: { sourceId: string }): Promise<HandlerResult> {
  const companies = new Map((await ctx.db.query<{ isin: string; company_id: string }>(`SELECT isin, company_id FROM ref.securities`)).map((r) => [r.isin, r.company_id]));
  let n = 0;
  for (const a of records) {
    const companyId = companies.get(a.isin);
    if (!companyId) continue;
    const dup = await ctx.db.maybeOne(`SELECT 1 FROM fund.audit_events WHERE company_id=$1 AND kind=$2 AND fiscal_year=$3`, [companyId, a.kind, a.fiscal_year]);
    if (dup) continue;
    await ctx.db.query(`INSERT INTO fund.audit_events (company_id, kind, fiscal_year, detail, filed_at, source_id) VALUES ($1,$2,$3,$4,$5,$6)`, [companyId, a.kind, a.fiscal_year, a.detail, a.filed_at, meta.sourceId]);
    n++;
  }
  return { rowsIn: records.length, rowsValid: n, rowsQuarantined: 0, checks: [{ check: 'schema', severity: 'pass', detail: `${n} audit events` }], status: 'succeeded' };
}

export { bulkInsert };
