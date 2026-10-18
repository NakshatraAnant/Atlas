import type { Db } from '../../db/db.js';
import { REGIME_RULES_V1 } from '../../pipeline/calc/market.js';
import type { RightsMatrix } from '../ref/rights.js';

// Market intelligence (PRD MKT-01..MKT-07, HOM-01). End-of-day only; every value carries its
// as-of date and an evidence id. Fields without display rights are omitted, never estimated.

export const PERIODS: { key: string; label: string; sessions: number | 'ytd' }[] = [
  { key: '1D', label: '1 day', sessions: 1 },
  { key: '1W', label: '1 week', sessions: 5 },
  { key: '1M', label: '1 month', sessions: 21 },
  { key: '3M', label: '3 months', sessions: 63 },
  { key: 'YTD', label: 'Year to date', sessions: 'ytd' },
  { key: '1Y', label: '1 year', sessions: 252 },
];

export function periodReturns(series: { trade_date: string; close: number }[], asOf: string): Record<string, number | null> {
  const upto = series.filter((s) => s.trade_date <= asOf);
  const i = upto.length - 1;
  const last = upto[i];
  const out: Record<string, number | null> = {};
  for (const p of PERIODS) {
    if (!last) {
      out[p.key] = null;
      continue;
    }
    let base: { close: number } | undefined;
    if (p.sessions === 'ytd') base = [...upto].reverse().find((s) => s.trade_date < `${asOf.slice(0, 4)}-01-01`);
    else base = upto[i - p.sessions];
    out[p.key] = base ? (last.close / base.close - 1) * 100 : null;
  }
  return out;
}

export async function latestMarketDate(db: Db): Promise<string | null> {
  return (await db.maybeOne<{ d: string | null }>(`SELECT max(trade_date) AS d FROM calc.market_daily WHERE universe_code='COVERED'`))?.d ?? null;
}

export async function marketSummary(db: Db, opts: { date?: string; publicOnly?: boolean; rights: RightsMatrix }) {
  const date = opts.date ?? (await latestMarketDate(db));
  if (!date) return null;
  const md = await db.maybeOne<Record<string, unknown> & { regime: unknown; traded: number; advances: number; declines: number; unchanged: number }>(`SELECT * FROM calc.market_daily WHERE universe_code='COVERED' AND trade_date=$1`, [date]);
  const defs = await db.query<{ index_code: string; name: string; kind: string; universe_size_class: string }>(`SELECT index_code, name, kind, universe_size_class FROM ref.index_definitions ORDER BY index_code`);
  const indices = [];
  for (const d of defs) {
    if (opts.publicOnly && !opts.rights.can('index', 'level', 'public_web')) continue;
    if (!opts.rights.can('index', 'level', 'display')) continue;
    const series = await db.query<{ trade_date: string; close: number }>(`SELECT trade_date, close FROM market.index_levels WHERE index_code=$1 AND trade_date <= $2 AND trade_date >= $2::date - interval '400 days' ORDER BY trade_date`, [d.index_code, date]);
    const last = series[series.length - 1];
    if (!last) continue;
    indices.push({ ...d, close: last.close, as_of: last.trade_date, returns: periodReturns(series, date), evidence_id: `ix.${d.index_code}.${last.trade_date}`, label: d.kind === 'total_return' ? 'Total return index' : 'Price return index' });
  }
  const sectors = await db.query(`SELECT sector, ret_equal, ret_cap, constituents, advances, declines FROM calc.sector_daily WHERE trade_date=$1 ORDER BY ret_cap DESC`, [date]);
  const breadthPublic = opts.rights.can('derived_metrics', 'breadth.advances', 'public_web');
  return {
    date,
    as_of_label: `${date}, 15:30 IST · End of day`,
    indices,
    breadth: md && (!opts.publicOnly || breadthPublic) ? { traded: md.traded, advances: md.advances, declines: md.declines, unchanged: md.unchanged, reconciles: md.advances + md.declines + md.unchanged === md.traded, pct_above_50dma: md.pct_above_50dma, pct_above_200dma: md.pct_above_200dma, new_highs: md.new_highs, new_lows: md.new_lows, evidence_id: `md.COVERED.${date}` } : null,
    activity: md ? { turnover_cr: md.turnover_cr, turnover_avg_20_cr: md.turnover_avg_20_cr, turnover_vs_avg20: md.turnover_avg_20_cr ? Number(md.turnover_cr) / Number(md.turnover_avg_20_cr) : null, realised_vol_20d: md.realised_vol_20d, vol_percentile_1y: md.vol_percentile_1y, percentile_lookback: '252 sessions including today', evidence_id: `md.COVERED.${date}` } : null,
    volatility_index: opts.rights.can('volatility_index', '*', 'display') ? { status: 'licensed' } : { status: 'hidden', note: 'India VIX is not shown: the series is not licensed in this configuration (dataset-level flag).' },
    sectors: opts.publicOnly && !opts.rights.can('derived_metrics', 'sector.ret', 'public_web') ? [] : sectors.map((s) => ({ ...s, evidence_id: `sec.${date}.${(s as { sector: string }).sector}` })),
    sector_methodology: 'Covered universe; documented classification version 1; equal-weighted and cap-weighted (previous-session market values).',
    index_contribution: opts.rights.can('index_weights', '*', 'display') ? { status: 'available' } : { status: 'hidden', note: 'Contribution to the index move is hidden because index constituent weights are not licensed.' },
    regime: md?.regime ?? null,
    regime_rules: REGIME_RULES_V1,
  };
}

