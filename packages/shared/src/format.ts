// Display conventions from PRD §7.2 and NFR-08: Indian digit grouping, ₹ crore,
// DD MMM YYYY dates, IST times, Indian financial-year labels.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const IST_OFFSET_MINUTES = 330;

/** Group an integer string the Indian way: 1234567 -> 12,34,567. */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  return `${groups.join(',')},${last3}`;
}

/** Format a number with Indian grouping and fixed decimals. Uses round-half-away-from-zero. */
export function formatIndianNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) throw new RangeError('formatIndianNumber requires a finite number');
  const sign = value < 0 ? '-' : '';
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * factor + Number.EPSILON * factor) / factor;
  const [intPart, frac] = rounded.toFixed(decimals).split('.') as [string, string | undefined];
  return `${sign}${groupIndian(intPart)}${frac !== undefined && decimals > 0 ? `.${frac}` : ''}`;
}

export function formatRupees(value: number, decimals = 0): string {
  const s = formatIndianNumber(value, decimals);
  return s.startsWith('-') ? `-₹${s.slice(1)}` : `₹${s}`;
}

/** Statement values are shown in ₹ crore with two decimals (PRD §7.2). */
export function formatCrore(valueInCrore: number): string {
  return formatIndianNumber(valueInCrore, 2);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${formatIndianNumber(value, decimals)}%`;
}

/** Lakh/crore notation for large rupee amounts, e.g. ₹12.5 lakh, ₹1.19 crore. */
export function formatLakhCrore(rupees: number): string {
  const abs = Math.abs(rupees);
  if (abs >= 1e7) return `₹${formatIndianNumber(rupees / 1e7, 2)} crore`;
  if (abs >= 1e5) return `₹${formatIndianNumber(rupees / 1e5, 2)} lakh`;
  return formatRupees(rupees);
}

/** ISO date (YYYY-MM-DD) -> DD MMM YYYY. */
export function formatDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) throw new RangeError(`Invalid ISO date: ${isoDate}`);
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) throw new RangeError(`Invalid month in ${isoDate}`);
  return `${m[3]} ${month} ${m[1]}`;
}

/** Convert an instant to IST wall-clock parts. */
export function toIstParts(instant: Date | string): { date: string; time: string } {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  const iso = ist.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Instant -> "16 Oct 2026, 20:30 IST". */
export function formatIstDateTime(instant: Date | string): string {
  const p = toIstParts(instant);
  return `${formatDate(p.date)}, ${p.time} IST`;
}

/** Indian financial year of a date: FY27 = April 2026 to March 2027. Returns 2027 for that range. */
export function fiscalYearOf(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const mo = Number(isoDate.slice(5, 7));
  return mo >= 4 ? y + 1 : y;
}

/** Fiscal quarter (1-4) of a date: Q1 = Apr–Jun. */
export function fiscalQuarterOf(isoDate: string): number {
  const mo = Number(isoDate.slice(5, 7));
  return Math.floor(((mo + 8) % 12) / 3) + 1;
}

export function fyLabel(fiscalYear: number): string {
  return `FY${String(fiscalYear % 100).padStart(2, '0')}`;
}

export function quarterLabel(fiscalYear: number, fiscalQuarter: number): string {
  return `Q${fiscalQuarter} ${fyLabel(fiscalYear)}`;
}

/** Period key used in calc.metric_values: FY27, Q2FY27, TTM:2026-09-30. */
export function periodKey(periodType: 'Q' | 'FY', fiscalYear: number, fiscalQuarter?: number): string {
  if (periodType === 'FY') return fyLabel(fiscalYear);
  if (!fiscalQuarter) throw new RangeError('Quarter period requires fiscalQuarter');
  return `Q${fiscalQuarter}${fyLabel(fiscalYear)}`;
}

/** Three distinct missing-value labels (PRD §7.2). */
export type MissingReason = 'not_reported' | 'not_available' | 'not_meaningful';
export const MISSING_LABELS: Record<MissingReason, { short: string; long: string }> = {
  not_reported: { short: 'Not reported', long: 'The company did not disclose this item for the period.' },
  not_available: { short: 'Not available', long: 'The data source does not provide this item.' },
  not_meaningful: { short: 'n/m', long: 'Not meaningful, for example a negative or zero denominator, or a measure that does not apply to this sector.' },
};
