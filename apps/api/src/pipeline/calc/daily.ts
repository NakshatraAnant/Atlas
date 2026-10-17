import type { Db } from '../../db/db.js';
import { bulkInsert } from '../../lib/bulk.js';
import { istInstant } from '../../lib/dates.js';
import { lastFourQuarters, latestFy, loadPit, sumItem, type CompanyFundamentalsPit } from '../../modules/fundamentals/pit.js';
import { realisedVol, rollingExtreme, rollingMean, rsi, sma } from '../../modules/calc/indicators.js';
import { dividendYield, evEbitda, isMissing, pbRatio, peRatio } from '../../modules/calc/ratios.js';

// calc.security_daily: daily indicators on the adjusted series plus point-in-time valuation.
// Fundamentals are used only if filed before the session close (15:30 IST) of that date, so a
// result published at 17:45 IST first affects the next session (no look-ahead).

export interface FundamentalSnapshot {
  availableAt: string;
  ttmProfit: number | null;
  ttmEbitda: number | null;
  equity: number | null;
  borrowings: number | null;
  cash: number | null;
  dividendsPaid: number | null;
  shares: number | null;
  sharesAsOf: string | null;
}

export function fundamentalTimeline(pit: CompanyFundamentalsPit): FundamentalSnapshot[] {
  return pit.filingInstants().map((instant) => {
    const visible = pit.asOf(instant);
    const q4 = lastFourQuarters(visible);
    const fy = latestFy(visible);
    return {
      availableAt: instant,
      ttmProfit: q4 ? sumItem(q4, 'net_profit') : null,
      ttmEbitda: q4 ? sumItem(q4, 'operating_profit') : null,
      equity: fy?.values.get('total_equity') ?? null,
      borrowings: fy?.values.get('borrowings') ?? null,
      cash: fy?.values.get('cash_and_equivalents') ?? 0,
      dividendsPaid: fy?.values.get('dividends_paid') ?? null,
      shares: fy?.values.get('shares_outstanding') ?? null,
      sharesAsOf: fy?.period_end ?? null,
    };
  });
}

export interface ShareAction { ex_date: string; action_type: string; factor: number | null; ratio_num: number | null; ratio_den: number | null }

/** Shares outstanding on `date`, starting from a reported count at `asOf` and applying actions in between. */
export function sharesOn(reported: number, asOf: string, date: string, actions: ShareAction[]): number {
  let shares = reported;
  for (const a of actions) {
    const mult = a.action_type === 'rights' ? (a.ratio_num && a.ratio_den ? 1 + a.ratio_num / a.ratio_den : 1) : a.factor ? 1 / a.factor : 1;
    if (a.ex_date > asOf && a.ex_date <= date) shares *= mult;
    else if (a.ex_date > date && a.ex_date <= asOf) shares /= mult;
  }
  return shares;
}

export async function computeSecurityDaily(db: Db, opts: { securityIds?: number[]; fromDate?: string; calcRunId: string }): Promise<number> {
  const secs = await db.query<{ security_id: number; company_id: string; template: string }>(
    `SELECT s.security_id, s.company_id, c.sector_template AS template FROM ref.securities s JOIN ref.companies c USING (company_id) WHERE c.coverage='full' ${opts.securityIds ? 'AND s.security_id = ANY($1::bigint[])' : ''}`,
    opts.securityIds ? [opts.securityIds] : [],
  );
  const pits = await loadPit(db, [...new Set(secs.map((s) => s.company_id))]);
  let total = 0;
  for (const s of secs) {
    const bars = await db.query<{ trade_date: string; adj_close: number; close: number; traded_value: number; adj_volume: number }>(
      `SELECT a.trade_date, a.adj_close, p.close, p.traded_value, a.adj_volume FROM market.adjusted_price_cache a
         JOIN market.price_eod p ON p.security_id=a.security_id AND p.trade_date=a.trade_date AND p.exchange_code='NSE'
        WHERE a.security_id=$1 ORDER BY a.trade_date`,
      [s.security_id],
    );
    if (!bars.length) continue;
    const actions = await db.query<ShareAction>(`SELECT ex_date, action_type, adj_factor AS factor, ratio_num, ratio_den FROM market.corporate_actions WHERE security_id=$1 AND action_type IN ('split','bonus','rights')`, [s.security_id]);
    const closes = bars.map((b) => b.adj_close);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const r14 = rsi(closes, 14);
    const v20 = realisedVol(closes, 20);
    const adv = rollingMean(bars.map((b) => b.traded_value), 20);
    const vavg = rollingMean(bars.map((b) => b.adj_volume), 20);
    const hi = rollingExtreme(closes, 252, 'max');
    const lo = rollingExtreme(closes, 252, 'min');
    const pit = pits.get(s.company_id);
    const timeline = pit ? fundamentalTimeline(pit) : [];
    const firstWithShares = timeline.find((t) => t.shares);
    let ti = -1;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i]!;
      const close = istInstant(b.trade_date, '15:30');
      while (ti + 1 < timeline.length && timeline[ti + 1]!.availableAt <= close) ti++;
      const snap = ti >= 0 ? timeline[ti]! : undefined;
      const shareSrc = snap?.shares ? snap : firstWithShares;
      const shares = shareSrc?.shares && shareSrc.sharesAsOf ? sharesOn(shareSrc.shares, shareSrc.sharesAsOf, b.trade_date, actions) : null;
      const mcap = shares ? (b.close * shares) / 1e7 : null;
      const pe = snap && mcap !== null ? peRatio(mcap, snap.ttmProfit) : null;
      const pb = snap && mcap !== null ? pbRatio(mcap, snap.equity) : null;
      const ev = snap && mcap !== null && s.template === 'standard' ? evEbitda(mcap, snap.borrowings, snap.cash, snap.ttmEbitda) : null;
      const dy = snap && mcap !== null ? dividendYield(snap.dividendsPaid, mcap) : null;
      if (opts.fromDate && b.trade_date < opts.fromDate) continue;
      const num = (r: ReturnType<typeof peRatio> | null) => (r && !isMissing(r) ? r.value : null);
      rows.push({
        security_id: s.security_id, trade_date: b.trade_date, adj_close: b.adj_close,
        ret_1d: i > 0 ? b.adj_close / bars[i - 1]!.adj_close - 1 : null,
        sma_20: s20[i], sma_50: s50[i], sma_200: s200[i], rsi_14: r14[i], vol_20d: v20[i], adv_20d: adv[i], vol_avg_20: vavg[i], high_52w: hi[i], low_52w: lo[i],
        market_cap_cr: mcap, shares_outstanding: shares, pe_ttm: num(pe), pb: num(pb), ev_ebitda: num(ev), dividend_yield: num(dy), fundamentals_as_of: snap?.availableAt ?? null,
        calc_run_id: opts.calcRunId,
      });
    }
    await db.query(`DELETE FROM calc.security_daily WHERE security_id=$1 ${opts.fromDate ? 'AND trade_date >= $2' : ''}`, opts.fromDate ? [s.security_id, opts.fromDate] : [s.security_id]);
    total += await bulkInsert(db, 'calc.security_daily', rows, { chunk: 5000 });
  }
  return total;
}
