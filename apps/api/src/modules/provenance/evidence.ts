import type { Db } from '../../db/db.js';
import { METRIC_BY_CODE } from '../calc/definitions.js';
import { conflictTolerance } from '../../pipeline/handlers/fundamentals.js';

// Provenance (Blueprint §5.6, PRD MTH-01, NFR-11): every displayed number resolves to source,
// publication time, retrieval time, transformation, definition version and validation status.

export interface Evidence {
  evidence_id: string;
  kind: string;
  label: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  as_of: string | null;
  filed_at: string | null;
  retrieved_at: string | null;
  source: { source_id: string; provider: string; dataset: string; is_synthetic: boolean; licence_status: string | null; attribution: string | null } | null;
  definition: { code: string; version: number; name: string; formula: string; url: string } | null;
  transformation: string;
  quality: { status: string; conflict?: { vendor_value: number; xbrl_value: number; tolerance_rule: string; displayed: string } | null };
  restatement: { version: number; original_value: number | null; restated: boolean } | null;
  inputs?: { id: string; label: string; value: number | null }[];
  deep_link: string | null;
}

async function source(db: Db, sourceId: string | null): Promise<Evidence['source']> {
  if (!sourceId) return null;
  const s = await db.maybeOne<{ source_id: string; provider: string; dataset: string; is_synthetic: boolean; status: string | null; attribution_text: string | null }>(
    `SELECT s.source_id, s.provider, s.dataset, s.is_synthetic, l.status, l.attribution_text FROM ref.sources s LEFT JOIN ref.licences l USING (licence_id) WHERE s.source_id=$1`,
    [sourceId],
  );
  return s ? { source_id: s.source_id, provider: s.provider, dataset: s.dataset, is_synthetic: s.is_synthetic, licence_status: s.status, attribution: s.attribution_text } : null;
}

