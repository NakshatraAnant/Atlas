import { RESEARCH_SUMMARY_LABEL, formatIndianNumber, quarterLabel, fyLabel } from '@atlas/shared';
import type { Db } from '../../db/db.js';
import { LINE_ITEMS } from '../fundamentals/lineItems.js';
import { METRIC_BY_CODE } from '../calc/definitions.js';
import { mvId } from '../provenance/evidence.js';
import { disclosedEvent, otherIncomeDependence, risingLeverage, risingReceivableDays, weakCashConversion, type QualityFlag, type SeriesPoint } from './qualityFlags.js';

// Company research services (PRD CMP-01..CMP-14). Shared by the HTTP routes and the AI tools so the
// assistant can only ever see what the product shows, with the same provenance.

export interface CompanyHeader {
  company_id: string;
  legal_name: string;
  short_name: string;
  former_names: string[];
  sector: string;
  industry: string;
  sector_template: 'standard' | 'bank' | 'nbfc' | 'insurance';
  status: string;
  coverage: 'full' | 'not_covered';
  is_synthetic: boolean;
  security_id: number;
  isin: string;
  nse_symbol: string | null;
  bse_code: string | null;
  listed_on: string;
  delisted_on: string | null;
  description: string | null;
  description_source_id: string | null;
  description_as_of: string | null;
  segments_reported: boolean;
  primary_basis: 'consolidated' | 'standalone' | null;
}

export async function getCompany(db: Db, companyId: string): Promise<CompanyHeader | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return undefined;
  return db.maybeOne<CompanyHeader>(
    `SELECT c.company_id, c.legal_name, c.short_name, c.former_names, c.sector, c.industry, c.sector_template, c.status, c.coverage, c.is_synthetic,
            s.security_id, s.isin, s.listed_on, s.delisted_on, c.description, c.description_source_id, c.description_as_of, c.segments_reported,
            (SELECT symbol FROM ref.security_identifiers i WHERE i.security_id=s.security_id AND exchange_code='NSE' AND valid_to IS NULL LIMIT 1) AS nse_symbol,
            (SELECT symbol FROM ref.security_identifiers i WHERE i.security_id=s.security_id AND exchange_code='BSE' LIMIT 1) AS bse_code,
            (SELECT CASE WHEN bool_or(basis='consolidated') THEN 'consolidated' WHEN count(*) > 0 THEN 'standalone' END FROM fund.financial_periods fp WHERE fp.company_id=c.company_id) AS primary_basis
       FROM ref.companies c JOIN ref.securities s USING (company_id) WHERE c.company_id=$1`,
    [companyId],
  );
}

export interface SearchHit {
  company_id: string;
  short_name: string;
  legal_name: string;
  nse_symbol: string | null;
  bse_code: string | null;
  isin: string;
  sector: string;
  coverage: string;
  status: string;
  matched_on: string;
  score: number;
}

/** Search by name, NSE symbol, BSE code, ISIN or former name; typo-tolerant via trigram similarity (CMP-02). */
export async function searchCompanies(db: Db, q: string, limit = 10): Promise<SearchHit[]> {
  const query = q.trim().slice(0, 80);
  if (!query) return [];
  const upper = query.toUpperCase();
  return db.query<SearchHit>(
    `WITH ids AS (
       SELECT s.company_id, max(CASE WHEN i.exchange_code='NSE' AND i.valid_to IS NULL THEN i.symbol END) AS nse, max(CASE WHEN i.exchange_code='BSE' THEN i.symbol END) AS bse,
              array_agg(i.symbol) AS all_symbols, s.isin
         FROM ref.securities s JOIN ref.security_identifiers i USING (security_id) GROUP BY s.company_id, s.isin),
     scored AS (
       SELECT c.company_id, c.short_name, c.legal_name, ids.nse AS nse_symbol, ids.bse AS bse_code, ids.isin, c.sector, c.coverage, c.status,
         GREATEST(
           CASE WHEN upper(ids.isin) = $2 THEN 1.0 ELSE 0 END,
           CASE WHEN $2 = ANY(SELECT upper(x) FROM unnest(ids.all_symbols) x) THEN 0.99 ELSE 0 END,
           CASE WHEN lower(c.short_name) = lower($1) OR lower(c.legal_name) = lower($1) THEN 0.98 ELSE 0 END,
           CASE WHEN lower(c.short_name) LIKE lower($1) || '%' THEN 0.9 ELSE 0 END,
           similarity(lower(c.short_name), lower($1)),
           similarity(lower(c.legal_name), lower($1)) * 0.95,
           word_similarity(lower($1), lower(c.short_name)) * 0.9,
           COALESCE((SELECT max(similarity(lower(f), lower($1))) FROM unnest(c.former_names) f), 0) * 0.92,
           COALESCE((SELECT max(similarity(upper(x), $2)) FROM unnest(ids.all_symbols) x), 0) * 0.85
         ) AS score,
         CASE WHEN upper(ids.isin) = $2 THEN 'isin'
              WHEN $2 = ANY(SELECT upper(x) FROM unnest(ids.all_symbols) x) THEN CASE WHEN ids.nse = $2 OR ids.bse = $2 THEN 'symbol' ELSE 'former_symbol' END
              WHEN COALESCE((SELECT max(similarity(lower(f), lower($1))) FROM unnest(c.former_names) f), 0) > similarity(lower(c.short_name), lower($1)) THEN 'former_name'
              ELSE 'name' END AS matched_on
       FROM ref.companies c JOIN ids USING (company_id))
     SELECT * FROM scored WHERE score > 0.25 ORDER BY score DESC, coverage ASC, short_name LIMIT $3`,
    [query, upper, limit],
  );
}

