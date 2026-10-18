import type { Db } from '../../db/db.js';
import { badRequest } from '../../lib/http.js';
import { computeAdjusted, type ActionRow, type RawBar } from '../../pipeline/calc/adjust.js';
import type { SecurityData } from './engine.js';

// Snapshot-consistent data for backtests (ADR-006, PRD BKT-09, BKT-10). Everything is loaded as it
// was known at the snapshot: prices up to its as-of date with later vendor revisions reverted, and
// only corporate actions announced before the snapshot was taken.

export interface Snapshot {
  snapshot_id: string;
  as_of_date: string;
  created_at: string;
  label: string;
}

export async function latestSnapshot(db: Db): Promise<Snapshot | undefined> {
  return db.maybeOne<Snapshot>(`SELECT snapshot_id, as_of_date, created_at, label FROM calc.data_snapshots ORDER BY created_at DESC LIMIT 1`);
}

export async function getSnapshot(db: Db, id: string): Promise<Snapshot | undefined> {
  return db.maybeOne<Snapshot>(`SELECT snapshot_id, as_of_date, created_at, label FROM calc.data_snapshots WHERE snapshot_id=$1`, [id]);
}

export async function tradingCalendar(db: Db, from: string, to: string): Promise<string[]> {
  return (await db.query<{ trade_date: string }>(`SELECT trade_date FROM ref.trading_calendar WHERE exchange_code='NSE' AND is_trading_day AND trade_date BETWEEN $1 AND $2 ORDER BY trade_date`, [from, to])).map((r) => r.trade_date);
}

export async function loadSecurities(db: Db, ids: number[], calendar: string[], snap: Snapshot): Promise<Map<number, SecurityData>> {
  const out = new Map<number, SecurityData>();
  if (!ids.length) return out;
  const pos = new Map(calendar.map((d, i) => [d, i]));
  const bars = await db.query<RawBar & { security_id: number }>(
    `SELECT security_id, trade_date, open, high, low, close, volume, traded_value FROM market.price_eod
      WHERE security_id = ANY($1::bigint[]) AND exchange_code='NSE' AND trade_date <= $2 AND quality_status <> 'quarantined' ORDER BY security_id, trade_date`,
    [ids, snap.as_of_date],
  );
  const revisions = await db.query<{ security_id: number; trade_date: string; previous: RawBar }>(
    `SELECT security_id, trade_date, previous FROM market.price_revisions WHERE security_id = ANY($1::bigint[]) AND revised_at > $2 ORDER BY revised_at DESC`,
    [ids, snap.created_at],
  );
  const actions = await db.query<ActionRow & { security_id: number }>(
    `SELECT security_id, action_id, action_type, ex_date, ratio_num, ratio_den, cash_amount, subscription_price, adj_factor FROM market.corporate_actions WHERE security_id = ANY($1::bigint[]) AND announced_at <= $2 AND status <> 'provisional'`,
    [ids, snap.created_at],
  );
  const meta = await db.query<{ security_id: number; symbol: string | null; delisted_on: string | null }>(
    `SELECT s.security_id, s.delisted_on, (SELECT symbol FROM ref.security_identifiers i WHERE i.security_id=s.security_id AND i.exchange_code='NSE' ORDER BY valid_from DESC LIMIT 1) AS symbol FROM ref.securities s WHERE s.security_id = ANY($1::bigint[])`,
    [ids],
  );
  const bySec = new Map<number, RawBar[]>();
  for (const b of bars) {
    const l = bySec.get(b.security_id);
    if (l) l.push(b);
    else bySec.set(b.security_id, [b]);
  }
  for (const rv of revisions) {
    const l = bySec.get(rv.security_id);
    const i = l?.findIndex((b) => b.trade_date === rv.trade_date) ?? -1;
    if (l && i >= 0) l[i] = { ...l[i]!, open: Number(rv.previous.open), high: Number(rv.previous.high), low: Number(rv.previous.low), close: Number(rv.previous.close), volume: Number(rv.previous.volume), traded_value: Number(rv.previous.traded_value) };
  }
  for (const id of ids) {
    const raw = bySec.get(id) ?? [];
    const m = meta.find((x) => x.security_id === id);
    const n = calendar.length;
    const sd: SecurityData = { id, symbol: m?.symbol ?? String(id), open: new Float64Array(n).fill(Number.NaN), close: new Float64Array(n).fill(Number.NaN), dividend: new Float64Array(n), adv: new Float64Array(n).fill(Number.NaN), firstIdx: -1, lastIdx: -1, delisted: !!m?.delisted_on && m.delisted_on <= snap.as_of_date };
    if (raw.length) {
      const acts = actions.filter((a) => a.security_id === id);
      const { bars: adj } = computeAdjusted(raw, acts);
      const cumByDate = new Map(adj.map((a) => [a.trade_date, a.cum_factor]));
      // 20-session average traded value over the security's own sessions.
      let sum = 0;
      const tv = raw.map((b) => b.traded_value);
      raw.forEach((b, k) => {
        sum += tv[k]!;
        if (k >= 20) sum -= tv[k - 20]!;
        const ci = pos.get(b.trade_date);
        if (ci === undefined) return;
        const a = adj[k]!;
        sd.open[ci] = a.adj_open;
        sd.close[ci] = a.adj_close;
        if (k >= 19) sd.adv[ci] = sum / 20;
        if (sd.firstIdx < 0) sd.firstIdx = ci;
        sd.lastIdx = ci;
      });
      for (const a of acts) {
        if (a.action_type !== 'dividend' || !a.cash_amount) continue;
        const ci = pos.get(a.ex_date);
        const cum = cumByDate.get(a.ex_date);
        if (ci !== undefined && cum !== undefined) sd.dividend[ci] = a.cash_amount * cum;
      }
      // A delisted security's last session must be its true last trade, not merely the calendar end.
      if (sd.delisted) sd.lastIdx = Math.max(-1, sd.lastIdx);
      else if (sd.lastIdx === n - 1) sd.lastIdx = n - 1;
    }
    out.set(id, sd);
  }
  return out;
}