export async function resolveEvidence(db: Db, id: string): Promise<Evidence | null> {
  const parts = id.split('.');
  const kind = parts[0];
  if (kind === 'fv' && parts.length >= 3) {
    const [, periodId, code] = parts as [string, string, string];
    const r = await db.maybeOne<{ value: number | null; unit: string; as_reported_at: string; source_id: string; source_ref: string | null; quality_status: string; missing_reason: string | null; period_type: string; fiscal_year: number; fiscal_quarter: number | null; period_end: string; basis: string; version: number; company_id: string; restatement_of: string | null; finished_at: string | null; name: string }>(
      `SELECT v.value, v.unit, v.as_reported_at, v.source_id, v.source_ref, v.quality_status, v.missing_reason, fp.period_type, fp.fiscal_year, fp.fiscal_quarter, fp.period_end, fp.basis, fp.version, fp.company_id, fp.restatement_of, r.finished_at, li.name
         FROM fund.financial_values v JOIN fund.financial_periods fp USING (period_id) JOIN fund.line_item_definitions li ON li.code=v.line_item_code LEFT JOIN ops.ingestion_runs r ON r.run_id=fp.ingestion_run_id
        WHERE v.period_id=$1 AND v.line_item_code=$2`,
      [periodId, code],
    );
    if (!r) return null;
    let original: number | null = null;
    if (r.restatement_of) original = (await db.maybeOne<{ value: number | null }>(`SELECT value FROM fund.financial_values WHERE period_id=$1 AND line_item_code=$2`, [r.restatement_of, code]))?.value ?? null;
    const conflictRow = r.quality_status === 'conflict' ? await db.maybeOne<{ details: { vendor_value: number; xbrl_value: number; tolerance_rule: string; displayed: string } }>(`SELECT details FROM calc.quality_issues WHERE kind='conflict' AND details->>'period_id'=$1 AND details->>'line_item'=$2 ORDER BY created_at DESC LIMIT 1`, [periodId, code]) : undefined;
    const period = r.period_type === 'FY' ? `FY${String(r.fiscal_year % 100).padStart(2, '0')}` : `Q${r.fiscal_quarter} FY${String(r.fiscal_year % 100).padStart(2, '0')}`;
    return {
      evidence_id: id, kind: 'financial_value', label: `${r.name}, ${period} (${r.basis})`, value: r.value, unit: r.unit, period: `${period}, period ended ${r.period_end}`, as_of: r.period_end,
      filed_at: r.as_reported_at, retrieved_at: r.finished_at, source: await source(db, r.source_id), definition: null,
      transformation: `As reported${r.unit === 'INR_cr' ? ', in ₹ crore' : ''}; vendor field ${r.source_ref ?? code}${r.missing_reason ? `; ${r.missing_reason.replace('_', ' ')}` : ''}`,
      quality: { status: r.quality_status, conflict: conflictRow ? { ...conflictRow.details, tolerance_rule: conflictRow.details.tolerance_rule ?? `±${conflictTolerance(r.value ?? 0).toFixed(2)} crore` } : null },
      restatement: { version: r.version, original_value: original, restated: r.version > 1 }, deep_link: `/app/companies/${r.company_id}?tab=financials`,
    };
  }
  if (kind === 'mv' && parts.length >= 5) {
    const [, entity, metric, periodKey, basis] = parts as [string, string, string, string, string];
    const r = await db.maybeOne<{ value: number | null; unit: string; missing_reason: string | null; as_of_date: string; period_end: string | null; available_at: string; input_refs: { id: string; label: string; value: number | null }[]; quality_status: string; definition_version: number; calc_run_id: string; computed_at: string }>(
      `SELECT value, unit, missing_reason, as_of_date, period_end, available_at, input_refs, quality_status, definition_version, calc_run_id, computed_at FROM calc.metric_values WHERE entity_id=$1 AND metric_code=$2 AND period_key=$3 AND basis=$4 ORDER BY definition_version DESC LIMIT 1`,
      [entity, metric, periodKey.replace(/~/g, '.'), basis],
    );
    if (!r) return null;
    const def = METRIC_BY_CODE.get(metric);
    return {
      evidence_id: id, kind: 'calculated_metric', label: `${def?.name ?? metric} (${periodKey.replace(/~/g, '.')})`, value: r.value, unit: r.unit, period: periodKey.replace(/~/g, '.'), as_of: r.as_of_date,
      filed_at: r.available_at, retrieved_at: r.computed_at, source: await source(db, 'atlas_calc'),
      definition: def ? { code: def.code, version: r.definition_version, name: def.name, formula: def.formula, url: `/methodology/metrics/${def.code}` } : null,
      transformation: `Calculated by the ATLAS calculation service (run ${r.calc_run_id.slice(0, 8)})${r.missing_reason ? `; result ${r.missing_reason === 'not_meaningful' ? 'n/m' : r.missing_reason.replace('_', ' ')}` : ''}`,
      quality: { status: r.quality_status }, restatement: null, inputs: r.input_refs, deep_link: `/app/companies/${entity}`,
    };
  }
  if ((kind === 'sd' || kind === 'px') && parts.length >= 3) {
    const sid = Number(parts[1]);
    const date = parts[2]!;
    const field = parts[3] ?? 'close';
    const r = await db.maybeOne<Record<string, number | string | null> & { source_id: string; finished_at: string | null; company_id: string; quality_status: string }>(
      `SELECT p.close, p.open, p.high, p.low, p.volume, p.traded_value, p.source_id, p.quality_status, r.finished_at, s.company_id, d.*
         FROM market.price_eod p JOIN ref.securities s ON s.security_id=p.security_id LEFT JOIN calc.security_daily d ON d.security_id=p.security_id AND d.trade_date=p.trade_date
         LEFT JOIN ops.ingestion_runs r ON r.run_id=p.ingestion_run_id WHERE p.security_id=$1 AND p.trade_date=$2 AND p.exchange_code='NSE'`,
      [sid, date],
    );
    if (!r) return null;
    const code = { pe_ttm: 'pe_ttm', pb: 'pb', ev_ebitda: 'ev_ebitda', dividend_yield: 'dividend_yield', market_cap_cr: 'market_cap', rsi_14: 'rsi_14', vol_20d: 'volatility_20d', sma_50: 'sma_50', sma_200: 'sma_200', sma_20: 'sma_20', adv_20d: 'adv_20d', adj_close: 'close' }[field] ?? null;
    const def = code ? METRIC_BY_CODE.get(code) : undefined;
    const derived = kind === 'sd' && field !== 'close';
    return {
      evidence_id: id, kind: derived ? 'daily_indicator' : 'price', label: `${field.replace(/_/g, ' ')} on ${date}`, value: r[field] === undefined ? null : (r[field] as number | null), unit: field === 'market_cap_cr' ? 'INR_cr' : null,
      period: date, as_of: `${date} end of day`, filed_at: null, retrieved_at: r.finished_at, source: await source(db, derived ? 'atlas_calc' : r.source_id),
      definition: def ? { code: def.code, version: def.version, name: def.name, formula: def.formula, url: `/methodology/metrics/${def.code}` } : null,
      transformation: derived ? 'Calculated on the split-, bonus- and rights-adjusted series; valuation uses only results filed before the session close' : 'Raw end-of-day close, as traded; not live',
      quality: { status: r.quality_status }, restatement: null, deep_link: `/app/companies/${r.company_id}?tab=technical`,
    };
  }
  if (kind === 'sh' && parts.length >= 3) {
    const r = await db.maybeOne<{ pct: number; pledged_pct_of_promoter: number | null; quarter_end: string; filed_at: string; source_id: string; company_id: string; finished_at: string | null }>(
      `SELECT v.pct, v.pledged_pct_of_promoter, s.quarter_end, s.filed_at, s.source_id, s.company_id, r.finished_at FROM fund.shareholding_values v JOIN fund.shareholding_snapshots s USING (snapshot_id) LEFT JOIN ops.ingestion_runs r ON r.run_id=s.ingestion_run_id WHERE v.snapshot_id=$1 AND v.category=$2`,
      [parts[1], parts[2]],
    );
    if (!r) return null;
    return { evidence_id: id, kind: 'shareholding', label: `${parts[2]} holding, quarter ended ${r.quarter_end}`, value: r.pct, unit: 'percent', period: `Quarter ended ${r.quarter_end}`, as_of: r.quarter_end, filed_at: r.filed_at, retrieved_at: r.finished_at, source: await source(db, r.source_id), definition: null, transformation: 'As filed in the shareholding pattern', quality: { status: 'validated' }, restatement: null, deep_link: `/app/companies/${r.company_id}?tab=ownership` };
  }
  if (kind === 'ix' && parts.length >= 3) {
    const r = await db.maybeOne<{ close: number; name: string; kind: string; source_id: string }>(`SELECT l.close, d.name, d.kind, l.source_id FROM market.index_levels l JOIN ref.index_definitions d USING (index_code) WHERE l.index_code=$1 AND l.trade_date=$2`, [parts[1], parts[2]]);
    if (!r) return null;
    return { evidence_id: id, kind: 'index_level', label: `${r.name} close`, value: r.close, unit: 'index_points', period: parts[2]!, as_of: `${parts[2]} end of day`, filed_at: null, retrieved_at: null, source: await source(db, r.source_id), definition: { code: 'index_return', version: 1, name: 'Index return', formula: METRIC_BY_CODE.get('index_return')!.formula, url: '/methodology/metrics/index_return' }, transformation: `${r.kind === 'total_return' ? 'Total-return' : 'Price-return'} index level as published`, quality: { status: 'validated' }, restatement: null, deep_link: `/app/market/indices/${parts[1]}` };
  }
  if (kind === 'md' && parts.length >= 3) {
    const r = await db.maybeOne<Record<string, unknown>>(`SELECT * FROM calc.market_daily WHERE universe_code=$1 AND trade_date=$2`, [parts[1], parts[2]]);
    if (!r) return null;
    return { evidence_id: id, kind: 'market_aggregate', label: `Covered-universe breadth and activity, ${parts[2]}`, value: null, unit: null, period: parts[2]!, as_of: `${parts[2]} end of day`, filed_at: null, retrieved_at: null, source: await source(db, 'atlas_calc'), definition: { code: 'advances', version: 1, name: 'Breadth measures', formula: 'advances + declines + unchanged = traded securities', url: '/methodology/metrics/advances' }, transformation: 'Counted from security-level validated data; reconciled (advances + declines + unchanged = traded)', quality: { status: 'validated' }, restatement: null, inputs: Object.entries(r).filter(([k]) => ['traded', 'advances', 'declines', 'unchanged', 'pct_above_50dma', 'pct_above_200dma', 'new_highs', 'new_lows', 'turnover_cr', 'turnover_avg_20_cr', 'realised_vol_20d', 'vol_percentile_1y'].includes(k)).map(([k, v]) => ({ id: k, label: k.replace(/_/g, ' '), value: v as number | null })), deep_link: `/app/market?date=${parts[2]}#breadth` };
  }
  if (kind === 'sec' && parts.length >= 3) {
    const sector = parts.slice(2).join('.');
    const r = await db.maybeOne<{ ret_equal: number; ret_cap: number; constituents: number; classification_version: number }>(`SELECT ret_equal, ret_cap, constituents, classification_version FROM calc.sector_daily WHERE trade_date=$1 AND sector=$2`, [parts[1], sector]);
    if (!r) return null;
    return { evidence_id: id, kind: 'sector_aggregate', label: `${sector} sector return, ${parts[1]}`, value: r.ret_cap * 100, unit: 'percent', period: parts[1]!, as_of: `${parts[1]} end of day`, filed_at: null, retrieved_at: null, source: await source(db, 'atlas_calc'), definition: { code: 'sector_return_cap', version: 1, name: 'Sector return (cap-weighted)', formula: METRIC_BY_CODE.get('sector_return_cap')!.formula, url: '/methodology/metrics/sector_return_cap' }, transformation: `Equal-weighted ${(r.ret_equal * 100).toFixed(2)}%, cap-weighted ${(r.ret_cap * 100).toFixed(2)}% across ${r.constituents} covered constituents; classification version ${r.classification_version}`, quality: { status: 'validated' }, restatement: null, deep_link: `/app/market/sectors/${encodeURIComponent(sector)}?date=${parts[1]}` };
  }
  if (kind === 'an' && parts.length >= 2) {
    const r = await db.maybeOne<{ subject: string; category: string; published_at: string; received_at: string; source_id: string; company_id: string }>(`SELECT subject, category, published_at, received_at, source_id, company_id FROM disc.announcements WHERE announcement_id=$1`, [parts[1]]);
    if (!r) return null;
    return { evidence_id: id, kind: 'announcement', label: r.subject, value: null, unit: null, period: null, as_of: r.published_at, filed_at: r.published_at, retrieved_at: r.received_at, source: await source(db, r.source_id), definition: null, transformation: `Exchange announcement (${r.category}); original document linked`, quality: { status: 'validated' }, restatement: null, deep_link: `/v1/documents/${parts[1]}` };
  }
  return null;
}

