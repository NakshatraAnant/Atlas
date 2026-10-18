import { formatIndianNumber } from '@atlas/shared';

// One formatter for every number the assistant shows, so displayed text and claim values agree.

export function fmtValue(value: number, unit: string): string {
  switch (unit) {
    case 'percent':
      return `${formatIndianNumber(value, 1)}%`;
    case 'pp':
      return `${value >= 0 ? '+' : '−'}${formatIndianNumber(Math.abs(value), 1)} points`;
    case 'ratio':
      return `${formatIndianNumber(value, Math.abs(value) < 10 ? 2 : 1)}×`;
    case 'INR_cr':
      return `₹${formatIndianNumber(value, 2)} crore`;
    case 'INR':
      return `₹${formatIndianNumber(value, 2)}`;
    case 'days':
      return `${formatIndianNumber(value, 0)} days`;
    case 'count':
      return formatIndianNumber(value, 0);
    case 'index_points':
      return formatIndianNumber(value, 2);
    default:
      return formatIndianNumber(value, 2);
  }
}

export const MISSING_TEXT: Record<string, string> = {
  not_meaningful: 'n/m (not meaningful)',
  not_reported: 'not reported by the company',
  not_available: 'not available from the data source',
};
