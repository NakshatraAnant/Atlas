import type { Db } from '../../db/db.js';

// "Worth investigating" (PRD HOM-03): prompts generated from DEFINED rules for watchlist
// companies on the latest session. Each prompt states the rule, the observed numbers and the
// evidence ids behind them. These are prompts to look closer, never signals or recommendations
// (BKT-12, content rules): wording is descriptive and the rule is always shown.

export const INVESTIGATE_RULES = {
  volume_spike: { multiple: 3, text: 'Traded volume at least 3× its average over the previous 20 sessions' },
  large_move: { pct: 5, text: 'Price moved 5% or more in one session (adjusted close)' },
  new_high: { text: 'Adjusted close above its previous 52-week high' },
  new_low: { text: 'Adjusted close below its previous 52-week low' },
  results_filed: { days: 7, text: 'Quarterly results filed in the last 7 days' },
} as const;
export type RuleCode = keyof typeof INVESTIGATE_RULES;

export interface SessionObservation {
  company_id: string;
  short_name: string;
  security_id: number;
  date: string;
  prev_date: string | null;
  adj_close: number;
  ret_1d: number | null;
  adj_volume: number | null;
  prev_vol_avg_20: number | null;
  prev_high_52w: number | null;
  prev_low_52w: number | null;
  results_filed_at: string | null;
}

export interface Prompt {
  rule: RuleCode;
  rule_text: string;
  company_id: string;
  short_name: string;
  date: string;
  observed: string;
  evidence: string[];
  href: string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Pure rule evaluation (unit-tested). Missing inputs never fire a rule. */
export function evaluatePrompts(o: SessionObservation, now: Date): Prompt[] {
  const out: Prompt[] = [];
  const base = { company_id: o.company_id, short_name: o.short_name, date: o.date, href: `/app/companies/${o.company_id}` };
  const sd = (field: string, date = o.date) => `sd.${o.security_id}.${date}.${field}`;
  if (o.adj_volume !== null && o.prev_vol_avg_20 !== null && o.prev_vol_avg_20 > 0) {
    const m = o.adj_volume / o.prev_vol_avg_20;
    if (m >= INVESTIGATE_RULES.volume_spike.multiple) out.push({ ...base, rule: 'volume_spike', rule_text: INVESTIGATE_RULES.volume_spike.text, observed: `Volume was ${m.toFixed(1)}× the previous 20-session average.`, evidence: [sd('vol_avg_20', o.prev_date ?? o.date)] });
  }
  if (o.ret_1d !== null && Math.abs(o.ret_1d) * 100 >= INVESTIGATE_RULES.large_move.pct) {
    out.push({ ...base, rule: 'large_move', rule_text: INVESTIGATE_RULES.large_move.text, observed: `The adjusted close changed ${o.ret_1d > 0 ? '+' : ''}${pct(o.ret_1d)} on ${o.date}.`, evidence: [sd('adj_close')] });
  }
  if (o.prev_high_52w !== null && o.adj_close > o.prev_high_52w) out.push({ ...base, rule: 'new_high', rule_text: INVESTIGATE_RULES.new_high.text, observed: `Closed at ${o.adj_close.toFixed(2)} versus a previous 52-week high of ${o.prev_high_52w.toFixed(2)}.`, evidence: [sd('adj_close'), sd('high_52w', o.prev_date ?? o.date)] });
  if (o.prev_low_52w !== null && o.adj_close < o.prev_low_52w) out.push({ ...base, rule: 'new_low', rule_text: INVESTIGATE_RULES.new_low.text, observed: `Closed at ${o.adj_close.toFixed(2)} versus a previous 52-week low of ${o.prev_low_52w.toFixed(2)}.`, evidence: [sd('adj_close'), sd('low_52w', o.prev_date ?? o.date)] });
  if (o.results_filed_at && now.getTime() - Date.parse(o.results_filed_at) <= INVESTIGATE_RULES.results_filed.days * 86_400_000) {
    out.push({ ...base, rule: 'results_filed', rule_text: INVESTIGATE_RULES.results_filed.text, observed: `Results filed on ${o.results_filed_at.slice(0, 10)}.`, evidence: [], href: `/app/companies/${o.company_id}?tab=financials` });
  }
  return out;
}

/** Observations for the user's watchlist companies on the latest computed session. */
export async function worthInvestigating(db: Db, userId: string, now: Date): Promise<{ date: string | null; prompts: Prompt[]; rules: typeof INVESTIGATE_RULES }> {
  const latest = await db.maybeOne<{ d: string | null }>(`SELECT max(trade_date) AS d FROM calc.security_daily`);
  if (!latest?.d) return { date: null, prompts: [], rules: INVESTIGATE_RULES };
  const rows = await db.query<SessionObservation>(
    `WITH wl AS (
       SELECT DISTINCT i.company_id FROM app.watchlist_items i JOIN app.watchlists w USING (watchlist_id) WHERE w.user_id=$1 AND w.deleted_at IS NULL)
     SELECT c.company_id, c.short_name, s.security_id, d.trade_date AS date, p.trade_date AS prev_date, d.adj_close, d.ret_1d,
            a.adj_volume, p.vol_avg_20 AS prev_vol_avg_20, p.high_52w AS prev_high_52w, p.low_52w AS prev_low_52w,
            (SELECT max(fp.filed_at) FROM fund.financial_periods fp WHERE fp.company_id=c.company_id AND fp.period_type='Q') AS results_filed_at
       FROM wl JOIN ref.companies c USING (company_id) JOIN ref.securities s ON s.company_id=c.company_id
       JOIN calc.security_daily d ON d.security_id=s.security_id AND d.trade_date=$2
       LEFT JOIN market.adjusted_price_cache a ON a.security_id=s.security_id AND a.trade_date=$2
       LEFT JOIN LATERAL (SELECT trade_date, vol_avg_20, high_52w, low_52w FROM calc.security_daily x WHERE x.security_id=s.security_id AND x.trade_date < $2 ORDER BY x.trade_date DESC LIMIT 1) p ON true
      ORDER BY c.short_name`,
    [userId, latest.d],
  );
  return { date: latest.d, prompts: rows.flatMap((r) => evaluatePrompts(r, now)), rules: INVESTIGATE_RULES };
}
