// Claim checker (PRD AIA-03, MKT-08; Blueprint §8.2): every number in generated text must match
// a value produced by a tool or the calculation service, exactly or within declared rounding.

export interface Claim {
  id: string;
  value: number;
  label: string;
  unit?: string;
  evidenceId: string;
}

export interface ExtractedNumber {
  raw: string;
  value: number;
  decimals: number;
  index: number;
}

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December';

// Numbers that are labels, not claims: dates, fiscal periods, times, indicator windows, versions, years, ordinals.
const LABEL_PATTERNS: RegExp[] = [
  new RegExp(`\\b\\d{1,2} (?:${MONTHS}),? \\d{4}\\b`, 'g'),
  new RegExp(`\\b(?:${MONTHS}) \\d{4}\\b`, 'g'),
  new RegExp(`\\b(?:${MONTHS}) \\d{1,2}\\b`, 'g'),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\bQ[1-4]\s?FY\s?\d{2,4}\b/gi,
  /\bFY\s?\d{2,4}\b/gi,
  /\bH[12]\s?FY\d{2}\b/gi,
  /\b\d{1,2}:\d{2}\b/g,
  /\b\d{1,4}[- ](?:day|session|sessions|week|weeks|month|months|year|years|quarter|quarters|trading-day)\b/gi,
  /\b\d{1,3}-(?:DMA|dma|SMA|sma)\b/g,
  /\b(?:SMA|RSI|EMA|DMA|MA)\s?\(?\d{1,3}\)?/g,
  /\b(?:last|past|previous|next|top|bottom|first) \d{1,3}\b/gi,
  /\bv\d+(?:\.\d+)*\b/gi,
  /(?<![₹\d,.])\b(?:19|20)\d{2}\b(?![.,]\d)(?!\s?(?:crore|cr|lakh|%|x\b|×|shares|points))/g,
  /\b\d+(?:st|nd|rd|th)\b(?! percentile)/g,
  /\bIST\b/g,
  /\b[A-Z]{2,}\d+[A-Z\d]*\b/g, // codes such as DEMO500, SYN00001
  /\b(?:section|step|page|part)\s\d+\b/gi,
  /\b\d+\s(?:of|out of)\s\d+\s(?:sections|parts)\b/gi,
];

export function maskLabels(text: string): string {
  let t = text;
  for (const re of LABEL_PATTERNS) t = t.replace(re, (m) => ' '.repeat(m.length));
  return t;
}

export function extractNumbers(text: string): ExtractedNumber[] {
  // Ordinal percentiles are claims ("72nd percentile"): keep the digits, drop the suffix (same length).
  const ordinals = text.replace(/(\d+)(st|nd|rd|th)(?= percentile)/g, (_m, d: string, s: string) => `${d}${' '.repeat(s.length)}`);
  const masked = maskLabels(ordinals);
  const out: ExtractedNumber[] = [];
  const re = /(?<![\w.])-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?(?![\w])|(?<![\w.])-?\d+(?:\.\d+)?(?![\w])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const raw = m[0];
    const clean = raw.replace(/,/g, '');
    const decimals = clean.includes('.') ? clean.split('.')[1]!.length : 0;
    out.push({ raw, value: Number(clean), decimals, index: m.index });
  }
  return out;
}

function roundTo(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f + (v >= 0 ? 1e-9 : -1e-9)) / f;
}

/** A text number matches a claim if the claim, rounded to the shown precision, equals it (sign-insensitive). */
export function numberMatches(n: ExtractedNumber, claimValue: number): boolean {
  const candidates = [claimValue, Math.abs(claimValue)];
  return candidates.some((v) => Math.abs(roundTo(v, n.decimals) - Math.abs(n.value)) < 1e-9 || Math.abs(roundTo(v, n.decimals) - n.value) < 1e-9);
}

export interface CheckOutcome {
  passed: boolean;
  numbers: number;
  matched: { raw: string; claimId: string }[];
  unmatched: string[];
}

/** Mask entity names (companies, indices, sectors) so digits inside names are not read as claims. */
export function maskNames(text: string, names: string[]): string {
  let t = text;
  for (const n of [...names].filter((x) => /\d/.test(x)).sort((a, b) => b.length - a.length)) t = t.split(n).join(' '.repeat(n.length));
  return t;
}

export function checkClaims(text: string, claims: Claim[], allowedConstants: number[] = [], names: string[] = []): CheckOutcome {
  const nums = extractNumbers(maskNames(text, names));
  const matched: CheckOutcome['matched'] = [];
  const unmatched: string[] = [];
  for (const n of nums) {
    const c = claims.find((cl) => numberMatches(n, cl.value));
    if (c) matched.push({ raw: n.raw, claimId: c.id });
    else if (allowedConstants.some((k) => numberMatches(n, k))) matched.push({ raw: n.raw, claimId: 'constant' });
    else unmatched.push(n.raw);
  }
  return { passed: unmatched.length === 0, numbers: nums.length, matched, unmatched };
}
