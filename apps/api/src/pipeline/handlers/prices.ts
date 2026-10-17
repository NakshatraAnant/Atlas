import { bulkInsert } from '../../lib/bulk.js';
import type { CheckResult, HandlerResult, PipelineCtx } from '../context.js';
import { raiseOpsAlert, raiseQualityIssue } from '../context.js';
import type { IndexOutput, VendorCorporateAction, VendorPrice } from '../synthetic/market.js';

// Data-quality checks for end-of-day prices (Blueprint §5.3).
export const PRICE_RULES = {
  completenessFailBelow: 0.995,
  jumpFailAbove: 0.5,
  bandWarnAbove: 0.2,
  valueTolerance: 0.05,
  coverageDriftWarn: 0.02,
};

interface SecurityRef {
  security_id: number;
  isin: string;
  listed_on: string;
  delisted_on: string | null;
}

export function validatePriceRow(p: VendorPrice, ctx: { tradingDays: Set<string>; asOf: string; actionDates: Set<string> }): { failed: string[]; warned: string[] } {
  const failed: string[] = [];
  const warned: string[] = [];
  const nums = [p.open, p.high, p.low, p.close, p.volume, p.traded_value];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) failed.push('schema');
  if (!(p.low <= p.open && p.low <= p.close && p.open <= p.high && p.close <= p.high && p.low > 0)) failed.push('ohlc_integrity');
  if (p.volume < 0) failed.push('ohlc_integrity');
  if (p.volume > 0) {
    const avg = (p.high + p.low + p.close) / 3;
    const implied = p.volume * avg;
    if (Math.abs(p.traded_value - implied) / implied > PRICE_RULES.valueTolerance) failed.push('value_consistency');
  }
  if (!ctx.tradingDays.has(p.date) || p.date > ctx.asOf) failed.push('timestamp_sanity');
  if (p.prev_close && p.prev_close > 0) {
    const jump = Math.abs(p.close / p.prev_close - 1);
    const explained = ctx.actionDates.has(`${p.isin}|${p.date}`);
    if (!explained && jump > PRICE_RULES.jumpFailAbove) failed.push('price_jump');
    else if (!explained && jump > PRICE_RULES.bandWarnAbove) warned.push('price_band');
  }
  return { failed: [...new Set(failed)], warned };
}

