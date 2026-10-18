// Financial quality checks (PRD CMP-07). Each flag describes a pattern in structured data and
// says "requires review"; flags never use language that implies wrongdoing.

export interface SeriesPoint {
  period: string;
  value: number | null;
}

export interface QualityFlag {
  code: string;
  name: string;
  triggered: boolean;
  status: 'requires_review' | 'not_triggered' | 'insufficient_data';
  rule: string;
  threshold: string;
  observed: SeriesPoint[];
  note: string;
}

export const FLAG_RULES = {
  weak_cash_conversion: { name: 'Weak cash conversion', rule: 'Cash conversion (operating cash flow ÷ operating profit) below the threshold in each of the last three financial years', threshold: 50, periods: 3 },
  rising_receivable_days: { name: 'Rising receivable days', rule: 'Receivable days rose in each of the last three consecutive financial years', threshold: 3, periods: 4 },
  rising_leverage: { name: 'Rising leverage', rule: 'Debt to equity rose in each of the last three financial years and the latest value is above the threshold', threshold: 1, periods: 4 },
  auditor_change: { name: 'Auditor change', rule: 'A change of statutory auditor was disclosed in the last three financial years', threshold: 1, periods: 3 },
  qualified_opinion: { name: 'Qualified audit opinion', rule: 'The auditor expressed a qualified (modified) opinion in the last three financial years', threshold: 1, periods: 3 },
  other_income_dependence: { name: 'Dependence on other income', rule: 'Other income above the threshold share of profit before tax in the latest financial year', threshold: 25, periods: 1 },
} as const;

const NOTE = 'A flag describes a pattern in reported data. It implies no conclusion; it marks something that requires review.';

const lastN = (s: SeriesPoint[], n: number) => s.slice(-n);
const allNumbers = (s: SeriesPoint[]): s is { period: string; value: number }[] => s.every((p) => typeof p.value === 'number');

function flag(code: keyof typeof FLAG_RULES, observed: SeriesPoint[], triggered: boolean | null, thresholdText: string): QualityFlag {
  const r = FLAG_RULES[code];
  return { code, name: r.name, triggered: triggered === true, status: triggered === null ? 'insufficient_data' : triggered ? 'requires_review' : 'not_triggered', rule: r.rule, threshold: thresholdText, observed, note: NOTE };
}

export function weakCashConversion(series: SeriesPoint[]): QualityFlag {
  const obs = lastN(series, 3);
  if (obs.length < 3 || !allNumbers(obs)) return flag('weak_cash_conversion', obs, null, 'below 50% for 3 years');
  return flag('weak_cash_conversion', obs, obs.every((p) => p.value < FLAG_RULES.weak_cash_conversion.threshold), 'below 50% for 3 years');
}

export function risingReceivableDays(series: SeriesPoint[]): QualityFlag {
  const obs = lastN(series, 4);
  if (obs.length < 4 || !allNumbers(obs)) return flag('rising_receivable_days', obs, null, '3 consecutive increases');
  const rising = obs.slice(1).every((p, i) => p.value > obs[i]!.value);
  return flag('rising_receivable_days', obs, rising, '3 consecutive increases');
}

export function risingLeverage(series: SeriesPoint[]): QualityFlag {
  const obs = lastN(series, 4);
  if (obs.length < 4 || !allNumbers(obs)) return flag('rising_leverage', obs, null, '3 consecutive increases and latest above 1.0×');
  const rising = obs.slice(1).every((p, i) => p.value > obs[i]!.value);
  return flag('rising_leverage', obs, rising && obs[obs.length - 1]!.value > FLAG_RULES.rising_leverage.threshold, '3 consecutive increases and latest above 1.0×');
}

export function disclosedEvent(code: 'auditor_change' | 'qualified_opinion', events: { fiscal_year: number; detail: string }[], latestFy: number): QualityFlag {
  const recent = events.filter((e) => e.fiscal_year > latestFy - 3);
  return flag(code, recent.map((e) => ({ period: `FY${String(e.fiscal_year % 100).padStart(2, '0')}: ${e.detail}`, value: 1 })), recent.length > 0, 'any disclosure in the last 3 years');
}

export function otherIncomeDependence(series: SeriesPoint[]): QualityFlag {
  const obs = lastN(series, 1);
  if (!obs.length || !allNumbers(obs)) return flag('other_income_dependence', obs, null, 'above 25% of profit before tax');
  return flag('other_income_dependence', obs, obs[0]!.value > FLAG_RULES.other_income_dependence.threshold, 'above 25% of profit before tax');
}

/** Words that must never appear in flag text (tested). */
export const FORBIDDEN_FLAG_WORDS = /\b(fraud|manipulat\w*|scam|cook\w*|window[- ]dressing|red flag|suspicious|wrongdoing|illegal)\b/i;