/** Point-in-time index constituents per calendar date (BKT-03). */
export async function indexUniverse(db: Db, indexCode: string, calendar: string[], snap: Snapshot): Promise<{ members: number[][]; all: number[]; delistedInUniverse: number }> {
  const rows = await db.query<{ security_id: number; effective_from: string; effective_to: string | null; delisted_on: string | null }>(
    `SELECT c.security_id, c.effective_from, c.effective_to, s.delisted_on FROM ref.index_constituents c JOIN ref.securities s USING (security_id) WHERE c.index_code=$1 AND c.effective_from <= $2`,
    [indexCode, snap.as_of_date],
  );
  if (!rows.length) throw badRequest(`No point-in-time constituents are available for ${indexCode}.`);
  const members = calendar.map((d) => rows.filter((r) => r.effective_from <= d && (r.effective_to === null || d < r.effective_to)).map((r) => r.security_id).sort((a, b) => a - b));
  const all = [...new Set(rows.map((r) => r.security_id))].sort((a, b) => a - b);
  const delistedInUniverse = new Set(rows.filter((r) => r.delisted_on && r.delisted_on <= snap.as_of_date && calendar.some((d) => r.effective_from <= d && (r.effective_to === null || d < r.effective_to))).map((r) => r.security_id)).size;
  return { members, all, delistedInUniverse };
}

/** Fields a saved screen may use in a point-in-time universe (values known at each rebalance date). */
export const PIT_SCREEN_FIELDS: Record<string, string> = {
  market_cap: 'market_cap_cr', pe_ttm: 'pe_ttm', pb: 'pb', ev_ebitda: 'ev_ebitda', dividend_yield: 'dividend_yield', rsi_14: 'rsi_14', volatility_20d: 'vol_20d', adv_20d: 'adv_20d',
};
export const PIT_FUNDAMENTAL_FIELDS = ['roe', 'roce', 'roa', 'debt_equity', 'interest_coverage', 'receivable_days', 'cash_conversion', 'revenue_growth_yoy', 'net_profit_growth_yoy', 'operating_margin', 'net_margin', 'revenue_cagr_3y', 'free_cash_flow', 'gnpa_pct', 'capital_adequacy', 'nim'];

