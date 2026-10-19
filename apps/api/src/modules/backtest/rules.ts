import { z } from 'zod';
import { realisedVol, rollingExtreme, rsi, sma } from '../calc/indicators.js';

// No-code rule builder (PRD BKT-02): Pro users combine indicator conditions with AND/OR for
// entry and exit. Rules are data (validated, stored in the run config, part of the results hash),
// compiled into a pure evaluator. Every indicator at session i uses closes up to i only; "crosses"
// compares i−1 with i. Fills still happen at the next session's open (engine), so no look-ahead.

export const indicatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('close') }),
  z.object({ kind: z.literal('sma'), period: z.number().int().min(2).max(300) }),
  z.object({ kind: z.literal('rsi'), period: z.number().int().min(2).max(50) }),
  /** Highest close of the previous `period` sessions, excluding the current session. */
  z.object({ kind: z.literal('prev_high'), period: z.number().int().min(5).max(252) }),
  z.object({ kind: z.literal('prev_low'), period: z.number().int().min(5).max(252) }),
  /** Return over the last `period` sessions, in percent. */
  z.object({ kind: z.literal('return_pct'), period: z.number().int().min(1).max(252) }),
  /** Annualised realised volatility over `period` sessions, in percent. */
  z.object({ kind: z.literal('volatility_pct'), period: z.number().int().min(5).max(252) }),
]);
export type Indicator = z.infer<typeof indicatorSchema>;

export const conditionSchema = z.object({
  left: indicatorSchema,
  op: z.enum(['>', '<', '>=', '<=', 'crosses_above', 'crosses_below']),
  right: z.union([indicatorSchema, z.object({ kind: z.literal('value'), value: z.number().finite().min(-1e9).max(1e9) })]),
});
export type Condition = z.infer<typeof conditionSchema>;

export const groupSchema = z.object({ combine: z.enum(['and', 'or']), conditions: z.array(conditionSchema).min(1).max(5) });
export const ruleSetSchema = z.object({ entry: groupSchema, exit: groupSchema, max_hold: z.number().int().min(1).max(500).optional() });
export type RuleSet = z.infer<typeof ruleSetSchema>;
type Operand = Condition['right'];

const LABEL: Record<string, (p?: number) => string> = {
  close: () => 'close',
  sma: (p) => `SMA(${p})`,
  rsi: (p) => `RSI(${p})`,
  prev_high: (p) => `highest close of the previous ${p} sessions`,
  prev_low: (p) => `lowest close of the previous ${p} sessions`,
  return_pct: (p) => `${p}-session return %`,
  volatility_pct: (p) => `${p}-session volatility %`,
};
const opText: Record<Condition['op'], string> = { '>': 'is above', '<': 'is below', '>=': 'is at or above', '<=': 'is at or below', crosses_above: 'crosses above', crosses_below: 'crosses below' };
const operandText = (o: Operand) => (o.kind === 'value' ? String(o.value) : LABEL[o.kind]!('period' in o ? o.period : undefined));

/** Plain-language description used in the report and methodology (BKT-13). */
export function describeRules(r: RuleSet): string {
  const g = (grp: RuleSet['entry']) => grp.conditions.map((c) => `${operandText(c.left)} ${opText[c.op]} ${operandText(c.right)}`).join(grp.combine === 'and' ? ' AND ' : ' OR ');
  return `Enter long when ${g(r.entry)}. Exit when ${g(r.exit)}${r.max_hold ? ` or after ${r.max_hold} sessions` : ''}. Signals at the close; orders fill at the next session's open.`;
}

/** Sessions of history needed before the rules can first be evaluated (for warnings). */
export function warmup(r: RuleSet): number {
  let w = 1;
  for (const c of [...r.entry.conditions, ...r.exit.conditions]) for (const o of [c.left, c.right]) if ('period' in o) w = Math.max(w, o.period + 1);
  return w;
}

/** Series for one indicator over a security's own trading-day closes (oldest first). */
export function indicatorSeries(ind: Indicator, px: number[]): (number | null)[] {
  switch (ind.kind) {
    case 'close':
      return px.slice();
    case 'sma':
      return sma(px, ind.period);
    case 'rsi':
      return rsi(px, ind.period);
    case 'prev_high':
    case 'prev_low': {
      const incl = rollingExtreme(px, ind.period, ind.kind === 'prev_high' ? 'max' : 'min');
      return px.map((_, k) => (k >= ind.period ? (incl[k - 1] ?? null) : null));
    }
    case 'return_pct':
      return px.map((v, k) => (k >= ind.period ? (v / px[k - ind.period]! - 1) * 100 : null));
    case 'volatility_pct':
      return realisedVol(px, ind.period).map((v) => (v === null || v === undefined ? null : v * 100));
  }
}

const key = (o: Operand) => JSON.stringify(o);

/** Compiles a rule set for one security's closes; returns per-index entry and exit evaluators. */
export function compileRules(r: RuleSet, px: number[]): { entry: (k: number) => boolean | null; exit: (k: number) => boolean | null } {
  const series = new Map<string, (number | null)[]>();
  const get = (o: Operand, k: number): number | null => {
    if (o.kind === 'value') return o.value;
    let s = series.get(key(o));
    if (!s) {
      s = indicatorSeries(o, px);
      series.set(key(o), s);
    }
    const v = s[k];
    return v === undefined || v === null || Number.isNaN(v) ? null : v;
  };
  const cond = (c: Condition, k: number): boolean | null => {
    const l = get(c.left, k);
    const rr = get(c.right, k);
    if (l === null || rr === null) return null;
    switch (c.op) {
      case '>': return l > rr;
      case '<': return l < rr;
      case '>=': return l >= rr;
      case '<=': return l <= rr;
      case 'crosses_above':
      case 'crosses_below': {
        if (k === 0) return null;
        const lp = get(c.left, k - 1);
        const rp = get(c.right, k - 1);
        if (lp === null || rp === null) return null;
        return c.op === 'crosses_above' ? lp <= rp && l > rr : lp >= rp && l < rr;
      }
    }
  };
  // Unknown (insufficient history) counts as "not met" for OR and blocks AND.
  const group = (g: RuleSet['entry'], k: number): boolean | null => {
    const vals = g.conditions.map((c) => cond(c, k));
    if (g.combine === 'and') return vals.some((v) => v === null) ? null : vals.every(Boolean);
    if (vals.some((v) => v === true)) return true;
    return vals.every((v) => v === null) ? null : false;
  };
  return { entry: (k) => group(r.entry, k), exit: (k) => group(r.exit, k) };
}
