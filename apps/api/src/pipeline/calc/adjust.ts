import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/db.js';
import { bulkInsert } from '../../lib/bulk.js';
import { raiseQualityIssue } from '../context.js';
import { adjustmentFactor } from '../handlers/prices.js';

// Corporate-action adjustment (Blueprint §5.4, ADR-002): raw prices are stored once; adjusted
// series are materialised in market.adjusted_price_cache and rebuilt when an action changes.
// adjusted = raw × Π(factors of actions with ex_date after the date). Dividends are not
// price-adjusted; the total-return series reinvests them at the ex-date close.

export interface RawBar { trade_date: string; open: number; high: number; low: number; close: number; volume: number; traded_value: number }
export interface ActionRow { action_id: string; action_type: string; ex_date: string; ratio_num: number | null; ratio_den: number | null; cash_amount: number | null; subscription_price: number | null; adj_factor: number | null }

export interface AdjustedBar { trade_date: string; cum_factor: number; adj_open: number; adj_high: number; adj_low: number; adj_close: number; adj_volume: number; tr_close: number }

export function computeAdjusted(bars: RawBar[], actions: ActionRow[]): { bars: AdjustedBar[]; factors: Map<string, number> } {
  const factors = new Map<string, number>(); // action_id -> factor
  const priceActions = actions.filter((a) => ['split', 'bonus', 'rights'].includes(a.action_type));
  for (const a of priceActions) {
    let f = a.adj_factor;
    if (f === null) {
      const prev = [...bars].reverse().find((b) => b.trade_date < a.ex_date);
      f = adjustmentFactor(a, prev?.close);
    }
    if (f !== null && f > 0) factors.set(a.action_id, f);
  }
  const events = priceActions.filter((a) => factors.has(a.action_id)).map((a) => ({ ex: a.ex_date, f: factors.get(a.action_id)! })).sort((x, y) => (x.ex < y.ex ? -1 : 1));
  const dividends = new Map(actions.filter((a) => a.action_type === 'dividend' && a.cash_amount).map((a) => [a.ex_date, a.cash_amount!]));
  // cumulative factor of all later events, walking backwards
  const out: AdjustedBar[] = new Array(bars.length);
  let cum = 1;
  let ei = events.length - 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]!;
    while (ei >= 0 && events[ei]!.ex > b.trade_date) {
      cum *= events[ei]!.f;
      ei--;
    }
    out[i] = { trade_date: b.trade_date, cum_factor: cum, adj_open: b.open * cum, adj_high: b.high * cum, adj_low: b.low * cum, adj_close: b.close * cum, adj_volume: b.volume / cum, tr_close: 0 };
  }
  for (let i = 0; i < out.length; i++) {
    const o = out[i]!;
    if (i === 0) {
      o.tr_close = o.adj_close;
      continue;
    }
    const p = out[i - 1]!;
    const div = (dividends.get(o.trade_date) ?? 0) * o.cum_factor;
    o.tr_close = p.tr_close * ((o.adj_close + div) / p.adj_close);
  }
  return { bars: out, factors };
}

export async function rebuildAdjusted(db: Db, opts: { securityIds?: number[]; fromDate?: string; calcRunId: string }): Promise<{ securities: number; rows: number }> {
  const secs = opts.securityIds ?? (await db.query<{ security_id: number }>(`SELECT DISTINCT security_id FROM market.price_eod`)).map((r) => r.security_id);
  let rows = 0;
  for (const sid of secs) {
    const bars = await db.query<RawBar>(
      `SELECT trade_date, open, high, low, close, volume, traded_value FROM market.price_eod WHERE security_id=$1 AND exchange_code='NSE' AND quality_status <> 'quarantined' ORDER BY trade_date`,
      [sid],
    );
    if (!bars.length) continue;
    const actions = await db.query<ActionRow>(`SELECT action_id, action_type, ex_date, ratio_num, ratio_den, cash_amount, subscription_price, adj_factor FROM market.corporate_actions WHERE security_id=$1 AND status <> 'provisional'`, [sid]);
    const { bars: adj, factors } = computeAdjusted(bars, actions);
    for (const a of actions) {
      const f = factors.get(a.action_id);
      if (f !== undefined && a.adj_factor === null) await db.query(`UPDATE market.corporate_actions SET adj_factor=$2 WHERE action_id=$1`, [a.action_id, f]);
      // Corporate-action consistency: ex-date raw price ratio should be near the factor.
      if (f !== undefined) {
        const i = bars.findIndex((b) => b.trade_date >= a.ex_date);
        if (i > 0 && bars[i]!.trade_date === a.ex_date) {
          const observed = bars[i]!.close / bars[i - 1]!.close;
          if (Math.abs(observed / f - 1) > 0.25) {
            const exists = await db.maybeOne(`SELECT 1 FROM calc.quality_issues WHERE dataset='corporate_actions' AND details->>'action_id'=$1`, [a.action_id]);
            if (!exists) await raiseQualityIssue(db, { kind: 'anomaly', severity: 'warn', dataset: 'corporate_actions', entityRef: String(sid), title: `Ex-date price ratio ${observed.toFixed(3)} inconsistent with ${a.action_type} factor ${f.toFixed(3)}`, details: { action_id: a.action_id, observed, factor: f, rule: 'ex-date price ratio within 25% of the announced factor' } });
          }
        }
      }
    }
    const write = opts.fromDate ? adj.filter((b) => b.trade_date >= opts.fromDate!) : adj;
    await db.query(`DELETE FROM market.adjusted_price_cache WHERE security_id=$1 ${opts.fromDate ? 'AND trade_date >= $2' : ''}`, opts.fromDate ? [sid, opts.fromDate] : [sid]);
    rows += await bulkInsert(db, 'market.adjusted_price_cache', write.map((b) => ({ security_id: sid, ...b, calc_run_id: opts.calcRunId })), { chunk: 5000 });
  }
  return { securities: secs.length, rows };
}

export async function startCalcRun(db: Db, kind: string, codeVersion: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO calc.calc_runs (calc_run_id, kind, code_version, status) VALUES ($1,$2,$3,'running')`, [id, kind, codeVersion]);
  return id;
}

export async function finishCalcRun(db: Db, id: string, status: 'succeeded' | 'failed', details: Record<string, unknown>): Promise<void> {
  await db.query(`UPDATE calc.calc_runs SET status=$2, finished_at=now(), details=$3 WHERE calc_run_id=$1`, [id, status, JSON.stringify(details)]);
}
