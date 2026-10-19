// User-provided datasets: CSV parsing, column mapping and validation (pure, unit-tested).
// Only daily price series are supported in this release. Every row either passes every check or
// is rejected with its row number and reasons; nothing is silently coerced or invented.

export const MAX_CSV_BYTES = 2_000_000;
export const MAX_ROWS = 20_000;
export const PRICE_FIELDS = ['date', 'open', 'high', 'low', 'close', 'volume'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];
export type Mapping = Partial<Record<PriceField, string>>;

/** RFC 4180-style CSV parser (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new Error('Unterminated quoted field');
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const SYNONYMS: Record<PriceField, string[]> = {
  date: ['date', 'trade date', 'trade_date', 'timestamp', 'day'],
  open: ['open', 'open price', 'opening price'],
  high: ['high', 'high price'],
  low: ['low', 'low price'],
  close: ['close', 'close price', 'closing price', 'last', 'ltp'],
  volume: ['volume', 'vol', 'total traded quantity', 'qty', 'shares traded'],
};

/** Suggest a mapping from header names (case/spacing-insensitive). The user confirms or edits it. */
export function suggestMapping(headers: string[]): Mapping {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const m: Mapping = {};
  for (const f of PRICE_FIELDS) {
    const h = headers.find((x) => SYNONYMS[f].includes(norm(x)));
    if (h) m[f] = h;
  }
  return m;
}

/** Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY and DD-Mon-YYYY (e.g. 14-Oct-2026). Returns ISO or null. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (r) [y, m, d] = [+r[1]!, +r[2]!, +r[3]!];
  else if ((r = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t))) [d, m, y] = [+r[1]!, +r[2]!, +r[3]!];
  else if ((r = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(t))) {
    const i = mon.indexOf(r[2]!.toLowerCase());
    if (i < 0) return null;
    [d, m, y] = [+r[1]!, i + 1, +r[3]!];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Plain decimal numbers only; Indian digit grouping commas are allowed ("1,23,456.50"). */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface PriceRow { date: string; open: number; high: number; low: number; close: number; volume: number | null }
export interface RowIssue { row: number; reasons: string[] }
export interface ValidationReport { rows_in: number; rows_valid: number; rows_rejected: number; issues: RowIssue[]; first_date: string | null; last_date: string | null; checks: string[] }

export const CHECKS = [
  'Required columns mapped: date, open, high, low, close (volume optional)',
  'Dates are real calendar dates in a supported format and not in the future',
  'Prices are positive numbers; volume, if given, is a non-negative whole number',
  'OHLC integrity: low ≤ open, close ≤ high and low ≤ high',
  'No duplicate dates',
];

export function validatePrices(rows: string[][], mapping: Mapping, today: string): { valid: PriceRow[]; report: ValidationReport } {
  const missing = (['date', 'open', 'high', 'low', 'close'] as const).filter((f) => !mapping[f]);
  if (missing.length) throw new Error(`Map these columns first: ${missing.join(', ')}`);
  const [header, ...body] = rows;
  if (!header) throw new Error('The file has no header row');
  if (body.length > MAX_ROWS) throw new Error(`At most ${MAX_ROWS} rows per upload`);
  const col = (f: PriceField) => (mapping[f] ? header.indexOf(mapping[f]!) : -1);
  const idx = Object.fromEntries(PRICE_FIELDS.map((f) => [f, col(f)])) as Record<PriceField, number>;
  for (const f of ['date', 'open', 'high', 'low', 'close'] as const) if (idx[f] < 0) throw new Error(`Column "${mapping[f]}" is not in the header`);
  const valid: PriceRow[] = [];
  const issues: RowIssue[] = [];
  const seen = new Set<string>();
  body.forEach((cells, i) => {
    const rowNo = i + 2; // 1-based, after the header
    const reasons: string[] = [];
    const date = parseDate(cells[idx.date] ?? '');
    if (!date) reasons.push('date is not a valid date');
    else if (date > today) reasons.push('date is in the future');
    const num = (f: PriceField) => (idx[f] >= 0 ? parseNumber(cells[idx[f]] ?? '') : null);
    const o = num('open'), h = num('high'), l = num('low'), c = num('close');
    for (const [k, x] of [['open', o], ['high', h], ['low', l], ['close', c]] as const) if (x === null || x <= 0) reasons.push(`${k} must be a positive number`);
    let vol: number | null = null;
    if (idx.volume >= 0 && (cells[idx.volume] ?? '').trim() !== '') {
      vol = parseNumber(cells[idx.volume]!);
      if (vol === null || vol < 0 || !Number.isInteger(vol)) reasons.push('volume must be a non-negative whole number');
    }
    if (o !== null && h !== null && l !== null && c !== null && o > 0 && h > 0 && l > 0 && c > 0) {
      if (l > h || o > h || c > h || o < l || c < l) reasons.push('OHLC integrity: low ≤ open, close ≤ high fails');
    }
    if (date && seen.has(date)) reasons.push('duplicate date');
    if (reasons.length) issues.push({ row: rowNo, reasons });
    else {
      seen.add(date!);
      valid.push({ date: date!, open: o!, high: h!, low: l!, close: c!, volume: vol });
    }
  });
  valid.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { valid, report: { rows_in: body.length, rows_valid: valid.length, rows_rejected: issues.length, issues: issues.slice(0, 200), first_date: valid[0]?.date ?? null, last_date: valid[valid.length - 1]?.date ?? null, checks: CHECKS } };
}
