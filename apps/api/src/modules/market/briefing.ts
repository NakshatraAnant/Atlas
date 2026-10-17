import { checkContent, formatDate, formatIndianNumber, POSSIBLE_EXPLANATION_LABEL, STANDARD_DISCLOSURE } from '@atlas/shared';
import { CODE_VERSION } from '../../config.js';
import type { Db } from '../../db/db.js';
import { addDays, istInstant } from '../../lib/dates.js';
import { checkClaims, type Claim } from '../ai/claims.js';

// Post-close daily briefing (PRD MKT-08, MKT-11, G1). Generated only after end-of-day data has
// passed validation. Every figure is a claim with evidence; automated number checks and the
// content rules run before publication — on failure the briefing is held and a delay notice shown.

export const BRIEFING_TEMPLATE_VERSION = 'briefing-template-v1';

export type ItemType = 'observed' | 'calculated' | 'possible_explanation' | 'data_note';
export interface BriefingItem { type: ItemType; text: string; claims: string[]; links?: { label: string; href: string }[] }
export interface BriefingSection { id: string; title: string; items: BriefingItem[]; table?: { columns: string[]; rows: (string | number)[][]; evidence: string[][] } }
export interface BriefingContent {
  trade_date: string;
  headline: string;
  sections: BriefingSection[];
  claims: Claim[];
  tiles: { label: string; value: string; change: string | null; claim: string; as_of: string; definition: string }[];
  regime: unknown;
  synthetic: boolean;
  disclosure_id: string;
}

