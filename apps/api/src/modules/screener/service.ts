import { z } from 'zod';
import type { Db } from '../../db/db.js';
import { badRequest } from '../../lib/http.js';
import { METRIC_BY_CODE, SCREENER_METRICS } from '../calc/definitions.js';
import type { RightsMatrix } from '../ref/rights.js';

// Screener (PRD SCR-01..SCR-06). Runs directly against calc.metric_values (period LATEST) so result
// counts equal a direct database query. Field names are validated against the published definitions
// library before they reach SQL; values are always bound parameters.

export const OPERATORS = ['gt', 'gte', 'lt', 'lte', 'between', 'eq'] as const;
export const filterSchema = z.object({
  field: z.string().max(60),
  op: z.enum(OPERATORS),
  value: z.number().finite(),
  value2: z.number().finite().optional(),
});
export const screenSchema = z.object({
  filters: z.array(filterSchema).max(40).default([]),
  sectors: z.array(z.string().max(40)).max(20).default([]),
  templates: z.array(z.enum(['standard', 'bank', 'nbfc', 'insurance'])).max(4).default([]),
  columns: z.array(z.string().max(60)).max(20).optional(),
  sort: z.object({ field: z.string().max(60), dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(10_000).default(0),
});
export type ScreenDefinition = z.infer<typeof screenSchema>;

const SQL_OP: Record<(typeof OPERATORS)[number], string> = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', between: 'BETWEEN' };
export const DEFAULT_COLUMNS = ['market_cap', 'pe_ttm', 'roce', 'debt_equity', 'revenue_growth_yoy', 'cash_conversion'];

/** Dataset whose licence governs export of a screener field (EXP-02/EXP-03). */
export function fieldDataset(code: string): { dataset: string; field: string } {
  if (code === 'close') return { dataset: 'eod_prices', field: 'close' };
  if (['promoter_pct', 'promoter_change_qoq', 'pledged_pct', 'fii_pct', 'dii_pct', 'public_pct', 'fii_change_qoq'].includes(code)) return { dataset: 'shareholding', field: code };
  return { dataset: 'derived_metrics', field: code };
}

export function validateScreen(def: ScreenDefinition, maxFilters: number): void {
  if (maxFilters !== -1 && def.filters.length > maxFilters) throw badRequest(`Your plan allows up to ${maxFilters} filters per screen.`, { limit: maxFilters, upgrade: { plan: 'plus', adds: 'All filters' } });
  for (const f of def.filters) {
    const m = METRIC_BY_CODE.get(f.field);
    if (!m || !m.screener) throw badRequest(`Unknown screener field: ${f.field}`);
    if (f.op === 'between' && f.value2 === undefined) throw badRequest(`Filter on ${f.field} needs two values for "between".`);
  }
  for (const c of [...(def.columns ?? []), ...(def.sort ? [def.sort.field] : [])]) {
    if (c !== 'short_name' && c !== 'sector' && !(METRIC_BY_CODE.get(c)?.screener)) throw badRequest(`Unknown column: ${c}`);
  }
}

export interface ScreenResult {
  as_of: string | null;
  total: number;
  rows: { company_id: string; short_name: string; sector: string; industry: string; values: Record<string, { value: number | null; missing: string | null }> }[];
  columns: string[];
  definitions: { code: string; name: string; unit: string; url: string; data_date: string | null }[];
  missing_rule: string;
  ms: number;
}

export async function runScreen(db: Db, def: ScreenDefinition): Promise<ScreenResult> {
  const t0 = Date.now();
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = [`c.coverage='full'`, `c.status='listed'`];
  if (def.sectors.length) where.push(`c.sector = ANY(${p(def.sectors)}::text[])`);
  if (def.templates.length) where.push(`c.sector_template = ANY(${p(def.templates)}::text[])`);
  for (const f of def.filters) {
    const cond = f.op === 'between' ? `mv.value BETWEEN ${p(Math.min(f.value, f.value2!))} AND ${p(Math.max(f.value, f.value2!))}` : `mv.value ${SQL_OP[f.op]} ${p(f.value)}`;
    where.push(`EXISTS (SELECT 1 FROM calc.metric_values mv WHERE mv.entity_type='company' AND mv.entity_id = c.company_id::text AND mv.period_key='LATEST' AND mv.metric_code=${p(f.field)} AND mv.value IS NOT NULL AND ${cond})`);
  }
  const whereSql = where.join(' AND ');
  const whereParams = [...params];
  const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ref.companies c WHERE ${whereSql}`, whereParams)).n;
  const columns = def.columns?.length ? def.columns.filter((c) => c !== 'short_name' && c !== 'sector') : DEFAULT_COLUMNS;
  const sortField = def.sort?.field ?? 'market_cap';
  const dir = def.sort?.dir === 'asc' ? 'ASC' : 'DESC';
  const sortExpr = sortField === 'short_name' ? 'c.short_name' : sortField === 'sector' ? 'c.sector' : `(SELECT value FROM calc.metric_values s WHERE s.entity_id=c.company_id::text AND s.period_key='LATEST' AND s.metric_code=${p(sortField)})`;
  const sql = `
    WITH hits AS (SELECT c.company_id, c.short_name, c.sector, c.industry, ${sortExpr} AS sort_value FROM ref.companies c WHERE ${whereSql}),
    page AS (SELECT * FROM hits ORDER BY sort_value ${dir} NULLS LAST, short_name LIMIT ${p(def.limit)} OFFSET ${p(def.offset)})
    SELECT page.company_id, page.short_name, page.sector, page.industry,
      COALESCE((SELECT json_object_agg(mv.metric_code, json_build_object('value', mv.value, 'missing', mv.missing_reason))
                  FROM calc.metric_values mv WHERE mv.entity_id = page.company_id::text AND mv.period_key='LATEST' AND mv.metric_code = ANY(${p(columns)}::text[])), '{}'::json) AS vals
      FROM page ORDER BY page.sort_value ${dir} NULLS LAST, page.short_name`;
  const rows = await db.query<{ company_id: string; short_name: string; sector: string; industry: string; vals: Record<string, { value: number | null; missing: string | null }> }>(sql, params);
  const asOf = (await db.maybeOne<{ d: string | null }>(`SELECT max(as_of_date) AS d FROM calc.metric_values WHERE period_key='LATEST'`))?.d ?? null;
  const usedFields = [...new Set([...def.filters.map((f) => f.field), ...columns])];
  return {
    as_of: asOf,
    total,
    rows: rows.map((r) => ({ company_id: r.company_id, short_name: r.short_name, sector: r.sector, industry: r.industry, values: Object.fromEntries(columns.map((c) => [c, r.vals[c] ?? { value: null, missing: 'not_available' }])) })),
    columns,
    definitions: usedFields.map((code) => ({ code, name: METRIC_BY_CODE.get(code)!.name, unit: METRIC_BY_CODE.get(code)!.unit, url: `/methodology/metrics/${code}`, data_date: asOf })),
    missing_rule: 'Companies with a missing, not-reported or not-meaningful value for a filtered field are excluded from that filter’s results; in columns, missing values show their label.',
    ms: Date.now() - t0,
  };
}

export function screenerFields(maxFilters: number) {
  return {
    max_filters: maxFilters,
    operators: OPERATORS,
    fields: SCREENER_METRICS.map((m) => ({ code: m.code, name: m.name, category: m.category, unit: m.unit, description: m.description, formula: m.formula, templates: m.templates, definition_url: `/methodology/metrics/${m.code}`, lesson: m.lesson ?? null })),
    count: SCREENER_METRICS.length,
  };
}

// Research templates (SCR-05): framed as starting points for research, never as lists to buy.
export const SCREEN_TEMPLATES: { id: string; name: string; description: string; definition: Partial<ScreenDefinition> }[] = [
  { id: 'consistent-cash-conversion', name: 'Consistent cash conversion', description: 'Companies whose latest annual operating cash flow covered most of their operating profit. A starting point for studying earnings quality.', definition: { filters: [{ field: 'cash_conversion', op: 'gte', value: 80 }], templates: ['standard'], columns: ['cash_conversion', 'free_cash_flow', 'operating_margin', 'roce', 'market_cap'] } },
  { id: 'low-leverage-steady-returns', name: 'Low leverage with steady returns on capital', description: 'Low borrowings relative to equity and ROCE above 15%. Useful for comparing capital efficiency.', definition: { filters: [{ field: 'debt_equity', op: 'lte', value: 0.5 }, { field: 'roce', op: 'gte', value: 15 }], templates: ['standard'], columns: ['debt_equity', 'roce', 'roe', 'interest_coverage', 'market_cap'] } },
  { id: 'growing-revenue', name: 'Growing revenue over three years', description: 'Three-year revenue CAGR of at least 12%. A starting point for studying growth and its drivers.', definition: { filters: [{ field: 'revenue_cagr_3y', op: 'gte', value: 12 }], columns: ['revenue_cagr_3y', 'revenue_growth_yoy', 'operating_margin', 'pe_ttm', 'market_cap'] } },
  { id: 'lenders-asset-quality', name: 'Lenders: asset quality and capital', description: 'Banks and NBFCs with gross NPA at or below 3% and capital adequacy at or above 15%.', definition: { filters: [{ field: 'gnpa_pct', op: 'lte', value: 3 }, { field: 'capital_adequacy', op: 'gte', value: 15 }], templates: ['bank', 'nbfc'], columns: ['gnpa_pct', 'nnpa_pct', 'capital_adequacy', 'nim', 'cost_to_income'] } },
  { id: 'receivables-watch', name: 'Receivable days to review', description: 'Companies with more than 90 receivable days in the latest year — a working-capital pattern to examine in the filings.', definition: { filters: [{ field: 'receivable_days', op: 'gt', value: 90 }], templates: ['standard'], columns: ['receivable_days', 'cash_conversion', 'cash_conversion_cycle', 'revenue_growth_yoy'] } },
  { id: 'near-52-week-high', name: 'Trading near the 52-week high', description: 'Adjusted close within 5% of the 52-week high. Describes recent price behaviour only.', definition: { filters: [{ field: 'pct_from_52w_high', op: 'gte', value: -5 }], columns: ['pct_from_52w_high', 'ret_3m', 'ret_1y', 'volatility_20d', 'market_cap'] } },
];

export interface CsvExportResult {
  csv: string;
  omitted: { field: string; reason: string }[];
}

/** CSV of permitted fields only (SCR-06, EXP-02, EXP-03). */
export function screenToCsv(result: ScreenResult, rights: RightsMatrix, meta: { userId: string; at: string }): CsvExportResult {
  const omitted: CsvExportResult['omitted'] = [];
  const allowed = result.columns.filter((c) => {
    const { dataset, field } = fieldDataset(c);
    const ok = rights.can(dataset, field, 'export');
    if (!ok) omitted.push({ field: c, reason: `The ${dataset} licence does not permit export of this field` });
    return ok;
  });
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : /^[=+\-@]/.test(s) ? `'${s}` : s);
  const header = ['company', 'sector', ...allowed.map((c) => `${c} (${METRIC_BY_CODE.get(c)!.unit})`)];
  const lines = result.rows.map((r) => [esc(r.short_name), esc(r.sector), ...allowed.map((c) => (r.values[c]?.value === null || r.values[c]?.value === undefined ? (r.values[c]?.missing === 'not_meaningful' ? 'n/m' : r.values[c]?.missing ?? '') : String(r.values[c]!.value)))].join(','));
  const footer = [`# Exported by user ${meta.userId} at ${meta.at}; data as of ${result.as_of}. Calculated by ATLAS; definitions at /methodology/metrics.`, ...omitted.map((o) => `# Omitted: ${o.field} — ${o.reason}`)];
  return { csv: [header.join(','), ...lines, ...footer].join('\n'), omitted };
}
