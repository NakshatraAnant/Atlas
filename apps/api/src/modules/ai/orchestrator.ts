import { checkContent, STANDARD_DISCLOSURE, quarterLabel, fyLabel } from '@atlas/shared';
import type { Db } from '../../db/db.js';
import { METRIC_BY_CODE } from '../calc/definitions.js';
import { freshness } from '../provenance/evidence.js';
import type { RightsMatrix } from '../ref/rights.js';
import { checkClaims, type Claim } from './claims.js';
import { fmtValue, MISSING_TEXT } from './format.js';
import { NARRATIVE_PROMPT_VERSION, type ModelGateway } from './gateway.js';
import { classify, POLICY_RESPONSES, type Intent } from './policy.js';
import { TOOL_VERSION, ToolBox, type Fact } from './tools.js';

// Answer pipeline (Blueprint §8.1): intent and policy check → entity and period resolution →
// data tools only → deterministic calculations → structured six-part answer → claim checker →
// content rules. Numbers come from code; the model (if enabled) only words the direct answer.

export const ANSWER_VERSION = 'answer-pipeline-v1';

export interface AnswerItem { text: string; type: 'observed' | 'calculated' | 'interpretation'; claim_ids: string[] }
export interface SixPartAnswer {
  direct_answer: AnswerItem[];
  figures: { label: string; display: string; claim_id: string; evidence_id: string; period: string | null }[];
  method: string;
  sources: { evidence_id: string; label: string; period: string | null; as_of: string | null; source: string; href: string }[];
  uncertainty: string[];
  inspect: { label: string; href: string }[];
}

export interface AnswerResult {
  kind: 'answer' | 'policy' | 'disambiguation' | 'not_covered' | 'not_found' | 'clarify' | 'fallback_table';
  intent: Intent | 'research';
  sections: SixPartAnswer;
  claims: (Claim & { type: 'observed' | 'calculated'; display: string })[];
  check: { status: 'pass' | 'regenerated' | 'fallback' | 'policy' | 'refused'; numbers: number; unmatched: string[]; content_violations: string[] };
  context: { company_id?: string; company_name?: string; metric?: string; period?: string };
  options?: { company_id: string; short_name: string }[];
  versions: { pipeline: string; model: string; prompt: string; tools: string };
  usage: { input_tokens: number; output_tokens: number; cost_inr: number };
  disclosure: { id: string; text: string };
  suggestions: string[];
}

interface CatalogEntry { company_id: string; short_name: string; legal_name: string; former_names: string[]; symbols: string[]; coverage: string; sector: string; industry: string; template: string }
let catalogCache: { at: number; rows: CatalogEntry[] } | null = null;
export async function catalog(db: Db): Promise<CatalogEntry[]> {
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.rows;
  const rows = await db.query<CatalogEntry>(
    `SELECT c.company_id, c.short_name, c.legal_name, c.former_names, c.coverage, c.sector, c.industry, c.sector_template AS template,
            array_agg(DISTINCT i.symbol) FILTER (WHERE i.symbol IS NOT NULL) AS symbols
       FROM ref.companies c JOIN ref.securities s USING (company_id) LEFT JOIN ref.security_identifiers i USING (security_id) GROUP BY c.company_id`,
  );
  catalogCache = { at: Date.now(), rows };
  return rows;
}
export function resetCatalogCache() {
  catalogCache = null;
}

const lc = (s: string) => s.toLowerCase();

