import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { parseCsv } from '../datasets/csv.js';

// Financial statements you import yourself (annual reports, exchange filings you obtained). The configured
// free price provider has no fundamentals, and ATLAS holds no licence to redistribute them, so this is the
// only fundamentals path for real companies. Rows are private to you, stored in rupees, and every row keeps
// the source you cite. Ratios are computed only from rows you supplied; a missing input means no ratio.

export const LINE_ITEMS: Record<string, { statement: 'income' | 'balance' | 'cashflow'; label: string; per_share?: boolean }> = {
  revenue: { statement: 'income', label: 'Revenue from operations' },
  ebitda: { statement: 'income', label: 'EBITDA' },
  operating_profit: { statement: 'income', label: 'Operating profit (EBIT)' },
  finance_costs: { statement: 'income', label: 'Finance costs' },
  profit_before_tax: { statement: 'income', label: 'Profit before tax' },
  net_profit: { statement: 'income', label: 'Net profit attributable to shareholders' },
  eps_diluted: { statement: 'income', label: 'Diluted EPS (₹ per share)', per_share: true },
  total_assets: { statement: 'balance', label: 'Total assets' },
  total_equity: { statement: 'balance', label: 'Total equity attributable to shareholders' },
  total_debt: { statement: 'balance', label: 'Total borrowings' },
  cash_and_equivalents: { statement: 'balance', label: 'Cash and cash equivalents' },
  operating_cash_flow: { statement: 'cashflow', label: 'Net cash from operating activities' },
  capex: { statement: 'cashflow', label: 'Purchase of property, plant and equipment' },
  dividends_paid: { statement: 'cashflow', label: 'Dividends paid' },
};

const UNITS: Record<string, number> = { inr: 1, thousand: 1e3, lakh: 1e5, million: 1e6, crore: 1e7, billion: 1e9 };
const HEADER = ['instrument', 'period_end', 'period_type', 'line_item', 'value', 'unit', 'source_note'];

export interface FundRow { instrument: string; period_end: string; period_type: 'annual' | 'quarter'; statement: 'income' | 'balance' | 'cashflow'; line_item: string; value_inr: number; source_note: string }

/** Validates every row; a row is either fully valid or rejected with its line number and reasons. */
export function parseFundamentalsCsv(text: string): { rows: FundRow[]; errors: { line: number; reasons: string[] }[] } {
  if (text.length > 1_000_000) return { rows: [], errors: [{ line: 0, reasons: ['File larger than 1 MB.'] }] };
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  const head = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  if (HEADER.some((h, i) => head[i] !== h)) return { rows: [], errors: [{ line: 1, reasons: [`The header must be: ${HEADER.join(',')}`] }] };
  const rows: FundRow[] = [];
  const errors: { line: number; reasons: string[] }[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const [instrument = '', periodEnd = '', periodType = '', item = '', value = '', unit = '', note = ''] = r.map((c) => c.trim());
    const reasons: string[] = [];
    const inst = instrument.toUpperCase();
    if (!/^(NSE|BSE):[A-Z0-9&_.-]{1,30}$/.test(inst)) reasons.push('instrument must look like NSE:SYMBOL or BSE:SYMBOL');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || Number.isNaN(Date.parse(`${periodEnd}T00:00:00Z`))) reasons.push('period_end must be a date (YYYY-MM-DD)');
    if (!['annual', 'quarter'].includes(periodType)) reasons.push('period_type must be annual or quarter');
    const def = LINE_ITEMS[item];
    if (!def) reasons.push(`unknown line_item (use one of: ${Object.keys(LINE_ITEMS).join(', ')})`);
    const n = Number(value.replace(/,/g, ''));
    if (value === '' || !Number.isFinite(n)) reasons.push('value must be a number');
    const mult = UNITS[unit.toLowerCase()];
    if (!mult) reasons.push(`unit must be one of: ${Object.keys(UNITS).join(', ')}`);
    if (def?.per_share && mult !== 1) reasons.push('per-share items use unit inr');
    if (note.length < 3 || note.length > 300) reasons.push('source_note must say where the figure comes from (3–300 characters)');
    const k = `${inst}|${periodEnd}|${periodType}|${item}`;
    if (seen.has(k)) reasons.push('duplicate of an earlier row');
    seen.add(k);
    if (reasons.length) { errors.push({ line, reasons }); return; }
    rows.push({ instrument: inst, period_end: periodEnd, period_type: periodType as 'annual', statement: def!.statement, line_item: item, value_inr: Math.round(n * mult! * 100) / 100, source_note: note });
  });
  if (table.length - 1 > 5000) errors.push({ line: 0, reasons: ['More than 5,000 rows.'] });
  return { rows, errors };
}

