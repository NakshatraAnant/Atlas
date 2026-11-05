import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';

// Universal search over records ATLAS actually holds: Indian indices with stored prices, crypto assets,
// commodity and macro series with observations, Academy courses and lessons, and the signed-in user's
// own research (notebook, reports, portfolios, saved views; never anyone else's). Common words map to
// the series they usually mean ("oil" → WTI/Brent, "rupee" → INR per USD). Nothing is returned for
// instruments ATLAS has no data for; known gaps answer with an explanation instead.

export interface Hit { kind: 'index' | 'crypto' | 'commodity' | 'macro' | 'course' | 'lesson' | 'research' | 'page'; title: string; subtitle: string; href: string; score: number }

/** Plain-language aliases → terms that appear in stored names or identifiers. */
export const ALIASES: Record<string, string[]> = {
  oil: ['crude_oil', 'wti', 'brent'], crude: ['crude_oil'], petrol: ['gasoline'], gas: ['natural_gas', 'gasoline'], lng: ['lng'],
  rupee: ['DEXINUS'], inr: ['DEXINUS'], dollar: ['DTWEXBGS', 'DEXINUS'], usd: ['DTWEXBGS', 'DEXINUS'], fx: ['DEXINUS', 'DTWEXBGS'],
  inflation: ['CPIAUCSL', 'CPILFESL', 'PCEPILFE', 'INDCPIALLMINMEI'], cpi: ['CPIAUCSL', 'CPILFESL', 'INDCPIALLMINMEI'], pce: ['PCEPILFE'],
  yield: ['DGS10', 'DGS2', 'T10Y2Y', 'DFII10'], yields: ['DGS10', 'DGS2', 'T10Y2Y', 'DFII10'], bond: ['DGS10', 'DGS2'], treasury: ['DGS10', 'DGS2'], curve: ['T10Y2Y'],
  fed: ['DFF'], rates: ['DFF', 'DGS2', 'DGS10'], jobs: ['PAYEMS', 'UNRATE'], unemployment: ['UNRATE'], payrolls: ['PAYEMS'], gdp: ['GDPC1', 'MKTGDPINA646NWDB'],
  stress: ['STLFSI4', 'NFCI'], conditions: ['NFCI'], india: ['MKTGDPINA646NWDB', 'INDCPIALLMINMEI', 'DEXINUS', 'NIFTY50', 'SENSEX', 'NIFTYBANK'],
  nifty: ['NIFTY50', 'NIFTYBANK'], 'bank nifty': ['NIFTYBANK'], banknifty: ['NIFTYBANK'], sensex: ['SENSEX'], btc: ['bitcoin'], eth: ['ethereum'], sol: ['solana'],
  metals: ['copper', 'aluminium', 'nickel', 'zinc'], grains: ['wheat', 'maize', 'rice', 'soybeans'], inventory: ['WCESTUS1', 'NW2_EPG0_SWO_R48_BCF'], storage: ['NW2_EPG0_SWO_R48_BCF'],
};

/** Things people look for that ATLAS deliberately does not have, with the reason. */
export const KNOWN_GAPS: { terms: string[]; message: string }[] = [
  { terms: ['gold', 'silver', 'platinum'], message: 'Gold and silver prices are not available: no free, permitted daily source was found (the LBMA series were withdrawn from FRED).' },
  { terms: ['reliance', 'tcs', 'infosys', 'hdfc', 'icici', 'sbi', 'stock', 'share', 'shares', 'company', 'fundamentals'], message: 'Individual Indian shares and company financials are not available: the free EODHD plan covers indices only, and NSE/BSE data need a licence.' },
  { terms: ['mcx', 'futures', 'f&o', 'options'], message: 'Indian futures and options are not available: exchange terms prohibit automated collection and redistribution without a licence.' },
];

const PAGES: Omit<Hit, 'score'>[] = [
  { kind: 'page', title: 'Home', subtitle: 'Your market snapshot', href: '/app' },
  { kind: 'page', title: 'Indian markets', subtitle: 'Indices, explorer, coverage', href: '/app/equities' },
  { kind: 'page', title: 'Commodities', subtitle: 'Benchmarks, spreads, inventories', href: '/app/commodities' },
  { kind: 'page', title: 'Macro', subtitle: 'Inflation, rates, labour, growth', href: '/app/macro' },
  { kind: 'page', title: 'Macro relationship explorer', subtitle: 'Compare two series; rolling correlation', href: '/app/macro/explorer' },
  { kind: 'page', title: 'Digital assets', subtitle: 'Crypto markets, DeFi, on-chain', href: '/app/crypto' },
  { kind: 'page', title: 'Research hub', subtitle: 'Workbench, portfolios, backtests, notebook, reports', href: '/app/research-hub' },
  { kind: 'page', title: 'Your data', subtitle: 'Upload your own price files', href: '/app/research/datasets' },
  { kind: 'page', title: 'Academy', subtitle: 'Courses, missions, progress', href: '/app/academy' },
  { kind: 'page', title: 'My progress', subtitle: 'XP, rank, achievements, skill map', href: '/app/academy/progress' },
  { kind: 'page', title: 'Data sources', subtitle: 'Where data comes from and how current it is', href: '/app/data-health' },
  { kind: 'page', title: 'Settings', subtitle: 'Home layout, notifications, theme', href: '/app/settings' },
];