export function resolveCompanies(question: string, rows: CatalogEntry[]): { matched: CatalogEntry[]; ambiguous: CatalogEntry[]; unknown: string | null } {
  const q = lc(question);
  const full = rows.filter((r) => q.includes(lc(r.short_name)) || q.includes(lc(r.legal_name)) || r.former_names.some((f) => q.includes(lc(f.replace(/ Ltd$/, '')))) || r.symbols.some((s) => s.length >= 4 && new RegExp(`\\b${s}\\b`).test(question)));
  if (full.length) {
    // Prefer the longest name when one name contains another.
    const sorted = full.sort((a, b) => b.short_name.length - a.short_name.length);
    const out: CatalogEntry[] = [];
    for (const r of sorted) if (!out.some((o) => lc(o.short_name).includes(lc(r.short_name)))) out.push(r);
    return { matched: out, ambiguous: [], unknown: null };
  }
  const words = new Set(q.replace(/['’]s\b/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  const partial = rows.filter((r) => words.has(lc(r.short_name.split(' ')[0]!)));
  if (partial.length === 1) return { matched: partial, ambiguous: [], unknown: null };
  if (partial.length > 1) return { matched: [], ambiguous: partial, unknown: null };
  // A company-like proper noun that is not in the catalogue (hallucination bait).
  const m = /\b((?:[A-Z][a-zA-Z&]+\s){0,3}[A-Z][a-zA-Z&]+)(?:['’]s|\s+(?:Ltd|Limited|Industries|Corp|Corporation|Enterprises|Holdings|Technologies|Bank)\b)/.exec(question);
  const STOP = new Set(['ATLAS', 'What', 'How', 'Why', 'Is', 'Explain', 'Compare', 'Show', 'Tell', 'Demo', 'Did', 'Does', 'India', 'Indian', 'RBI', 'Should', 'Which', 'Nifty', 'Sensex', 'NSE', 'BSE', 'SEBI', 'FY', 'Q1', 'Q2', 'Q3', 'Q4', 'IT', 'FMCG', 'Banks', 'Auto', 'Materials', 'Retail', 'Chemicals', 'Insurance', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Today', 'Broad', 'Market', 'Index', 'Largecap', 'Smallcap']);
  if (m && !m[1]!.split(' ').every((w) => STOP.has(w))) return { matched: [], ambiguous: [], unknown: m[1]! };
  // "ROCE of Tata Motors?" — a proper noun after of/for/about/on that is not in the catalogue.
  const m2 = /\b(?:of|for|about|on)\s+((?:[A-Z][a-zA-Z&.]+\s?){1,4})(?=[?.!,]|\s*$)/.exec(question);
  if (m2) {
    const name = m2[1]!.trim();
    if (!name.split(' ').every((w) => STOP.has(w))) return { matched: [], ambiguous: [], unknown: name };
  }
  return { matched: [], ambiguous: [], unknown: null };
}

const METRIC_WORDS: [RegExp, string][] = [
  [/operating\s+(?:profit\s+)?margin|ebitda\s+margin/i, 'operating_margin'],
  [/net\s+(?:profit\s+)?margin|profit\s+margin|pat\s+margin/i, 'net_margin'],
  [/\broce\b|return\s+on\s+capital/i, 'roce'],
  [/\broe\b|return\s+on\s+equity/i, 'roe'],
  [/\broa\b|return\s+on\s+assets/i, 'roa'],
  [/debt[\s-]*(?:to[\s-]*)?equity|leverage|\bd\/e\b/i, 'debt_equity'],
  [/interest\s+coverage/i, 'interest_coverage'],
  [/receivable\s+days|debtor\s+days|receivables/i, 'receivable_days'],
  [/inventory\s+days/i, 'inventory_days'],
  [/payable\s+days/i, 'payable_days'],
  [/cash\s+conversion\s+cycle/i, 'cash_conversion_cycle'],
  [/cash\s+conversion/i, 'cash_conversion'],
  [/free\s+cash\s+flow|\bfcf\b/i, 'free_cash_flow'],
  [/\bp\/?e\b|price[\s-]+(?:to[\s-]+)?earnings|pe\s+ratio/i, 'pe_ttm'],
  [/\bp\/?b\b|price[\s-]+(?:to[\s-]+)?book/i, 'pb'],
  [/ev\s*\/\s*ebitda|enterprise\s+value/i, 'ev_ebitda'],
  [/dividend\s+yield/i, 'dividend_yield'],
  [/market\s+(?:cap|capitali[sz]ation|value)/i, 'market_cap'],
  [/\beps\b|earnings\s+per\s+share/i, 'eps_ttm'],
  [/book\s+value/i, 'book_value_per_share'],
  [/promoter\s+(?:holding|stake|shareholding)/i, 'promoter_pct'],
  [/\bfii\b|foreign\s+(?:institutional|portfolio)/i, 'fii_pct'],
  [/\bnim\b|net\s+interest\s+margin/i, 'nim'],
  [/\bgnpa\b|gross\s+npa|\bnpa\b|non[\s-]+performing/i, 'gnpa_pct'],
  [/capital\s+adequacy|\bcar\b|\bcrar\b/i, 'capital_adequacy'],
  [/cost[\s-]+to[\s-]+income/i, 'cost_to_income'],
  [/volatil/i, 'volatility_20d'],
  [/\brsi\b/i, 'rsi_14'],
  [/52[\s-]*week\s+high/i, 'pct_from_52w_high'],
  [/profit\s+growth|earnings\s+growth|net\s+profit\s+(?:grow|grew|change)/i, 'net_profit_growth_yoy'],
  [/revenue|sales|top[\s-]?line|growing|growth/i, 'revenue_growth_yoy'],
  [/other\s+income/i, 'other_income_share'],
];

export function detectMetric(q: string): string | null {
  for (const [re, code] of METRIC_WORDS) if (re.test(q)) return code;
  return null;
}

export function detectPeriod(q: string): { key: string; label: string } | null {
  const m = /\bQ([1-4])\s?(?:FY\s?)?'?(\d{2}|\d{4})\b/i.exec(q);
  if (m) {
    const fy = Number(m[2]!.length === 4 ? m[2]!.slice(2) : m[2]);
    return { key: `Q${m[1]}FY${String(fy).padStart(2, '0')}`, label: `Q${m[1]} FY${String(fy).padStart(2, '0')}` };
  }
  const y = /\bFY\s?'?(\d{2}|\d{4})\b/i.exec(q);
  if (y) {
    const fy = Number(y[1]!.length === 4 ? y[1]!.slice(2) : y[1]);
    return { key: `FY${String(fy).padStart(2, '0')}`, label: `FY${String(fy).padStart(2, '0')}` };
  }
  return null;
}

type QType = 'concept' | 'trend' | 'peers' | 'market' | 'announcement' | 'backtest' | 'quality' | 'results' | 'lookup' | 'ownership';

export function questionType(q: string, hasCompany: boolean, metric: string | null, hasRun: boolean): QType {
  if (hasRun && /\b(backtest|test|strategy|run|result|drawdown|sharpe|warning|trades?)\b/i.test(q)) return 'backtest';
  if (/\b(backtest|my\s+test|strategy\s+result)\b/i.test(q)) return 'backtest';
  if (!hasCompany && metric && /\b(what\s+is|what\s+does|define|definition|meaning|explain|how\s+is\b.*\bcalculated|formula)\b/i.test(q)) return 'concept';
  if (hasCompany && /\b(announcement|filing|disclosure|summari[sz]e|document|presentation)\b/i.test(q)) return 'announcement';
  if (hasCompany && /\b(peers?|compare|comparison|versus|vs\.?|relative\s+to|against|industry\s+median)\b/i.test(q)) return 'peers';
  if (hasCompany && /\b(quality|flags?|concerns?|risks?|warning\s+signs?|red\s+flags?)\b/i.test(q)) return 'quality';
  if (hasCompany && /\b(shareholding|promoter|pledge|ownership|fii|dii|holding)\b/i.test(q) && (!metric || ['promoter_pct', 'fii_pct'].includes(metric))) return 'ownership';
  if (!hasCompany && /\b(market|index|indices|breadth|briefing|sector|session|today|yesterday|advances|declines|broad|nifty|sensex)\b/i.test(q)) return 'market';
  if (hasCompany && metric && /\b(change|changed|trend|over\s+(?:the\s+)?(?:last|past)|evolv|history|eight|8|twelve|12)\b/i.test(q)) return 'trend';
  if (hasCompany && (!metric || /\b(results?|latest\s+quarter|explain)\b/i.test(q))) return 'results';
  if (!hasCompany && metric) return 'concept';
  return 'lookup';
}

interface Builder {
  claims: (Claim & { type: 'observed' | 'calculated'; display: string })[];
  claim(f: Fact, type: 'observed' | 'calculated'): string;
  claimRaw(value: number, display: string, label: string, evidenceId: string, type: 'observed' | 'calculated', unit: string): string;
}

function builder(): Builder {
  const claims: Builder['claims'] = [];
  return {
    claims,
    claim(f, type) {
      const id = `cl_${claims.length + 1}`;
      claims.push({ id, value: f.value, label: `${f.label}${f.period ? `, ${prettyPeriod(f.period)}` : ''}`, unit: f.unit, evidenceId: f.evidence_id, type, display: f.value === null ? MISSING_TEXT[f.missing ?? 'not_available']! : fmtValue(f.value, f.unit) });
      return id;
    },
    claimRaw(value, display, label, evidenceId, type, unit) {
      const id = `cl_${claims.length + 1}`;
      claims.push({ id, value, label, evidenceId, type, display, unit });
      return id;
    },
  };
}

export function prettyPeriod(k: string): string {
  if (k === 'LATEST') return 'latest';
  const q = /^Q([1-4])FY(\d\d)(@v\d)?$/.exec(k);
  if (q) return `Q${q[1]} FY${q[2]}`;
  if (k.startsWith('TTM:')) return `TTM to ${k.slice(4)}`;
  return k;
}

const empty = (): SixPartAnswer => ({ direct_answer: [], figures: [], method: 'Not applicable: no data was used.', sources: [], uncertainty: [], inspect: [] });

export interface AskInput {
  question: string;
  userId: string;
  experienceLevel: string | null;
  context: { company_id?: string; metric?: string; period?: string; run_id?: string; briefing_date?: string };
  tableOnly: boolean;
  useNarrative: boolean;
}

export async function answerQuestion(db: Db, rights: RightsMatrix, gateway: ModelGateway, input: AskInput, now: Date): Promise<{ result: AnswerResult; tools: ToolBox }> {
  const tools = new ToolBox(db, rights, input.userId);
  const versions = { pipeline: ANSWER_VERSION, model: gateway.model, prompt: input.useNarrative ? NARRATIVE_PROMPT_VERSION : 'n/a (deterministic composer)', tools: TOOL_VERSION };
  const base = (kind: AnswerResult['kind'], intent: AnswerResult['intent'], text: string, extra: Partial<AnswerResult> = {}): AnswerResult => ({
    kind, intent, sections: { ...empty(), direct_answer: [{ text, type: 'observed', claim_ids: [] }], uncertainty: ['Not applicable: no figures were reported.'], inspect: [{ label: 'How AI answers work', href: '/methodology/ai' }] },
    claims: [], check: { status: kind === 'policy' ? 'policy' : 'pass', numbers: 0, unmatched: [], content_violations: [] }, context: {}, versions, usage: { input_tokens: 0, output_tokens: 0, cost_inr: 0 },
    disclosure: { id: STANDARD_DISCLOSURE.id, text: STANDARD_DISCLOSURE.text }, suggestions: [], ...extra,
  });

  // 1. Intent and policy
  const policy = classify(input.question);
  if (policy.intent !== 'research') {
    const r = base('policy', policy.intent, POLICY_RESPONSES[policy.intent], { suggestions: ['How did operating margin change over the last eight quarters?', 'What is the ROCE and how is it calculated?', 'Which quality checks require review?'] });
    if (policy.intent === 'advice') r.sections.method = 'Policy: requests for recommendations, targets, allocations or predictions receive this response (PRD AIA-06).';
    return { result: r, tools };
  }

  // 2. Entities and periods
  const cat = await catalog(db);
  let { matched, ambiguous, unknown } = resolveCompanies(input.question, cat);
  const followUp = /\b(it|its|their|the company|this company|same company|what about)\b/i.test(input.question);
  if (!matched.length && !ambiguous.length && !unknown && input.context.company_id && (followUp || detectMetric(input.question))) {
    const c = cat.find((x) => x.company_id === input.context.company_id);
    if (c) matched = [c];
  }
  if (ambiguous.length) {
    return { result: base('disambiguation', 'research', `More than one company matches. Which did you mean: ${ambiguous.map((a) => a.short_name).join(', ')}?`, { options: ambiguous.map((a) => ({ company_id: a.company_id, short_name: a.short_name })) }), tools };
  }
  if (unknown && !matched.length) {
    const hits = await tools.search_companies(unknown);
    const close = hits.filter((h) => h.score > 0.45);
    // Auto-correct only an obvious typo (strong match); a loose look-alike is offered as a suggestion,
    // never silently substituted (answering about another company would misattribute figures).
    const strong = close.filter((h) => h.score >= 0.7);
    if (strong.length === 1 && strong[0]!.coverage === 'full') matched = [cat.find((c) => c.company_id === strong[0]!.company_id)!];
    else {
      const r = base('not_found', 'research', `ATLAS has no record of a listed company called “${unknown}”. Nothing is estimated for companies outside its data.${close.length ? ` Similar names: ${close.map((c) => c.short_name).join(', ')}.` : ''}`, { options: close.map((c) => ({ company_id: c.company_id, short_name: c.short_name })) });
      r.sections.uncertainty = ['The name did not match any company, symbol, ISIN or former name in the coverage list.'];
      return { result: r, tools };
    }
  }
  const company = matched[0];
  if (company && company.coverage !== 'full') {
    const peers = cat.filter((c) => c.coverage === 'full' && c.sector === company.sector).slice(0, 3);
    return { result: base('not_covered', 'research', `${company.short_name} is not yet covered with a full profile, so ATLAS has no verified figures for it. You can request coverage. Covered companies in the same sector: ${peers.map((p) => p.short_name).join(', ') || 'none'}.`, { options: peers.map((p) => ({ company_id: p.company_id, short_name: p.short_name })), context: { company_id: company.company_id, company_name: company.short_name } }), tools };
  }
  const metric = detectMetric(input.question) ?? (input.context.metric && followUp ? input.context.metric : null);
  const period = detectPeriod(input.question);
  const qtype = questionType(input.question, !!company, metric, !!input.context.run_id);
  const b = builder();
  const s = empty();
  const uncertainty: string[] = [];
  const addSource = (f: Fact) => {
    if (!s.sources.some((x) => x.evidence_id === f.evidence_id)) s.sources.push({ evidence_id: f.evidence_id, label: f.label, period: f.period ? prettyPeriod(f.period) : null, as_of: f.as_of, source: f.source, href: `/v1/evidence/${encodeURIComponent(f.evidence_id)}` });
  };
  const fig = (f: Fact, type: 'observed' | 'calculated') => {
    const id = b.claim(f, type);
    s.figures.push({ label: `${f.label}${f.period ? `, ${prettyPeriod(f.period)}` : ''}`, display: b.claims.find((c) => c.id === id)!.display, claim_id: id, evidence_id: f.evidence_id, period: f.period });
    addSource(f);
    if (f.quality === 'conflict') uncertainty.push(`${f.label} (${prettyPeriod(f.period ?? '')}): the data vendor and the XBRL filing disagree beyond tolerance; the displayed value follows source precedence and the conflict badge shows both.`);
    if (f.quality === 'restated') uncertainty.push(`${f.label} (${prettyPeriod(f.period ?? '')}) was restated; the originally reported value remains available in the statements.`);
    if (f.value === null) uncertainty.push(`${f.label} (${prettyPeriod(f.period ?? '')}) is ${MISSING_TEXT[f.missing ?? 'not_available']}.`);
    return id;
  };
  const say = (text: string, type: AnswerItem['type'], ids: string[]) => s.direct_answer.push({ text, type, claim_ids: ids });
  const basis = company ? ((await db.maybeOne<{ b: string }>(`SELECT CASE WHEN bool_or(basis='consolidated') THEN 'consolidated' ELSE 'standalone' END AS b FROM fund.financial_periods WHERE company_id=$1`, [company.company_id]))?.b ?? 'consolidated') : 'consolidated';
  const def = metric ? METRIC_BY_CODE.get(metric) : undefined;
  let methodText = '';

  if (qtype === 'concept' && def) {
    await tools.get_metric_definition(def.code);
    say(`${def.name}: ${def.description}`, 'observed', []);
    methodText = `Formula: ${def.formula}. Edge cases: ${def.edgeRules.join(' ')} Definition version ${def.version}.`;
    s.inspect.push({ label: `${def.name} definition`, href: `/methodology/metrics/${def.code}` });
    if (def.lesson) s.inspect.push({ label: 'Related lesson', href: `/learn/${def.lesson}` });
    s.uncertainty = ['Not applicable: this is a definition, not a company figure.'];
  } else if (qtype === 'backtest') {
    const run = input.context.run_id ? await tools.get_backtest(input.context.run_id) : null;
    if (!run || run.status !== 'succeeded') {
      return { result: base('clarify', 'research', 'Open a completed backtest report and ask from there, so the assistant can read that run’s results.'), tools };
    }
    const m = run.metrics as Record<string, number | null>;
    const ev = `bt.${input.context.run_id}`;
    const tr = b.claimRaw(m.total_return ?? 0, fmtValue(m.total_return ?? 0, 'percent'), 'Total return', ev, 'calculated', 'percent');
    const bm = b.claimRaw(m.benchmark_return ?? 0, fmtValue(m.benchmark_return ?? 0, 'percent'), 'Benchmark return', ev, 'calculated', 'percent');
    const dd = b.claimRaw(m.max_drawdown ?? 0, fmtValue(m.max_drawdown ?? 0, 'percent'), 'Maximum drawdown', ev, 'calculated', 'percent');
    const nt = b.claimRaw(m.trades ?? 0, String(m.trades ?? 0), 'Number of trades', ev, 'calculated', 'count');
    for (const id of [tr, bm, dd, nt]) {
      const c = b.claims.find((x) => x.id === id)!;
      s.figures.push({ label: c.label, display: c.display, claim_id: id, evidence_id: ev, period: null });
    }
    say(`Over the test period the simulated strategy returned ${fmtValue(m.total_return ?? 0, 'percent')} against ${fmtValue(m.benchmark_return ?? 0, 'percent')} for the benchmark, with a maximum drawdown of ${fmtValue(m.max_drawdown ?? 0, 'percent')} across ${m.trades ?? 0} trades.`, 'calculated', [tr, bm, dd, nt]);
    methodText = 'Figures come from the stored backtest record (engine, cost table and snapshot versions in the report footer). The assistant does not recompute or re-run the test.';
    for (const w of run.warnings ?? []) uncertainty.push(`${w.title}: ${w.why}`);
    uncertainty.push('Historical and simulated results do not indicate future performance.');
    s.inspect.push({ label: 'Backtest report', href: `/app/lab/runs/${input.context.run_id}` }, { label: 'Backtest methodology', href: '/methodology/backtests' });
    s.sources.push({ evidence_id: ev, label: 'Backtest run record', period: null, as_of: null, source: 'ATLAS backtest engine', href: `/app/lab/runs/${input.context.run_id}` });
  } else if (qtype === 'market') {
    const date = input.context.briefing_date;
    const ms = await tools.get_market_summary(date);
    if (!ms || !ms.breadth) return { result: base('clarify', 'research', 'Market data for that session is not available yet.'), tools };
    const br = ms.breadth;
    const evMd = br.evidence_id;
    const cA = b.claimRaw(br.advances, String(br.advances), 'Advances', evMd, 'observed', 'count');
    const cD = b.claimRaw(br.declines, String(br.declines), 'Declines', evMd, 'observed', 'count');
    const cU = b.claimRaw(br.unchanged, String(br.unchanged), 'Unchanged', evMd, 'observed', 'count');
    const cT = b.claimRaw(br.traded, String(br.traded), 'Traded securities', evMd, 'observed', 'count');
    const ix = ms.indices.find((i) => i.index_code === 'DEMO500') ?? ms.indices[0];
    const ids = [cA, cD, cU, cT];
    let idxText = '';
    if (ix && ix.returns['1D'] !== null && ix.returns['1D'] !== undefined) {
      const ci = b.claimRaw(ix.close, fmtValue(ix.close, 'index_points'), `${ix.name} close`, ix.evidence_id, 'observed', 'index_points');
      const cr = b.claimRaw(ix.returns['1D']!, fmtValue(Math.abs(ix.returns['1D']!), 'percent'), `${ix.name} 1-day return`, ix.evidence_id, 'calculated', 'percent');
      ids.push(ci, cr);
      idxText = `${ix.name} closed at ${fmtValue(ix.close, 'index_points')}, ${ix.returns['1D']! >= 0 ? 'up' : 'down'} ${fmtValue(Math.abs(ix.returns['1D']!), 'percent')}. `;
      s.sources.push({ evidence_id: ix.evidence_id, label: `${ix.name} close`, period: ms.date, as_of: ms.date, source: 'Index provider', href: `/v1/evidence/${ix.evidence_id}` });
    }
    say(`${idxText}${br.advances} of ${br.traded} traded covered securities advanced, ${br.declines} declined and ${br.unchanged} were unchanged on ${ms.date}.`, 'observed', ids);
    if (br.pct_above_50dma !== null) {
      const c5 = b.claimRaw(Number(br.pct_above_50dma), fmtValue(Number(br.pct_above_50dma), 'percent'), 'Share above 50-day average', evMd, 'calculated', 'percent');
      say(`${fmtValue(Number(br.pct_above_50dma), 'percent')} of the universe closed above its 50-day average.`, 'calculated', [c5]);
      ids.push(c5);
    }
    for (const id of ids) {
      const c = b.claims.find((x) => x.id === id)!;
      s.figures.push({ label: c.label, display: c.display, claim_id: id, evidence_id: c.evidenceId, period: ms.date });
    }
    s.sources.push({ evidence_id: evMd, label: 'Covered-universe breadth', period: ms.date, as_of: ms.date, source: 'ATLAS calculation service', href: `/v1/evidence/${evMd}` });
    methodText = 'Breadth counts covered securities by the sign of their adjusted one-day return; advances + declines + unchanged = traded securities. Index returns use trading sessions.';
    uncertainty.push('Explanations of why the market moved are hypotheses; the briefing labels them as possible explanations with timing evidence.');
    s.inspect.push({ label: 'Post-close briefing', href: `/app/briefings/${ms.date}` }, { label: 'Breadth view', href: `/app/market?date=${ms.date}#breadth` });
  } else if (company && qtype === 'announcement') {
    const anns = await tools.get_announcements(company.company_id, 5);
    const a = anns[0];
    if (!a) return { result: base('answer', 'research', `No announcements are on record for ${company.short_name}.`), tools };
    say(`The latest announcement from ${company.short_name} is “${a.subject}” (${a.category}), published ${a.published_at.slice(0, 10)}.`, 'observed', []);
    if (anns.length > 1) say(`Earlier: ${anns.slice(1, 4).map((x) => `“${x.subject}” (${x.published_at.slice(0, 10)})`).join('; ')}.`, 'observed', []);
    methodText = 'Announcement metadata comes from the licensed exchange feed. Document text is third-party content: it is treated as data, never as instructions, and numbers in it are not reported as verified figures unless they also appear in structured results data.';
    if (anns.some((x) => x.untrusted_text && /ignore (all )?previous instructions|you are now/i.test(x.untrusted_text))) uncertainty.push('One document contains text addressed to automated systems; it was ignored. Read the original filing for its content.');
    uncertainty.push('This is a description of the filing, not an assessment of its significance.');
    s.sources.push(...anns.slice(0, 3).map((x) => ({ evidence_id: `an.${x.announcement_id}`, label: x.subject, period: null, as_of: x.published_at, source: 'Exchange announcement', href: `/v1/documents/${x.announcement_id}` })));
    s.inspect.push({ label: 'Original document', href: `/v1/documents/${a.announcement_id}` }, { label: 'All announcements', href: `/app/companies/${company.company_id}?tab=disclosures` });
  } else if (company && qtype === 'quality') {
    const qf = await tools.get_quality_flags(company.company_id);
    const triggered = qf?.flags.filter((f) => f.triggered) ?? [];
    say(triggered.length ? `${triggered.length} of ${qf!.flags.length} financial quality checks require review for ${company.short_name}: ${triggered.map((f) => f.name.toLowerCase()).join(', ')}.` : `None of the ${qf?.flags.length ?? 0} financial quality checks is triggered for ${company.short_name} in the periods available.`, 'observed', []);
    for (const f of triggered) say(`${f.name}: ${f.rule.toLowerCase()}; observed ${f.observed.map((o) => `${o.period} ${o.value === null ? 'n/a' : typeof o.value === 'number' && f.code !== 'auditor_change' && f.code !== 'qualified_opinion' ? o.value.toFixed(1) : ''}`.trim()).join(', ')}.`, 'observed', f.observed.filter((o) => typeof o.value === 'number').map((o) => b.claimRaw(o.value as number, (o.value as number).toFixed(1), `${f.name} ${o.period}`, `mv.${company.company_id}.${f.code}`, 'calculated', 'ratio')));
    methodText = 'Each check is a published rule with a threshold applied to reported data. A flag describes a pattern and requires review; it implies no conclusion.';
    s.inspect.push({ label: 'Quality checks', href: `/app/companies/${company.company_id}?tab=quality` });
    uncertainty.push('Checks use structured data only; disclosures in the notes to accounts may explain the patterns.');
  } else if (company && qtype === 'ownership') {
    const sh = await tools.get_shareholding(company.company_id);
    const last = sh.history[sh.history.length - 1];
    if (!last) return { result: base('answer', 'research', `No shareholding pattern is on record for ${company.short_name}.`), tools };
    const p = last.categories.promoter!;
    const f: Fact = { id: 'promoter', label: 'Promoter holding', value: p.pct, missing: null, unit: 'percent', period: last.quarter_end, as_of: last.quarter_end, evidence_id: p.evidence_id, quality: 'validated', source: 'Shareholding pattern' };
    const id = fig(f, 'observed');
    const ids = [id];
    let change = '';
    if (last.promoter_change_pp !== null) {
      const cid = b.claimRaw(last.promoter_change_pp, fmtValue(last.promoter_change_pp, 'pp'), 'Promoter holding change', p.evidence_id, 'calculated', 'pp');
      ids.push(cid);
      change = `, a change of ${fmtValue(last.promoter_change_pp, 'pp')} on the previous quarter`;
    }
    say(`Promoter holding in ${company.short_name} was ${fmtValue(p.pct ?? 0, 'percent')} for the quarter ended ${last.quarter_end}${change}.`, 'observed', ids);
    const toolRec = tools.calls[tools.calls.length - 1]!;
    if (toolRec.fieldsWithheld.includes('pledged_pct_of_promoter')) uncertainty.push('Pledge details are shown on the company page; under the data licence they are not sent to the assistant.');
    methodText = 'Ownership percentages are as filed in the quarterly shareholding pattern.';
    s.inspect.push({ label: 'Ownership history', href: `/app/companies/${company.company_id}?tab=ownership` });
  } else if (company && qtype === 'peers') {
    const code = metric ?? 'roce';
    const pt = await tools.compare_peers(company.company_id, [code]);
    if (!pt) return { result: base('answer', 'research', 'Peer data is not available.'), tools };
    const md = METRIC_BY_CODE.get(code)!;
    const me = pt.peers.find((p) => p.is_subject)!;
    const myV = me.values[code];
    const med = pt.median[code];
    if (myV?.value === null || myV?.value === undefined || med === null || med === undefined) {
      say(`A peer comparison of ${md.name.toLowerCase()} is not possible: the value is ${MISSING_TEXT[myV?.missing ?? 'not_available']} for ${company.short_name} or for too many peers.`, 'observed', []);
    } else {
      const c1 = b.claimRaw(myV.value, fmtValue(myV.value, md.unit), `${md.name}, ${company.short_name}`, myV.evidence_id, 'calculated', md.unit);
      const c2 = b.claimRaw(med, fmtValue(med, md.unit), `${md.name}, peer median`, `peers.${company.company_id}.${code}`, 'calculated', md.unit);
      say(`${company.short_name}’s ${md.name.toLowerCase()} is ${fmtValue(myV.value, md.unit)}, against a median of ${fmtValue(med, md.unit)} for its ${pt.peers.length - 1} default peers.`, 'calculated', [c1, c2]);
      for (const p of pt.peers) {
        const v = p.values[code];
        if (v?.value === null || v?.value === undefined) continue;
        const cid = p.is_subject ? c1 : b.claimRaw(v.value, fmtValue(v.value, md.unit), `${md.name}, ${p.short_name}`, v.evidence_id, 'calculated', md.unit);
        s.figures.push({ label: `${md.name}, ${p.short_name}`, display: fmtValue(v.value, md.unit), claim_id: cid, evidence_id: v.evidence_id, period: 'latest' });
      }
    }
    methodText = `${pt.alignment} Peers: same sector, nearest by market capitalisation, same industry first.`;
    uncertainty.push(...pt.warnings);
    s.inspect.push({ label: 'Peer comparison', href: `/app/companies/${company.company_id}?tab=peers` });
  } else if (company) {
    // Results, trend and look-ups on company metrics.
    const latestQKey = (await db.maybeOne<{ k: string }>(`SELECT period_key AS k FROM calc.metric_values WHERE entity_id=$1 AND basis=$2 AND period_key ~ '^Q[1-4]FY\\d{2}$' ORDER BY period_end DESC LIMIT 1`, [company.company_id, basis]))?.k;
    if (qtype === 'results' || (qtype === 'lookup' && !metric)) {
      const key = period?.key ?? latestQKey;
      if (!key) return { result: base('answer', 'research', `No quarterly results are on record for ${company.short_name}.`), tools };
      const rev = (await tools.get_financial_series(company.company_id, 'revenue_from_operations', 'Q', basis)).find((f) => f.period === key);
      const np = (await tools.get_financial_series(company.company_id, 'net_profit', 'Q', basis)).find((f) => f.period === key);
      if (!rev) {
        const r = base('answer', 'research', `There are no ${prettyPeriod(key)} results for ${company.short_name} in ATLAS’s data. Nothing is estimated for periods that have not been reported.`);
        r.sections.uncertainty = [`The requested period ${prettyPeriod(key)} is not available (not yet filed or before the data history).`];
        r.context = { company_id: company.company_id, company_name: company.short_name };
        return { result: r, tools };
      }
      const g = (await tools.compute_metric(company.company_id, 'revenue_growth_yoy', [key], basis))[0];
      const om = (await tools.compute_metric(company.company_id, 'operating_margin', [key], basis))[0];
      const ng = (await tools.compute_metric(company.company_id, 'net_profit_growth_yoy', [key], basis))[0];
      const cRev = fig(rev, 'observed');
      const parts: string[] = [`${company.short_name} reported revenue from operations of ${fmtValue(rev.value!, 'INR_cr')} in ${prettyPeriod(key)}`];
      const ids = [cRev];
      if (g?.value !== null && g !== undefined) {
        ids.push(fig(g, 'calculated'));
        parts.push(`${g.value! >= 0 ? 'up' : 'down'} ${fmtValue(Math.abs(g.value!), 'percent')} year on year`);
      }
      say(`${parts.join(', ')}.`, 'observed', ids);
      if (np?.value !== null && np !== undefined) {
        const ids2 = [fig(np, 'observed')];
        let t = `Net profit was ${fmtValue(np.value!, 'INR_cr')}`;
        if (ng && ng.value !== null) {
          ids2.push(fig(ng, 'calculated'));
          t += `, ${ng.value >= 0 ? 'up' : 'down'} ${fmtValue(Math.abs(ng.value), 'percent')} year on year`;
        } else if (ng) {
          fig(ng, 'calculated');
          t += ` (year-on-year growth ${MISSING_TEXT[ng.missing ?? 'not_available']})`;
        }
        say(`${t}.`, 'observed', ids2);
      }
      if (om && company.template === 'standard') {
        if (om.value !== null) say(`Operating margin was ${fmtValue(om.value, 'percent')}.`, 'calculated', [fig(om, 'calculated')]);
      }
      methodText = `Reported ${basis} figures as filed; growth is (this period ÷ same period a year earlier) − 1, computed by the calculation service (revenue_growth_yoy v${METRIC_BY_CODE.get('revenue_growth_yoy')!.version}).`;
      s.inspect.push({ label: 'Quarterly financials', href: `/app/companies/${company.company_id}?tab=financials&freq=Q` });
    } else if (metric && def) {
      if (qtype === 'trend') {
        const isQ = def.periods.includes('Q');
        const series = (await tools.compute_metric(company.company_id, metric, isQ ? 'all_quarters' : 'all_years', basis)).filter((f) => !f.period?.includes('@'));
        const n = /\b(twelve|12)\b/i.test(input.question) ? 12 : /\b(four|4)\b/i.test(input.question) ? 4 : isQ ? 8 : 5;
        const window = series.slice(-n);
        const first = window[0];
        const last = window[window.length - 1];
        if (!first || !last || first.value === null || last.value === null) {
          say(`${def.name} over that window is not available for ${company.short_name}${last && last.value === null ? `: the latest value is ${MISSING_TEXT[last.missing ?? 'not_available']}` : ''}.`, 'observed', []);
          if (last) fig(last, 'calculated');
        } else {
          const c1 = fig(first, 'calculated');
          const c2 = fig(last, 'calculated');
          const change = last.value - first.value;
          const cc = def.unit === 'percent' ? b.claimRaw(change, fmtValue(Math.abs(change), 'percent').replace('%', ''), `Change in ${def.name}`, last.evidence_id, 'calculated', 'pp') : null;
          const dir = change > 0 ? 'rose' : change < 0 ? 'fell' : 'was unchanged';
          say(`${company.short_name}’s ${def.name.toLowerCase()} ${dir}${change !== 0 ? ` from ${fmtValue(first.value, def.unit)} in ${prettyPeriod(first.period!)} to ${fmtValue(last.value, def.unit)} in ${prettyPeriod(last.period!)}` : ` at ${fmtValue(last.value, def.unit)}`}${cc && change !== 0 ? `, a change of ${fmtValue(Math.abs(change), 'percent').replace('%', '')} points` : ''} over the last ${window.length} ${isQ ? 'quarters' : 'years'}.`, 'calculated', [c1, c2, ...(cc ? [cc] : [])]);
          for (const f of window.slice(1, -1)) fig(f, 'calculated');
        }
      } else {
        const keys = period ? [period.key] : ['LATEST'];
        const fact = (await tools.compute_metric(company.company_id, metric, keys, basis))[0];
        if (!fact) {
          const r = base('answer', 'research', period ? `There is no ${def.name.toLowerCase()} for ${company.short_name} in ${period.label}: the period is not in ATLAS’s data (not yet reported or before the history). Nothing is estimated.` : `${def.name} is not available for ${company.short_name}.`);
          r.sections.uncertainty = [`Requested period ${period?.label ?? 'latest'} not available.`];
          r.context = { company_id: company.company_id, company_name: company.short_name, metric };
          return { result: r, tools };
        }
        const id = fig(fact, 'calculated');
        if (fact.value === null) {
          const why = fact.missing === 'not_meaningful' && !def.templates.includes(company.template as never) ? 'not meaningful for this sector (financial-sector template)' : MISSING_TEXT[fact.missing ?? 'not_available'];
          say(`${company.short_name}’s ${def.name.toLowerCase()}${fact.period && fact.period !== 'LATEST' ? ` for ${prettyPeriod(fact.period)}` : ' (latest)'} is ${why}.`, 'calculated', []);
        } else {
          say(`${company.short_name}’s ${def.name.toLowerCase()} is ${fmtValue(fact.value, def.unit)} (${prettyPeriod(fact.period ?? 'LATEST')}${fact.as_of ? `, data as of ${fact.as_of}` : ''}).`, 'calculated', [id]);
        }
      }
      methodText = `${def.name} = ${def.formula} (definition version ${def.version}, ${basis}). Computed by the ATLAS calculation service, not by the language model.${input.experienceLevel === 'beginner' ? ` In plain terms: ${def.description}` : ''}`;
      s.inspect.push({ label: `${def.name} definition`, href: `/methodology/metrics/${def.code}` }, { label: 'Ratios', href: `/app/companies/${company.company_id}?tab=ratios` });
      if (def.lesson) s.inspect.push({ label: 'Related lesson', href: `/learn/${def.lesson}` });
    } else {
      return { result: base('clarify', 'research', `What would you like to know about ${company.short_name}? For example its latest results, operating margin trend, ROCE, peers or quality checks.`, { context: { company_id: company.company_id, company_name: company.short_name } }), tools };
    }
  } else {
    return { result: base('clarify', 'research', 'Which company or market view is this about? Ask about a covered company (for example its operating margin or latest results), the post-close briefing, or a metric definition.', { suggestions: ['What happened in the market today?', 'What is cash conversion?', 'How did Kaveri Foods’ operating margin change over the last eight quarters?'] }), tools };
  }

  // Freshness and synthetic notices
  const fresh = await freshness(db, now);
  const stale = fresh.filter((f) => f.stale && ['eod_prices', 'fundamentals', 'index'].includes(f.dataset));
  if (stale.length) uncertainty.push(`Some data is stale: ${stale.map((f) => `${f.dataset.replace('_', ' ')} (${f.label})`).join('; ')}.`);
  if (company) {
    const syn = await db.maybeOne<{ is_synthetic: boolean }>(`SELECT is_synthetic FROM ref.companies WHERE company_id=$1`, [company.company_id]);
    if (syn?.is_synthetic) uncertainty.push('This environment uses synthetic development data: the company and its figures are fictional.');
  }
  s.method = methodText || 'Not applicable.';
  s.uncertainty = uncertainty.length ? [...new Set(uncertainty)] : ['No missing, stale or conflicting data was found for the figures used.'];
  if (!s.inspect.length) s.inspect.push({ label: 'How AI answers work', href: '/methodology/ai' });

  // Optional model narrative (direct answer wording only); deterministic text is the fallback.
  let usage = { input_tokens: 0, output_tokens: 0, cost_inr: 0 };
  let status: AnswerResult['check']['status'] = 'pass';
  const names = cat.map((c) => c.short_name);
  const check = (items: AnswerItem[]) => {
    const text = [...items.map((i) => i.text), ...s.uncertainty].join('\n');
    const nums = checkClaims(text, b.claims, [1], names);
    const content = items.flatMap((i) => checkContent(i.text, { causalEvidenceLinked: false })).filter((v) => v.action === 'block' || v.category === 'causal_certainty');
    return { nums, content };
  };
  if (input.useNarrative && !input.tableOnly && s.direct_answer.length && b.claims.length) {
    const facts = b.claims.map((c) => ({ id: c.id, label: c.label, value: c.display }));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await gateway.narrate({ question: input.question, experienceLevel: input.experienceLevel, facts, untrusted: [], draft: { direct: s.direct_answer.map((d) => d.text).join(' '), method: s.method, uncertainty: s.uncertainty }, maxOutputTokens: 600 });
        if (!r) break;
        usage = { input_tokens: usage.input_tokens + r.usage.inputTokens, output_tokens: usage.output_tokens + r.usage.outputTokens, cost_inr: usage.cost_inr + r.costInr };
        const items: AnswerItem[] = [{ text: r.direct, type: 'calculated', claim_ids: b.claims.map((c) => c.id) }, ...(r.interpretation ? [{ text: r.interpretation, type: 'interpretation' as const, claim_ids: [] }] : [])];
        const c = check(items);
        if (c.nums.passed && !c.content.length && (!r.interpretation || /possible|may|might|could/i.test(r.interpretation))) {
          s.direct_answer = items;
          status = attempt === 0 ? 'pass' : 'regenerated';
          break;
        }
        status = attempt === 0 ? 'regenerated' : 'fallback';
      } catch {
        status = 'pass'; // provider unavailable: keep the deterministic composition
        break;
      }
    }
  }
  const final = check(s.direct_answer);
  let kind: AnswerResult['kind'] = 'answer';
  if (input.tableOnly || status === 'fallback' || !final.nums.passed || final.content.length) {
    // Fallback: a data table without narrative (AIA-03).
    kind = 'fallback_table';
    status = input.tableOnly ? status : 'fallback';
    s.direct_answer = [{ text: 'The figures are shown as a table without narrative.', type: 'observed', claim_ids: [] }];
  }
  const result: AnswerResult = {
    kind, intent: 'research', sections: s, claims: b.claims,
    check: { status, numbers: final.nums.numbers, unmatched: final.nums.unmatched, content_violations: final.content.map((v) => `${v.rule}: ${v.match}`) },
    context: { company_id: company?.company_id, company_name: company?.short_name, metric: metric ?? undefined, period: period?.key },
    versions, usage, disclosure: { id: STANDARD_DISCLOSURE.id, text: STANDARD_DISCLOSURE.text },
    suggestions: company ? [`What is ${company.short_name}’s ROCE?`, `Which quality checks require review for ${company.short_name}?`, `Compare ${company.short_name} with peers on operating margin`] : [],
  };
  return { result, tools };
}

export const _labels = { quarterLabel, fyLabel };
