import type { Db } from '../../db/db.js';
import { METRIC_BY_CODE } from '../calc/definitions.js';
import { comparePeers, defaultPeers, getAnnouncements, getCompany, getQualityFlags, getShareholding, searchCompanies } from '../companies/service.js';
import { latestMarketDate, marketSummary } from '../market/service.js';
import { mvId } from '../provenance/evidence.js';
import type { RightsMatrix } from '../ref/rights.js';

// The model can reach data only through these tools (Blueprint §7.4). Each enforces the
// can_ai_process right: withheld fields are dropped and recorded; third-party text is marked untrusted.

export const TOOL_VERSION = 'tools-v1';

export interface Fact {
  id: string;
  label: string;
  value: number | null;
  missing: string | null;
  unit: string;
  period: string | null;
  as_of: string | null;
  evidence_id: string;
  quality: string;
  source: string;
}

export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  fieldsSent: string[];
  fieldsWithheld: string[];
  ms: number;
}

export class ToolBox {
  readonly calls: ToolCallRecord[] = [];
  constructor(private readonly db: Db, private readonly rights: RightsMatrix, private readonly userId: string) {}

  private async run<T>(tool: string, input: Record<string, unknown>, fn: () => Promise<{ out: T; sent: string[]; withheld?: string[] }>): Promise<T> {
    const t = Date.now();
    const r = await fn();
    this.calls.push({ tool, input, output: summarise(r.out), fieldsSent: r.sent, fieldsWithheld: r.withheld ?? [], ms: Date.now() - t });
    return r.out;
  }

  search_companies(query: string) {
    return this.run('search_companies', { query }, async () => ({ out: await searchCompanies(this.db, query, 5), sent: ['company_id', 'short_name', 'coverage'] }));
  }

  get_company_profile(companyId: string) {
    return this.run('get_company_profile', { company_id: companyId }, async () => {
      const c = await getCompany(this.db, companyId);
      const lastQ = await this.db.maybeOne<{ fiscal_year: number; fiscal_quarter: number; filed_at: string }>(`SELECT fiscal_year, fiscal_quarter, filed_at FROM fund.financial_periods WHERE company_id=$1 AND period_type='Q' ORDER BY filed_at DESC LIMIT 1`, [companyId]);
      return { out: c ? { ...c, latest_quarter: lastQ ?? null } : null, sent: ['short_name', 'sector', 'industry', 'sector_template', 'coverage', 'latest_quarter'] };
    });
  }

  /** Calculation-service output: metric values with definition versions and evidence ids. */
  compute_metric(companyId: string, metricCode: string, periodKeys: string[] | 'all_quarters' | 'all_years', basis: string): Promise<Fact[]> {
    return this.run('compute_metric', { company_id: companyId, metric_code: metricCode, periods: periodKeys, basis }, async () => {
      const def = METRIC_BY_CODE.get(metricCode);
      const where = periodKeys === 'all_quarters' ? `period_key ~ '^Q[1-4]FY\\d{2}$'` : periodKeys === 'all_years' ? `period_key ~ '^FY\\d{2}$'` : `period_key = ANY($4::text[])`;
      const params: unknown[] = [companyId, metricCode, basis];
      if (Array.isArray(periodKeys)) params.push(periodKeys);
      const rows = await this.db.query<{ period_key: string; value: number | null; missing_reason: string | null; as_of_date: string; period_end: string | null; quality_status: string; basis: string }>(
        `SELECT period_key, value, missing_reason, as_of_date, period_end, quality_status, basis FROM calc.metric_values WHERE entity_type='company' AND entity_id=$1 AND metric_code=$2 AND (basis=$3 OR period_key='LATEST') AND ${where} ORDER BY period_end NULLS LAST, period_key`,
        params,
      );
      const allowed = this.rights.can('derived_metrics', metricCode, 'ai_process');
      const facts: Fact[] = allowed
        ? rows.map((r) => ({ id: `${metricCode}:${r.period_key}`, label: def?.name ?? metricCode, value: r.value, missing: r.missing_reason, unit: def?.unit ?? 'ratio', period: r.period_key, as_of: r.as_of_date, evidence_id: mvId(companyId, metricCode, r.period_key, r.basis), quality: r.quality_status, source: 'ATLAS calculation service' }))
        : [];
      return { out: facts, sent: allowed ? [metricCode] : [], withheld: allowed ? [] : [metricCode] };
    });
  }

