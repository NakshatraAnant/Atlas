import { realisedVol, rollingExtreme, rsi, sma } from '../calc/indicators.js';
import { tradeCosts, type CostTable, type TradeCosts } from './costs.js';
import type { TemplateSpec } from './templates.js';

// Deterministic backtest engine (PRD BKT-03..BKT-09). Pure function of its inputs: signals use only
// data up to the signal close; orders fill at the next session's open; long-only, equal weights.

export const ENGINE_VERSION = 'atlas-bt-engine 1.0.0';

export interface SecurityData {
  id: number;
  symbol: string;
  /** Arrays aligned to the master calendar; NaN where the security did not trade. Adjusted basis. */
  open: Float64Array;
  close: Float64Array;
  /** Cash dividend per adjusted share credited on the ex-date (0 otherwise). */
  dividend: Float64Array;
  /** 20-session average traded value in ₹ as of each close (NaN if unknown). */
  adv: Float64Array;
  firstIdx: number;
  lastIdx: number;
  delisted: boolean;
}

export interface LiquidityRule {
  maxAdvPct: number; // e.g. 0.05 = 5% of 20-day average traded value
  minAdvInr: number; // minimum liquidity level
  mode: 'skip' | 'cap';
}

export interface EngineConfig {
  template: TemplateSpec;
  params: Record<string, number>;
  calendar: string[];
  startIdx: number;
  endIdx: number;
  securities: Map<number, SecurityData>;
  /** Securities eligible on a signal date (point-in-time universe). */
  universe: (idx: number) => number[];
  capital: number;
  costs: CostTable;
  costMultiplier: number;
  slippageBps: number;
  liquidity: LiquidityRule;
}

export interface Trade {
  seq: number;
  securityId: number;
  symbol: string;
  side: 'entry' | 'exit' | 'skipped';
  date: string;
  price: number | null;
  quantity: number | null;
  grossValue: number | null;
  costs: TradeCosts | null;
  pnl: number | null;
  returnPct: number | null;
  reason: string;
}

export interface RoundTrip {
  securityId: number;
  symbol: string;
  entryDate: string;
  exitDate: string;
  netPnl: number;
  returnPct: number;
  grossPnl: number;
}

export interface EngineResult {
  dates: string[];
  equity: number[];
  invested: number[];
  trades: Trade[];
  roundTrips: RoundTrip[];
  totalCosts: number;
  tradedValue: number;
  delistedHeld: number;
  universeSizes: number[];
}

interface Position {
  qty: number;
  costBasis: number; // cash paid including buy costs
  entryDate: string;
  entryIdx: number;
  grossBasis: number;
}

interface Signals {
  /** For time-series templates: desired state per security at each close (true = long). */
  want?: (sid: number, i: number, held: Position | undefined) => boolean | null;
  /** For cross-sectional templates: target set at a rebalance close, or null if not a rebalance day. */
  targets?: (i: number) => number[] | null;
}

