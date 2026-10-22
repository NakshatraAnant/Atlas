import * as A from '@atlas/shared';
import type { Instrument } from './instruments.js';

// One metric set for every surface (workbench, screener, reports, discovery), computed by the tested
// functions in @atlas/shared. Each value is null with a reason when its inputs are insufficient; a
// missing value is never reported as zero.

export interface MetricSet {
  observations: number;
  first: string | null;
  last: string | null;
  total_return: number | null;
  cagr: number | null;
  return_30d: number | null;
  return_90d: number | null;
  return_365d: number | null;
  vol_90d: number | null;
  max_drawdown: number | null;
  current_drawdown: number | null;
  sharpe: number | null;
  sortino: number | null;
  risk_free: number;
  annualisation: number;
  sma50_gap: number | null;
  sma200_gap: number | null;
  volume_ratio_30_90: number | null;
  reasons: Record<string, string>;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function metricsFor(inst: Pick<Instrument, 'observations' | 'volumes' | 'annualisation' | 'calendar'>, riskFree: number): MetricSet {
  const obs = inst.observations;
  const reasons: Record<string, string> = {};
  const take = <T>(name: string, r: A.Result<T>, pick: (x: T) => number): number | null => {
    if (r.ok) return pick(r as T);
    reasons[name] = (r as A.Insufficient).reason;
    return null;
  };
  // Period returns: crypto in calendar days; sessions in calendar days as well (period ends on the last session).
  const pr = (days: number) => take(`return_${days}d`, A.periodReturn(obs, days, undefined, inst.calendar === 'sessions' ? 5 : 3), (x) => x.value);
  const step = inst.calendar === 'continuous' ? A.DAY : undefined;
  const dailyRets = step ? A.simpleReturns(obs).map((r) => r.r) : sessionReturns(obs);
  const rr = A.riskRatios(dailyRets.slice(-365), inst.annualisation, riskFree);
  const dd = A.drawdowns(obs);
  const s50 = A.sma(obs, 50);
  const s200 = A.sma(obs, 200);
  const last = obs[obs.length - 1];
  const gap = (s: (number | null)[], name: string) => {
    const v = s[s.length - 1];
    if (!last || v === null || v === undefined) {
      reasons[name] = 'not enough observations for the moving average';
      return null;
    }
    return last.v / v - 1;
  };
  const vt = A.volumeTrend(inst.volumes);
  // Volatility of daily (or session) log returns over the last 90 calendar days, annualised per calendar.
  let vol: number | null = null;
  if (inst.calendar === 'continuous') vol = take('vol_90d', A.realisedVol(obs, { window: 90, annualisation: 365 }), (x) => x.value);
  else {
    const recent = obs.filter((o) => last && o.t > last.t - 90 * A.DAY);
    const r = sessionReturns(recent).map((x) => Math.log(1 + x));
    if (r.length >= 40) vol = A.stdev(r) * Math.sqrt(252);
    else reasons.vol_90d = 'needs at least 40 session returns in the last 90 days';
  }
  return {
    observations: obs.length, first: obs[0] ? iso(obs[0].t) : null, last: last ? iso(last.t) : null,
    total_return: obs.length >= 2 ? last!.v / obs[0]!.v - 1 : null,
    cagr: take('cagr', A.cagr(obs), (x) => x.value),
    return_30d: pr(30), return_90d: pr(90), return_365d: pr(365),
    vol_90d: vol,
    max_drawdown: dd.ok ? dd.max_drawdown : null, current_drawdown: dd.ok ? dd.current_drawdown : null,
    sharpe: rr.ok ? rr.sharpe : (reasons.sharpe = (rr as A.Insufficient).reason, null),
    sortino: rr.ok ? rr.sortino : null,
    risk_free: riskFree, annualisation: inst.annualisation,
    sma50_gap: gap(s50, 'sma50_gap'), sma200_gap: gap(s200, 'sma200_gap'),
    volume_ratio_30_90: vt.ok ? vt.ratio : (reasons.volume_ratio_30_90 = (vt as A.Insufficient).reason, null),
    reasons,
  };
}

/** Session-to-session simple returns; a break of more than 5 calendar days (data gap) is skipped, not bridged. */
export function sessionReturns(obs: A.Obs[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < obs.length; i++) if ((obs[i]!.t - obs[i - 1]!.t) / A.DAY <= 5) out.push(obs[i]!.v / obs[i - 1]!.v - 1);
  return out;
}

export const METRIC_DEFINITIONS: Record<string, string> = {
  total_return: 'last ÷ first − 1 over the selected range (price return; see each instrument’s basis).',
  cagr: '(last ÷ first)^(365.25 ÷ days) − 1, shown only for spans of at least one year.',
  return_30d: 'Return over 30 calendar days (nearest earlier observation within 3 days for crypto, 5 for sessions).',
  vol_90d: 'Standard deviation of daily (crypto, ×√365) or session (equities, ×√252) log returns over the last 90 calendar days.',
  max_drawdown: 'Largest fall from a running peak within the range.',
  sharpe: 'Annualised (mean return − risk-free) ÷ standard deviation over the last 365 returns; risk-free rate shown alongside.',
  sortino: 'As Sharpe, with downside deviation (returns below the risk-free rate) in the denominator.',
  sma50_gap: 'Last close ÷ 50-observation simple moving average − 1.',
  volume_ratio_30_90: 'Mean volume of the last 30 observations ÷ mean of the last 90.',
};