  get_financial_series(companyId: string, lineItem: string, freq: 'Q' | 'FY', basis: string) {
    return this.run('get_financial_series', { company_id: companyId, line_item: lineItem, freq, basis }, async () => {
      const allowed = this.rights.can('fundamentals', lineItem, 'ai_process');
      if (!allowed) return { out: [] as Fact[], sent: [], withheld: [lineItem] };
      const rows = await this.db.query<{ period_id: string; fiscal_year: number; fiscal_quarter: number | null; period_end: string; filed_at: string; value: number | null; missing_reason: string | null; quality_status: string; unit: string; name: string; version: number }>(
        `SELECT DISTINCT ON (fp.fiscal_year, fp.fiscal_quarter) fp.period_id, fp.fiscal_year, fp.fiscal_quarter, fp.period_end, fp.filed_at, v.value, v.missing_reason, v.quality_status, v.unit, li.name, fp.version
           FROM fund.financial_periods fp JOIN fund.financial_values v USING (period_id) JOIN fund.line_item_definitions li ON li.code=v.line_item_code
          WHERE fp.company_id=$1 AND fp.basis=$2 AND fp.period_type=$3 AND v.line_item_code=$4 ORDER BY fp.fiscal_year, fp.fiscal_quarter, fp.version DESC`,
        [companyId, basis, freq, lineItem],
      );
      const facts: Fact[] = rows.map((r) => {
        const key = freq === 'FY' ? `FY${String(r.fiscal_year % 100).padStart(2, '0')}` : `Q${r.fiscal_quarter}FY${String(r.fiscal_year % 100).padStart(2, '0')}`;
        return { id: `${lineItem}:${key}`, label: r.name, value: r.value, missing: r.missing_reason, unit: r.unit, period: key, as_of: r.period_end, evidence_id: `fv.${r.period_id}.${lineItem}`, quality: r.version > 1 ? 'restated' : r.quality_status, source: `filed ${r.filed_at.slice(0, 10)}` };
      });
      return { out: facts.sort((a, b) => ((a.as_of ?? '') < (b.as_of ?? '') ? -1 : 1)), sent: [lineItem] };
    });
  }

  compare_peers(companyId: string, metrics: string[]) {
    return this.run('compare_peers', { company_id: companyId, metrics }, async () => {
      const allowedMetrics = metrics.filter((m) => this.rights.can('derived_metrics', m, 'ai_process'));
      const peers = await defaultPeers(this.db, companyId, 5);
      return { out: await comparePeers(this.db, companyId, peers, allowedMetrics), sent: allowedMetrics, withheld: metrics.filter((m) => !allowedMetrics.includes(m)) };
    });
  }

  get_market_summary(date?: string) {
    return this.run('get_market_summary', { date: date ?? 'latest' }, async () => {
      const d = date ?? (await latestMarketDate(this.db)) ?? undefined;
      const s = d ? await marketSummary(this.db, { date: d, rights: this.rights }) : null;
      return { out: s, sent: ['indices', 'breadth', 'sectors', 'regime'] };
    });
  }

  get_announcements(companyId: string, limit = 5) {
    return this.run('get_announcements', { company_id: companyId, limit }, async () => {
      const rows = await getAnnouncements(this.db, companyId, { limit });
      const canAi = this.rights.can('announcements', 'document', 'ai_process');
      const withText = canAi ? await this.db.query<{ announcement_id: string; body_text: string | null }>(`SELECT announcement_id, body_text FROM disc.announcements WHERE announcement_id = ANY($1::uuid[])`, [rows.map((r) => r.announcement_id)]) : [];
      return { out: rows.map((r) => ({ ...r, untrusted_text: withText.find((w) => w.announcement_id === r.announcement_id)?.body_text ?? null })), sent: canAi ? ['subject', 'category', 'published_at', 'untrusted_text'] : ['subject', 'category', 'published_at'], withheld: canAi ? [] : ['document'] };
    });
  }

  get_shareholding(companyId: string) {
    return this.run('get_shareholding', { company_id: companyId }, async () => {
      const s = await getShareholding(this.db, companyId, 8);
      const pledgeAllowed = this.rights.can('shareholding', 'pledged_pct_of_promoter', 'ai_process');
      const insiderAllowed = this.rights.can('insider_trades', '*', 'ai_process');
      const history = s.history.map((h) => (pledgeAllowed ? h : { ...h, pledged_pct_of_promoter: null, pledge_change_pp: null, pledge_highlight: false }));
      return {
        out: { ...s, history, insider_trades: insiderAllowed ? s.insider_trades : [] },
        sent: ['promoter', 'fii', 'dii', 'public', ...(pledgeAllowed ? ['pledged_pct_of_promoter'] : []), ...(insiderAllowed ? ['insider_trades'] : [])],
        withheld: [...(pledgeAllowed ? [] : ['pledged_pct_of_promoter']), ...(insiderAllowed ? [] : ['insider_trades'])],
      };
    });
  }

  get_quality_flags(companyId: string) {
    return this.run('get_quality_flags', { company_id: companyId }, async () => ({ out: await getQualityFlags(this.db, companyId), sent: ['flags'] }));
  }

  get_backtest(runId: string) {
    return this.run('get_backtest', { run_id: runId }, async () => {
      const r = await this.db.maybeOne<{ user_id: string; metrics: Record<string, unknown>; warnings: { title: string; why: string }[]; template_code: string; config: Record<string, unknown>; results_hash: string; status: string }>(`SELECT user_id, metrics, warnings, template_code, config, results_hash, status FROM bt.backtest_runs WHERE run_id=$1 AND deleted_at IS NULL`, [runId]);
      // Owner only (Blueprint §7.4).
      return { out: r && r.user_id === this.userId ? r : null, sent: ['metrics', 'warnings', 'template_code'] };
    });
  }

  get_metric_definition(code: string) {
    return this.run('get_metric_definition', { metric_code: code }, async () => ({ out: METRIC_BY_CODE.get(code) ?? null, sent: ['definition'] }));
  }
}

function summarise(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  return s.length > 4000 ? { truncated: true, preview: s.slice(0, 4000) } : v;
}