export async function handlePrices(ctx: PipelineCtx, records: VendorPrice[], meta: { sourceId: string; runId: string; asOf: string; mode: 'history' | 'daily' }): Promise<HandlerResult> {
  const db = ctx.db;
  const secs = await db.query<SecurityRef>(`SELECT security_id, isin, listed_on, delisted_on FROM ref.securities s JOIN ref.companies c USING (company_id) WHERE c.coverage = 'full'`);
  const byIsin = new Map(secs.map((s) => [s.isin, s]));
  const ids = await db.query<{ security_id: number; symbol: string; valid_from: string; valid_to: string | null }>(`SELECT security_id, symbol, valid_from, valid_to FROM ref.security_identifiers WHERE exchange_code = 'NSE'`);
  const idsBySec = new Map<number, typeof ids>();
  for (const i of ids) idsBySec.set(i.security_id, [...(idsBySec.get(i.security_id) ?? []), i]);
  const days = await db.query<{ trade_date: string }>(`SELECT trade_date FROM ref.trading_calendar WHERE exchange_code='NSE' AND is_trading_day`);
  const tradingDays = new Set(days.map((d) => d.trade_date));
  const actions = await db.query<{ isin: string; ex_date: string }>(`SELECT s.isin, a.ex_date FROM market.corporate_actions a JOIN ref.securities s USING (security_id) WHERE a.action_type IN ('split','bonus','rights','demerger')`);
  const actionDates = new Set(actions.map((a) => `${a.isin}|${a.ex_date}`));

  const checks: CheckResult[] = [];
  const valid: Record<string, unknown>[] = [];
  const quarantine: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let warnedRows = 0;
  const failCounts = new Map<string, number>();
  const receivedByDate = new Map<string, Set<number>>();
  const affected = new Set<number>();

  for (const p of records) {
    const key = `${p.isin}|${p.date}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    const sec = byIsin.get(p.isin);
    const failed: string[] = [];
    let warned: string[] = [];
    if (!sec) failed.push('identifier_continuity');
    else {
      const sym = (idsBySec.get(sec.security_id) ?? []).find((i) => i.valid_from <= p.date && (!i.valid_to || p.date < i.valid_to));
      if (!sym || sym.symbol !== p.symbol) failed.push('identifier_continuity');
      const set = receivedByDate.get(p.date) ?? new Set<number>();
      set.add(sec.security_id);
      receivedByDate.set(p.date, set);
    }
    const v = validatePriceRow(p, { tradingDays, asOf: meta.asOf, actionDates });
    failed.push(...v.failed);
    warned = v.warned;
    if (failed.length) {
      for (const f of new Set(failed)) failCounts.set(f, (failCounts.get(f) ?? 0) + 1);
      quarantine.push({ ingestion_run_id: meta.runId, raw: p, failed_checks: `{${[...new Set(failed)].join(',')}}` });
      continue;
    }
    if (warned.length) warnedRows++;
    affected.add(sec!.security_id);
    valid.push({
      security_id: sec!.security_id, exchange_code: 'NSE', trade_date: p.date, open: p.open, high: p.high, low: p.low, close: p.close, prev_close: p.prev_close,
      volume: p.volume, trades: p.trades, delivery_qty: p.delivery_qty, traded_value: p.traded_value, source_id: meta.sourceId, ingestion_run_id: meta.runId,
      quality_status: warned.length ? 'warned' : 'validated',
    });
  }

  // Completeness: securities received ÷ securities expected, per trading date in the file.
  let worst = 1;
  let worstDate: string | null = null;
  for (const [date, got] of receivedByDate) {
    const expected = secs.filter((s) => s.listed_on <= date && (!s.delisted_on || date <= s.delisted_on)).length;
    const ratio = expected ? got.size / expected : 1;
    if (ratio < worst) {
      worst = ratio;
      worstDate = date;
    }
  }
  if (meta.mode === 'daily' && receivedByDate.size === 0) worst = 0;
  const completenessFail = worst < PRICE_RULES.completenessFailBelow;
  checks.push({ check: 'completeness', severity: completenessFail ? 'fail' : 'pass', detail: `lowest securities received ÷ expected = ${(worst * 100).toFixed(2)}%${worstDate ? ` on ${worstDate}` : ''} (fail below 99.5%)` });
  checks.push({ check: 'duplicates', severity: duplicates ? 'fail' : 'pass', detail: `${duplicates} duplicate rows dropped`, count: duplicates });
  for (const name of ['schema', 'ohlc_integrity', 'value_consistency', 'price_jump', 'timestamp_sanity', 'identifier_continuity']) {
    const n = failCounts.get(name) ?? 0;
    checks.push({ check: name, severity: n ? 'fail' : 'pass', detail: `${n} rows quarantined`, count: n });
  }
  checks.push({ check: 'price_band', severity: warnedRows ? 'warn' : 'pass', detail: `${warnedRows} rows beyond the 20% band without a corporate action`, count: warnedRows });

  if (meta.mode === 'daily') {
    const prev = await db.maybeOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM market.price_eod WHERE trade_date = (SELECT max(trade_date) FROM market.price_eod WHERE trade_date < $1)`,
      [meta.asOf],
    );
    if (prev && prev.n > 0) {
      const drift = Math.abs(valid.length - prev.n) / prev.n;
      checks.push({ check: 'coverage_drift', severity: drift > PRICE_RULES.coverageDriftWarn ? 'warn' : 'pass', detail: `row count ${valid.length} vs ${prev.n} on the previous session (${(drift * 100).toFixed(2)}%)` });
    }
  }

  if (completenessFail) {
    await raiseOpsAlert(db, { kind: 'dataset_blocked', severity: 'SEV2', message: `End-of-day prices for ${meta.asOf} blocked: completeness ${(worst * 100).toFixed(2)}%`, dedupeKey: `prices-blocked-${meta.asOf}` });
    return { rowsIn: records.length, rowsValid: 0, rowsQuarantined: records.length, checks, status: 'blocked' };
  }

  await db.tx(async (t) => {
    if (meta.mode === 'daily' && valid.length) {
      // Vendor corrections: keep the previous value in price_revisions (values are never silently overwritten).
      const existing = await t.query<Record<string, unknown> & { security_id: number; trade_date: string; close: number }>(
        `SELECT * FROM market.price_eod WHERE trade_date = ANY($1::date[])`,
        [[...new Set(valid.map((v) => v.trade_date as string))]],
      );
      const ex = new Map(existing.map((e) => [`${e.security_id}|${e.trade_date}`, e]));
      for (const v of valid) {
        const prior = ex.get(`${v.security_id}|${v.trade_date}`);
        if (prior && Number(prior.close) !== Number(v.close)) {
          await t.query(`INSERT INTO market.price_revisions (security_id, trade_date, previous, revised, ingestion_run_id) VALUES ($1,$2,$3,$4,$5)`, [v.security_id, v.trade_date, JSON.stringify(prior), JSON.stringify(v), meta.runId]);
          await t.query(`DELETE FROM market.price_eod WHERE security_id=$1 AND exchange_code='NSE' AND trade_date=$2`, [v.security_id, v.trade_date]);
        }
      }
    }
    await bulkInsert(t, 'market.price_eod', valid, { onConflict: 'ON CONFLICT (security_id, exchange_code, trade_date) DO NOTHING' });
    if (quarantine.length) {
      await bulkInsert(t, 'market.price_quarantine', quarantine);
      await raiseQualityIssue(t, {
        kind: 'quarantine', severity: 'fail', dataset: 'eod_prices', entityRef: meta.asOf,
        title: `${quarantine.length} price row(s) quarantined in the ${meta.asOf} ${meta.mode} file`,
        details: { run_id: meta.runId, failed: Object.fromEntries(failCounts), sample: quarantine.slice(0, 5).map((q) => q.raw) },
      });
    }
  });
  return { rowsIn: records.length, rowsValid: valid.length, rowsQuarantined: quarantine.length, checks, status: quarantine.length ? 'partial' : 'succeeded', affected: { securities: [...affected] } };
}