/** History depth allowed by the plan (BIL-10): -1 means all available. */
export interface HistoryLimit {
  years: number;
  quarters: number;
}

export interface StatementCell {
  value: number | null;
  missing: 'not_reported' | 'not_available' | null;
  evidence_id: string;
  quality: string;
  restated: boolean;
  original_value: number | null;
  filed_at: string;
  period_end: string;
}

export interface StatementTable {
  company_id: string;
  basis: 'consolidated' | 'standalone';
  basis_label: string;
  freq: 'Q' | 'FY';
  statement: string;
  unit_note: string;
  periods: { key: string; label: string; period_end: string; filed_at: string; version: number; restated: boolean }[];
  rows: { code: string; name: string; unit: string; cells: (StatementCell | null)[] }[];
  history_limited: { allowed: number; available: number } | null;
  bases_available: string[];
}

export async function getFinancials(db: Db, companyId: string, opts: { statement: 'pl' | 'bs' | 'cf' | 'all'; basis?: 'consolidated' | 'standalone'; freq: 'Q' | 'FY'; limit: HistoryLimit; asOf?: string }): Promise<StatementTable | null> {
  const company = await getCompany(db, companyId);
  if (!company || !company.primary_basis) return null;
  const bases = (await db.query<{ basis: string }>(`SELECT DISTINCT basis FROM fund.financial_periods WHERE company_id=$1 ORDER BY basis`, [companyId])).map((b) => b.basis);
  const basis = opts.basis && bases.includes(opts.basis) ? opts.basis : company.primary_basis;
  const asOf = opts.asOf ?? new Date().toISOString();
  const periods = await db.query<{ period_id: string; fiscal_year: number; fiscal_quarter: number | null; period_end: string; filed_at: string; version: number; restatement_of: string | null }>(
    `SELECT DISTINCT ON (fiscal_year, fiscal_quarter) period_id, fiscal_year, fiscal_quarter, period_end, filed_at, version, restatement_of
       FROM fund.financial_periods WHERE company_id=$1 AND basis=$2 AND period_type=$3 AND filed_at <= $4 ORDER BY fiscal_year, fiscal_quarter, version DESC`,
    [companyId, basis, opts.freq, asOf],
  );
  periods.sort((a, b) => (a.period_end < b.period_end ? -1 : 1));
  const allowed = opts.freq === 'FY' ? opts.limit.years : opts.limit.quarters;
  const visible = allowed === -1 ? periods : periods.slice(-allowed);
  const ids = visible.map((p) => p.period_id);
  const originals = visible.filter((p) => p.restatement_of).map((p) => p.restatement_of!) as string[];
  const values = await db.query<{ period_id: string; line_item_code: string; value: number | null; missing_reason: 'not_reported' | 'not_available' | null; quality_status: string; as_reported_at: string }>(
    `SELECT period_id, line_item_code, value, missing_reason, quality_status, as_reported_at FROM fund.financial_values WHERE period_id = ANY($1::uuid[])`,
    [[...ids, ...originals]],
  );
  const byKey = new Map(values.map((v) => [`${v.period_id}|${v.line_item_code}`, v]));
  const statements = opts.statement === 'all' ? ['pl', 'bs', 'cf', 'bank', 'per_share', 'other'] : opts.statement === 'pl' ? ['pl', 'bank', 'per_share'] : opts.statement === 'bs' ? ['bs', 'bank', 'other'] : ['cf'];
  const items = LINE_ITEMS.filter((li) => statements.includes(li.statement) && li.templates.includes(company.sector_template) && (opts.freq === 'FY' || li.flow));
  const rows = items
    .map((li) => ({
      code: li.code,
      name: li.name,
      unit: li.unit,
      cells: visible.map((p) => {
        const v = byKey.get(`${p.period_id}|${li.code}`);
        if (!v) return null;
        const orig = p.restatement_of ? byKey.get(`${p.restatement_of}|${li.code}`) : undefined;
        return { value: v.value, missing: v.missing_reason, evidence_id: `fv.${p.period_id}.${li.code}`, quality: v.quality_status, restated: !!p.restatement_of && orig?.value !== v.value, original_value: orig?.value ?? null, filed_at: v.as_reported_at, period_end: p.period_end };
      }),
    }))
    .filter((r) => r.cells.some((c) => c !== null));
  return {
    company_id: companyId, basis, basis_label: basis === 'consolidated' ? 'Consolidated' : bases.includes('consolidated') ? 'Standalone' : 'Standalone (consolidated not reported)',
    freq: opts.freq, statement: opts.statement, unit_note: '₹ crore unless stated; FY = April–March',
    periods: visible.map((p) => ({ key: opts.freq === 'FY' ? fyLabel(p.fiscal_year) : `Q${p.fiscal_quarter}${fyLabel(p.fiscal_year)}`, label: opts.freq === 'FY' ? fyLabel(p.fiscal_year) : quarterLabel(p.fiscal_year, p.fiscal_quarter!), period_end: p.period_end, filed_at: p.filed_at, version: p.version, restated: !!p.restatement_of })),
    rows,
    history_limited: allowed !== -1 && periods.length > allowed ? { allowed, available: periods.length } : null,
    bases_available: bases,
  };
}

