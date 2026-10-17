// Technical indicators on adjusted series (PRD CMP-10). Vectorised, O(n) where possible.
// Values must match the naive reference implementations in tests within 1e-6.

export type Series = (number | null)[];

export function sma(values: number[], window: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= window) sum -= values[i - window]!;
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

/** Wilder RSI. First value at index `period` (needs period + 1 prices). */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i]! - values[i - 1]!;
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const calc = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = calc();
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = calc();
  }
  return out;
}

export function logReturns(values: number[]): Series {
  return values.map((v, i) => (i === 0 ? null : Math.log(v / values[i - 1]!)));
}

/** Annualised realised volatility: population std of `window` log returns × √252. */
export function realisedVol(values: number[], window = 20): Series {
  const r = logReturns(values);
  const out: Series = new Array(values.length).fill(null);
  let s = 0;
  let s2 = 0;
  for (let i = 1; i < values.length; i++) {
    const x = r[i]!;
    s += x;
    s2 += x * x;
    if (i > window) {
      const old = r[i - window]!;
      s -= old;
      s2 -= old * old;
    }
    if (i >= window) {
      const mean = s / window;
      const variance = Math.max(0, s2 / window - mean * mean);
      out[i] = Math.sqrt(variance) * Math.sqrt(252);
    }
  }
  return out;
}

/** Rolling max/min over the last `window` values including today (monotonic deque, O(n)). */
export function rollingExtreme(values: number[], window: number, kind: 'max' | 'min'): Series {
  const out: Series = new Array(values.length).fill(null);
  const dq: number[] = [];
  const better = (a: number, b: number) => (kind === 'max' ? a >= b : a <= b);
  for (let i = 0; i < values.length; i++) {
    while (dq.length && better(values[i]!, values[dq[dq.length - 1]!]!)) dq.pop();
    dq.push(i);
    if (dq[0]! <= i - window) dq.shift();
    if (i >= window - 1) out[i] = values[dq[0]!]!;
  }
  return out;
}

export function rollingMean(values: number[], window: number): Series {
  return sma(values, window);
}

/** Reference (naive) implementations used only to cross-check the fast versions in tests. */
export const reference = {
  sma(values: number[], window: number): Series {
    return values.map((_, i) => (i < window - 1 ? null : values.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0) / window));
  },
  realisedVol(values: number[], window = 20): Series {
    return values.map((_, i) => {
      if (i < window) return null;
      const rs: number[] = [];
      for (let k = i - window + 1; k <= i; k++) rs.push(Math.log(values[k]! / values[k - 1]!));
      const m = rs.reduce((a, b) => a + b, 0) / window;
      return Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / window) * Math.sqrt(252);
    });
  },
  rollingMax(values: number[], window: number): Series {
    return values.map((_, i) => (i < window - 1 ? null : Math.max(...values.slice(i - window + 1, i + 1))));
  },
  rsi(values: number[], period = 14): Series {
    const out: Series = values.map(() => null);
    if (values.length <= period) return out;
    const changes = values.slice(1).map((v, i) => v - values[i]!);
    let ag = changes.slice(0, period).filter((c) => c > 0).reduce((a, b) => a + b, 0) / period;
    let al = -changes.slice(0, period).filter((c) => c < 0).reduce((a, b) => a + b, 0) / period;
    out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = period; i < changes.length; i++) {
      const c = changes[i]!;
      ag = (ag * (period - 1) + (c > 0 ? c : 0)) / period;
      al = (al * (period - 1) + (c < 0 ? -c : 0)) / period;
      out[i + 1] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  },
};