/** Adjustment factor for one action (Blueprint §5.4). Returns null when the factor depends on a price not yet known. */
export function adjustmentFactor(a: { action_type: string; ratio_num: number | null; ratio_den: number | null; subscription_price: number | null }, cumClose?: number): number | null {
  switch (a.action_type) {
    case 'split':
      // ratio_num new shares for ratio_den old: factor = old ÷ new
      return a.ratio_num && a.ratio_den ? a.ratio_den / a.ratio_num : null;
    case 'bonus':
      // ratio_num bonus shares for every ratio_den held: factor = old ÷ (old + new)
      return a.ratio_num && a.ratio_den ? a.ratio_den / (a.ratio_den + a.ratio_num) : null;
    case 'rights': {
      if (!cumClose || !a.ratio_num || !a.ratio_den || a.subscription_price === null) return null;
      const terp = (a.ratio_den * cumClose + a.ratio_num * a.subscription_price) / (a.ratio_den + a.ratio_num);
      return terp / cumClose;
    }
    default:
      return null;
  }
}

export async function handleCorporateActions(ctx: PipelineCtx, records: VendorCorporateAction[], meta: { sourceId: string; runId: string }): Promise<HandlerResult> {
  const secs = new Map((await ctx.db.query<{ isin: string; security_id: number }>(`SELECT isin, security_id FROM ref.securities`)).map((s) => [s.isin, s.security_id]));
  let valid = 0;
  let bad = 0;
  const affected = new Set<number>();
  const checks: CheckResult[] = [];
  await ctx.db.tx(async (db) => {
    for (const a of records) {
      const sid = secs.get(a.isin);
      if (!sid) {
        bad++;
        continue;
      }
      if ((a.action_type === 'split' || a.action_type === 'bonus') && (!a.ratio_num || !a.ratio_den || a.ratio_num <= 0 || a.ratio_den <= 0)) {
        bad++;
        checks.push({ check: 'ranges_and_signs', severity: 'fail', detail: `${a.isin} ${a.action_type} has an invalid ratio` });
        continue;
      }
      const factor = adjustmentFactor(a);
      const res = await db.query(
        `INSERT INTO market.corporate_actions (security_id, action_type, announced_at, ex_date, record_date, ratio_num, ratio_den, cash_amount, subscription_price, adj_factor, status, version, source_id, ingestion_run_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed',1,$11,$12,$13) ON CONFLICT (security_id, action_type, ex_date, version) DO NOTHING RETURNING action_id`,
        [sid, a.action_type, a.announced_at, a.ex_date, a.record_date, a.ratio_num, a.ratio_den, a.cash_amount, a.subscription_price, factor, meta.sourceId, meta.runId, a.notes],
      );
      if (res.length) {
        valid++;
        affected.add(sid);
      }
      if (a.action_type === 'delisting' || a.action_type === 'merger') {
        await db.query(`UPDATE ref.securities SET delisted_on = COALESCE(delisted_on, $2) WHERE security_id = $1`, [sid, a.ex_date]);
      }
    }
  });
  checks.unshift({ check: 'identifier_continuity', severity: bad ? 'fail' : 'pass', detail: `${bad} actions not mapped or invalid` });
  return { rowsIn: records.length, rowsValid: valid, rowsQuarantined: bad, checks, status: bad ? 'partial' : 'succeeded', affected: { securities: [...affected] } };
}