/** Settings markets → hit kinds they favour (macro covers the US economy and the rupee). */
const MARKET_KINDS: Record<string, Hit['kind'][]> = { india: ['index'], us: ['macro'], commodities: ['commodity'], crypto: ['crypto'] };

export async function searchAll(ctx: AppContext, userId: string, q: string, limit = 20): Promise<{ hits: Hit[]; gaps: string[] }> {
  const db = ctx.db;
  const query = q.trim().toLowerCase();
  if (!query) return { hits: PAGES.map((p, i) => ({ ...p, score: 100 - i })), gaps: [] };
  const like = `%${query}%`;
  const aliasTerms = Object.entries(ALIASES).filter(([k]) => k.startsWith(query) || query.split(/\s+/).includes(k)).flatMap(([, v]) => v);
  const aliasLike = aliasTerms.map((t) => t.toLowerCase());
  const score = (title: string, id: string, base: number) => {
    const t = title.toLowerCase();
    const i = id.toLowerCase();
    return base + (t === query || i === query ? 50 : t.startsWith(query) || i.startsWith(query) ? 30 : t.includes(query) || i.includes(query) ? 15 : aliasLike.some((a) => i.includes(a) || t.includes(a)) ? 12 : 0);
  };
  const hits: Hit[] = [];
  const indices = await db.query<{ exchange: string; symbol: string; name: string | null; last_date: string | null }>(
    `SELECT i.exchange, i.symbol, i.name, to_char(max(s.last_date),'YYYY-MM-DD') AS last_date FROM equity.instruments i JOIN equity.price_series s USING (instrument_id)
      WHERE s.observations > 0 AND (lower(i.symbol) LIKE $1 OR lower(coalesce(i.name,'')) LIKE $1 OR lower(i.symbol) = ANY($2)) GROUP BY i.exchange, i.symbol, i.name LIMIT 10`, [like, aliasLike]);
  for (const r of indices) hits.push({ kind: 'index', title: r.name ?? r.symbol, subtitle: `${r.exchange}:${r.symbol} · end of day · last ${r.last_date ?? '—'}`, href: `/app/equities/${r.exchange}/${encodeURIComponent(r.symbol)}`, score: score(r.name ?? r.symbol, r.symbol, 40) });
  const crypto = await db.query<{ canonical_key: string; name: string; symbol: string; market_cap_rank: number | null }>(
    `SELECT a.canonical_key, a.name, a.symbol, a.market_cap_rank FROM crypto.assets a WHERE a.listing_status='listed' AND (lower(a.name) LIKE $1 OR lower(a.symbol) LIKE $1 OR a.canonical_key = ANY($2))
      ORDER BY a.market_cap_rank NULLS LAST LIMIT 8`, [like, aliasLike]);
  for (const r of crypto) hits.push({ kind: 'crypto', title: `${r.name} (${r.symbol.toUpperCase()})`, subtitle: `Crypto${r.market_cap_rank ? ` · rank ${r.market_cap_rank}` : ''} · CoinGecko reference price`, href: `/app/crypto/assets/${r.canonical_key}`, score: score(r.name, r.symbol, 30) - Math.min(10, (r.market_cap_rank ?? 100) / 20) });
  const comm = await db.query<{ series_id: string; name: string; source_id: string; source_series: string; frequency: string; unit: string; commodity: string }>(
    `SELECT series_id, name, source_id, source_series, frequency, unit, commodity FROM commodity.series WHERE enabled AND observations > 0 AND (lower(name) LIKE $1 OR commodity LIKE $1 OR lower(source_series) LIKE $1 OR commodity = ANY($2) OR lower(source_series) = ANY($2) OR lower(name) LIKE ANY($3)) LIMIT 10`,
    [like, aliasLike, aliasLike.map((a) => `%${a}%`)]);
  for (const r of comm) hits.push({ kind: 'commodity', title: r.name, subtitle: `${r.frequency} · ${r.unit} · ${r.source_id.toUpperCase()} ${r.source_series}`, href: `/app/commodities/${r.source_id}/${r.source_series}`, score: score(r.name, `${r.commodity} ${r.source_series}`, 35) });
  const macro = await db.query<{ series_id: string; title: string; frequency: string | null; units: string | null }>(
    `SELECT series_id, title, frequency, units FROM macro.series WHERE enabled AND observations > 0 AND (lower(title) LIKE $1 OR lower(series_id) LIKE $1 OR lower(coalesce(notes,'')) LIKE $1 OR lower(series_id) = ANY($2)) LIMIT 10`, [like, aliasLike]);
  for (const r of macro) hits.push({ kind: 'macro', title: r.title, subtitle: `${r.series_id} · ${r.frequency ?? ''} · ${r.units ?? ''} · FRED`, href: `/app/macro/${r.series_id}`, score: score(r.title, r.series_id, 35) });
  const lessons = await db.query<{ lesson_id: string; title: string; course: string }>(
    `SELECT DISTINCT ON (l.lesson_id) l.lesson_id, l.title, cv.title AS course FROM acad.lessons l JOIN acad.modules m ON m.module_id=l.module_id
       JOIN LATERAL (SELECT title FROM acad.course_versions v WHERE v.course_id=m.course_id ORDER BY v.version DESC LIMIT 1) cv ON true
      WHERE lower(l.title) LIKE $1 ORDER BY l.lesson_id, l.version DESC LIMIT 8`, [like]).catch(() => []);
  for (const r of lessons) hits.push({ kind: 'lesson', title: r.title, subtitle: `Lesson · ${r.course.replace('ATLAS: ', '')}`, href: `/app/academy/lesson/${r.lesson_id}`, score: score(r.title, r.lesson_id, 20) });
  const courses = await db.query<{ course_id: string; title: string }>(
    `SELECT DISTINCT ON (course_id) course_id, title FROM acad.course_versions WHERE lower(title) LIKE $1 ORDER BY course_id, version DESC LIMIT 5`, [like]).catch(() => []);
  for (const r of courses) hits.push({ kind: 'course', title: r.title.replace('ATLAS: ', ''), subtitle: 'Academy course', href: `/app/academy/${r.course_id}`, score: score(r.title, r.course_id, 22) });
  // The user's own research only.
  const mine = await db.query<{ kind: string; id: string; title: string }>(
    `(SELECT 'notebook' AS kind, entry_id::text AS id, title FROM research.notebook_entries WHERE user_id=$1 AND deleted_at IS NULL AND lower(title) LIKE $2 LIMIT 5)
     UNION ALL (SELECT 'report', report_id::text, title FROM research.reports WHERE user_id=$1 AND deleted_at IS NULL AND lower(title) LIKE $2 LIMIT 5)
     UNION ALL (SELECT 'portfolio', portfolio_id::text, name FROM research.portfolios WHERE user_id=$1 AND deleted_at IS NULL AND lower(name) LIKE $2 LIMIT 5)
     UNION ALL (SELECT 'saved view', view_id::text, name FROM research.saved_views WHERE user_id=$1 AND deleted_at IS NULL AND lower(name) LIKE $2 LIMIT 5)`, [userId, like]).catch(() => []);
  const tab: Record<string, string> = { notebook: 'notebook', report: 'reports', portfolio: 'portfolios', 'saved view': 'workbench' };
  for (const r of mine) hits.push({ kind: 'research', title: r.title, subtitle: `Your ${r.kind}`, href: `/app/research-hub?tab=${tab[r.kind] ?? 'notebook'}`, score: score(r.title, r.id, 45) });
  for (const p of PAGES) if (p.title.toLowerCase().includes(query) || p.subtitle.toLowerCase().includes(query)) hits.push({ ...p, score: score(p.title, p.href, 25) });
  // Markets the user marked in Settings rank first among otherwise similar matches.
  const prefs = await db.maybeOne<{ m: string[] | null }>(`SELECT display_prefs->'markets' AS m FROM app.users WHERE user_id=$1`, [userId]);
  const preferred = new Set((Array.isArray(prefs?.m) ? prefs.m : []).flatMap((m) => MARKET_KINDS[m] ?? []));
  if (preferred.size) for (const h of hits) if (preferred.has(h.kind)) h.score += 8;
  hits.sort((a, b) => b.score - a.score);
  const gaps = KNOWN_GAPS.filter((g) => g.terms.some((t) => query.includes(t) || t.startsWith(query) && query.length >= 3)).map((g) => g.message);
  return { hits: hits.slice(0, limit), gaps };
}

export async function searchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/find', { config: { rateLimit: { limit: 240, windowMs: 60_000, key: 'user' } } }, async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ q: z.string().max(80).default('') }), req.query);
    return searchAll(ctx, u.userId, q.q);
  });
}