export interface MetricCell {
  value: number | null;
  missing: string | null;
  evidence_id: string;
  quality: string;
}

/** Ratios over periods (CMP-05), from calc.metric_values. */
export async function getMetrics(db: Db, companyId: string, opts: { codes: string[]; freq: 'Q' | 'FY' | 'LATEST'; basis?: string; limit: HistoryLimit }) {
  const company = await getCompany(db, companyId);
  if (!company) return null;
  const basis = opts.basis ?? company.primary_basis ?? 'consolidated';
  const pattern = opts.freq === 'Q' ? '^Q[1-4]FY\\d{2}$' : opts.freq === 'FY' ? '^FY\\d{2}$' : '^LATEST$';
  const rows = await db.query<{ metric_code: string; period_key: string; value: number | null; missing_reason: string | null; quality_status: string; period_end: string | null; unit: string; as_of_date: string; definition_version: number }>(
    `SELECT metric_code, period_key, value, missing_reason, quality_status, period_end, unit, as_of_date, definition_version FROM calc.metric_values
      WHERE entity_type='company' AND entity_id=$1 AND metric_code = ANY($2::text[]) AND period_key ~ $3 AND (basis=$4 OR period_key='LATEST')`,
    [companyId, opts.codes, pattern, basis],
  );
  const periodKeys = [...new Set(rows.map((r) => r.period_key))].sort((a, b) => {
    const pa = rows.find((r) => r.period_key === a)?.period_end ?? '';
    const pb = rows.find((r) => r.period_key === b)?.period_end ?? '';
    return pa < pb ? -1 : 1;
  });
  const allowed = opts.freq === 'FY' ? opts.limit.years : opts.freq === 'Q' ? opts.limit.quarters : -1;
  const keys = allowed === -1 ? periodKeys : periodKeys.slice(-allowed);
  return {
    company_id: companyId, basis, freq: opts.freq, periods: keys,
    metrics: opts.codes.filter((c) => METRIC_BY_CODE.has(c)).map((code) => {
      const def = METRIC_BY_CODE.get(code)!;
      return {
        code, name: def.name, unit: def.unit, definition_version: def.version, definition_url: `/methodology/metrics/${code}`, lesson: def.lesson ?? null,
        applies: def.templates.includes(company.sector_template),
        cells: keys.map((k) => {
          const r = rows.find((x) => x.metric_code === code && x.period_key === k);
          return r ? { value: r.value, missing: r.missing_reason, evidence_id: mvId(companyId, code, k, k === 'LATEST' ? (company.primary_basis ?? basis) : basis), quality: r.quality_status, as_of: r.as_of_date } : null;
        }),
      };
    }),
  };
}

