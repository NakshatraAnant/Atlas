import { createHash } from 'node:crypto';
import type { Db } from '../../db/db.js';
import { bulkInsert } from '../../lib/bulk.js';
import { addDays } from '../../lib/dates.js';
import { METRIC_BY_CODE } from '../../modules/calc/definitions.js';
import * as R from '../../modules/calc/ratios.js';
import { lastFourQuarters, loadPit, sumItem, type PeriodValues } from '../../modules/fundamentals/pit.js';

// Fundamental, valuation, technical and ownership metrics → calc.metric_values with full input
// references (provenance: which filed values, which versions). LATEST rows feed the screener.

interface Ref {
  kind: 'fv' | 'sd' | 'sh' | 'ix' | 'mv';
  id: string;
  label: string;
  value: number | null;
}

export interface MetricRow {
  entity_type: 'company';
  entity_id: string;
  metric_code: string;
  period_key: string;
  definition_version: number;
  basis: string;
  value: number | null;
  missing_reason: R.Missing | null;
  unit: string;
  as_of_date: string;
  period_end: string | null;
  available_at: string;
  inputs_hash: string;
  input_refs: Ref[];
  calc_run_id: string;
  quality_status: 'validated' | 'conflict';
}

const fq = (p: PeriodValues) => (p.period_type === 'FY' ? `FY${String(p.fiscal_year % 100).padStart(2, '0')}` : `Q${p.fiscal_quarter}FY${String(p.fiscal_year % 100).padStart(2, '0')}`);
const fvRef = (p: PeriodValues, code: string): Ref => ({ kind: 'fv', id: `fv.${p.period_id}.${code}`, label: `${code} ${fq(p)} (${p.basis}, v${p.version})`, value: p.values.get(code) ?? null });
const input = (p: PeriodValues | undefined, code: string): R.Input => {
  if (!p) return { missing: 'not_available' };
  const m = p.missing.get(code);
  if (m) return { missing: m };
  return p.values.get(code);
};

export function hashRefs(refs: Ref[]): string {
  return createHash('sha256').update(JSON.stringify(refs.map((r) => [r.id, r.value]))).digest('hex').slice(0, 32);
}

interface Ctx {
  companyId: string;
  template: string;
  basis: string;
  asOf: string;
  calcRunId: string;
  out: MetricRow[];
}

function emit(ctx: Ctx, code: string, periodKey: string, result: R.MetricResult, refs: Ref[], periodEnd: string | null, availableAt: string, conflict = false): void {
  const def = METRIC_BY_CODE.get(code);
  if (!def) throw new Error(`Metric ${code} has no published definition (MTH-01)`);
  let r = result;
  if (!def.templates.includes(ctx.template as never)) r = R.miss('not_meaningful');
  ctx.out.push({
    entity_type: 'company', entity_id: ctx.companyId, metric_code: code, period_key: periodKey, definition_version: def.version, basis: ctx.basis,
    value: R.isMissing(r) ? null : Number(r.value.toFixed(8)), missing_reason: R.isMissing(r) ? r.missing : null, unit: def.unit,
    as_of_date: ctx.asOf, period_end: periodEnd, available_at: availableAt, inputs_hash: hashRefs(refs), input_refs: refs, calc_run_id: ctx.calcRunId,
    quality_status: conflict ? 'conflict' : 'validated',
  });
}

const hasConflict = (ps: (PeriodValues | undefined)[], codes: string[]) => ps.some((p) => p && codes.some((c) => p.quality.get(c) === 'conflict'));

