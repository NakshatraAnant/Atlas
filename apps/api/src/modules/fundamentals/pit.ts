import type { Db } from '../../db/db.js';

// Point-in-time access to fundamentals (Blueprint §5.5, PRD BKT-09). A value is visible at
// instant t only if its filing timestamp is at or before t; restatements are new versions that
// become visible on their own filing date. The current view is "as of now".

export interface PeriodValues {
  period_id: string;
  basis: 'consolidated' | 'standalone';
  period_type: 'Q' | 'FY';
  fiscal_year: number;
  fiscal_quarter: number | null;
  period_start: string;
  period_end: string;
  filed_at: string;
  version: number;
  is_current: boolean;
  values: Map<string, number | null>;
  missing: Map<string, 'not_reported' | 'not_available'>;
  quality: Map<string, string>;
}

export interface CompanyFundamentalsPit {
  companyId: string;
  primaryBasis: 'consolidated' | 'standalone';
  all: PeriodValues[];
  /** Periods visible at `instant` (latest version filed by then), for a basis. */
  asOf(instant: string, basis?: 'consolidated' | 'standalone'): PeriodValues[];
  filingInstants(): string[];
}

const periodKeyOf = (p: { period_type: string; fiscal_year: number; fiscal_quarter: number | null }) => `${p.period_type}|${p.fiscal_year}|${p.fiscal_quarter ?? 0}`;

export function buildPit(companyId: string, periods: PeriodValues[]): CompanyFundamentalsPit {
  const primaryBasis = periods.some((p) => p.basis === 'consolidated') ? 'consolidated' : 'standalone';
  const sorted = [...periods].sort((a, b) => (a.period_end < b.period_end ? -1 : a.period_end > b.period_end ? 1 : a.version - b.version));
  return {
    companyId,
    primaryBasis,
    all: sorted,
    asOf(instant, basis = primaryBasis) {
      const best = new Map<string, PeriodValues>();
      for (const p of sorted) {
        if (p.basis !== basis || p.filed_at > instant) continue;
        const k = periodKeyOf(p);
        const cur = best.get(k);
        if (!cur || p.version > cur.version) best.set(k, p);
      }
      return [...best.values()].sort((a, b) => (a.period_end < b.period_end ? -1 : 1));
    },
    filingInstants() {
      return [...new Set(sorted.map((p) => p.filed_at))].sort();
    },
  };
}

/**
 * Companies per point-in-time query. Each company contributes thousands of (period × line item)
 * rows; one query over a large universe returned a result too big for the embedded engine's
 * protocol buffer and aborted it ("memory access out of bounds" / "unreachable"; session 4
 * diagnosis). Bounded batches keep every result small; callers also process one batch at a time.
 */
export const PIT_BATCH_COMPANIES = Math.max(1, Number(process.env.ATLAS_PIT_BATCH_COMPANIES ?? 10));

/** Calls `fn` with the point-in-time fundamentals of each batch of companies, in order. */
export async function forEachPitBatch(db: Db, companyIds: string[], fn: (pits: Map<string, CompanyFundamentalsPit>, batch: string[]) => Promise<void>, batchSize = PIT_BATCH_COMPANIES): Promise<void> {
  const ids = [...new Set(companyIds)];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    await fn(await loadPit(db, batch), batch);
  }
}

export async function loadPit(db: Db, companyIds?: string[]): Promise<Map<string, CompanyFundamentalsPit>> {
  const ids = companyIds ?? (await db.query<{ company_id: string }>(`SELECT DISTINCT company_id FROM fund.financial_periods`)).map((r) => r.company_id);
  if (ids.length > PIT_BATCH_COMPANIES) {
    const merged = new Map<string, CompanyFundamentalsPit>();
    for (let i = 0; i < ids.length; i += PIT_BATCH_COMPANIES) for (const [k, v] of await loadPit(db, ids.slice(i, i + PIT_BATCH_COMPANIES))) merged.set(k, v);
    return merged;
  }
  const rows = await db.query<{
    company_id: string; period_id: string; basis: 'consolidated' | 'standalone'; period_type: 'Q' | 'FY'; fiscal_year: number; fiscal_quarter: number | null;
    period_start: string; period_end: string; filed_at: string; version: number; is_current: boolean; line_item_code: string | null; value: number | null; missing_reason: 'not_reported' | 'not_available' | null; quality_status: string | null;
  }>(
    `SELECT fp.company_id, fp.period_id, fp.basis, fp.period_type, fp.fiscal_year, fp.fiscal_quarter, fp.period_start, fp.period_end, fp.filed_at, fp.version, fp.is_current,
            v.line_item_code, v.value, v.missing_reason, v.quality_status
       FROM fund.financial_periods fp LEFT JOIN fund.financial_values v USING (period_id) WHERE fp.company_id = ANY($1::uuid[])`,
    [ids],
  );
  const byPeriod = new Map<string, PeriodValues & { company_id: string }>();
  for (const r of rows) {
    let p = byPeriod.get(r.period_id);
    if (!p) {
      p = { company_id: r.company_id, period_id: r.period_id, basis: r.basis, period_type: r.period_type, fiscal_year: r.fiscal_year, fiscal_quarter: r.fiscal_quarter, period_start: r.period_start, period_end: r.period_end, filed_at: r.filed_at, version: r.version, is_current: r.is_current, values: new Map(), missing: new Map(), quality: new Map() };
      byPeriod.set(r.period_id, p);
    }
    if (r.line_item_code) {
      p.values.set(r.line_item_code, r.value);
      if (r.missing_reason) p.missing.set(r.line_item_code, r.missing_reason);
      if (r.quality_status) p.quality.set(r.line_item_code, r.quality_status);
    }
  }
  const grouped = new Map<string, PeriodValues[]>();
  for (const p of byPeriod.values()) grouped.set(p.company_id, [...(grouped.get(p.company_id) ?? []), p]);
  return new Map([...grouped].map(([cid, ps]) => [cid, buildPit(cid, ps)]));
}

/** Last four consecutive quarters visible in `periods` (sorted ascending). */
export function lastFourQuarters(periods: PeriodValues[]): PeriodValues[] | null {
  const qs = periods.filter((p) => p.period_type === 'Q');
  if (qs.length < 4) return null;
  const last4 = qs.slice(-4);
  // consecutive check: each period starts the day after the previous ends (within 3 days)
  for (let i = 1; i < 4; i++) {
    const gap = (Date.parse(last4[i]!.period_start) - Date.parse(last4[i - 1]!.period_end)) / 86_400_000;
    if (gap < 0 || gap > 3) return null;
  }
  return last4;
}

export function sumItem(periods: PeriodValues[], code: string): number | null {
  let s = 0;
  for (const p of periods) {
    const v = p.values.get(code);
    if (v === null || v === undefined) return null;
    s += v;
  }
  return s;
}

export function latestFy(periods: PeriodValues[]): PeriodValues | undefined {
  return [...periods].reverse().find((p) => p.period_type === 'FY');
}