export async function getQualityFlags(db: Db, companyId: string): Promise<{ flags: QualityFlag[]; basis: string } | null> {
  const company = await getCompany(db, companyId);
  if (!company) return null;
  const basis = company.primary_basis ?? 'consolidated';
  const series = async (code: string): Promise<SeriesPoint[]> =>
    (await db.query<{ period_key: string; value: number | null; period_end: string }>(`SELECT period_key, value, period_end FROM calc.metric_values WHERE entity_id=$1 AND metric_code=$2 AND period_key ~ '^FY\\d{2}$' AND basis=$3 ORDER BY period_end`, [companyId, code, basis])).map((r) => ({ period: r.period_key, value: r.value }));
  const events = await db.query<{ kind: string; fiscal_year: number; detail: string }>(`SELECT kind, fiscal_year, detail FROM fund.audit_events WHERE company_id=$1`, [companyId]);
  const latestFy = (await db.maybeOne<{ fy: number | null }>(`SELECT max(fiscal_year) AS fy FROM fund.financial_periods WHERE company_id=$1 AND period_type='FY'`, [companyId]))?.fy ?? new Date().getUTCFullYear();
  const flags: QualityFlag[] = [];
  if (company.sector_template === 'standard') {
    flags.push(weakCashConversion(await series('cash_conversion')));
    flags.push(risingReceivableDays(await series('receivable_days')));
    flags.push(risingLeverage(await series('debt_equity')));
    flags.push(otherIncomeDependence(await series('other_income_share')));
  }
  flags.push(disclosedEvent('auditor_change', events.filter((e) => e.kind === 'auditor_change'), latestFy));
  flags.push(disclosedEvent('qualified_opinion', events.filter((e) => e.kind === 'qualified_opinion'), latestFy));
  return { flags, basis };
}

export async function getValuation(db: Db, companyId: string) {
  const company = await getCompany(db, companyId);
  if (!company) return null;
  const latest = await getMetrics(db, companyId, { codes: ['market_cap', 'pe_ttm', 'pb', 'ev_ebitda', 'dividend_yield', 'earnings_yield', 'pe_5y_percentile', 'pe_peer_median'], freq: 'LATEST', limit: { years: -1, quarters: -1 } });
  const hist = await db.query<{ trade_date: string; pe_ttm: number | null; pb: number | null; ev_ebitda: number | null; dividend_yield: number | null }>(
    `SELECT trade_date, pe_ttm, pb, ev_ebitda, dividend_yield FROM calc.security_daily WHERE security_id=$1 AND trade_date >= (SELECT max(trade_date) - interval '5 years' FROM calc.security_daily WHERE security_id=$1) ORDER BY trade_date`,
    [company.security_id],
  );
  // Weekly sampling keeps the payload small; the table view lists the same points.
  const sampled = hist.filter((_, i) => i % 5 === 0 || i === hist.length - 1);
  return { company_id: companyId, latest, history: sampled, notes: ['Price date and trailing-twelve-month definitions are shown with each value.', 'Negative earnings display n/m.', 'ATLAS publishes no price targets or fair-value figures.'] };
}

export async function getShareholding(db: Db, companyId: string, quarters = 16) {
  const rows = await db.query<{ snapshot_id: string; quarter_end: string; filed_at: string; category: string; pct: number; pledged_pct_of_promoter: number | null }>(
    `SELECT s.snapshot_id, s.quarter_end, s.filed_at, v.category, v.pct, v.pledged_pct_of_promoter FROM fund.shareholding_snapshots s JOIN fund.shareholding_values v USING (snapshot_id) WHERE s.company_id=$1 ORDER BY s.quarter_end DESC`,
    [companyId],
  );
  const qs = [...new Set(rows.map((r) => r.quarter_end))].slice(0, quarters).reverse();
  const history = qs.map((q, i) => {
    const pick = (c: string) => rows.find((r) => r.quarter_end === q && r.category === c);
    const prom = pick('promoter');
    const prev = i > 0 ? rows.find((r) => r.quarter_end === qs[i - 1] && r.category === 'promoter') : undefined;
    const pledgeChange = prom?.pledged_pct_of_promoter !== null && prom?.pledged_pct_of_promoter !== undefined && prev?.pledged_pct_of_promoter !== null && prev?.pledged_pct_of_promoter !== undefined ? prom.pledged_pct_of_promoter - prev.pledged_pct_of_promoter : null;
    return {
      quarter_end: q, filed_at: prom?.filed_at,
      categories: Object.fromEntries(['promoter', 'fii', 'dii', 'public', 'government', 'other'].map((c) => [c, { pct: pick(c)?.pct ?? null, evidence_id: `sh.${pick(c)?.snapshot_id}.${c}` }])),
      pledged_pct_of_promoter: prom?.pledged_pct_of_promoter ?? null,
      pledge_change_pp: pledgeChange,
      pledge_highlight: pledgeChange !== null && Math.abs(pledgeChange) >= 0.5,
      promoter_change_pp: prev ? (prom?.pct ?? 0) - prev.pct : null,
    };
  });
  const insider = await db.query(`SELECT person_category, transaction_type, shares, value_inr, transaction_date, disclosed_at, source_id FROM disc.insider_trades WHERE company_id=$1 ORDER BY transaction_date DESC LIMIT 20`, [companyId]);
  return { company_id: companyId, history, insider_trades: insider, quarters_available: qs.length };
}