/** Period-level metrics (Q and FY) for one visible set of periods on one basis. */
export function periodMetrics(ctx: Ctx, periods: PeriodValues[], suffix = ''): void {
  const byKey = new Map(periods.map((p) => [`${p.period_type}|${p.fiscal_year}|${p.fiscal_quarter ?? 0}`, p]));
  const fys = periods.filter((p) => p.period_type === 'FY');
  for (const p of periods) {
    const key = fq(p) + suffix;
    const prior = byKey.get(`${p.period_type}|${p.fiscal_year - 1}|${p.fiscal_quarter ?? 0}`);
    const at = p.filed_at;
    const ce = (x: PeriodValues | undefined) => {
      const e = x?.values.get('total_equity');
      const b = x?.values.get('borrowings');
      return e === undefined || e === null || b === undefined || b === null ? undefined : e + b;
    };
    const growth = (code: string, metric: string) =>
      emit(ctx, metric, key, R.growth(input(p, code), prior ? input(prior, code) : { missing: 'not_available' }), prior ? [fvRef(p, code), fvRef(prior, code)] : [fvRef(p, code)], p.period_end, at, hasConflict([p, prior], [code]));
    growth('revenue_from_operations', 'revenue_growth_yoy');
    growth('net_profit', 'net_profit_growth_yoy');
    if (ctx.template === 'bank' || ctx.template === 'nbfc') {
      growth('net_interest_income', 'nii_growth_yoy');
      emit(ctx, 'cost_to_income', key, R.costToIncome(input(p, 'operating_expenses'), input(p, 'net_interest_income'), input(p, 'other_income')), ['operating_expenses', 'net_interest_income', 'other_income'].map((c) => fvRef(p, c)), p.period_end, at);
    }
    if (ctx.template === 'insurance') emit(ctx, 'claims_ratio', key, R.ratio(input(p, 'claims_incurred'), input(p, 'net_premium_earned'), { scale: 100 }), [fvRef(p, 'claims_incurred'), fvRef(p, 'net_premium_earned')], p.period_end, at);
    emit(ctx, 'operating_margin', key, R.operatingMargin(input(p, 'operating_profit'), input(p, 'revenue_from_operations')), [fvRef(p, 'operating_profit'), fvRef(p, 'revenue_from_operations')], p.period_end, at, hasConflict([p], ['operating_profit', 'revenue_from_operations']));
    emit(ctx, 'net_margin', key, R.netMargin(input(p, 'net_profit'), input(p, 'revenue_from_operations')), [fvRef(p, 'net_profit'), fvRef(p, 'revenue_from_operations')], p.period_end, at, hasConflict([p], ['net_profit', 'revenue_from_operations']));
    if (p.period_type !== 'FY') continue;
    const prevFy = prior;
    emit(ctx, 'roe', key, R.roe(input(p, 'net_profit'), prevFy ? (input(prevFy, 'total_equity') as number) : undefined, input(p, 'total_equity')), [fvRef(p, 'net_profit'), fvRef(p, 'total_equity'), ...(prevFy ? [fvRef(prevFy, 'total_equity')] : [])], p.period_end, at);
    emit(ctx, 'roa', key, R.roa(input(p, 'net_profit'), prevFy ? (input(prevFy, 'total_assets') as number) : undefined, input(p, 'total_assets')), [fvRef(p, 'net_profit'), fvRef(p, 'total_assets'), ...(prevFy ? [fvRef(prevFy, 'total_assets')] : [])], p.period_end, at);
    emit(ctx, 'dividend_per_share', key, input(p, 'dividend_per_share') === undefined ? R.miss('not_available') : R.val(input(p, 'dividend_per_share') as number), [fvRef(p, 'dividend_per_share')], p.period_end, at);
    if (ctx.template === 'standard') {
      emit(ctx, 'roce', key, R.roce(input(p, 'profit_before_tax'), input(p, 'finance_costs'), ce(prevFy), ce(p)), [fvRef(p, 'profit_before_tax'), fvRef(p, 'finance_costs'), fvRef(p, 'total_equity'), fvRef(p, 'borrowings'), ...(prevFy ? [fvRef(prevFy, 'total_equity'), fvRef(prevFy, 'borrowings')] : [])], p.period_end, at);
      emit(ctx, 'debt_equity', key, R.debtEquity(input(p, 'borrowings'), input(p, 'total_equity')), [fvRef(p, 'borrowings'), fvRef(p, 'total_equity')], p.period_end, at);
      emit(ctx, 'interest_coverage', key, R.interestCoverage(input(p, 'profit_before_tax'), input(p, 'finance_costs')), [fvRef(p, 'profit_before_tax'), fvRef(p, 'finance_costs')], p.period_end, at);
      const rec = R.days(input(p, 'trade_receivables'), input(p, 'revenue_from_operations'));
      const inv = R.days(input(p, 'inventories'), input(p, 'operating_expenses'));
      const pay = R.days(input(p, 'trade_payables'), input(p, 'operating_expenses'));
      emit(ctx, 'receivable_days', key, rec, [fvRef(p, 'trade_receivables'), fvRef(p, 'revenue_from_operations')], p.period_end, at);
      emit(ctx, 'inventory_days', key, inv, [fvRef(p, 'inventories'), fvRef(p, 'operating_expenses')], p.period_end, at);
      emit(ctx, 'payable_days', key, pay, [fvRef(p, 'trade_payables'), fvRef(p, 'operating_expenses')], p.period_end, at);
      emit(ctx, 'cash_conversion_cycle', key, R.cashConversionCycle(rec, inv, pay), ['trade_receivables', 'inventories', 'trade_payables', 'revenue_from_operations', 'operating_expenses'].map((c) => fvRef(p, c)), p.period_end, at);
      emit(ctx, 'cash_conversion', key, R.cashConversion(input(p, 'cash_from_operations'), input(p, 'operating_profit')), [fvRef(p, 'cash_from_operations'), fvRef(p, 'operating_profit')], p.period_end, at);
      const fcf = R.freeCashFlow(input(p, 'cash_from_operations'), input(p, 'capex'));
      emit(ctx, 'free_cash_flow', key, fcf, [fvRef(p, 'cash_from_operations'), fvRef(p, 'capex')], p.period_end, at);
      emit(ctx, 'fcf_margin', key, R.isMissing(fcf) ? fcf : R.ratio(fcf.value, input(p, 'revenue_from_operations'), { scale: 100 }), [fvRef(p, 'cash_from_operations'), fvRef(p, 'capex'), fvRef(p, 'revenue_from_operations')], p.period_end, at);
      emit(ctx, 'other_income_share', key, R.otherIncomeShare(input(p, 'other_income'), input(p, 'profit_before_tax')), [fvRef(p, 'other_income'), fvRef(p, 'profit_before_tax')], p.period_end, at);
    }
    if (ctx.template === 'bank' || ctx.template === 'nbfc') {
      const avgAdv = prevFy ? R.average(input(prevFy, 'advances'), input(p, 'advances')) : input(p, 'advances');
      emit(ctx, 'nim', key, R.ratio(input(p, 'net_interest_income'), avgAdv as R.Input, { scale: 100 }), [fvRef(p, 'net_interest_income'), fvRef(p, 'advances'), ...(prevFy ? [fvRef(prevFy, 'advances')] : [])], p.period_end, at);
      emit(ctx, 'credit_cost', key, R.ratio(input(p, 'provisions'), avgAdv as R.Input, { scale: 100 }), [fvRef(p, 'provisions'), fvRef(p, 'advances')], p.period_end, at);
      for (const [metric, item] of [['gnpa_pct', 'gnpa_pct'], ['nnpa_pct', 'nnpa_pct'], ['capital_adequacy', 'capital_adequacy_ratio']] as const) {
        const v = input(p, item);
        emit(ctx, metric, key, typeof v === 'number' ? R.val(v) : v && typeof v === 'object' ? v : R.miss('not_available'), [fvRef(p, item)], p.period_end, at);
      }
    }
    if (ctx.template === 'insurance') {
      const v = input(p, 'solvency_ratio');
      emit(ctx, 'solvency_ratio', key, typeof v === 'number' ? R.val(v) : R.miss('not_available'), [fvRef(p, 'solvency_ratio')], p.period_end, at);
    }
    const i3 = fys.indexOf(p);
    const base = i3 >= 3 ? fys[i3 - 3] : undefined;
    emit(ctx, 'revenue_cagr_3y', key, base ? R.cagr(input(p, 'revenue_from_operations'), input(base, 'revenue_from_operations'), 3) : R.miss('not_available'), base ? [fvRef(p, 'revenue_from_operations'), fvRef(base, 'revenue_from_operations')] : [fvRef(p, 'revenue_from_operations')], p.period_end, at);
  }
}