function buildSignals(cfg: EngineConfig): Signals {
  const t = cfg.template;
  const p = cfg.params;
  const cache = new Map<number, Record<string, (number | null)[]>>();
  const ind = (sid: number) => {
    let c = cache.get(sid);
    if (c) return c;
    const s = cfg.securities.get(sid)!;
    // Indicators are computed on the security's own trading days only (NaN gaps removed) and mapped back.
    const idx: number[] = [];
    const px: number[] = [];
    for (let i = 0; i < s.close.length; i++) if (!Number.isNaN(s.close[i]!)) {
      idx.push(i);
      px.push(s.close[i]!);
    }
    const map = (arr: (number | null)[]) => {
      const out: (number | null)[] = new Array(s.close.length).fill(null);
      idx.forEach((ci, k) => (out[ci] = arr[k] ?? null));
      return out;
    };
    c = {};
    if (t.code === 'ma_crossover') {
      c.fast = map(sma(px, p.fast!));
      c.slow = map(sma(px, p.slow!));
    } else if (t.code === 'breakout_52w') {
      // Highest close of the previous 252 sessions (excluding today) and lowest of the previous L.
      const hiIncl = rollingExtreme(px, 252, 'max');
      const loIncl = rollingExtreme(px, p.exit_lookback!, 'min');
      // Shift by one session so today's close is compared with the previous window only.
      c.hi = map(px.map((_, k) => (k >= 252 ? hiIncl[k - 1] ?? null : null)));
      c.lo = map(px.map((_, k) => (k >= p.exit_lookback! ? loIncl[k - 1] ?? null : null)));
    } else if (t.code === 'rsi_mean_reversion') {
      c.rsi = map(rsi(px, 14));
    } else if (t.code === 'low_vol_monthly') {
      c.vol = map(realisedVol(px, p.lookback_sessions!));
    }
    c.pos = map(px.map((_, k) => k));
    cache.set(sid, c);
    return c;
  };
  if (t.kind === 'time_series') {
    return {
      want: (sid, i, held) => {
        const s = cfg.securities.get(sid)!;
        const close = s.close[i]!;
        if (Number.isNaN(close)) return null;
        const c = ind(sid);
        if (t.code === 'ma_crossover') {
          const f = c.fast![i];
          const sl = c.slow![i];
          if (f === null || f === undefined || sl === null || sl === undefined) return null;
          return f > sl;
        }
        if (t.code === 'breakout_52w') {
          if (!held) return c.hi![i] !== null && close > c.hi![i]!;
          return !(c.lo![i] !== null && close < c.lo![i]!);
        }
        if (t.code === 'rsi_mean_reversion') {
          const r = c.rsi![i];
          if (r === null || r === undefined) return null;
          if (!held) return r < p.entry!;
          const heldFor = (c.pos![i] ?? 0) - (c.pos![held.entryIdx] ?? 0);
          return !(r > p.exit! || heldFor >= p.max_hold!);
        }
        return null;
      },
    };
  }
  const isMonthEnd = (i: number) => i === cfg.endIdx || cfg.calendar[i + 1]!.slice(0, 7) !== cfg.calendar[i]!.slice(0, 7);
  return {
    targets: (i) => {
      if (!isMonthEnd(i)) return null;
      const members = cfg.universe(i);
      const scored: { sid: number; score: number }[] = [];
      for (const sid of members) {
        const s = cfg.securities.get(sid);
        if (!s || Number.isNaN(s.close[i]!)) continue;
        const c = ind(sid);
        if (t.code === 'momentum_monthly') {
          const k = c.pos![i];
          if (k === null || k === undefined) continue;
          const lag = Math.round(p.skip_months! * 21);
          const look = Math.round(p.lookback_months! * 21);
          // find calendar indices of the security's k-lag and k-look trading days
          const priceAt = (back: number): number | null => {
            let j = i;
            let seen = 0;
            while (j >= 0 && seen < back) {
              j--;
              if (j >= 0 && !Number.isNaN(s.close[j]!)) seen++;
            }
            return j >= 0 && !Number.isNaN(s.close[j]!) ? s.close[j]! : null;
          };
          const recent = lag === 0 ? s.close[i]! : priceAt(lag);
          const base = priceAt(look);
          if (recent === null || base === null || base <= 0) continue;
          scored.push({ sid, score: -(recent / base - 1) }); // lower score = better rank
        } else {
          const v = c.vol![i];
          if (v === null || v === undefined) continue;
          scored.push({ sid, score: v });
        }
      }
      scored.sort((a, b) => a.score - b.score || a.sid - b.sid);
      return scored.slice(0, p.top_n!).map((x) => x.sid);
    },
  };
}