export async function getAnnouncements(db: Db, companyId: string, opts: { from?: string; to?: string; categories?: string[]; limit?: number } = {}) {
  return db.query<{ announcement_id: string; category: string; subcategory: string | null; subject: string; published_at: string; received_at: string; document_url: string | null }>(
    `SELECT announcement_id, category, subcategory, subject, published_at, received_at, document_url FROM disc.announcements
      WHERE company_id=$1 AND ($2::timestamptz IS NULL OR published_at >= $2) AND ($3::timestamptz IS NULL OR published_at <= $3) AND ($4::text[] IS NULL OR category = ANY($4))
      ORDER BY published_at DESC LIMIT $5`,
    [companyId, opts.from ?? null, opts.to ?? null, opts.categories ?? null, opts.limit ?? 50],
  );
}

export async function getPrices(db: Db, companyId: string, opts: { from?: string; to?: string; adjusted: boolean }) {
  const company = await getCompany(db, companyId);
  if (!company) return null;
  const rows = await db.query<{ trade_date: string; open: number; high: number; low: number; close: number; volume: number; adj_close: number; adj_open: number; adj_high: number; adj_low: number; adj_volume: number; tr_close: number; sma_20: number | null; sma_50: number | null; sma_200: number | null; vol_20d: number | null; rsi_14: number | null; quality_status: string }>(
    `SELECT p.trade_date, p.open, p.high, p.low, p.close, p.volume, p.quality_status, a.adj_close, a.adj_open, a.adj_high, a.adj_low, a.adj_volume, a.tr_close, d.sma_20, d.sma_50, d.sma_200, d.vol_20d, d.rsi_14
       FROM market.price_eod p JOIN market.adjusted_price_cache a ON a.security_id=p.security_id AND a.trade_date=p.trade_date LEFT JOIN calc.security_daily d ON d.security_id=p.security_id AND d.trade_date=p.trade_date
      WHERE p.security_id=$1 AND p.exchange_code='NSE' AND p.trade_date >= COALESCE($2::date, '1900-01-01') AND p.trade_date <= COALESCE($3::date, '2999-12-31') ORDER BY p.trade_date`,
    [company.security_id, opts.from ?? null, opts.to ?? null],
  );
  const last = rows[rows.length - 1];
  const yearRows = rows.filter((r) => last && r.trade_date > new Date(Date.parse(last.trade_date) - 365 * 86_400_000).toISOString().slice(0, 10));
  const quarantinedLatest = await db.maybeOne<{ n: number }>(`SELECT count(*)::int AS n FROM market.price_quarantine q WHERE q.raw->>'isin'=$1 AND q.resolved_at IS NULL AND (q.raw->>'date') > $2`, [company.isin, last?.trade_date ?? '1900-01-01']);
  const actions = await db.query(`SELECT action_type, ex_date, ratio_num, ratio_den, cash_amount, adj_factor, notes FROM market.corporate_actions WHERE security_id=$1 ORDER BY ex_date`, [company.security_id]);
  return {
    company_id: companyId, security_id: company.security_id, adjusted: opts.adjusted,
    basis_label: opts.adjusted ? 'Adjusted for splits, bonuses and rights (not for dividends); end of day' : 'As traded (unadjusted); end of day',
    delay_label: 'End-of-day data; not live',
    series: rows.map((r) => ({ date: r.trade_date, open: opts.adjusted ? r.adj_open : r.open, high: opts.adjusted ? r.adj_high : r.high, low: opts.adjusted ? r.adj_low : r.low, close: opts.adjusted ? r.adj_close : r.close, volume: opts.adjusted ? r.adj_volume : r.volume, total_return: r.tr_close, sma_20: r.sma_20, sma_50: r.sma_50, sma_200: r.sma_200, evidence_id: `px.${company.security_id}.${r.trade_date}` })),
    range_52w: yearRows.length ? { high: Math.max(...yearRows.map((r) => r.adj_close)), low: Math.min(...yearRows.map((r) => r.adj_close)), basis: 'adjusted close' } : null,
    latest: last ? { date: last.trade_date, close: last.close, vol_20d: last.vol_20d, rsi_14: last.rsi_14, stale: (quarantinedLatest?.n ?? 0) > 0 } : null,
    corporate_actions: actions,
  };
}

export interface PeerTable {
  company_id: string;
  peers: { company_id: string; short_name: string; is_subject: boolean; fy_end_month: number; values: Record<string, MetricCell | null> }[];
  metrics: string[];
  alignment: string;
  median: Record<string, number | null>;
  warnings: string[];
}