/** TTM metrics from the last four quarters and the four before them. */
export function ttmMetrics(ctx: Ctx, periods: PeriodValues[]): Map<string, { result: R.MetricResult; refs: Ref[] }> {
  const out = new Map<string, { result: R.MetricResult; refs: Ref[] }>();
  const qs = periods.filter((p) => p.period_type === 'Q');
  const last4 = lastFourQuarters(qs);
  if (!last4) return out;
  const prev4 = lastFourQuarters(qs.slice(0, qs.indexOf(last4[0]!)));
  const key = `TTM:${last4[3]!.period_end}`;
  const at = last4.reduce((m, p) => (p.filed_at > m ? p.filed_at : m), '');
  const refsFor = (codes: string[], set: PeriodValues[]) => set.flatMap((p) => codes.map((c) => fvRef(p, c)));
  const s = (code: string, set: PeriodValues[] | null) => (set ? sumItem(set, code) : null);
  const add = (code: string, result: R.MetricResult, refs: Ref[]) => {
    emit(ctx, code, key, result, refs, last4[3]!.period_end, at);
    out.set(code, { result, refs });
  };
  add('revenue_growth_yoy', R.growth(s('revenue_from_operations', last4), s('revenue_from_operations', prev4)), refsFor(['revenue_from_operations'], [...last4, ...(prev4 ?? [])]));
  add('net_profit_growth_yoy', R.growth(s('net_profit', last4), s('net_profit', prev4)), refsFor(['net_profit'], [...last4, ...(prev4 ?? [])]));
  add('operating_margin', R.operatingMargin(s('operating_profit', last4), s('revenue_from_operations', last4)), refsFor(['operating_profit', 'revenue_from_operations'], last4));
  add('net_margin', R.netMargin(s('net_profit', last4), s('revenue_from_operations', last4)), refsFor(['net_profit', 'revenue_from_operations'], last4));
  if (ctx.template === 'standard') {
    add('interest_coverage', R.interestCoverage(s('profit_before_tax', last4), s('finance_costs', last4)), refsFor(['profit_before_tax', 'finance_costs'], last4));
    add('other_income_share', R.otherIncomeShare(s('other_income', last4), s('profit_before_tax', last4)), refsFor(['other_income', 'profit_before_tax'], last4));
  }
  if (ctx.template === 'bank' || ctx.template === 'nbfc') {
    add('nii_growth_yoy', R.growth(s('net_interest_income', last4), s('net_interest_income', prev4)), refsFor(['net_interest_income'], [...last4, ...(prev4 ?? [])]));
    add('cost_to_income', R.costToIncome(s('operating_expenses', last4), s('net_interest_income', last4), s('other_income', last4)), refsFor(['operating_expenses', 'net_interest_income', 'other_income'], last4));
  }
  return out;
}