export function runEngine(cfg: EngineConfig): EngineResult {
  const signals = buildSignals(cfg);
  const slip = cfg.slippageBps / 10_000;
  const positions = new Map<number, Position>();
  const lastClose = new Map<number, number>();
  const trades: Trade[] = [];
  const roundTrips: RoundTrip[] = [];
  let cash = cfg.capital;
  let totalCosts = 0;
  let tradedValue = 0;
  let delistedHeld = 0;
  let seq = 0;
  const equity: number[] = [];
  const invested: number[] = [];
  const dates: string[] = [];
  const universeSizes: number[] = [];
  let pendingSells = new Map<number, string>();
  let pendingBuys: { sid: number; value: number; reason: string }[] = [];

  const mark = (i: number): number => {
    let v = cash;
    for (const [sid, pos] of positions) {
      const s = cfg.securities.get(sid)!;
      const c = s.close[i]!;
      if (!Number.isNaN(c)) lastClose.set(sid, c);
      v += pos.qty * (lastClose.get(sid) ?? 0);
    }
    return v;
  };

  const sell = (sid: number, i: number, price: number, reason: string, applySlip = true) => {
    const pos = positions.get(sid);
    if (!pos) return;
    const s = cfg.securities.get(sid)!;
    const fill = applySlip ? price * (1 - slip) : price;
    const gross = pos.qty * fill;
    const c = tradeCosts('sell', gross, pos.qty * (price - fill), cfg.costs, cfg.costMultiplier);
    const costsExSlip = c.total - c.slippage;
    cash += gross - costsExSlip;
    totalCosts += c.total;
    tradedValue += gross;
    const pnl = gross - costsExSlip - pos.costBasis;
    const grossPnl = pos.qty * price - pos.grossBasis;
    trades.push({ seq: ++seq, securityId: sid, symbol: s.symbol, side: 'exit', date: cfg.calendar[i]!, price: fill, quantity: pos.qty, grossValue: gross, costs: c, pnl, returnPct: (pnl / pos.costBasis) * 100, reason });
    roundTrips.push({ securityId: sid, symbol: s.symbol, entryDate: pos.entryDate, exitDate: cfg.calendar[i]!, netPnl: pnl, returnPct: (pnl / pos.costBasis) * 100, grossPnl });
    positions.delete(sid);
  };

  const buy = (sid: number, i: number, value: number, reason: string) => {
    const s = cfg.securities.get(sid)!;
    const open = s.open[i]!;
    if (Number.isNaN(open) || value <= 0) return;
    const adv = s.adv[i - 1] ?? Number.NaN;
    let target = value;
    if (!Number.isNaN(adv)) {
      if (adv < cfg.liquidity.minAdvInr) {
        trades.push({ seq: ++seq, securityId: sid, symbol: s.symbol, side: 'skipped', date: cfg.calendar[i]!, price: null, quantity: null, grossValue: null, costs: null, pnl: null, returnPct: null, reason: `Skipped: 20-day average traded value ₹${Math.round(adv / 1e5) / 100} crore is below the minimum liquidity level` });
        return;
      }
      const cap = adv * cfg.liquidity.maxAdvPct;
      if (target > cap) {
        if (cfg.liquidity.mode === 'skip') {
          trades.push({ seq: ++seq, securityId: sid, symbol: s.symbol, side: 'skipped', date: cfg.calendar[i]!, price: null, quantity: null, grossValue: null, costs: null, pnl: null, returnPct: null, reason: `Skipped: position ₹${Math.round(target)} exceeds ${cfg.liquidity.maxAdvPct * 100}% of 20-day average traded value` });
          return;
        }
        target = cap;
      }
    }
    const fill = open * (1 + slip);
    // Size so that value plus costs fits within the allocation and available cash.
    const affordable = Math.min(target, cash);
    if (affordable <= 0) return;
    const estRate = cfg.costs.stt_pct_buy + cfg.costs.stamp_duty_pct_buy + cfg.costs.exchange_txn_pct * (1 + cfg.costs.gst_pct_on_fees) + cfg.costs.brokerage_pct * (1 + cfg.costs.gst_pct_on_fees);
    let qty = affordable / (fill * (1 + estRate * cfg.costMultiplier));
    let gross = qty * fill;
    let c = tradeCosts('buy', gross, qty * (fill - open), cfg.costs, cfg.costMultiplier);
    if (gross + c.total - c.slippage > cash) {
      qty *= cash / (gross + c.total - c.slippage + 1e-9);
      gross = qty * fill;
      c = tradeCosts('buy', gross, qty * (fill - open), cfg.costs, cfg.costMultiplier);
    }
    const costsExSlip = c.total - c.slippage;
    cash -= gross + costsExSlip;
    totalCosts += c.total;
    tradedValue += gross;
    const existing = positions.get(sid);
    if (existing) {
      existing.qty += qty;
      existing.costBasis += gross + costsExSlip;
      existing.grossBasis += qty * open;
    } else positions.set(sid, { qty, costBasis: gross + costsExSlip, grossBasis: qty * open, entryDate: cfg.calendar[i]!, entryIdx: i });
    trades.push({ seq: ++seq, securityId: sid, symbol: s.symbol, side: 'entry', date: cfg.calendar[i]!, price: fill, quantity: qty, grossValue: gross, costs: c, pnl: null, returnPct: null, reason });
  };

  /** Partial sell for cross-sectional rebalancing (keeps the position open). */
  const trim = (sid: number, i: number, value: number) => {
    const pos = positions.get(sid);
    const s = cfg.securities.get(sid)!;
    const open = s.open[i]!;
    if (!pos || Number.isNaN(open) || value <= 0) return;
    const fill = open * (1 - slip);
    const qty = Math.min(pos.qty, value / fill);
    const gross = qty * fill;
    const c = tradeCosts('sell', gross, qty * (open - fill), cfg.costs, cfg.costMultiplier);
    const share = qty / pos.qty;
    cash += gross - (c.total - c.slippage);
    totalCosts += c.total;
    tradedValue += gross;
    pos.costBasis *= 1 - share;
    pos.grossBasis *= 1 - share;
    pos.qty -= qty;
    trades.push({ seq: ++seq, securityId: sid, symbol: s.symbol, side: 'exit', date: cfg.calendar[i]!, price: fill, quantity: qty, grossValue: gross, costs: c, pnl: null, returnPct: null, reason: 'Rebalance to equal weight (partial)' });
  };

  for (let i = cfg.startIdx; i <= cfg.endIdx; i++) {
    const date = cfg.calendar[i]!;
    // 1. Execute orders generated at the previous close, at today's open.
    if (i > cfg.startIdx) {
      for (const [sid, reason] of pendingSells) {
        const s = cfg.securities.get(sid)!;
        if (!Number.isNaN(s.open[i]!)) sell(sid, i, s.open[i]!, reason);
      }
      pendingSells = new Map();
      for (const b of pendingBuys) {
        if (b.value < 0) trim(b.sid, i, -b.value);
      }
      for (const b of pendingBuys) {
        if (b.value > 0) buy(b.sid, i, b.value, b.reason);
      }
      pendingBuys = [];
    }
    // 2. Dividends on the ex-date for positions held overnight.
    for (const [sid, pos] of positions) {
      const d = cfg.securities.get(sid)!.dividend[i]!;
      if (d > 0 && pos.entryIdx < i) cash += pos.qty * d;
    }
    // 3. Delisting: exit at the last traded price on the last trading day.
    for (const sid of [...positions.keys()]) {
      const s = cfg.securities.get(sid)!;
      if (s.delisted && i === s.lastIdx) {
        delistedHeld++;
        sell(sid, i, s.close[i]!, 'Delisted or merged: exited at the last traded price (flagged)', false);
      }
    }
    // 4. Mark to market.
    const eq = mark(i);
    dates.push(date);
    equity.push(eq);
    invested.push(eq > 0 ? (eq - cash) / eq : 0);
    const members = cfg.universe(i);
    universeSizes.push(members.length);
    if (i === cfg.endIdx) break;
    // 5. Signals at today's close → orders for tomorrow's open.
    if (signals.want) {
      const memberSet = new Set(members);
      for (const sid of [...positions.keys()]) {
        const w = signals.want(sid, i, positions.get(sid));
        if (!memberSet.has(sid)) pendingSells.set(sid, 'Left the point-in-time universe');
        else if (w === false) pendingSells.set(sid, 'Exit rule met at the close');
      }
      const slots = Math.max(1, members.length);
      for (const sid of members) {
        if (positions.has(sid) || pendingSells.has(sid)) continue;
        const s = cfg.securities.get(sid);
        if (!s || s.delisted && i >= s.lastIdx) continue;
        if (signals.want(sid, i, undefined) === true) pendingBuys.push({ sid, value: eq / slots, reason: 'Entry rule met at the close' });
      }
      // Cap total buys at available cash, keeping order deterministic (security id order).
      pendingBuys.sort((a, b) => a.sid - b.sid);
    } else if (signals.targets) {
      const target = signals.targets(i);
      if (target) {
        const tset = new Set(target);
        for (const sid of positions.keys()) if (!tset.has(sid)) pendingSells.set(sid, 'Not in the target set at the monthly rebalance');
        const per = target.length ? eq / target.length : 0;
        for (const sid of target) {
          const pos = positions.get(sid);
          const s = cfg.securities.get(sid)!;
          const cur = pos ? pos.qty * s.close[i]! : 0;
          const delta = per - cur;
          if (Math.abs(delta) > per * 0.01) pendingBuys.push({ sid, value: delta, reason: pos ? 'Rebalance to equal weight' : 'Entered the target set at the monthly rebalance' });
        }
        pendingBuys.sort((a, b) => a.sid - b.sid);
      }
    }
  }
  // Close remaining positions at the final close (simulation end; not a current position).
  const end = cfg.endIdx;
  for (const sid of [...positions.keys()]) {
    const s = cfg.securities.get(sid)!;
    const px = Number.isNaN(s.close[end]!) ? lastClose.get(sid)! : s.close[end]!;
    sell(sid, end, px, 'Closed at the end of the test period (simulation only)', false);
  }
  if (equity.length) equity[equity.length - 1] = cash;
  return { dates, equity, invested, trades, roundTrips, totalCosts, tradedValue, delistedHeld, universeSizes };
}