/** Encode a metric-value evidence id (period keys may contain '.', escaped as '~'). */
export const mvId = (entity: string, metric: string, periodKey: string, basis: string) => `mv.${entity}.${metric}.${periodKey.replace(/\./g, '~')}.${basis}`;

export interface Freshness {
  source_id: string;
  dataset: string;
  last_data_date: string | null;
  last_success_at: string | null;
  stale: boolean;
  label: string;
}

/** Freshness against each source's target (HOM-01: "Stale — last updated <time>"). */
export async function freshness(db: Db, now: Date): Promise<Freshness[]> {
  const rows = await db.query<{ source_id: string; dataset: string; last_data_date: string | null; last_success_at: string | null; freshness_target_minutes: number; status: string }>(`SELECT source_id, dataset, last_data_date, last_success_at, freshness_target_minutes, status FROM ref.sources WHERE status <> 'disabled' ORDER BY source_id`);
  // Data for a session is expected after the 21:30 IST data window closes (Blueprint §5.2).
  const ist = new Date(now.getTime() + 330 * 60_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const expectedBy = minutes >= 21 * 60 + 30 ? ist.toISOString().slice(0, 10) : new Date(ist.getTime() - 86_400_000).toISOString().slice(0, 10);
  const lastTrading = await db.maybeOne<{ d: string | null }>(`SELECT max(trade_date) AS d FROM ref.trading_calendar WHERE exchange_code='NSE' AND is_trading_day AND trade_date <= $1`, [expectedBy]);
  return rows.map((r) => {
    let stale = false;
    if (['eod_prices', 'index'].includes(r.dataset)) stale = !!lastTrading?.d && (!r.last_data_date || r.last_data_date < lastTrading.d);
    else if (r.last_success_at) stale = now.getTime() - Date.parse(r.last_success_at) > r.freshness_target_minutes * 60_000 * 2;
    return { source_id: r.source_id, dataset: r.dataset, last_data_date: r.last_data_date, last_success_at: r.last_success_at, stale, label: stale ? `Stale — last updated ${r.last_data_date ?? r.last_success_at ?? 'never'}` : 'End of day' };
  });
}