const pct = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${formatIndianNumber(Math.abs(v), d)}%`;

async function previousTradingDay(db: Db, date: string): Promise<string | null> {
  const r = await db.maybeOne<{ d: string }>(`SELECT max(trade_date) AS d FROM ref.trading_calendar WHERE exchange_code='NSE' AND is_trading_day AND trade_date < $1`, [date]);
  return r?.d ?? null;
}

export async function nextTradingDay(db: Db, date: string): Promise<string | null> {
  const r = await db.maybeOne<{ d: string }>(`SELECT min(trade_date) AS d FROM ref.trading_calendar WHERE exchange_code='NSE' AND is_trading_day AND trade_date > $1`, [date]);
  return r?.d ?? null;
}

export interface BuildResult {
  status: 'published' | 'held' | 'holiday';
  content: BriefingContent | { notice: string; next_session?: string | null; reasons?: string[] };
  checks: { name: string; passed: boolean; detail: string }[];
}

export async function buildBriefing(db: Db, date: string): Promise<BuildResult> {
  const cal = await db.maybeOne<{ is_trading_day: boolean }>(`SELECT is_trading_day FROM ref.trading_calendar WHERE exchange_code='NSE' AND trade_date=$1`, [date]);
  if (cal && !cal.is_trading_day) {
    const next = await nextTradingDay(db, date);
    return { status: 'holiday', content: { notice: `No briefing: markets were closed on ${formatDate(date)}.${next ? ` The next session is ${formatDate(next)}.` : ''}`, next_session: next }, checks: [] };
  }
  const checks: BuildResult['checks'] = [];
  const reasons: string[] = [];
  const md = await db.maybeOne<{ traded: number; advances: number; declines: number; unchanged: number; pct_above_50dma: number | null; pct_above_200dma: number | null; new_highs: number; new_lows: number; turnover_cr: number; turnover_avg_20_cr: number | null; realised_vol_20d: number | null; vol_percentile_1y: number | null; regime: unknown }>(
    `SELECT * FROM calc.market_daily WHERE universe_code='COVERED' AND trade_date=$1`,
    [date],
  );
  const priceRun = await db.maybeOne<{ status: string }>(`SELECT status FROM ops.ingestion_runs WHERE dataset='eod_prices' AND data_date=$1 ORDER BY started_at DESC LIMIT 1`, [date]);
  checks.push({ name: 'eod_prices_validated', passed: !!priceRun && priceRun.status !== 'blocked' && priceRun.status !== 'failed', detail: priceRun ? `latest price run ${priceRun.status}` : 'no validated end-of-day file for this date' });
  checks.push({ name: 'market_aggregates_present', passed: !!md, detail: md ? 'breadth and sector aggregates computed' : 'market aggregates missing' });
  const prev = await previousTradingDay(db, date);
  const idx = await db.query<{ index_code: string; name: string; kind: string; close: number; prev: number | null }>(
    `SELECT d.index_code, d.name, d.kind, l.close, p.close AS prev FROM ref.index_definitions d
       JOIN market.index_levels l ON l.index_code=d.index_code AND l.trade_date=$1
       LEFT JOIN market.index_levels p ON p.index_code=d.index_code AND p.trade_date=$2
      WHERE d.kind='price' ORDER BY d.index_code`,
    [date, prev],
  );
  checks.push({ name: 'index_levels_present', passed: idx.length > 0, detail: `${idx.length} price indices with a level on ${date}` });
  if (!md || !idx.length || checks.some((c) => !c.passed)) {
    reasons.push(...checks.filter((c) => !c.passed).map((c) => c.detail));
    return { status: 'held', content: { notice: `The ${formatDate(date)} briefing is held: end-of-day data has not passed validation yet. It will be published when the data is validated.`, reasons }, checks };
  }

  const claims: Claim[] = [];
  let k = 0;
  const claim = (value: number, label: string, evidenceId: string, unit?: string): string => {
    const id = `c${++k}`;
    claims.push({ id, value, label, evidenceId, unit });
    return id;
  };
  const broad = idx.find((i) => i.index_code === 'DEMO500') ?? idx[0]!;
  const broadRet = broad.prev ? (broad.close / broad.prev - 1) * 100 : 0;
  const cBroad = claim(broad.close, `${broad.name} close`, `ix.${broad.index_code}.${date}`, 'index_points');
  const cBroadRet = claim(broadRet, `${broad.name} 1-day return`, `ix.${broad.index_code}.${date}`, 'percent');
  const cAdv = claim(md.advances, 'Advances', `md.COVERED.${date}`, 'count');
  const cDec = claim(md.declines, 'Declines', `md.COVERED.${date}`, 'count');
  const cUnch = claim(md.unchanged, 'Unchanged', `md.COVERED.${date}`, 'count');
  const cTraded = claim(md.traded, 'Traded securities', `md.COVERED.${date}`, 'count');
  const advShare = (md.advances / md.traded) * 100;
  const cAdvShare = claim(advShare, 'Share of traded securities that advanced', `md.COVERED.${date}`, 'percent');
  const sections: BriefingSection[] = [];
  const direction = broadRet > 0 ? 'up' : broadRet < 0 ? 'down' : 'unchanged';
  sections.push({
    id: 'what_happened', title: 'What happened', items: [
      { type: 'observed', text: `${broad.name} closed at ${formatIndianNumber(broad.close, 2)}, ${direction} ${formatIndianNumber(Math.abs(broadRet), 2)}% on the session.`, claims: [cBroad, cBroadRet], links: [{ label: 'Index history', href: `/app/market/indices/${broad.index_code}` }] },
      ...idx.filter((i) => i !== broad && i.prev).map((i) => {
        const r = (i.close / i.prev! - 1) * 100;
        const c1 = claim(i.close, `${i.name} close`, `ix.${i.index_code}.${date}`);
        const c2 = claim(r, `${i.name} 1-day return`, `ix.${i.index_code}.${date}`, 'percent');
        return { type: 'observed' as const, text: `${i.name}: ${formatIndianNumber(i.close, 2)} (${pct(r)}).`, claims: [c1, c2] };
      }),
    ],
  });
  const p50 = md.pct_above_50dma;
  const c50 = p50 !== null ? claim(p50, 'Share above 50-day average', `md.COVERED.${date}`, 'percent') : null;
  const cHi = claim(md.new_highs, 'New 52-week highs', `md.COVERED.${date}`, 'count');
  const cLo = claim(md.new_lows, 'New 52-week lows', `md.COVERED.${date}`, 'count');
  sections.push({
    id: 'how_broad', title: 'How broad', items: [
      { type: 'observed', text: `${md.advances} of ${md.traded} traded covered securities advanced, ${md.declines} declined and ${md.unchanged} were unchanged (${md.advances} + ${md.declines} + ${md.unchanged} = ${md.traded}).`, claims: [cAdv, cDec, cUnch, cTraded], links: [{ label: 'Breadth view', href: `/app/market?date=${date}#breadth` }] },
      { type: 'calculated', text: `${formatIndianNumber(advShare, 1)}% of traded securities advanced${p50 !== null ? `; ${formatIndianNumber(p50, 1)}% closed above their 50-day average` : ''}. New 52-week highs: ${md.new_highs}; new lows: ${md.new_lows}.`, claims: [cAdvShare, ...(c50 ? [c50] : []), cHi, cLo] },
    ],
  });
  // Sectors
  const sectors = await db.query<{ sector: string; ret_equal: number; ret_cap: number; constituents: number; advances: number; declines: number }>(`SELECT sector, ret_equal, ret_cap, constituents, advances, declines FROM calc.sector_daily WHERE trade_date=$1 ORDER BY ret_cap DESC`, [date]);
  const sectorRows = sectors.map((s) => [s.sector, pct(s.ret_equal * 100), pct(s.ret_cap * 100), `${s.advances}/${s.constituents}`]);
  const sectorEvidence = sectors.map((s) => [`sec.${date}.${s.sector}`]);
  for (const s of sectors) {
    claim(s.ret_equal * 100, `${s.sector} equal-weighted return`, `sec.${date}.${s.sector}`, 'percent');
    claim(s.ret_cap * 100, `${s.sector} cap-weighted return`, `sec.${date}.${s.sector}`, 'percent');
  }
  const leader = sectors[0];
  const laggard = sectors[sectors.length - 1];
  sections.push({
    id: 'sectors', title: 'Sectors', items: [
      { type: 'data_note', text: 'Sector returns use the covered universe and the documented classification (version 1). Contribution to the index move is hidden because index weights are not licensed.', claims: [] },
    ],
    table: { columns: ['Sector', 'Equal-weighted', 'Cap-weighted', 'Advancing / constituents'], rows: sectorRows, evidence: sectorEvidence },
  });
  // Disclosures: filings and announcements received for covered companies on the date
  const ann = await db.query<{ announcement_id: string; short_name: string; company_id: string; category: string; subject: string; published_at: string; sector: string }>(
    `SELECT a.announcement_id, c.short_name, c.company_id, a.category, a.subject, a.published_at, c.sector FROM disc.announcements a JOIN ref.companies c USING (company_id)
      WHERE a.published_at > $1 AND a.published_at <= $2 AND a.category IN ('Financial Results','Change in Auditor','Acquisition','Credit Rating','Dividend') ORDER BY a.published_at`,
    [istInstant(prev ?? addDays(date, -1), '15:30'), istInstant(date, '20:00')],
  );
  sections.push({
    id: 'disclosures', title: 'Notable disclosures', items: ann.length
      ? ann.slice(0, 12).map((a) => ({ type: 'observed' as const, text: `${a.short_name}: ${a.subject} (${a.category}).`, claims: [], links: [{ label: 'Original document', href: `/v1/documents/${a.announcement_id}` }, { label: 'Company', href: `/app/companies/${a.company_id}` }] }))
      : [{ type: 'observed', text: 'No results or other notable announcements were received for covered companies in this window.', claims: [] }],
  });
  // Context against history
  const ctxItems: BriefingItem[] = [];
  if (md.turnover_avg_20_cr) {
    const ratio = md.turnover_cr / md.turnover_avg_20_cr;
    const cR = claim(ratio, 'Turnover vs 20-day average', `md.COVERED.${date}`, 'ratio');
    ctxItems.push({ type: 'calculated', text: `Turnover was ${formatIndianNumber(ratio, 2)}× its 20-day average.`, claims: [cR] });
  }
  if (md.realised_vol_20d !== null && md.vol_percentile_1y !== null) {
    const cV = claim(md.realised_vol_20d * 100, 'Index realised volatility (20-day, annualised)', `md.COVERED.${date}`, 'percent');
    const cP = claim(md.vol_percentile_1y, 'Volatility percentile (1 year)', `md.COVERED.${date}`, 'percent');
    ctxItems.push({ type: 'calculated', text: `20-day realised volatility of the broad index was ${formatIndianNumber(md.realised_vol_20d * 100, 1)}%, at the ${Math.round(md.vol_percentile_1y)}th percentile of the past year.`, claims: [cV, cP] });
  }
  sections.push({ id: 'context', title: 'Context against history', items: ctxItems });
  // Possible explanations (hypothesis language; timing evidence shown, causation not claimed)
  const expl: BriefingItem[] = [];
  if (leader && laggard && leader !== laggard) {
    const leaderFilings = ann.filter((a) => a.sector === leader.sector);
    const cL = claim(leader.ret_cap * 100, `${leader.sector} cap-weighted return`, `sec.${date}.${leader.sector}`, 'percent');
    if (leaderFilings.length) {
      expl.push({ type: 'possible_explanation', text: `${leader.sector} led the session (${pct(leader.ret_cap * 100)} cap-weighted). A possible explanation is the ${leaderFilings.length === 1 ? 'filing' : 'filings'} from ${leaderFilings.slice(0, 3).map((f) => f.short_name).join(', ')} in the same window. The timing is consistent; causation is not shown.`, claims: [cL], links: leaderFilings.slice(0, 3).map((f) => ({ label: `${f.short_name} filing`, href: `/v1/documents/${f.announcement_id}` })) });
    } else {
      expl.push({ type: 'possible_explanation', text: `${leader.sector} led the session (${pct(leader.ret_cap * 100)} cap-weighted). No sector-specific filing was received in the window, so no explanation is offered.`, claims: [cL] });
    }
  }
  sections.push({ id: 'possible_explanations', title: `${POSSIBLE_EXPLANATION_LABEL}s`, items: expl });
  // Data notes
  const quarantined = await db.maybeOne<{ n: number }>(`SELECT coalesce(sum(rows_quarantined),0)::int AS n FROM ops.ingestion_runs WHERE dataset='eod_prices' AND data_date=$1`, [date]);
  const synthetic = (await db.maybeOne<{ s: boolean }>(`SELECT bool_or(is_synthetic) AS s FROM ref.sources WHERE status='active'`))?.s ?? false;
  const notes: BriefingItem[] = [];
  if (quarantined && quarantined.n > 0) {
    const cQ = claim(quarantined.n, 'Quarantined price rows', `qi.eod_prices.${date}`, 'count');
    notes.push({ type: 'data_note', text: `${quarantined.n} price row(s) failed validation and were quarantined; affected securities show their last validated value with a stale label.`, claims: [cQ] });
  }
  if (synthetic) notes.push({ type: 'data_note', text: 'This environment uses synthetic development data generated by ATLAS. Companies and figures are fictional.', claims: [] });
  notes.push({ type: 'data_note', text: 'End-of-day data. Nothing here is live.', claims: [] });
  sections.push({ id: 'data_notes', title: 'Data notes', items: notes });

  const tiles: BriefingContent['tiles'] = idx.map((i) => ({ label: i.name, value: formatIndianNumber(i.close, 2), change: i.prev ? pct((i.close / i.prev - 1) * 100) : null, claim: claims.find((c) => c.evidenceId === `ix.${i.index_code}.${date}`)?.id ?? cBroad, as_of: `${date}T10:00:00.000Z`, definition: 'index_return' }));
  const headline = `${formatDate(date)} — post-close briefing`;
  const content: BriefingContent = { trade_date: date, headline, sections, claims, tiles, regime: md.regime, synthetic, disclosure_id: STANDARD_DISCLOSURE.id };

  // Automated number checks: every number in every item must match a claim value.
  const allText = sections.flatMap((s) => s.items.map((i) => i.text));
  const names = [...idx.map((i) => i.name), ...sectors.map((s) => s.sector), ...ann.map((a) => a.short_name)];
  const numberCheck = allText.map((t) => checkClaims(t, claims, [1], names));
  const unmatched = numberCheck.flatMap((c) => c.unmatched);
  checks.push({ name: 'number_check', passed: unmatched.length === 0, detail: unmatched.length ? `unmatched numbers: ${unmatched.slice(0, 5).join(', ')}` : `${numberCheck.reduce((s, c) => s + c.numbers, 0)} numbers matched to evidence` });
  const contentViolations = sections.flatMap((s) => s.items.filter((i) => i.type !== 'possible_explanation' || true).flatMap((i) => checkContent(i.text, { causalEvidenceLinked: false })));
  checks.push({ name: 'content_rules', passed: contentViolations.length === 0, detail: contentViolations.length ? contentViolations.map((v) => `${v.rule}: "${v.match}"`).join('; ') : 'no prohibited or causal-certainty language' });
  const explanationLabelled = expl.every((e) => e.type === 'possible_explanation' && /possible explanation|no explanation is offered/i.test(e.text));
  checks.push({ name: 'hypothesis_labelling', passed: explanationLabelled, detail: 'explanations use the Possible explanation label (MKT-11)' });
  if (checks.some((c) => !c.passed)) {
    return { status: 'held', content: { notice: `The ${formatDate(date)} briefing is held because automated checks did not pass. It will be published after review.`, reasons: checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`) }, checks };
  }
  return { status: 'published', content, checks };
}

export async function generateAndStoreBriefing(db: Db, date: string, publishAt: Date): Promise<BuildResult> {
  const r = await buildBriefing(db, date);
  await db.query(
    `INSERT INTO calc.briefings (trade_date, status, generated_at, published_at, content, checks, versions) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (trade_date) DO UPDATE SET status=EXCLUDED.status, generated_at=EXCLUDED.generated_at, published_at=COALESCE(calc.briefings.published_at, EXCLUDED.published_at), content=EXCLUDED.content, checks=EXCLUDED.checks, versions=EXCLUDED.versions`,
    [date, r.status, publishAt.toISOString(), r.status === 'published' ? publishAt.toISOString() : null, JSON.stringify(r.content), JSON.stringify(r.checks), JSON.stringify({ template: BRIEFING_TEMPLATE_VERSION, code: CODE_VERSION })],
  );
  return r;
}
