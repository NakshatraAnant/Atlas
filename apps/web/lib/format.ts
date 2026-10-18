import { formatDate, formatIndianNumber, formatIstDateTime } from '@atlas/shared';

export { formatDate, formatIndianNumber, formatIstDateTime };

export const MISSING: Record<string, string> = { not_reported: 'Not reported', not_available: 'Not available', not_meaningful: 'n/m' };
export const MISSING_TITLE: Record<string, string> = {
  not_reported: 'The company did not disclose this item for the period.',
  not_available: 'The data source does not provide this item.',
  not_meaningful: 'Not meaningful: for example a negative or zero denominator, or a measure that does not apply to this sector.',
};

/** Format a value by unit; identical rules to the API's report formatter. */
export function fmt(v: number | null | undefined, unit?: string | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'percent': return `${formatIndianNumber(v, 1)}%`;
    case 'pp': return `${v >= 0 ? '+' : '−'}${formatIndianNumber(Math.abs(v), 1)} pp`;
    case 'ratio': return `${formatIndianNumber(v, Math.abs(v) < 10 ? 2 : 1)}×`;
    case 'INR_cr': return `₹${formatIndianNumber(v, 2)} cr`;
    case 'INR': return `₹${formatIndianNumber(v, 2)}`;
    case 'days': return `${formatIndianNumber(v, 0)} days`;
    case 'count': return formatIndianNumber(v, 0);
    case 'shares': return formatIndianNumber(v, 0);
    case 'index_points': return formatIndianNumber(v, 2);
    default: return formatIndianNumber(v, 2);
  }
}

export const pct = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : '−'}${formatIndianNumber(Math.abs(v), d)}%`);
export const cls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
export const prettyPeriod = (k: string) => (k === 'LATEST' ? 'Latest' : k.replace(/^Q(\d)FY(\d\d)$/, 'Q$1 FY$2'));
export const dateOrDash = (d?: string | null) => (d ? formatDate(d.slice(0, 10)) : '—');