type IndexRecord = { kind: 'definitions'; rows: IndexOutput['definitions'] } | { kind: 'constituents'; rows: IndexOutput['constituents'] } | { kind: 'levels'; rows: IndexOutput['levels'] };

export async function handleIndex(ctx: PipelineCtx, records: IndexRecord[], meta: { sourceId: string; isSynthetic: boolean }): Promise<HandlerResult> {
  const db = ctx.db;
  const secs = new Map((await db.query<{ isin: string; security_id: number }>(`SELECT isin, security_id FROM ref.securities`)).map((s) => [s.isin, s.security_id]));
  let n = 0;
  let bad = 0;
  for (const rec of records) {
    if (rec.kind === 'definitions') {
      for (const d of rec.rows) {
        await db.query(
          `INSERT INTO ref.index_definitions (index_code, name, kind, universe_size_class, base_date, base_value, source_id, is_synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (index_code) DO UPDATE SET name = EXCLUDED.name`,
          [d.index_code, d.name, d.kind, d.universe_size_class, d.base_date, d.base_value, meta.sourceId, meta.isSynthetic],
        );
        n++;
      }
    } else if (rec.kind === 'constituents') {
      const rows = rec.rows.flatMap((c) => {
        const sid = secs.get(c.isin);
        if (!sid) {
          bad++;
          return [];
        }
        return [{ index_code: c.index_code, security_id: sid, effective_from: c.effective_from, effective_to: c.effective_to, source_id: meta.sourceId }];
      });
      for (let i = 0; i < rows.length; i += 4000) {
        await db.query(
          `INSERT INTO ref.index_constituents (index_code, security_id, effective_from, effective_to, source_id)
           SELECT index_code, security_id, effective_from, effective_to, source_id FROM json_populate_recordset(NULL::ref.index_constituents, $1::json)
           ON CONFLICT (index_code, security_id, effective_from) DO UPDATE SET effective_to = EXCLUDED.effective_to`,
          [JSON.stringify(rows.slice(i, i + 4000))],
        );
      }
      n += rows.length;
    } else {
      const rows = rec.rows.filter((l) => l.close > 0).map((l) => ({ index_code: l.index_code, trade_date: l.date, close: l.close, source_id: meta.sourceId, quality_status: 'validated' }));
      bad += rec.rows.length - rows.length;
      n += await bulkInsert(db, 'market.index_levels', rows, { onConflict: 'ON CONFLICT (index_code, trade_date) DO NOTHING' });
    }
  }
  const total = records.reduce((s, r) => s + r.rows.length, 0);
  return { rowsIn: total, rowsValid: n, rowsQuarantined: bad, checks: [{ check: 'identifier_continuity', severity: bad ? 'fail' : 'pass', detail: `${bad} rows unmapped or invalid` }], status: bad ? 'partial' : 'succeeded' };
}
