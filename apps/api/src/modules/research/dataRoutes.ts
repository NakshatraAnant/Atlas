import type { FastifyInstance, FastifyRequest } from 'fastify';
import { worthInvestigating } from '../market/investigate.js';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { forbidden, notFound, paymentRequired, parse } from '../../lib/http.js';
import { periodStart, requireFeature, userPlan, consume, upgradeHint } from '../billing/entitlements.js';
import { requireUser, requireVerified } from '../auth/service.js';
import { track } from '../analytics/events.js';
import { isEnabled } from '../ops/flags.js';
import { comparePeers, defaultPeers, getAnnouncements, getCompany, getFinancials, getMetrics, getPrices, getQualityFlags, getShareholding, getValuation, researchSummary, searchCompanies, whatChanged } from '../companies/service.js';
import { breadthSeries, calendar, indexHistory, latestMarketDate, marketSummary, relativePerformance, sectorDetail, similarSessions } from '../market/service.js';
import { freshness, resolveEvidence } from '../provenance/evidence.js';
import { METRICS, METRIC_BY_CODE } from '../calc/definitions.js';
import { SCREEN_TEMPLATES, runScreen, screenSchema, screenerFields, screenToCsv, validateScreen } from '../screener/service.js';
import { nextTradingDay } from '../market/briefing.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function planFor(ctx: AppContext, req: FastifyRequest) {
  return req.user ? userPlan(ctx.db, req.user.userId, ctx.clock()) : null;
}

/** Free plan: 10 full profiles a month, summaries for all (PRD §4.3). Revisits in the same month are free. */
async function fullProfileAccess(ctx: AppContext, req: FastifyRequest, companyId: string): Promise<{ full: boolean; used: number; limit: number }> {
  const u = req.user;
  if (!u) return { full: false, used: 0, limit: 0 };
  const plan = await userPlan(ctx.db, u.userId, ctx.clock());
  const limit = plan.entitlements.full_profiles_per_month;
  if (limit === -1) return { full: true, used: 0, limit };
  const ps = periodStart(ctx.clock());
  const seen = await ctx.db.maybeOne(`SELECT 1 FROM app.company_views WHERE user_id=$1 AND company_id=$2 AND period_start=$3`, [u.userId, companyId, ps]);
  const count = (await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.company_views WHERE user_id=$1 AND period_start=$2`, [u.userId, ps])).n;
  if (seen) return { full: true, used: count, limit };
  if (count >= limit) return { full: false, used: count, limit };
  await ctx.db.query(`INSERT INTO app.company_views (user_id, company_id, period_start) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [u.userId, companyId, ps]);
  await consume(ctx.db, u.userId, 'full_profiles', { ...plan, entitlements: { ...plan.entitlements, full_profiles_per_month: -1 } }, ctx.clock());
  return { full: true, used: count + 1, limit };
}

async function requireFullProfile(ctx: AppContext, req: FastifyRequest, companyId: string) {
  const a = await fullProfileAccess(ctx, req, companyId);
  if (!a.full) {
    const plan = await userPlan(ctx.db, req.user!.userId, ctx.clock());
    throw paymentRequired(`You have opened ${a.limit} full company profiles this month on the Free plan. Summaries stay available for every company.`, { upgrade: upgradeHint(plan.plan, 'full_profiles_per_month'), entitlement: 'full_profiles_per_month', used: a.used, limit: a.limit });
  }
}