export async function defaultPeers(db: Db, companyId: string, max = 5): Promise<string[]> {
  const me = await db.maybeOne<{ industry: string; sector: string; mcap: number | null }>(
    `SELECT c.industry, c.sector, (SELECT value FROM calc.metric_values WHERE entity_id=c.company_id::text AND metric_code='market_cap' AND period_key='LATEST') AS mcap FROM ref.companies c WHERE company_id=$1`,
    [companyId],
  );
  if (!me) return [];
  const rows = await db.query<{ company_id: string; industry: string; mcap: number | null }>(
    `SELECT c.company_id, c.industry, (SELECT value FROM calc.metric_values WHERE entity_id=c.company_id::text AND metric_code='market_cap' AND period_key='LATEST') AS mcap
       FROM ref.companies c WHERE c.coverage='full' AND c.status='listed' AND c.sector=$1 AND c.company_id <> $2`,
    [me.sector, companyId],
  );
  return rows
    .sort((a, b) => (a.industry === me.industry ? 0 : 1) - (b.industry === me.industry ? 0 : 1) || Math.abs(Math.log((a.mcap ?? 1) / (me.mcap ?? 1))) - Math.abs(Math.log((b.mcap ?? 1) / (me.mcap ?? 1))))
    .slice(0, max)
    .map((r) => r.company_id);
}

/** Peer comparison on aligned trailing-twelve-month / latest-financial-year values (CMP-13). */
export async function comparePeers(db: Db, companyId: string, peerIds: string[], metrics: string[]): Promise<PeerTable | null> {
  const company = await getCompany(db, companyId);
  if (!company) return null;
  const ids = [companyId, ...peerIds.filter((p) => p !== companyId)];
  const rows = await db.query<{ company_id: string; short_name: string; fy_end_month: number; metric_code: string | null; value: number | null; missing_reason: string | null; quality_status: string | null }>(
    `SELECT c.company_id, c.short_name, c.fy_end_month, m.metric_code, m.value, m.missing_reason, m.quality_status FROM ref.companies c
       LEFT JOIN calc.metric_values m ON m.entity_id=c.company_id::text AND m.period_key='LATEST' AND m.metric_code = ANY($2::text[])
      WHERE c.company_id = ANY($1::uuid[])`,
    [ids, metrics],
  );
  const peers = ids.map((id) => {
    const r = rows.filter((x) => x.company_id === id);
    return {
      company_id: id, short_name: r[0]?.short_name ?? '', is_subject: id === companyId, fy_end_month: r[0]?.fy_end_month ?? 3,
      values: Object.fromEntries(metrics.map((m) => {
        const v = r.find((x) => x.metric_code === m);
        return [m, v ? { value: v.value, missing: v.missing_reason, evidence_id: mvId(id, m, 'LATEST', 'consolidated'), quality: v.quality_status ?? 'validated' } : null];
      })),
    };
  });
  const median = Object.fromEntries(metrics.map((m) => {
    const vals = peers.filter((p) => !p.is_subject).map((p) => p.values[m]?.value).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    if (!vals.length) return [m, null];
    const mid = Math.floor(vals.length / 2);
    return [m, vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2];
  }));
  const warnings: string[] = [];
  const subjectFyEnd = peers.find((p) => p.is_subject)?.fy_end_month ?? 3;
  const mismatched = peers.filter((p) => !p.is_subject && p.fy_end_month !== subjectFyEnd);
  if (mismatched.length) warnings.push(`Financial year ends differ for ${mismatched.map((p) => p.short_name).join(', ')}; values are aligned on trailing twelve months.`);
  return { company_id: companyId, peers, metrics, alignment: 'Trailing twelve months for flow measures and latest financial year for balance-sheet measures; valuation on the same price date.', median, warnings };
}

export interface SummarySentence {
  text: string;
  evidence: string[];
  type: 'observed' | 'calculated' | 'interpretation';
}

