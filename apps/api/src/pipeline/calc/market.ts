import type { Db } from '../../db/db.js';
import { bulkInsert } from '../../lib/bulk.js';
import { realisedVol, sma } from '../../modules/calc/indicators.js';
import { percentileRank } from '../../modules/calc/ratios.js';

// Market breadth, volume/volatility summary, sector aggregates and rule-based regimes
// (PRD MKT-02, MKT-03, MKT-04, MKT-07). Universe "COVERED" = all fully covered securities.

export const REGIME_RULES_V1 = {
  version: 1,
  trend: { rule: 'Up if the broad index close is above its 200-session simple average; otherwise Down', input: 'DEMO500 close vs SMA200' },
  volatility: { rule: 'Low if 20-day realised volatility is below its 33rd percentile over 252 sessions; High if above the 67th; otherwise Normal', low: 33, high: 67 },
  breadth: { rule: 'Positive if more than 50% of the covered universe closes above its 50-day average; Negative if below 40%; otherwise Neutral', positive: 50, negative: 40 },
};

export interface RegimeLabels {
  version: number;
  trend: { label: 'Up' | 'Down' | 'Not available'; inputs: { index_close: number | null; sma_200: number | null } };
  volatility: { label: 'Low' | 'Normal' | 'High' | 'Not available'; inputs: { vol_20d: number | null; percentile_1y: number | null } };
  breadth: { label: 'Positive' | 'Neutral' | 'Negative' | 'Not available'; inputs: { pct_above_50dma: number | null } };
}

export function regimeLabels(indexClose: number | null, sma200: number | null, vol: number | null, pctl: number | null, pctAbove50: number | null): RegimeLabels {
  return {
    version: REGIME_RULES_V1.version,
    trend: { label: indexClose === null || sma200 === null ? 'Not available' : indexClose > sma200 ? 'Up' : 'Down', inputs: { index_close: indexClose, sma_200: sma200 } },
    volatility: { label: pctl === null ? 'Not available' : pctl < REGIME_RULES_V1.volatility.low ? 'Low' : pctl > REGIME_RULES_V1.volatility.high ? 'High' : 'Normal', inputs: { vol_20d: vol, percentile_1y: pctl } },
    breadth: { label: pctAbove50 === null ? 'Not available' : pctAbove50 > REGIME_RULES_V1.breadth.positive ? 'Positive' : pctAbove50 < REGIME_RULES_V1.breadth.negative ? 'Negative' : 'Neutral', inputs: { pct_above_50dma: pctAbove50 } },
  };
}

type DailyRow = { trade_date: string; security_id: number; ret_1d: number | null; adj_close: number; sma_50: number | null; sma_200: number | null; high_52w: number | null; low_52w: number | null; market_cap_cr: number | null; traded_value: number; sector: string; classification_version: number };

/** Calendar days of history replayed before `fromDate` so carried state (previous-day values, 20-session turnover) matches a full run. */
export const MARKET_WARMUP_DAYS = 60;
/**
 * Rows per window query. The embedded engine aborts on very large single results (session 4: a
 * 366-day window of a 500-company universe, ~126k wide rows, crashed it), so the window length is
 * derived from the universe size instead of being fixed.
 */
