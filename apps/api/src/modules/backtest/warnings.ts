import type { BacktestMetrics } from './metrics.js';
import type { RoundTrip } from './engine.js';

// Robustness warnings (PRD BKT-08): shown at the top of every report and in every export.

export interface RobustnessWarning {
  code: string;
  title: string;
  why: string;
  methodology: string;
}

const M = '/methodology/backtests#robustness';

export function robustnessWarnings(input: {
  metrics: BacktestMetrics;
  roundTrips: RoundTrip[];
  doubledCostReturn: number | null;
  universeKind: 'security' | 'index' | 'screen';
  delistedIncluded: number;
  variantsThisSession: number;
  costsExcluded: boolean;
  benchmarkMismatch: string | null;
}): RobustnessWarning[] {
  const w: RobustnessWarning[] = [];
  const m = input.metrics;
  if (input.costsExcluded) w.push({ code: 'costs_excluded', title: 'Costs excluded', why: 'This run ignores brokerage, taxes, charges and slippage. Real results would be lower.', methodology: `${M}-costs` });
  if (m.trades < 30) w.push({ code: 'few_trades', title: `Fewer than 30 trades (${m.trades})`, why: 'With few trades, the result may be noise rather than a repeatable pattern.', methodology: M });
  const grossProfits = input.roundTrips.filter((t) => t.grossPnl > 0).map((t) => t.grossPnl).sort((a, b) => b - a);
  const totalGross = grossProfits.reduce((a, b) => a + b, 0);
  if (grossProfits.length >= 3 && totalGross > 0 && grossProfits.slice(0, 3).reduce((a, b) => a + b, 0) / totalGross > 0.6) {
    w.push({ code: 'few_trades_drive_result', title: 'Results driven by a few trades', why: 'More than 60% of gross profit came from three trades; removing them could change the conclusion.', methodology: M });
  }
  if (m.years < 3) w.push({ code: 'short_period', title: `Short test period (${m.years.toFixed(1)} years)`, why: 'Short periods may cover a single market regime and say little about other conditions.', methodology: M });
  if (input.universeKind === 'security') w.push({ code: 'single_security', title: 'Single security', why: 'A security chosen today may have been chosen because of how it performed (selection bias). Point-in-time universes avoid this.', methodology: `${M}-survivorship` });
  else if (input.delistedIncluded === 0 && m.years >= 3) w.push({ code: 'survivorship_check', title: 'No delisted securities were held', why: 'The point-in-time universe included delisted names where they were members, but none were held. Check that the universe definition covers the whole period.', methodology: `${M}-survivorship` });
  if (input.doubledCostReturn !== null && m.total_return > 0 && (input.doubledCostReturn < m.total_return * 0.7 || input.doubledCostReturn <= 0)) {
    w.push({ code: 'cost_sensitive', title: 'Sensitive to costs', why: `With doubled costs and slippage, total return falls from ${m.total_return.toFixed(1)}% to ${input.doubledCostReturn.toFixed(1)}%.`, methodology: `${M}-costs` });
  }
  if (input.variantsThisSession > 5) w.push({ code: 'many_variants', title: `${input.variantsThisSession} variants tested in this session`, why: 'Testing many variants and keeping the best one is likely to overfit history.', methodology: `${M}-overfitting` });
  if (input.benchmarkMismatch) w.push({ code: 'benchmark_mismatch', title: 'Benchmark may not match the universe', why: input.benchmarkMismatch, methodology: `${M}-benchmarks` });
  return w;
}