type Period = { period_end: string; period_type: string; values: Record<string, number> };

/** Ratios from your own rows only. Each needs every input for the same period; otherwise it is absent. */
export function ratiosFor(periods: Period[]): { period_end: string; period_type: string; ratios: Record<string, number> }[] {
  const annual = periods.filter((p) => p.period_type === 'annual').sort((a, b) => a.period_end.localeCompare(b.period_end));
  return periods.map((p) => {
    const v = p.values;
    const r: Record<string, number> = {};
    if (v.net_profit !== undefined && v.revenue) r.net_margin = v.net_profit / v.revenue;
    if (v.operating_profit !== undefined && v.revenue) r.operating_margin = v.operating_profit / v.revenue;
    if (v.net_profit !== undefined && v.total_equity && v.total_equity > 0 && p.period_type === 'annual') r.return_on_equity = v.net_profit / v.total_equity;
    if (v.total_debt !== undefined && v.total_equity && v.total_equity > 0) r.debt_to_equity = v.total_debt / v.total_equity;
    if (v.operating_cash_flow !== undefined && v.capex !== undefined) r.free_cash_flow_inr = v.operating_cash_flow - Math.abs(v.capex);
    if (v.operating_cash_flow !== undefined && v.net_profit && v.net_profit > 0) r.cash_conversion = v.operating_cash_flow / v.net_profit;
    if (p.period_type === 'annual') {
      const prev = annual.filter((a) => a.period_end < p.period_end).pop();
      // Year-on-year growth only between consecutive annual periods (about 12 months apart).
      const months = prev ? (Date.parse(p.period_end) - Date.parse(prev.period_end)) / (30.44 * 86_400_000) : 0;
      if (prev && months > 10 && months < 14) {
        if (v.revenue && prev.values.revenue && prev.values.revenue > 0) r.revenue_growth = v.revenue / prev.values.revenue - 1;
        if (v.net_profit !== undefined && prev.values.net_profit && prev.values.net_profit > 0) r.net_profit_growth = v.net_profit / prev.values.net_profit - 1;
      }
    }
    return { period_end: p.period_end, period_type: p.period_type, ratios: r };
  });
}

export const RATIO_DEFINITIONS = {
  net_margin: 'Net profit ÷ revenue (same period).',
  operating_margin: 'Operating profit ÷ revenue.',
  return_on_equity: 'Net profit ÷ closing total equity (annual periods; a simple, not average-equity, definition).',
  debt_to_equity: 'Total borrowings ÷ total equity.',
  free_cash_flow_inr: 'Operating cash flow − |capital expenditure| (₹).',
  cash_conversion: 'Operating cash flow ÷ net profit.',
  revenue_growth: 'Revenue ÷ previous annual revenue − 1 (consecutive years only).',
  net_profit_growth: 'Net profit ÷ previous annual net profit − 1 (only when the previous profit was positive).',
  pe_ratio: 'Latest stored provider close ÷ your latest annual diluted EPS (only when EPS is positive). Mixes a provider price with your figure: both dates are shown.',
} as const;