export async function indexHistory(db: Db, code: string, from?: string, to?: string) {
  const def = await db.maybeOne<{ index_code: string; name: string; kind: string }>(`SELECT index_code, name, kind FROM ref.index_definitions WHERE index_code=$1`, [code]);
  if (!def) return null;
  const series = await db.query<{ trade_date: string; close: number }>(`SELECT trade_date, close FROM market.index_levels WHERE index_code=$1 AND trade_date >= COALESCE($2::date,'1900-01-01') AND trade_date <= COALESCE($3::date,'2999-12-31') ORDER BY trade_date`, [code, from ?? null, to ?? null]);
  return { ...def, type_label: def.kind === 'total_return' ? 'Total return' : 'Price return', series, period_definition: 'Returns use trading sessions: 1W = 5, 1M = 21, 3M = 63, 1Y = 252; YTD from the last session of the previous calendar year.' };
}

export async function sectorDetail(db: Db, sector: string, date: string) {
  const agg = await db.maybeOne(`SELECT * FROM calc.sector_daily WHERE trade_date=$1 AND sector=$2`, [date, sector]);
  if (!agg) return null;
  const constituents = await db.query(
    `SELECT c.company_id, c.short_name, c.industry, d.ret_1d, d.market_cap_cr, d.adj_close, d.sma_50, (d.adj_close > d.sma_50) AS above_50dma
       FROM calc.security_daily d JOIN ref.securities s USING (security_id) JOIN ref.companies c USING (company_id) WHERE d.trade_date=$1 AND c.sector=$2 AND c.coverage='full' ORDER BY d.ret_1d DESC NULLS LAST`,
    [date, sector],
  );
  const announcements = await db.query(
    `SELECT a.announcement_id, c.short_name, c.company_id, a.category, a.subject, a.published_at FROM disc.announcements a JOIN ref.companies c USING (company_id)
      WHERE c.sector=$1 AND a.published_at >= ($2::date - interval '3 days') AND a.published_at < ($2::date + interval '1 day') ORDER BY a.published_at DESC LIMIT 20`,
    [sector, date],
  );
  return { sector, date, aggregate: agg, constituents, announcements, evidence_id: `sec.${date}.${sector}` };
}

export async function breadthSeries(db: Db, from: string, to: string) {
  return db.query(`SELECT trade_date, traded, advances, declines, unchanged, pct_above_50dma, pct_above_200dma, new_highs, new_lows FROM calc.market_daily WHERE universe_code='COVERED' AND trade_date BETWEEN $1 AND $2 ORDER BY trade_date`, [from, to]);
}