/** Research summary panel (CMP-11). Deterministic; every sentence with a number links to evidence. */
export async function researchSummary(db: Db, companyId: string) {
  const company = await getCompany(db, companyId);
  if (!company || company.coverage !== 'full') return null;
  const basis = company.primary_basis ?? 'consolidated';
  const m = await db.query<{ metric_code: string; period_key: string; value: number | null; missing_reason: string | null; period_end: string | null }>(
    `SELECT metric_code, period_key, value, missing_reason, period_end FROM calc.metric_values WHERE entity_id=$1 AND (basis=$2 OR period_key='LATEST') AND period_key !~ '@'`,
    [companyId, basis],
  );
  const latestQ = m.filter((x) => /^Q[1-4]FY\d{2}$/.test(x.period_key)).sort((a, b) => ((a.period_end ?? '') < (b.period_end ?? '') ? 1 : -1))[0]?.period_key;
  const get = (code: string, key: string) => m.find((x) => x.metric_code === code && x.period_key === key);
  const ev = (code: string, key: string) => mvId(companyId, code, key, key === 'LATEST' ? basis : basis);
  const supports: SummarySentence[] = [];
  const pretty = (k: string) => k.replace(/^Q(\d)FY(\d\d)$/, 'Q$1 FY$2');
  if (latestQ) {
    const g = get('revenue_growth_yoy', latestQ);
    const om = get('operating_margin', latestQ);
    const prevKey = latestQ.replace(/FY(\d\d)$/, (_, y: string) => `FY${String(Number(y) - 1).padStart(2, '0')}`);
    const omPrev = get('operating_margin', prevKey);
    if (g?.value !== null && g?.value !== undefined) supports.push({ type: 'calculated', text: `Revenue ${g.value < 0 ? 'fell' : 'grew'} ${formatIndianNumber(Math.abs(g.value), 1)}% year on year in ${pretty(latestQ)}.`, evidence: [ev('revenue_growth_yoy', latestQ)] });
    if (om?.value !== null && om?.value !== undefined && omPrev?.value !== null && omPrev?.value !== undefined) {
      const d = om.value - omPrev.value;
      supports.push({ type: 'calculated', text: `Operating margin was ${formatIndianNumber(om.value, 1)}% in ${pretty(latestQ)}, ${Math.round(Math.abs(d) * 10) === 0 ? 'little changed' : `${d > 0 ? 'up' : 'down'} ${formatIndianNumber(Math.abs(d), 1)} points`} from ${formatIndianNumber(omPrev.value, 1)}% a year earlier.`, evidence: [ev('operating_margin', latestQ), ev('operating_margin', prevKey)] });
    }
  }
  const roe = get('roe', 'LATEST');
  if (roe?.value !== null && roe?.value !== undefined) supports.push({ type: 'calculated', text: `Return on equity for the latest financial year was ${formatIndianNumber(roe.value, 1)}%.`, evidence: [ev('roe', 'LATEST')] });
  const changes: SummarySentence[] = [];
  const lastResults = await db.maybeOne<{ fiscal_year: number; fiscal_quarter: number; filed_at: string }>(`SELECT fiscal_year, fiscal_quarter, filed_at FROM fund.financial_periods WHERE company_id=$1 AND period_type='Q' ORDER BY filed_at DESC LIMIT 1`, [companyId]);
  if (lastResults) changes.push({ type: 'observed', text: `${quarterLabel(lastResults.fiscal_year, lastResults.fiscal_quarter)} results were filed on ${lastResults.filed_at.slice(0, 10)}.`, evidence: [] });
  const restated = await db.maybeOne<{ fiscal_year: number; filed_at: string }>(`SELECT fiscal_year, filed_at FROM fund.financial_periods WHERE company_id=$1 AND version > 1 ORDER BY filed_at DESC LIMIT 1`, [companyId]);
  const uncertain: SummarySentence[] = [];
  if (restated) uncertain.push({ type: 'observed', text: `${fyLabel(restated.fiscal_year)} figures were restated in a later filing; both versions are shown in the statements.`, evidence: [] });
  const exceptional = await db.maybeOne<{ fiscal_year: number; fiscal_quarter: number }>(`SELECT fp.fiscal_year, fp.fiscal_quarter FROM fund.financial_values v JOIN fund.financial_periods fp USING (period_id) WHERE fp.company_id=$1 AND fp.basis=$2 AND fp.period_type='Q' AND v.line_item_code='exceptional_items' AND v.value <> 0 AND fp.is_current ORDER BY fp.period_end DESC LIMIT 1`, [companyId, basis]);
  if (exceptional) uncertain.push({ type: 'observed', text: `${quarterLabel(exceptional.fiscal_year, exceptional.fiscal_quarter)} profit includes exceptional items disclosed in the results.`, evidence: [] });
  const conflicts = await db.maybeOne<{ n: number }>(`SELECT count(*)::int AS n FROM calc.quality_issues WHERE entity_ref=$1 AND kind='conflict' AND status='open'`, [companyId]);
  if (conflicts && conflicts.n > 0) uncertain.push({ type: 'observed', text: 'At least one reported value differs between the data vendor and the XBRL filing beyond tolerance; the conflict badge shows both values.', evidence: [] });
  if (!uncertain.length) uncertain.push({ type: 'observed', text: 'No restatements, exceptional items or source conflicts were found in the periods shown.', evidence: [] });
  const flags = await getQualityFlags(db, companyId);
  const contrary: SummarySentence[] = [];
  for (const f of flags?.flags.filter((x) => x.triggered) ?? []) contrary.push({ type: 'observed', text: `${f.name}: ${f.rule.toLowerCase()} — requires review.`, evidence: [] });
  const pe = get('pe_ttm', 'LATEST');
  const peer = get('pe_peer_median', 'LATEST');
  if (pe?.value != null && peer?.value != null && pe.value > peer.value) contrary.push({ type: 'calculated', text: `The trailing P/E of ${formatIndianNumber(pe.value, 1)}× is above the peer median of ${formatIndianNumber(peer.value, 1)}×.`, evidence: [ev('pe_ttm', 'LATEST'), ev('pe_peer_median', 'LATEST')] });
  const ng = latestQ ? get('net_profit_growth_yoy', latestQ) : undefined;
  if (ng?.value != null && ng.value < 0) contrary.push({ type: 'calculated', text: `Net profit fell ${formatIndianNumber(Math.abs(ng.value), 1)}% year on year in ${pretty(latestQ!)}.`, evidence: [ev('net_profit_growth_yoy', latestQ!)] });
  if (!contrary.length) contrary.push({ type: 'observed', text: 'No contrary evidence was found in the quality checks, peer valuation or the latest results (checked: six quality flags, P/E against peers, year-on-year profit change).', evidence: [] });
  return {
    company_id: companyId,
    label: RESEARCH_SUMMARY_LABEL,
    sections: [
      { id: 'data_supports', title: 'What the data supports', sentences: supports },
      { id: 'what_changed', title: 'What has changed', sentences: changes },
      { id: 'uncertain', title: 'What remains uncertain', sentences: uncertain },
      { id: 'contrary', title: 'Risks and contrary evidence', sentences: contrary },
      { id: 'segments', title: 'Segments', sentences: [{ type: 'observed' as const, text: company.segments_reported ? 'Segment data is reported by the company; see the filings.' : 'Not reported by the company for this period.', evidence: [] }] },
    ],
    sources: 'Consolidated or standalone filings as labelled; ATLAS calculation service',
    versions: { generator: 'research-summary-v1', model: 'deterministic (no language model)', prompt: 'n/a' },
    generated_at: new Date().toISOString(),
  };
}