export async function fundamentalsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const csv = z.object({ csv: z.string().min(1).max(1_000_000) });

  app.get('/v1/research/fundamentals/template', async (req) => {
    requireUser(req);
    return { header: HEADER.join(','), line_items: LINE_ITEMS, units: Object.keys(UNITS), example: `${HEADER.join(',')}\nNSE:EXAMPLE,2025-03-31,annual,revenue,1234.5,crore,"Annual report FY2025, consolidated P&L (page you used)"`, note: 'The example row is a format illustration, not data. Use figures from documents you obtained yourself and cite them in source_note.' };
  });

  app.post('/v1/research/fundamentals/preview', async (req) => {
    requireUser(req);
    const b = parse(csv, req.body);
    const r = parseFundamentalsCsv(b.csv);
    return { valid: r.rows.length, rejected: r.errors.length, errors: r.errors.slice(0, 50), sample: r.rows.slice(0, 10) };
  });

  app.post('/v1/research/fundamentals/import', { config: { rateLimit: { limit: 20, windowMs: 60_000, key: 'user' } } }, async (req) => {
    const u = requireUser(req);
    const b = parse(csv, req.body);
    const r = parseFundamentalsCsv(b.csv);
    if (r.errors.length) throw badRequest('Nothing was imported: fix the rejected rows first (every row must pass).', { errors: r.errors.slice(0, 50) });
    if (!r.rows.length) throw badRequest('The file has no rows.');
    let changed = 0;
    await db.tx(async (t) => {
      for (const x of r.rows) {
        const res = await t.query(`INSERT INTO research.user_fundamentals (user_id, instrument, period_end, period_type, statement, line_item, value_inr, source_note, imported_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (user_id, instrument, period_end, period_type, statement, line_item) DO UPDATE SET value_inr=EXCLUDED.value_inr, source_note=EXCLUDED.source_note, imported_at=EXCLUDED.imported_at
          WHERE research.user_fundamentals.value_inr IS DISTINCT FROM EXCLUDED.value_inr OR research.user_fundamentals.source_note IS DISTINCT FROM EXCLUDED.source_note RETURNING 1`,
          [u.userId, x.instrument, x.period_end, x.period_type, x.statement, x.line_item, x.value_inr, x.source_note, ctx.clock().toISOString()]);
        changed += res.length;
      }
    });
    return { imported: r.rows.length, changed, unchanged: r.rows.length - changed, instruments: [...new Set(r.rows.map((x) => x.instrument))] };
  });

  app.get('/v1/research/fundamentals', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ instrument: z.string().regex(/^(NSE|BSE):[A-Z0-9&_.-]{1,30}$/).optional() }), req.query);
    if (!q.instrument) {
      return { instruments: await db.query(`SELECT instrument, count(*)::int AS rows, count(DISTINCT period_end)::int AS periods, max(period_end) AS latest_period, max(imported_at) AS imported_at FROM research.user_fundamentals WHERE user_id=$1 GROUP BY instrument ORDER BY instrument`, [u.userId]) };
    }
    const rows = await db.query<{ period_end: string; period_type: string; statement: string; line_item: string; value_inr: number; source_note: string; imported_at: string }>(
      `SELECT to_char(period_end, 'YYYY-MM-DD') AS period_end, period_type, statement, line_item, value_inr::float8 AS value_inr, source_note, imported_at FROM research.user_fundamentals WHERE user_id=$1 AND instrument=$2 ORDER BY period_end DESC, statement, line_item`, [u.userId, q.instrument]);
    if (!rows.length) throw notFound('You have not imported statements for this instrument.');
    const byPeriod = new Map<string, Period>();
    for (const r of rows) {
      const k = `${r.period_end}|${r.period_type}`;
      if (!byPeriod.has(k)) byPeriod.set(k, { period_end: r.period_end, period_type: r.period_type, values: {} });
      byPeriod.get(k)!.values[r.line_item] = r.value_inr;
    }
    const periods = [...byPeriod.values()];
    const [exchange, symbol] = q.instrument.split(':') as [string, string];
    const price = await db.maybeOne<{ trade_date: string; close: number; provider_id: string; basis: string }>(
      `SELECT to_char(p.trade_date, 'YYYY-MM-DD') AS trade_date, p.close::float8 AS close, s.provider_id, s.basis FROM equity.prices p JOIN equity.price_series s USING (series_id) JOIN equity.instruments i USING (instrument_id)
        WHERE i.exchange=$1 AND i.symbol=$2 AND s.basis='raw' ORDER BY p.trade_date DESC LIMIT 1`, [exchange, symbol]);
    const latestAnnual = periods.filter((p) => p.period_type === 'annual' && p.values.eps_diluted !== undefined).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
    const pe = price && latestAnnual && latestAnnual.values.eps_diluted! > 0 ? { value: price.close / latestAnnual.values.eps_diluted!, price_date: price.trade_date, price_source: `${price.provider_id} (raw close)`, eps_period: latestAnnual.period_end } : null;
    return {
      instrument: q.instrument, classification: 'USER_IMPORTED', rows, ratios: ratiosFor(periods), valuation: { pe_ratio: pe, reason: pe ? null : !price ? 'No stored provider price for this instrument.' : 'Needs a positive diluted EPS in an annual period you imported.' },
      definitions: RATIO_DEFINITIONS, line_items: LINE_ITEMS,
      notice: 'Figures you imported from your own documents; ATLAS has not checked them against the filings. Private to you.',
    };
  });

  app.delete('/v1/research/fundamentals', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ instrument: z.string().regex(/^(NSE|BSE):[A-Z0-9&_.-]{1,30}$/) }), req.query);
    const r = await db.query(`DELETE FROM research.user_fundamentals WHERE user_id=$1 AND instrument=$2 RETURNING 1`, [u.userId, q.instrument]);
    return { deleted: r.length };
  });
}