export async function dataRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // ── Market (MKT, HOM-01) ──
  app.get('/v1/market/summary', async (req) => {
    const q = parse(z.object({ date: date.optional() }), req.query);
    const rights = await ctx.rights();
    const s = await marketSummary(ctx.db, { date: q.date, publicOnly: !req.user, rights });
    if (!s) throw notFound('No market data yet.');
    const fresh = await freshness(ctx.db, ctx.clock());
    const eod = fresh.find((f) => f.dataset === 'eod_prices');
    return { ...s, freshness: eod ? { stale: eod.stale, label: eod.stale ? `Stale — last updated ${eod.last_data_date}` : 'End of day', last_data_date: eod.last_data_date } : null, public_view: !req.user };
  });
  app.get('/v1/market/indices/:code/history', async (req) => {
    requireUser(req);
    const { code } = parse(z.object({ code: z.string().max(20) }), req.params);
    const q = parse(z.object({ from: date.optional(), to: date.optional() }), req.query);
    const h = await indexHistory(ctx.db, code, q.from, q.to);
    if (!h) throw notFound();
    return h;
  });
  app.get('/v1/market/sectors/:sector', async (req) => {
    requireUser(req);
    const { sector } = parse(z.object({ sector: z.string().max(60) }), req.params);
    const q = parse(z.object({ date: date.optional() }), req.query);
    const d = q.date ?? (await latestMarketDate(ctx.db));
    const s = d ? await sectorDetail(ctx.db, sector, d) : null;
    if (!s) throw notFound();
    return s;
  });
  app.get('/v1/market/breadth', async (req) => {
    requireUser(req);
    const q = parse(z.object({ from: date, to: date }), req.query);
    return { series: await breadthSeries(ctx.db, q.from, q.to) };
  });
  app.get('/v1/market/relative', async (req) => {
    requireUser(req);
    const q = parse(z.object({ company_id: uuid.optional(), sector: z.string().max(60).optional(), benchmark: z.string().max(20).default('DEMO500'), date: date.optional() }), req.query);
    const d = q.date ?? (await latestMarketDate(ctx.db))!;
    const r = await relativePerformance(ctx.db, { companyId: q.company_id, sector: q.sector, benchmark: q.benchmark, date: d });
    if (!r) throw notFound();
    return r;
  });
  app.get('/v1/market/similar-sessions', async (req) => {
    requireUser(req);
    const q = parse(z.object({ date: date.optional() }), req.query);
    const d = q.date ?? (await latestMarketDate(ctx.db))!;
    const r = await similarSessions(ctx.db, d, await isEnabled(ctx.db, 'similar_sessions_forward_returns', { production: ctx.cfg.isProduction }));
    if (!r) throw notFound();
    return r;
  });
  app.get('/v1/market/briefings/:date', async (req) => {
    const { date: d } = parse(z.object({ date: z.union([date, z.literal('latest')]) }), req.params);
    const row = d === 'latest'
      ? await ctx.db.maybeOne<Record<string, unknown> & { trade_date: string }>(`SELECT * FROM calc.briefings WHERE status IN ('published','held') ORDER BY trade_date DESC LIMIT 1`)
      : await ctx.db.maybeOne<Record<string, unknown> & { trade_date: string }>(`SELECT * FROM calc.briefings WHERE trade_date=$1`, [d]);
    if (!row) {
      if (d !== 'latest') {
        const cal = await ctx.db.maybeOne<{ is_trading_day: boolean }>(`SELECT is_trading_day FROM ref.trading_calendar WHERE exchange_code='NSE' AND trade_date=$1`, [d]);
        if (cal && !cal.is_trading_day) return { trade_date: d, status: 'holiday', content: { notice: `Markets were closed on ${d}.`, next_session: await nextTradingDay(ctx.db, d) } };
      }
      throw notFound('No briefing for that date.');
    }
    if (req.user) {
      await track(ctx.db, 'briefing_opened', { briefing_date: row.trade_date, channel: (req.query as { channel?: string }).channel === 'email' ? 'email' : 'app' }, { userId: req.user.userId, origin: 'server' });
      await ctx.db.query(`INSERT INTO app.research_history (user_id, kind, ref_id, label) VALUES ($1,'briefing',$2,$3)`, [req.user.userId, row.trade_date, `Briefing ${row.trade_date}`]);
    }
    return row;
  });
  app.get('/v1/market/briefings', async (req) => {
    requireUser(req);
    return { briefings: await ctx.db.query(`SELECT trade_date, status, published_at FROM calc.briefings ORDER BY trade_date DESC LIMIT 60`) };
  });
  app.get('/v1/market/calendar', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ from: date.optional(), to: date.optional(), watchlist_only: z.enum(['true', 'false']).optional() }), req.query);
    const today = new Date(ctx.clock().getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const ids = q.watchlist_only === 'true' ? (await ctx.db.query<{ company_id: string }>(`SELECT DISTINCT i.company_id FROM app.watchlist_items i JOIN app.watchlists w USING (watchlist_id) WHERE w.user_id=$1 AND w.deleted_at IS NULL`, [u.userId])).map((r) => r.company_id) : undefined;
    return { events: await calendar(ctx.db, q.from ?? today, q.to ?? new Date(Date.parse(today) + 45 * 86_400_000).toISOString().slice(0, 10), ids) };
  });

  // ── Search and company research (CMP) ──
  app.get('/v1/search', async (req) => {
    const q = parse(z.object({ q: z.string().min(1).max(80), limit: z.coerce.number().int().min(1).max(20).default(8) }), req.query);
    return { results: await searchCompanies(ctx.db, q.q, q.limit) };
  });
  app.get('/v1/companies/:id', async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const c = await getCompany(ctx.db, id);
    if (!c) throw notFound('Company not found.');
    const access = c.coverage === 'full' ? await fullProfileAccess(ctx, req, id) : { full: false, used: 0, limit: 0 };
    if (req.user && c.coverage === 'full') {
      const prev = await ctx.db.maybeOne<{ last_visit_at: string }>(`SELECT last_visit_at FROM app.last_visits WHERE user_id=$1 AND company_id=$2`, [req.user.userId, id]);
      await ctx.db.query(`INSERT INTO app.last_visits (user_id, company_id, last_visit_at) VALUES ($1,$2,now()) ON CONFLICT (user_id, company_id) DO UPDATE SET last_visit_at=now()`, [req.user.userId, id]);
      await ctx.db.query(`INSERT INTO app.research_history (user_id, kind, ref_id, label) VALUES ($1,'company_view',$2,$3)`, [req.user.userId, id, c.short_name]);
      const changes = prev ? await ctx.db.query(`SELECT 'results_filed' AS kind, 'Q' || fiscal_quarter || ' FY' || lpad((fiscal_year % 100)::text, 2, '0') || ' results filed' AS title, filed_at AS at FROM fund.financial_periods WHERE company_id=$1 AND filed_at > $2 AND period_type='Q' AND version=1 UNION ALL SELECT 'announcement', subject, published_at FROM disc.announcements WHERE company_id=$1 AND published_at > $2 ORDER BY 3 DESC LIMIT 10`, [id, prev.last_visit_at]) : [];
      const announcements = await getAnnouncements(ctx.db, id, { limit: 5 });
      return { company: c, access, since_last_visit: prev ? { last_visit_at: prev.last_visit_at, changes } : null, recent_developments: announcements };
    }
    return { company: c, access, since_last_visit: null, recent_developments: c.coverage === 'full' && req.user ? await getAnnouncements(ctx.db, id, { limit: 5 }) : [] };
  });
  app.get('/v1/companies/:id/financials', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(z.object({ statement: z.enum(['pl', 'bs', 'cf', 'all']).default('pl'), basis: z.enum(['consolidated', 'standalone']).optional(), freq: z.enum(['Q', 'FY']).default('Q') }), req.query);
    await requireFullProfile(ctx, req, id);
    const plan = await userPlan(ctx.db, u.userId, ctx.clock());
    const t = await getFinancials(ctx.db, id, { statement: q.statement, basis: q.basis, freq: q.freq, limit: { years: plan.entitlements.history_years, quarters: plan.entitlements.history_quarters } });
    if (!t) throw notFound('No financial statements for this company.');
    return { ...t, history_limited: t.history_limited ? { ...t.history_limited, upgrade: upgradeHint(plan.plan, q.freq === 'FY' ? 'history_years' : 'history_quarters') } : null };
  });
  app.get('/v1/companies/:id/metrics', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(z.object({ codes: z.string().max(1000).optional(), freq: z.enum(['Q', 'FY', 'LATEST']).default('FY'), basis: z.enum(['consolidated', 'standalone']).optional() }), req.query);
    await requireFullProfile(ctx, req, id);
    const plan = await userPlan(ctx.db, u.userId, ctx.clock());
    const codes = q.codes ? q.codes.split(',').filter((c) => METRIC_BY_CODE.has(c)) : METRICS.filter((m) => ['growth', 'margins', 'returns', 'leverage', 'working_capital', 'cash', 'quality', 'financial_sector'].includes(m.category) && m.periods.includes(q.freq === 'LATEST' ? 'LATEST' : q.freq)).map((m) => m.code);
    return getMetrics(ctx.db, id, { codes, freq: q.freq, basis: q.basis, limit: { years: plan.entitlements.history_years, quarters: plan.entitlements.history_quarters } });
  });
  app.get('/v1/companies/:id/quality-flags', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await requireFullProfile(ctx, req, id);
    const r = await getQualityFlags(ctx.db, id);
    if (!r) throw notFound();
    return r;
  });
  app.get('/v1/companies/:id/valuation', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await requireFullProfile(ctx, req, id);
    return getValuation(ctx.db, id);
  });
  app.get('/v1/companies/:id/shareholding', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await requireFullProfile(ctx, req, id);
    return getShareholding(ctx.db, id);
  });
  app.get('/v1/companies/:id/announcements', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(z.object({ from: z.string().max(30).optional(), to: z.string().max(30).optional(), category: z.string().max(60).optional() }), req.query);
    return { announcements: await getAnnouncements(ctx.db, id, { from: q.from, to: q.to, categories: q.category ? [q.category] : undefined, limit: 100 }), latency_target: 'Within 60 minutes of arrival in the licensed feed' };
  });
  app.get('/v1/companies/:id/prices', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(z.object({ from: date.optional(), to: date.optional(), adjusted: z.enum(['true', 'false']).default('true') }), req.query);
    const r = await getPrices(ctx.db, id, { from: q.from, to: q.to, adjusted: q.adjusted === 'true' });
    if (!r) throw notFound();
    return r;
  });
  app.get('/v1/companies/:id/peers', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(z.object({ peers: z.string().max(400).optional(), metrics: z.string().max(400).optional(), peer_set_id: uuid.optional() }), req.query);
    const plan = await userPlan(ctx.db, u.userId, ctx.clock());
    requireFeature(plan, 'peer_edit_max', 'Peer comparison');
    let peers = await defaultPeers(ctx.db, id, 5);
    if (q.peer_set_id) {
      const ps = await ctx.db.maybeOne<{ peers: string[]; user_id: string }>(`SELECT peers, user_id FROM app.peer_sets WHERE peer_set_id=$1`, [q.peer_set_id]);
      if (!ps || ps.user_id !== u.userId) throw notFound();
      peers = ps.peers;
    } else if (q.peers) peers = q.peers.split(',').filter((p) => uuid.safeParse(p).success);
    if (peers.length > plan.entitlements.peer_edit_max) throw paymentRequired(`Your plan allows up to ${plan.entitlements.peer_edit_max} peers.`, { upgrade: upgradeHint(plan.plan, 'peer_edit_max'), limit: plan.entitlements.peer_edit_max });
    const metrics = q.metrics ? q.metrics.split(',').filter((m) => METRIC_BY_CODE.get(m)?.screener) : ['revenue_growth_yoy', 'operating_margin', 'roce', 'roe', 'debt_equity', 'pe_ttm', 'ev_ebitda'];
    return comparePeers(ctx.db, id, peers, metrics);
  });
  app.get('/v1/companies/:id/research-summary', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    if (!(await isEnabled(ctx.db, 'research_summary_panel', { production: ctx.cfg.isProduction }))) {
      return { enabled: false, notice: 'The research summary panel is switched off pending written legal sign-off (CPL-03). Figures, ratios and quality checks remain available.' };
    }
    const s = await researchSummary(ctx.db, id);
    if (!s) throw notFound();
    return { enabled: true, ...s };
  });
  // HOM-03: rule-based prompts for watchlist companies (rules are returned with the prompts).
  app.get('/v1/home/worth-investigating', async (req) => {
    const u = requireUser(req);
    return { ...(await worthInvestigating(ctx.db, u.userId, ctx.clock())), note: 'Prompts to look closer, generated from the rules shown. They are not signals or recommendations.' };
  });
  app.get('/v1/home/what-changed', async (req) => {
    const u = requireUser(req);
    return { items: await whatChanged(ctx.db, u.userId), empty_state: 'Add companies to a watchlist and material changes since your last visit appear here: results filed, announcements, shareholding changes and data corrections.' };
  });

  // ── Evidence and documents (MTH-01, CMP-09) ──
  app.get('/v1/evidence/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().min(3).max(200) }), req.params);
    const e = await resolveEvidence(ctx.db, decodeURIComponent(id));
    if (!e) throw notFound('Evidence not found.');
    const rights = await ctx.rights();
    if (e.source && !rights.can(e.source.dataset === 'derived_metrics' ? 'derived_metrics' : e.source.dataset, '*', 'display')) throw forbidden('This value cannot be displayed under the data licence.');
    if (req.user) await track(ctx.db, 'evidence_opened', { surface: String((req.query as { surface?: string }).surface ?? 'unknown').slice(0, 60), metric_code: e.definition?.code, source_id: e.source?.source_id }, { userId: req.user.userId, origin: 'server' });
    return e;
  });
  app.get('/v1/documents/:id', async (req, reply) => {
    requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const a = await ctx.db.maybeOne<{ document_key: string | null; subject: string; published_at: string; category: string }>(`SELECT document_key, subject, published_at, category FROM disc.announcements WHERE announcement_id=$1`, [id]);
    if (!a?.document_key) throw notFound();
    const rights = await ctx.rights();
    if (!rights.can('announcements', 'document', 'display')) throw forbidden('This document cannot be displayed under the data licence.');
    const body = await ctx.store.get(a.document_key);
    // Third-party text: served as plain text only, never as HTML.
    return reply.type('text/plain; charset=utf-8').header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'").send(`${body.toString('utf8')}\n\n— ${a.category}, published ${a.published_at}. Third-party document; ATLAS shows it unchanged.`);
  });

  // ── Screener (SCR) ──
  app.get('/v1/screener/fields', async (req) => {
    const plan = await planFor(ctx, req);
    return { ...screenerFields(plan?.entitlements.screener_filters_max ?? 10), templates: SCREEN_TEMPLATES };
  });
  app.post('/v1/screener/run', async (req) => {
    const u = requireUser(req);
    const def = parse(screenSchema, req.body);
    const plan = await userPlan(ctx.db, u.userId, ctx.clock());
    validateScreen(def, plan.entitlements.screener_filters_max);
    const r = await runScreen(ctx.db, def);
    await track(ctx.db, 'screen_run', { filters_count: def.filters.length, results_count: r.total, saved: false }, { userId: u.userId, origin: 'server' });
    const prefs = await ctx.db.maybeOne<{ display_prefs: Record<string, unknown> }>(`SELECT display_prefs FROM app.users WHERE user_id=$1`, [u.userId]);
    if (def.columns?.length && JSON.stringify(prefs?.display_prefs?.screener_columns) !== JSON.stringify(def.columns)) {
      await ctx.db.query(`UPDATE app.users SET display_prefs = display_prefs || jsonb_build_object('screener_columns', $2::jsonb) WHERE user_id=$1`, [u.userId, JSON.stringify(def.columns)]);
    }
    return r;
  });
  app.post('/v1/screener/export', async (req, reply) => {
    const u = requireVerified(req);
    const def = parse(screenSchema, req.body);
    const plan = await userPlan(ctx.db, u.userId, ctx.clock());
    requireFeature(plan, 'csv_export', 'CSV export');
    validateScreen(def, plan.entitlements.screener_filters_max);
    await consume(ctx.db, u.userId, 'csv_exports', plan, ctx.clock());
    const r = await runScreen(ctx.db, { ...def, limit: 100, offset: 0 });
    const out = screenToCsv(r, await ctx.rights(), { userId: u.userId, at: ctx.clock().toISOString() });
    await ctx.db.query(`INSERT INTO app.exports (user_id, kind, params, status, fields_omitted, completed_at) VALUES ($1,'csv_screen',$2,'ready',$3,now())`, [u.userId, JSON.stringify(def), JSON.stringify(out.omitted)]);
    return reply.type('text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="atlas-screen.csv"').header('x-atlas-fields-omitted', String(out.omitted.length)).send(out.csv);
  });
}