/** What changed for a user's watchlist companies since their last visit (HOM-02). */
export async function whatChanged(db: Db, userId: string, sinceDefaultDays = 14) {
  return db.query<{ company_id: string; short_name: string; kind: string; title: string; at: string; href: string }>(
    `WITH wl AS (
       SELECT DISTINCT i.company_id, COALESCE(v.last_visit_at, now() - make_interval(days => $2)) AS since
         FROM app.watchlist_items i JOIN app.watchlists w USING (watchlist_id) LEFT JOIN app.last_visits v ON v.user_id=w.user_id AND v.company_id=i.company_id
        WHERE w.user_id=$1 AND w.deleted_at IS NULL)
     SELECT * FROM (
       SELECT c.company_id, c.short_name, 'results_filed' AS kind, c.short_name || ' filed ' || 'Q' || fp.fiscal_quarter || ' FY' || lpad((fp.fiscal_year % 100)::text, 2, '0') || ' results' AS title, fp.filed_at AS at, '/app/companies/' || c.company_id || '?tab=financials' AS href
         FROM wl JOIN fund.financial_periods fp ON fp.company_id=wl.company_id AND fp.filed_at > wl.since AND fp.period_type='Q' AND fp.version=1 JOIN ref.companies c ON c.company_id=wl.company_id
        WHERE fp.basis = (SELECT CASE WHEN bool_or(basis='consolidated') THEN 'consolidated' ELSE 'standalone' END FROM fund.financial_periods x WHERE x.company_id=wl.company_id)
       UNION ALL
       SELECT c.company_id, c.short_name, 'announcement', c.short_name || ': ' || a.subject, a.published_at, '/v1/documents/' || a.announcement_id
         FROM wl JOIN disc.announcements a ON a.company_id=wl.company_id AND a.published_at > wl.since AND a.category IN ('Change in Auditor','Acquisition','Credit Rating','Dividend') JOIN ref.companies c ON c.company_id=wl.company_id
       UNION ALL
       SELECT c.company_id, c.short_name, 'shareholding', c.short_name || ': shareholding pattern for the quarter ended ' || to_char(s.quarter_end, 'DD Mon YYYY') || ' filed', s.filed_at, '/app/companies/' || c.company_id || '?tab=ownership'
         FROM wl JOIN fund.shareholding_snapshots s ON s.company_id=wl.company_id AND s.filed_at > wl.since JOIN ref.companies c ON c.company_id=wl.company_id
       UNION ALL
       SELECT c.company_id, c.short_name, 'correction', 'Correction: ' || k.title, k.published_at, '/methodology/corrections'
         FROM wl JOIN calc.corrections k ON k.affected->'company_ids' ? wl.company_id::text AND k.published_at > wl.since JOIN ref.companies c ON c.company_id=wl.company_id
     ) x ORDER BY CASE kind WHEN 'results_filed' THEN 0 WHEN 'correction' THEN 1 WHEN 'shareholding' THEN 2 ELSE 3 END, at DESC LIMIT 10`,
    [userId, sinceDefaultDays],
  );
}
