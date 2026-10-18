import type { Db } from '../../db/db.js';

// Indian equity delivery cost model (PRD BKT-04). Versioned; every report states the version.
// The default values below are PLANNING DEFAULTS that must be verified against the current
// exchange, SEBI, stamp-duty and GST schedules before release (BLOCKERS.md B-BKT-01); the table
// is stored with verified_against_current_schedules = false until a reviewer records verification.

export interface CostTable {
  version: string;
  brokerage_pct: number; // of trade value, both sides (user-adjustable)
  brokerage_cap_inr: number | null; // per order
  stt_pct_buy: number;
  stt_pct_sell: number;
  exchange_txn_pct: number;
  sebi_fee_pct: number;
  stamp_duty_pct_buy: number;
  gst_pct_on_fees: number; // GST on brokerage + exchange + SEBI fee
  dp_charge_per_sell_inr: number;
}

export const DEFAULT_COST_TABLE: CostTable = {
  version: 'IN-EQ-DELIVERY-2026Q4-DRAFT',
  brokerage_pct: 0,
  brokerage_cap_inr: 20,
  stt_pct_buy: 0.001,
  stt_pct_sell: 0.001,
  exchange_txn_pct: 0.0000297,
  sebi_fee_pct: 0.000001,
  stamp_duty_pct_buy: 0.00015,
  gst_pct_on_fees: 0.18,
  dp_charge_per_sell_inr: 15.93,
};

export interface TradeCosts {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  gst: number;
  dp: number;
  slippage: number;
  total: number;
}

export function tradeCosts(side: 'buy' | 'sell', value: number, slippageValue: number, t: CostTable, multiplier = 1): TradeCosts {
  const v = Math.abs(value);
  let brokerage = v * t.brokerage_pct;
  if (t.brokerage_cap_inr !== null && t.brokerage_pct > 0) brokerage = Math.min(brokerage, t.brokerage_cap_inr);
  const stt = v * (side === 'buy' ? t.stt_pct_buy : t.stt_pct_sell);
  const exchange = v * t.exchange_txn_pct;
  const sebi = v * t.sebi_fee_pct;
  const stamp = side === 'buy' ? v * t.stamp_duty_pct_buy : 0;
  const gst = (brokerage + exchange + sebi) * t.gst_pct_on_fees;
  const dp = side === 'sell' ? t.dp_charge_per_sell_inr : 0;
  const c = { brokerage, stt, exchange, sebi, stamp, gst, dp, slippage: Math.abs(slippageValue) };
  const m = (x: number) => x * multiplier;
  const out = { brokerage: m(c.brokerage), stt: m(c.stt), exchange: m(c.exchange), sebi: m(c.sebi), stamp: m(c.stamp), gst: m(c.gst), dp: m(c.dp), slippage: m(c.slippage), total: 0 };
  out.total = out.brokerage + out.stt + out.exchange + out.sebi + out.stamp + out.gst + out.dp + out.slippage;
  return out;
}

export const ZERO_COSTS: CostTable = { ...DEFAULT_COST_TABLE, version: 'ZERO-COSTS', brokerage_pct: 0, stt_pct_buy: 0, stt_pct_sell: 0, exchange_txn_pct: 0, sebi_fee_pct: 0, stamp_duty_pct_buy: 0, gst_pct_on_fees: 0, dp_charge_per_sell_inr: 0 };

export async function seedCostTables(db: Db): Promise<void> {
  await db.query(
    `INSERT INTO bt.cost_tables (version, effective_from, components, verified_against_current_schedules, notes) VALUES ($1,'2026-10-01',$2,false,$3) ON CONFLICT (version) DO NOTHING`,
    [DEFAULT_COST_TABLE.version, JSON.stringify(DEFAULT_COST_TABLE), 'Planning defaults for Indian equity delivery trades: STT 0.1% each side, NSE transaction charge 0.00297%, SEBI fee ₹10 per crore, stamp duty 0.015% on buys, GST 18% on brokerage and exchange/SEBI fees, DP charge per sell. Brokerage defaults to zero (discount delivery) and is user-adjustable. Must be verified against current schedules before release and reviewed quarterly (BKT-04).'],
  );
  await db.query(`INSERT INTO bt.cost_tables (version, effective_from, components, verified_against_current_schedules, notes) VALUES ('ZERO-COSTS','2000-01-01',$1,true,'Explicit costs-excluded toggle; reports are watermarked "Costs excluded".') ON CONFLICT (version) DO NOTHING`, [JSON.stringify(ZERO_COSTS)]);
}
