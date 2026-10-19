import type { Db } from '../../db/db.js';
import { badRequest } from '../../lib/http.js';

// Strategy templates (PRD BKT-01): rules, parameters with defaults and ranges, known limitations.

export interface ParamSpec {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface TemplateSpec {
  code: 'ma_crossover' | 'breakout_52w' | 'rsi_mean_reversion' | 'momentum_monthly' | 'low_vol_monthly' | 'custom_rules';
  version: number;
  name: string;
  kind: 'time_series' | 'cross_sectional';
  description: string;
  rules: string;
  params: ParamSpec[];
  limitations: string[];
  universeKinds: ('security' | 'index' | 'screen')[];
}

export const TEMPLATES: TemplateSpec[] = [
  {
    code: 'ma_crossover', version: 2, name: 'Moving-average crossover', kind: 'time_series',
    description: 'Holds a security while its fast moving average is above its slow moving average.',
    rules: 'Enter long when SMA(fast) of the adjusted close crosses above SMA(slow) at the close; exit when it crosses below. Orders fill at the next session’s open.',
    params: [
      { key: 'fast', label: 'Fast average (sessions)', default: 50, min: 5, max: 100, step: 1 },
      { key: 'slow', label: 'Slow average (sessions)', default: 200, min: 20, max: 300, step: 1 },
    ],
    limitations: ['Long only; no shorting.', 'Whipsaws in sideways markets generate many small losing trades.', 'Moving averages lag; entries and exits come after turns.'],
    universeKinds: ['security', 'index'],
  },
  {
    code: 'breakout_52w', version: 1, name: '52-week-high breakout', kind: 'time_series',
    description: 'Enters when the close exceeds the highest close of the previous 252 sessions.',
    rules: 'Enter long when the adjusted close exceeds the maximum close of the previous 252 sessions; exit when it falls below the minimum close of the previous exit-lookback sessions. Next-open fills.',
    params: [{ key: 'exit_lookback', label: 'Exit lookback (sessions)', default: 126, min: 20, max: 252, step: 1 }],
    limitations: ['Long only.', 'Breakouts often fail; results depend on a few large winners.', 'Needs 252 sessions of history before the first signal.'],
    universeKinds: ['security', 'index'],
  },
  {
    code: 'rsi_mean_reversion', version: 1, name: 'RSI mean reversion', kind: 'time_series',
    description: 'Buys after short-term weakness measured by RSI(14) and exits on recovery or after a maximum holding period.',
    rules: 'Enter long when RSI(14, Wilder) closes below the entry level; exit when it closes above the exit level or after the maximum holding period. Next-open fills.',
    params: [
      { key: 'entry', label: 'Entry RSI below', default: 30, min: 10, max: 40, step: 1 },
      { key: 'exit', label: 'Exit RSI above', default: 55, min: 45, max: 80, step: 1 },
      { key: 'max_hold', label: 'Maximum holding period (sessions)', default: 20, min: 5, max: 60, step: 1 },
    ],
    limitations: ['Long only.', 'Falling knives: weak securities can keep falling.', 'High trade count makes results sensitive to costs.'],
    universeKinds: ['security', 'index'],
  },
  {
    code: 'momentum_monthly', version: 1, name: 'Monthly cross-sectional momentum', kind: 'cross_sectional',
    description: 'Each month holds the top N securities of the universe ranked by past return, equal-weighted.',
    rules: 'On the last session of each month, rank members of the point-in-time universe by adjusted return over the lookback window, skipping the most recent month; hold the top N in equal weights from the next session’s open.',
    params: [
      { key: 'lookback_months', label: 'Lookback (months)', default: 12, min: 3, max: 12, step: 1 },
      { key: 'skip_months', label: 'Skip most recent months', default: 1, min: 0, max: 2, step: 1 },
      { key: 'top_n', label: 'Holdings (top N)', default: 10, min: 3, max: 30, step: 1 },
    ],
    limitations: ['Momentum can reverse sharply after market turns.', 'Monthly rebalancing creates turnover and costs.', 'Universe and membership dates matter; survivorship controls apply.'],
    universeKinds: ['index', 'screen'],
  },
  {
    code: 'low_vol_monthly', version: 1, name: 'Monthly low-volatility portfolio', kind: 'cross_sectional',
    description: 'Each month holds the N least volatile members of the universe, equal-weighted.',
    rules: 'On the last session of each month, rank point-in-time universe members by realised volatility of daily log returns over the lookback window (lowest first); hold the lowest N in equal weights from the next session’s open.',
    params: [
      { key: 'lookback_sessions', label: 'Volatility lookback (sessions)', default: 252, min: 60, max: 252, step: 1 },
      { key: 'top_n', label: 'Holdings (lowest N)', default: 10, min: 3, max: 30, step: 1 },
    ],
    limitations: ['Concentrates in defensive sectors.', 'Lags in strong rallies.', 'Volatility is measured historically and can change.'],
    universeKinds: ['index', 'screen'],
  },
  {
    code: 'custom_rules', version: 1, name: 'Custom rules (rule builder)', kind: 'time_series',
    description: 'Your own entry and exit conditions built from indicators, combined with AND or OR (Pro).',
    rules: 'Enter long when the entry group is met at the close; exit when the exit group is met (or after an optional maximum holding period). Indicators use closes up to the signal session only; orders fill at the next session’s open.',
    params: [],
    limitations: ['Long only.', 'Every extra condition and variant tested raises the risk of fitting noise; the report warns when many variants are tried.', 'Conditions needing long lookbacks delay the first possible signal.'],
    universeKinds: ['security', 'index'],
  },
];

export const TEMPLATE_BY_CODE = new Map(TEMPLATES.map((t) => [t.code, t]));

export function resolveParams(t: TemplateSpec, input: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of t.params) {
    const v = input[p.key] ?? p.default;
    if (!Number.isFinite(v) || v < p.min || v > p.max) throw badRequest(`${p.label} must be between ${p.min} and ${p.max}.`);
    out[p.key] = Math.round(v / p.step) * p.step;
  }
  if (t.code === 'ma_crossover' && out.fast! >= out.slow!) throw badRequest('The fast average must be shorter than the slow average.');
  if (t.code === 'rsi_mean_reversion' && out.entry! >= out.exit!) throw badRequest('The entry RSI must be below the exit RSI.');
  return out;
}

export async function seedTemplates(db: Db): Promise<void> {
  for (const t of TEMPLATES) {
    await db.query(
      `INSERT INTO bt.strategy_templates (template_code, version, name, description, rules, params_schema, limitations, universe_kinds, min_plan) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [t.code, t.version, t.name, t.description, t.rules, JSON.stringify(t.params), t.limitations.join(' '), t.universeKinds, t.kind === 'cross_sectional' ? 'pro' : 'free'],
    );
  }
}