export async function computeCompanyMetrics(db: Db, opts: { companyIds?: string[]; asOf: string; calcRunId: string; latestOnly?: boolean }): Promise<number> {
  const companies = await db.query<{ company_id: string; sector_template: string; industry: string; sector: string; security_id: number }>(
    `SELECT c.company_id, c.sector_template, c.industry, c.sector, s.security_id FROM ref.companies c JOIN ref.securities s USING (company_id) WHERE c.coverage='full' ${opts.companyIds ? 'AND c.company_id = ANY($1::uuid[])' : ''}`,
    opts.companyIds ? [opts.companyIds] : [],
  );
  const pits = await loadPit(db, companies.map((c) => c.company_id));
  const nowInstant = `${opts.asOf}T18:29:59.999Z`;
  const latestDay = await db.maybeOne<{ d: string }>(`SELECT max(trade_date) AS d FROM calc.security_daily WHERE trade_date <= $1`, [opts.asOf]);
  const lastDate = latestDay?.d ?? opts.asOf;
  const idx = await db.query<{ trade_date: string; close: number }>(`SELECT trade_date, close FROM market.index_levels WHERE index_code='DEMO500' AND trade_date <= $1 ORDER BY trade_date`, [lastDate]);
  const idx1y = idx.length > 252 ? idx[idx.length - 1]!.close / idx[idx.length - 253]!.close - 1 : null;
  // Latest P/E for all covered companies, for peer medians.
  const allPe = await db.query<{ security_id: number; company_id: string; pe_ttm: number | null; market_cap_cr: number | null; industry: string; sector: string }>(
    `SELECT d.security_id, s.company_id, d.pe_ttm, d.market_cap_cr, c.industry, c.sector FROM calc.security_daily d JOIN ref.securities s USING (security_id) JOIN ref.companies c USING (company_id)
      WHERE d.trade_date = $1 AND c.coverage='full'`,
    [lastDate],
  );
  let written = 0;
  for (const c of companies) {
    const pit = pits.get(c.company_id);
    const out: MetricRow[] = [];
    const latestRows = new Map<string, { result: R.MetricResult; refs: Ref[]; periodEnd: string | null; at: string }>();
    if (pit) {
      for (const basis of ['consolidated', 'standalone'] as const) {
        const visible = pit.asOf(nowInstant, basis);
        if (!visible.length) continue;
        const ctx: Ctx = { companyId: c.company_id, template: c.sector_template, basis, asOf: opts.asOf, calcRunId: opts.calcRunId, out };
        periodMetrics(ctx, visible);
        // Originally reported values of restated periods stay queryable (CMP-04): key suffix @v1.
        const originals = pit.all.filter((p) => p.basis === basis && !visible.includes(p) && p.filed_at <= nowInstant);
        for (const o of originals) {
          const tmp: MetricRow[] = [];
          periodMetrics({ ...ctx, out: tmp }, pit.asOf(o.filed_at, basis));
          const key = fq(o);
          for (const row of tmp) if (row.period_key === key) out.push({ ...row, period_key: `${key}@v${o.version}` });
        }
        const ttm = ttmMetrics(ctx, visible);
        if (basis === pit.primaryBasis) {
          for (const [code, v] of ttm) latestRows.set(code, { ...v, periodEnd: null, at: nowInstant });
          // FY-based screener fields come from the latest annual period.
          const fyRows = out.filter((r) => r.basis === basis && /^FY\d\d$/.test(r.period_key));
          const latestFyKey = fyRows.reduce((m, r) => (r.period_end && r.period_end > m ? r.period_end : m), '');
          for (const r of fyRows.filter((x) => x.period_end === latestFyKey)) {
            if (!latestRows.has(r.metric_code)) latestRows.set(r.metric_code, { result: r.value === null ? R.miss(r.missing_reason!) : R.val(r.value), refs: r.input_refs, periodEnd: r.period_end, at: r.available_at });
          }
        }
      }
    }
    // Valuation, technical and ownership LATEST values.
    const daily = await db.query<{ trade_date: string; adj_close: number; sma_50: number | null; sma_200: number | null; rsi_14: number | null; vol_20d: number | null; adv_20d: number | null; high_52w: number | null; low_52w: number | null; market_cap_cr: number | null; shares_outstanding: number | null; pe_ttm: number | null; pb: number | null; ev_ebitda: number | null; dividend_yield: number | null }>(
      `SELECT trade_date, adj_close, sma_50, sma_200, rsi_14, vol_20d, adv_20d, high_52w, low_52w, market_cap_cr, shares_outstanding, pe_ttm, pb, ev_ebitda, dividend_yield FROM calc.security_daily WHERE security_id=$1 AND trade_date <= $2 ORDER BY trade_date`,
      [c.security_id, lastDate],
    );
    const last = daily[daily.length - 1];
    const ctx: Ctx = { companyId: c.company_id, template: c.sector_template, basis: pit?.primaryBasis ?? 'consolidated', asOf: lastDate, calcRunId: opts.calcRunId, out };
    const sdRef = (field: string, d = last): Ref => ({ kind: 'sd', id: `sd.${c.security_id}.${d?.trade_date}.${field}`, label: `${field} on ${d?.trade_date}`, value: d ? ((d as unknown as Record<string, number | null>)[field] ?? null) : null });
    const live = last && last.trade_date === lastDate;
    if (last) {
      const raw = await db.maybeOne<{ close: number }>(`SELECT close FROM market.price_eod WHERE security_id=$1 AND trade_date=$2 AND exchange_code='NSE'`, [c.security_id, last.trade_date]);
      const put = (code: string, result: R.MetricResult, refs: Ref[]) => latestRows.set(code, { result: live ? result : R.miss('not_available'), refs, periodEnd: null, at: nowInstant });
      const n = (x: number | null) => (x === null ? R.miss('not_available') : R.val(x));
      const nm = (x: number | null, applies = true) => (!applies ? R.miss('not_meaningful') : x === null ? R.miss('not_meaningful') : R.val(x));
      put('close', n(raw?.close ?? null), [{ kind: 'sd', id: `px.${c.security_id}.${last.trade_date}`, label: `close ${last.trade_date}`, value: raw?.close ?? null }]);
      put('market_cap', n(last.market_cap_cr), [sdRef('market_cap_cr'), sdRef('shares_outstanding')]);
      put('pe_ttm', last.market_cap_cr === null ? R.miss('not_available') : nm(last.pe_ttm), [sdRef('pe_ttm'), sdRef('market_cap_cr')]);
      put('pb', last.market_cap_cr === null ? R.miss('not_available') : nm(last.pb), [sdRef('pb'), sdRef('market_cap_cr')]);
      put('ev_ebitda', nm(last.ev_ebitda, c.sector_template === 'standard'), [sdRef('ev_ebitda')]);
      put('dividend_yield', n(last.dividend_yield), [sdRef('dividend_yield')]);
      const visibleNow = pit ? pit.asOf(nowInstant) : [];
      const q4 = lastFourQuarters(visibleNow);
      const ttmNp = q4 ? sumItem(q4, 'net_profit') : null;
      const qsNow = visibleNow.filter((p) => p.period_type === 'Q');
      const prevQ4 = q4 ? lastFourQuarters(qsNow.slice(0, qsNow.indexOf(q4[0]!))) : null;
      const prevNp = prevQ4 ? sumItem(prevQ4, 'net_profit') : null;
      const q4Refs = q4 ? q4.map((p) => fvRef(p, 'net_profit')) : [];
      put('earnings_yield', last.market_cap_cr && ttmNp !== null ? R.earningsYield(ttmNp, last.market_cap_cr) : R.miss('not_available'), [...q4Refs, sdRef('market_cap_cr')]);
      put('eps_ttm', last.shares_outstanding && ttmNp !== null ? R.val((ttmNp * 1e7) / last.shares_outstanding) : R.miss('not_available'), [...q4Refs, sdRef('shares_outstanding')]);
      put('eps_growth_ttm', R.growth(ttmNp, prevNp), [...q4Refs, ...(prevQ4 ? prevQ4.map((p) => fvRef(p, 'net_profit')) : [])]);
      const fy = [...visibleNow].reverse().find((p) => p.period_type === 'FY');
      put('book_value_per_share', fy && last.shares_outstanding ? R.ratio((fy.values.get('total_equity') ?? 0) * 1e7, last.shares_outstanding) : R.miss('not_available'), fy ? [fvRef(fy, 'total_equity'), sdRef('shares_outstanding')] : []);
      // P/E percentile within own five-year history (meaningful values only).
      const fiveY = daily.slice(-1260).map((d) => d.pe_ttm).filter((x): x is number => x !== null);
      put('pe_5y_percentile', last.pe_ttm === null ? R.miss('not_meaningful') : fiveY.length < 252 ? R.miss('not_available') : R.val(R.percentileRank(last.pe_ttm, fiveY)), [sdRef('pe_ttm')]);
      // Peer median P/E: same industry, nearest market caps, up to 10 peers.
      const me = allPe.find((x) => x.company_id === c.company_id);
      const peers = allPe.filter((x) => x.company_id !== c.company_id && x.industry === c.industry && x.market_cap_cr);
      const ranked = me?.market_cap_cr ? peers.sort((a, b) => Math.abs(Math.log(a.market_cap_cr! / me.market_cap_cr!)) - Math.abs(Math.log(b.market_cap_cr! / me.market_cap_cr!))).slice(0, 10) : [];
      const peerPe = ranked.map((x) => x.pe_ttm).filter((x): x is number => x !== null);
      const med = peerPe.length >= 3 ? R.median(peerPe) : null;
      put('pe_peer_median', med === null ? R.miss('not_available') : R.val(med), ranked.map((x) => ({ kind: 'sd' as const, id: `sd.${x.security_id}.${lastDate}.pe_ttm`, label: `peer P/E ${x.company_id}`, value: x.pe_ttm })));
      // Technical
      const i = daily.length - 1;
      const ret = (k: number) => (i - k >= 0 ? R.val((daily[i]!.adj_close / daily[i - k]!.adj_close - 1) * 100) : R.miss('not_available'));
      for (const [code, k] of [['ret_1w', 5], ['ret_1m', 21], ['ret_3m', 63], ['ret_6m', 126], ['ret_1y', 252]] as const) put(code, ret(k), [sdRef('adj_close'), ...(i - k >= 0 ? [sdRef('adj_close', daily[i - k])] : [])]);
      const ytdBase = [...daily].reverse().find((d) => d.trade_date < `${lastDate.slice(0, 4)}-01-01`);
      put('ret_ytd', ytdBase ? R.val((last.adj_close / ytdBase.adj_close - 1) * 100) : R.miss('not_available'), [sdRef('adj_close'), ...(ytdBase ? [sdRef('adj_close', ytdBase)] : [])]);
      put('pct_from_sma_50', last.sma_50 ? R.val((last.adj_close / last.sma_50 - 1) * 100) : R.miss('not_available'), [sdRef('adj_close'), sdRef('sma_50')]);
      put('pct_from_sma_200', last.sma_200 ? R.val((last.adj_close / last.sma_200 - 1) * 100) : R.miss('not_available'), [sdRef('adj_close'), sdRef('sma_200')]);
      put('rsi_14', n(last.rsi_14), [sdRef('rsi_14')]);
      put('volatility_20d', last.vol_20d === null ? R.miss('not_available') : R.val(last.vol_20d * 100), [sdRef('vol_20d')]);
      put('pct_from_52w_high', last.high_52w ? R.val((last.adj_close / last.high_52w - 1) * 100) : R.miss('not_available'), [sdRef('adj_close'), sdRef('high_52w')]);
      put('pct_from_52w_low', last.low_52w ? R.val((last.adj_close / last.low_52w - 1) * 100) : R.miss('not_available'), [sdRef('adj_close'), sdRef('low_52w')]);
      put('adv_20d', last.adv_20d === null ? R.miss('not_available') : R.val(last.adv_20d / 1e7), [sdRef('adv_20d')]);
      const r1y = ret(252);
      put('rel_perf_1y', !R.isMissing(r1y) && idx1y !== null ? R.val(r1y.value - idx1y * 100) : R.miss('not_available'), [sdRef('adj_close'), { kind: 'ix', id: `ix.DEMO500.${lastDate}`, label: 'DEMO500 1-year price return', value: idx1y }]);
    }
    // Ownership
    const shp = await db.query<{ snapshot_id: string; quarter_end: string; filed_at: string; category: string; pct: number; pledged_pct_of_promoter: number | null }>(
      `SELECT s.snapshot_id, s.quarter_end, s.filed_at, v.category, v.pct, v.pledged_pct_of_promoter FROM fund.shareholding_snapshots s JOIN fund.shareholding_values v USING (snapshot_id)
        WHERE s.company_id=$1 AND s.filed_at <= $2 ORDER BY s.quarter_end DESC`,
      [c.company_id, nowInstant],
    );
    const quarters = [...new Set(shp.map((x) => x.quarter_end))];
    const latestQ = quarters[0];
    const prevQ = quarters[1];
    if (latestQ) {
      const get = (q: string | undefined, cat: string) => shp.find((x) => x.quarter_end === q && x.category === cat);
      const shRef = (q: string | undefined, cat: string): Ref => ({ kind: 'sh', id: `sh.${get(q, cat)?.snapshot_id}.${cat}`, label: `${cat} holding ${q}`, value: get(q, cat)?.pct ?? null });
      const put = (code: string, result: R.MetricResult, refs: Ref[]) => latestRows.set(code, { result, refs, periodEnd: latestQ, at: get(latestQ, 'promoter')?.filed_at ?? nowInstant });
      const pct = (cat: string) => R.val(get(latestQ, cat)?.pct ?? 0);
      put('promoter_pct', pct('promoter'), [shRef(latestQ, 'promoter')]);
      put('fii_pct', pct('fii'), [shRef(latestQ, 'fii')]);
      put('dii_pct', pct('dii'), [shRef(latestQ, 'dii')]);
      put('public_pct', pct('public'), [shRef(latestQ, 'public')]);
      const prom = get(latestQ, 'promoter');
      put('pledged_pct', !prom || prom.pct === 0 || prom.pledged_pct_of_promoter === null ? R.miss('not_meaningful') : R.val(prom.pledged_pct_of_promoter), [shRef(latestQ, 'promoter')]);
      put('promoter_change_qoq', prevQ ? R.val((get(latestQ, 'promoter')?.pct ?? 0) - (get(prevQ, 'promoter')?.pct ?? 0)) : R.miss('not_available'), [shRef(latestQ, 'promoter'), shRef(prevQ, 'promoter')]);
      put('fii_change_qoq', prevQ ? R.val((get(latestQ, 'fii')?.pct ?? 0) - (get(prevQ, 'fii')?.pct ?? 0)) : R.miss('not_available'), [shRef(latestQ, 'fii'), shRef(prevQ, 'fii')]);
    }
    for (const [code, v] of latestRows) emit(ctx, code, 'LATEST', v.result, v.refs, v.periodEnd, v.at);
    const rows = opts.latestOnly ? out.filter((r) => r.period_key === 'LATEST') : out;
    await db.query(`DELETE FROM calc.metric_values WHERE entity_type='company' AND entity_id=$1 ${opts.latestOnly ? `AND period_key='LATEST'` : ''}`, [c.company_id]);
    written += await bulkInsert(db, 'calc.metric_values', rows, { chunk: 3000 });
  }
  return written;
}

export const _test = { addDays };