/** Relative performance of a company or sector against a benchmark over standard periods (MKT-05). */
export async function relativePerformance(db: Db, opts: { companyId?: string; sector?: string; benchmark: string; date: string }) {
  const bench = await db.maybeOne<{ kind: string; name: string }>(`SELECT kind, name FROM ref.index_definitions WHERE index_code=$1`, [opts.benchmark]);
  if (!bench) return null;
  const bseries = await db.query<{ trade_date: string; close: number }>(`SELECT trade_date, close FROM market.index_levels WHERE index_code=$1 AND trade_date <= $2 ORDER BY trade_date`, [opts.benchmark, opts.date]);
  let series: { trade_date: string; close: number }[] = [];
  let label = '';
  if (opts.companyId) {
    series = await db.query(`SELECT a.trade_date, a.adj_close AS close FROM market.adjusted_price_cache a JOIN ref.securities s USING (security_id) WHERE s.company_id=$1 AND a.trade_date <= $2 ORDER BY a.trade_date`, [opts.companyId, opts.date]);
    label = 'Company (adjusted price return)';
  } else if (opts.sector) {
    const rets = await db.query<{ trade_date: string; ret_cap: number }>(`SELECT trade_date, ret_cap FROM calc.sector_daily WHERE sector=$1 AND trade_date <= $2 ORDER BY trade_date`, [opts.sector, opts.date]);
    let level = 100;
    series = rets.map((r) => ({ trade_date: r.trade_date, close: (level *= 1 + r.ret_cap) }));
    label = `${opts.sector} (cap-weighted price return)`;
  }
  const a = periodReturns(series, opts.date);
  const b = periodReturns(bseries, opts.date);
  return { subject: label, benchmark: { code: opts.benchmark, name: bench.name, type: bench.kind === 'total_return' ? 'Total return' : 'Price return' }, periods: PERIODS.map((p) => ({ key: p.key, subject: a[p.key], benchmark: b[p.key], difference_pp: a[p.key] !== null && b[p.key] !== null ? a[p.key]! - b[p.key]! : null })), note: bench.kind === 'price' ? 'Benchmark is a price-return index; dividends are excluded on both sides.' : 'Benchmark is a total-return index; the subject series is price return, so the comparison understates the subject by its dividend yield.' };
}

/** Similar past sessions (MKT-06, Should): Euclidean distance on standardised return, breadth and volatility. */
export async function similarSessions(db: Db, date: string, forwardAllowed: boolean, k = 5) {
  const rows = await db.query<{ trade_date: string; pct_above_50dma: number | null; realised_vol_20d: number | null; ret: number | null }>(
    `SELECT m.trade_date, m.pct_above_50dma, m.realised_vol_20d, (l.close / lag(l.close) OVER (ORDER BY l.trade_date) - 1) AS ret
       FROM calc.market_daily m JOIN market.index_levels l ON l.index_code='DEMO500' AND l.trade_date=m.trade_date WHERE m.universe_code='COVERED' ORDER BY m.trade_date`,
  );
  const usable = rows.filter((r) => r.pct_above_50dma !== null && r.realised_vol_20d !== null && r.ret !== null) as { trade_date: string; pct_above_50dma: number; realised_vol_20d: number; ret: number }[];
  const target = usable.find((r) => r.trade_date === date);
  if (!target) return null;
  const stats = (f: (r: (typeof usable)[number]) => number) => {
    const v = usable.map(f);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return { m, s: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1 };
  };
  const sr = stats((r) => r.ret);
  const sb = stats((r) => r.pct_above_50dma);
  const sv = stats((r) => r.realised_vol_20d);
  const z = (r: (typeof usable)[number]) => [(r.ret - sr.m) / sr.s, (r.pct_above_50dma - sb.m) / sb.s, (r.realised_vol_20d - sv.m) / sv.s];
  const t = z(target);
  const candidates = usable
    .filter((r) => r.trade_date < date && Date.parse(date) - Date.parse(r.trade_date) > 30 * 86_400_000)
    .map((r) => ({ r, d: Math.sqrt(z(r).reduce((s, x, i) => s + (x - t[i]!) ** 2, 0)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(3, Math.min(10, k)));
  return {
    date,
    measure: 'Euclidean distance between standardised (z-score) values of the broad-index 1-day return, share of the universe above its 50-day average and 20-day realised volatility; sessions within 30 days excluded.',
    label: 'Descriptive analogues only. What happened after these sessions is not shown (legal-gated).',
    forward_returns_shown: forwardAllowed,
    analogues: candidates.map((c) => ({ trade_date: c.r.trade_date, distance: c.d, index_return_pct: c.r.ret * 100, pct_above_50dma: c.r.pct_above_50dma, realised_vol_20d_pct: c.r.realised_vol_20d * 100 })),
  };
}

export async function calendar(db: Db, from: string, to: string, companyIds?: string[]) {
  return db.query(
    `SELECT e.event_date, e.kind, e.title, e.status, e.company_id, s.provider AS source, e.updated_at FROM ref.calendar_events e JOIN ref.sources s USING (source_id)
      WHERE e.event_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR e.kind <> 'results' OR e.company_id = ANY($3)) ORDER BY e.event_date, e.kind`,
    [from, to, companyIds ?? null],
  );
}