/** Evaluate a saved screen at each month-end using only data available then. */
export async function screenUniverse(db: Db, definition: { filters: { field: string; op: string; value: number; value2?: number }[]; sectors?: string[] }, calendar: string[], snap: Snapshot): Promise<{ members: number[][]; all: number[]; delistedInUniverse: number }> {
  for (const f of definition.filters) {
    if (!PIT_SCREEN_FIELDS[f.field] && !PIT_FUNDAMENTAL_FIELDS.includes(f.field)) throw badRequest(`The field ${f.field} cannot be evaluated point-in-time in a backtest universe. Supported: ${[...Object.keys(PIT_SCREEN_FIELDS), ...PIT_FUNDAMENTAL_FIELDS].join(', ')}.`);
  }
  const monthEnds = calendar.filter((d, i) => i === calendar.length - 1 || calendar[i + 1]!.slice(0, 7) !== d.slice(0, 7));
  const secs = await db.query<{ security_id: number; company_id: string; sector: string; delisted_on: string | null }>(`SELECT s.security_id, s.company_id, c.sector, s.delisted_on FROM ref.securities s JOIN ref.companies c USING (company_id) WHERE c.coverage='full'`);
  const eligible = secs.filter((s) => !definition.sectors?.length || definition.sectors.includes(s.sector));
  const byDate = new Map<string, number[]>();
  for (const me of monthEnds) {
    const daily = await db.query<Record<string, number | null> & { security_id: number }>(`SELECT * FROM calc.security_daily WHERE trade_date=$1 AND security_id = ANY($2::bigint[])`, [me, eligible.map((e) => e.security_id)]);
    const fundFields = definition.filters.filter((f) => PIT_FUNDAMENTAL_FIELDS.includes(f.field)).map((f) => f.field);
    const fund = fundFields.length
      ? await db.query<{ entity_id: string; metric_code: string; value: number | null }>(
          `SELECT DISTINCT ON (entity_id, metric_code) entity_id, metric_code, value FROM calc.metric_values
            WHERE metric_code = ANY($1::text[]) AND period_key ~ '^(FY\\d\\d(@v\\d)?)$' AND available_at <= $2 AND available_at <= $3 ORDER BY entity_id, metric_code, period_end DESC, available_at DESC`,
          [fundFields, `${me}T10:00:00Z`, snap.created_at],
        )
      : [];
    const pass = (v: number | null | undefined, f: { op: string; value: number; value2?: number }) => {
      if (v === null || v === undefined) return false;
      switch (f.op) {
        case 'gt': return v > f.value;
        case 'gte': return v >= f.value;
        case 'lt': return v < f.value;
        case 'lte': return v <= f.value;
        case 'eq': return v === f.value;
        case 'between': return v >= Math.min(f.value, f.value2!) && v <= Math.max(f.value, f.value2!);
        default: return false;
      }
    };
    const members = eligible.filter((s) => {
      const d = daily.find((x) => x.security_id === s.security_id);
      if (!d) return false;
      return definition.filters.every((f) => {
        if (PIT_SCREEN_FIELDS[f.field]) {
          let v = d[PIT_SCREEN_FIELDS[f.field]!] as number | null;
          if (f.field === 'volatility_20d' && v !== null) v *= 100;
          if (f.field === 'adv_20d' && v !== null) v /= 1e7;
          return pass(v, f);
        }
        return pass(fund.find((x) => x.entity_id === s.company_id && x.metric_code === f.field)?.value, f);
      });
    }).map((s) => s.security_id);
    byDate.set(me, members);
  }
  let current: number[] = [];
  const members = calendar.map((d) => {
    if (byDate.has(d)) current = byDate.get(d)!;
    return current;
  });
  const all = [...new Set(members.flat())].sort((a, b) => a - b);
  const delistedInUniverse = secs.filter((s) => all.includes(s.security_id) && s.delisted_on && s.delisted_on <= snap.as_of_date).length;
  return { members, all, delistedInUniverse };
}

export async function benchmarkSeries(db: Db, code: string, calendar: string[]): Promise<number[]> {
  const rows = await db.query<{ trade_date: string; close: number }>(`SELECT trade_date, close FROM market.index_levels WHERE index_code=$1 AND trade_date BETWEEN $2 AND $3 ORDER BY trade_date`, [code, calendar[0], calendar[calendar.length - 1]]);
  const m = new Map(rows.map((r) => [r.trade_date, r.close]));
  let last = rows[0]?.close ?? 1;
  return calendar.map((d) => {
    const v = m.get(d);
    if (v !== undefined) last = v;
    return last;
  });
}

export async function riskFreeDaily(db: Db, calendar: string[]): Promise<number[]> {
  const rows = await db.query<{ auction_date: string; yield_pct: number }>(`SELECT auction_date, yield_pct FROM ref.risk_free_rates WHERE auction_date <= $1 ORDER BY auction_date`, [calendar[calendar.length - 1]]);
  let k = 0;
  let cur = rows[0]?.yield_pct ?? 6;
  return calendar.map((d) => {
    while (k < rows.length && rows[k]!.auction_date <= d) cur = rows[k++]!.yield_pct;
    return cur / 100 / 252;
  });
}

export async function regimeLabelsByDate(db: Db, from: string, to: string): Promise<Map<string, string>> {
  const rows = await db.query<{ trade_date: string; regime: { trend?: { label: string } } | null }>(`SELECT trade_date, regime FROM calc.market_daily WHERE universe_code='COVERED' AND trade_date BETWEEN $1 AND $2`, [from, to]);
  return new Map(rows.map((r) => [r.trade_date, `Trend ${r.regime?.trend?.label ?? 'Not available'}`]));
}