export const QUERY_ROW_BUDGET = Math.max(1000, Number(process.env.ATLAS_QUERY_ROW_BUDGET ?? 20_000));
/** Calendar days per window for a universe of n securities (≈252 trading days a year), between 7 and 366. */
export const windowDaysFor = (n: number): number => Math.max(7, Math.min(366, Math.floor((QUERY_ROW_BUDGET / Math.max(1, n)) * (365 / 252))));
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function computeMarketDaily(db: Db, opts: { fromDate?: string; calcRunId: string; windowDays?: number }): Promise<number> {
  // Rows are read one window of dates at a time: a single query over the full history of a large
  // universe exhausts the embedded database's memory, and incremental runs only need recent state.
  const span = await db.one<{ lo: string | null; hi: string | null }>(`SELECT min(trade_date) AS lo, max(trade_date) AS hi FROM calc.security_daily`);
  const universe = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ref.securities s JOIN ref.companies c USING (company_id) WHERE c.coverage='full'`);
  const WINDOW_DAYS = opts.windowDays ?? windowDaysFor(universe.n);
  const loadWindow = (from: string, to: string) =>
    db.query<DailyRow>(
      `SELECT d.trade_date, d.security_id, d.ret_1d, d.adj_close, d.sma_50, d.sma_200, d.high_52w, d.low_52w, d.market_cap_cr, p.traded_value, c.sector, c.classification_version
         FROM calc.security_daily d
         JOIN market.price_eod p ON p.security_id=d.security_id AND p.trade_date=d.trade_date AND p.exchange_code='NSE'
         JOIN ref.securities s ON s.security_id=d.security_id JOIN ref.companies c USING (company_id)
        WHERE c.coverage='full' AND d.trade_date >= $1 AND d.trade_date < $2 ORDER BY d.trade_date, d.security_id`, // fixed order: float sums must not depend on row order
      [from, to],
    );
  const prevHigh = new Map<number, number>();
  const prevLow = new Map<number, number>();
  const prevCap = new Map<number, number>();
  const idx = await db.query<{ trade_date: string; close: number }>(`SELECT trade_date, close FROM market.index_levels WHERE index_code='DEMO500' ORDER BY trade_date`);
  const idxClose = idx.map((r) => r.close);
  const idxSma200 = sma(idxClose, 200);
  const idxVol = realisedVol(idxClose, 20);
  const idxByDate = new Map(idx.map((r, i) => [r.trade_date, i]));
  const turnoverHist: number[] = [];
  const market: Record<string, unknown>[] = [];
  const sectors: Record<string, unknown>[] = [];
  const processDate = (d: string, list: DailyRow[]) => {
    let adv = 0, dec = 0, unch = 0, traded = 0, above50 = 0, has50 = 0, above200 = 0, has200 = 0, highs = 0, lows = 0, turnover = 0;
    const sectorAgg = new Map<string, { n: number; sum: number; capRet: number; cap: number; adv: number; dec: number; cv: number }>();
    for (const r of list) {
      turnover += r.traded_value / 1e7;
      if (r.ret_1d !== null) {
        traded++;
        // Returns are compared on the adjusted series rounded to 1e-10 so floating-point noise is not counted as a move.
        const rr = Math.round(r.ret_1d * 1e10) / 1e10;
        if (rr > 0) adv++;
        else if (rr < 0) dec++;
        else unch++;
        const sa = sectorAgg.get(r.sector) ?? { n: 0, sum: 0, capRet: 0, cap: 0, adv: 0, dec: 0, cv: r.classification_version };
        sa.n++;
        sa.sum += r.ret_1d;
        const pc = prevCap.get(r.security_id);
        if (pc) {
          sa.capRet += pc * r.ret_1d;
          sa.cap += pc;
        }
        if (rr > 0) sa.adv++;
        else if (rr < 0) sa.dec++;
        sectorAgg.set(r.sector, sa);
      }
      if (r.sma_50 !== null) {
        has50++;
        if (r.adj_close > r.sma_50) above50++;
      }
      if (r.sma_200 !== null) {
        has200++;
        if (r.adj_close > r.sma_200) above200++;
      }
      const ph = prevHigh.get(r.security_id);
      const pl = prevLow.get(r.security_id);
      if (ph !== undefined && r.adj_close > ph) highs++;
      if (pl !== undefined && r.adj_close < pl) lows++;
      if (r.high_52w !== null) prevHigh.set(r.security_id, r.high_52w);
      if (r.low_52w !== null) prevLow.set(r.security_id, r.low_52w);
      if (r.market_cap_cr) prevCap.set(r.security_id, r.market_cap_cr);
    }
    const avg20 = turnoverHist.length >= 20 ? turnoverHist.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
    turnoverHist.push(turnover);
    const ii = idxByDate.get(d);
    const vol = ii !== undefined ? idxVol[ii] ?? null : null;
    let pctl: number | null = null;
    if (ii !== undefined && vol !== null && ii >= 251) {
      const hist = idxVol.slice(ii - 251, ii + 1).filter((v): v is number => v !== null);
      if (hist.length >= 200) pctl = percentileRank(vol, hist);
    }
    const p50 = has50 ? (above50 / has50) * 100 : null;
    const regime = regimeLabels(ii !== undefined ? idxClose[ii]! : null, ii !== undefined ? idxSma200[ii] ?? null : null, vol, pctl, p50);
    if (opts.fromDate && d < opts.fromDate) return;
    market.push({
      universe_code: 'COVERED', trade_date: d, traded, advances: adv, declines: dec, unchanged: unch,
      pct_above_50dma: p50, pct_above_200dma: has200 ? (above200 / has200) * 100 : null, new_highs: highs, new_lows: lows,
      turnover_cr: turnover, turnover_avg_20_cr: avg20, realised_vol_20d: vol, vol_percentile_1y: pctl, regime, calc_run_id: opts.calcRunId,
    });
    for (const [sector, a] of sectorAgg) {
      sectors.push({ trade_date: d, sector, ret_equal: a.sum / a.n, ret_cap: a.cap > 0 ? a.capRet / a.cap : a.sum / a.n, constituents: a.n, advances: a.adv, declines: a.dec, classification_version: a.cv, calc_run_id: opts.calcRunId });
    }
  };
  if (span.lo && span.hi) {
    const start = opts.fromDate ? (addDays(opts.fromDate, -MARKET_WARMUP_DAYS) > span.lo ? addDays(opts.fromDate, -MARKET_WARMUP_DAYS) : span.lo) : span.lo;
    for (let from = start; from <= span.hi; from = addDays(from, WINDOW_DAYS)) {
      const rows = await loadWindow(from, addDays(from, WINDOW_DAYS));
      const byDate = new Map<string, DailyRow[]>();
      for (const row of rows) {
        const list = byDate.get(row.trade_date);
        if (list) list.push(row);
        else byDate.set(row.trade_date, [row]);
      }
      for (const d of [...byDate.keys()].sort()) processDate(d, byDate.get(d)!);
    }
  }
  await db.query(`DELETE FROM calc.market_daily WHERE universe_code='COVERED' ${opts.fromDate ? 'AND trade_date >= $1' : ''}`, opts.fromDate ? [opts.fromDate] : []);
  await db.query(`DELETE FROM calc.sector_daily ${opts.fromDate ? 'WHERE trade_date >= $1' : ''}`, opts.fromDate ? [opts.fromDate] : []);
  await bulkInsert(db, 'calc.market_daily', market, { chunk: 2000 });
  await bulkInsert(db, 'calc.sector_daily', sectors, { chunk: 5000 });
  return market.length;
}

export async function seedRegimeRules(db: Db): Promise<void> {
  await db.query(`INSERT INTO calc.regime_rules (version, rules, effective_from, change_note) VALUES (1, $1, '2013-01-01', 'Initial rule set') ON CONFLICT DO NOTHING`, [JSON.stringify(REGIME_RULES_V1)]);
}
