import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { randomToken } from '../../lib/crypto.js';
import { notFound, parse, badRequest } from '../../lib/http.js';
import { CLIENT_EVENTS, hasAnalyticsConsent, track, type EventName } from '../analytics/events.js';
import { requireUser } from '../auth/service.js';
import { userPlan } from '../billing/entitlements.js';
import { METRICS, METRIC_BY_CODE } from '../calc/definitions.js';
import { freshness } from '../provenance/evidence.js';
import { createDraft, listContent, publish, publishedPage, PUBLISH_CHECKS, submitForReview, type CmsKind } from './cms.js';
import { audit } from '../ops/audit.js';
import { requireRole } from '../auth/service.js';
import { HELP_ARTICLES, LEGAL_PAGES, LESSONS, METHODOLOGY_PAGES, RELEASE_NOTES } from './content.js';
import { raiseQualityIssue } from '../../pipeline/context.js';

/** Business-day arithmetic for support targets (Mon–Fri). */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

const PARAGRAPH = '\n\n';

export async function contentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  // Methodology (MTH-01..MTH-06)
  app.get('/v1/methodology/metrics', async () => ({ metrics: METRICS.map((m) => ({ code: m.code, version: m.version, name: m.name, category: m.category, unit: m.unit, screener: m.screener })) }));
  app.get('/v1/methodology/metrics/:code', async (req) => {
    const { code } = parse(z.object({ code: z.string().max(60) }), req.params);
    const m = METRIC_BY_CODE.get(code);
    if (!m) throw notFound('No definition for that metric.');
    const versions = await db.query(`SELECT version, published_at, change_note, formula_expr FROM calc.metric_definitions WHERE metric_code=$1 ORDER BY version DESC`, [code]);
    return { ...m, versions, lesson_url: m.lesson ? `/learn/${m.lesson}` : null };
  });
  app.get('/v1/methodology/pages/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().max(40) }), req.params);
    const builtin = METHODOLOGY_PAGES[slug];
    const override = await publishedPage(db, 'methodology', slug);
    if (!builtin && !override) throw notFound();
    const p = override ? { title: override.title, sections: override.sections, version: override.version, published_at: override.published_at } : { ...builtin!, version: 0, published_at: null };
    let evaluation = null;
    if (slug === 'ai') {
      evaluation = await db.maybeOne(`SELECT provider, model_id, prompt_version, tool_version, metrics, thresholds, passed, finished_at FROM ai.eval_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`);
    }
    if (slug === 'backtests') {
      evaluation = await db.query(`SELECT version, components, verified_against_current_schedules, notes FROM bt.cost_tables ORDER BY effective_from DESC`);
    }
    return { ...p, data: evaluation };
  });
  app.get('/v1/sources/status', async () => {
    const sources = await db.query(`SELECT s.source_id, s.provider, s.dataset, s.description, s.schedule, s.delay_note, s.coverage_note, s.known_limitations, s.status, s.last_success_at, s.last_data_date, s.is_synthetic, l.status AS licence_status, l.attribution_text FROM ref.sources s LEFT JOIN ref.licences l USING (licence_id) ORDER BY s.source_id`);
    const fresh = await freshness(db, ctx.clock());
    const pending = await db.query(`SELECT counterparty, contract_ref, status, permitted_use FROM ref.licences WHERE status IN ('under_negotiation','draft') ORDER BY counterparty`);
    const coverage = await db.one(`SELECT count(*) FILTER (WHERE coverage='full')::int AS full_profiles, count(*)::int AS searchable, min(created_at) AS freeze_date FROM ref.companies`);
    return { sources: sources.map((s) => ({ ...s, freshness: fresh.find((f) => f.source_id === (s as { source_id: string }).source_id) ?? null })), pending_licences: pending, coverage, generated_at: ctx.clock().toISOString() };
  });
  app.get('/v1/coverage', async () => ({ companies: await db.query(`SELECT company_id, short_name, sector, industry, status FROM ref.companies WHERE coverage='full' ORDER BY short_name`), freeze_note: 'Coverage universe as of the latest master-data load; requests for other companies are reviewed weekly.' }));
  app.get('/v1/corrections', async () => ({ corrections: await db.query(`SELECT correction_id, published_at, kind, title, description, impact, users_notified FROM calc.corrections ORDER BY published_at DESC LIMIT 200`) }));
  app.get('/v1/status', async () => {
    const incidents = await db.query(`SELECT incident_id, component, title, severity, status, started_at, posted_at, resolved_at, updates FROM ops.status_incidents ORDER BY started_at DESC LIMIT 20`);
    if (!ctx.cfg.allowSyntheticData) {
      // Real-data mode: one line per data pipeline, from the durable provider state. "Operational" only
      // when the provider's last request succeeded and it is not paused.
      const states = await db.query<{ provider_id: string; configured: boolean; status: string; last_success_at: string | null; next_eligible_at: string | null }>(`SELECT provider_id, configured, status, last_success_at, next_eligible_at FROM ops.provider_state WHERE provider_id <> 'fred_csv'`);
      const NAMES: Record<string, string> = { eodhd: 'Indian indices (EODHD, end of day)', fred: 'Macro and commodity benchmarks (FRED)', eia: 'US energy inventories (EIA)', coingecko: 'Crypto market data (CoinGecko)', data_gov_in: 'Indian mandi prices (data.gov.in)' };
      const label = (s: { configured: boolean; status: string }) => (!s.configured ? 'not connected' : s.status === 'operational' ? 'operational' : ['rate_limited', 'quota_exhausted', 'recovering'].includes(s.status) ? 'limited, resuming automatically' : s.status === 'unknown' ? 'starting' : s.status === 'degraded' ? 'degraded' : 'unavailable');
      return { demo_mode: false, components: [{ name: 'Web application and API', status: 'operational' }, ...states.map((s) => ({ name: NAMES[s.provider_id] ?? s.provider_id, status: label(s), last_success_at: s.last_success_at }))], incidents, latest_briefing: null };
    }
    const fresh = await freshness(db, ctx.clock());
    const briefing = await db.maybeOne(`SELECT trade_date, status, published_at FROM calc.briefings ORDER BY trade_date DESC LIMIT 1`);
    return { demo_mode: true, components: [{ name: 'Web application and API', status: 'operational' }, { name: 'End-of-day data pipeline (demo data)', status: fresh.some((f) => f.stale && ['eod_prices', 'index'].includes(f.dataset)) ? 'degraded' : 'operational' }, { name: 'Daily briefing', status: briefing ? (briefing as { status: string }).status : 'no data' }], incidents, latest_briefing: briefing };
  });
  app.get('/v1/release-notes', async () => ({ releases: RELEASE_NOTES }));
  app.get('/v1/legal/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().max(30) }), req.params);
    const p = LEGAL_PAGES[slug];
    if (!p) throw notFound();
    return p;
  });

  // Help centre (SUP-02): searchable
  app.get('/v1/help', async (req) => {
    const q = parse(z.object({ q: z.string().max(100).optional(), category: z.string().max(30).optional() }), req.query);
    const terms = (q.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const articles = await Promise.all(HELP_ARTICLES.map(async (a) => {
      const o = await publishedPage(db, 'help', a.slug);
      return o ? { ...a, title: o.title, body: o.sections.map((s) => s.body).join(PARAGRAPH), version: o.version } : a;
    }));
    const list = articles.filter((a) => (!q.category || a.category === q.category) && terms.every((t) => `${a.title} ${a.body}`.toLowerCase().includes(t)));
    return { total: articles.length, articles: list };
  });
  app.get('/v1/help/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().max(60) }), req.params);
    const a = HELP_ARTICLES.find((x) => x.slug === slug);
    if (!a) throw notFound();
    const o = await publishedPage(db, 'help', slug);
    return o ? { ...a, title: o.title, body: o.sections.map((s) => s.body).join(PARAGRAPH), version: o.version, published_at: o.published_at } : a;
  });

  // Content management (ADM-06): draft → review → publish, versioned and audited. Admin only.
  const cmsKind = z.enum(['methodology', 'help']);
  const sectionSchema = z.object({ heading: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000) });
  app.get('/admin/v1/content', async (req) => {
    requireRole(req, ['admin']);
    return listContent(db);
  });
  app.post('/admin/v1/content', async (req) => {
    const a = requireRole(req, ['admin']);
    const body = parse(z.object({ kind: cmsKind, slug: z.string().regex(/^[a-z0-9-]{2,60}$/), title: z.string().trim().min(3).max(200), sections: z.array(sectionSchema).min(1).max(30) }), req.body);
    const r = await createDraft(db, a.userId, body as { kind: CmsKind; slug: string; title: string; sections: { heading: string; body: string }[] });
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'content.draft', targetType: body.kind, targetId: `${r.slug}@${r.version}` });
    return r;
  });
  app.post('/admin/v1/content/:slug/versions/:version/submit', async (req) => {
    const a = requireRole(req, ['admin']);
    const p = parse(z.object({ slug: z.string().max(60), version: z.coerce.number().int().positive() }), req.params);
    await submitForReview(db, p.slug, p.version);
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'content.submit', targetType: 'content', targetId: `${p.slug}@${p.version}` });
    return { status: 'in_review' };
  });
  app.post('/admin/v1/content/:slug/versions/:version/publish', async (req) => {
    const a = requireRole(req, ['admin']);
    const p = parse(z.object({ slug: z.string().max(60), version: z.coerce.number().int().positive() }), req.params);
    const body = parse(z.object({ checks: z.object(Object.fromEntries(PUBLISH_CHECKS.map((k) => [k, z.literal(true)])) as Record<(typeof PUBLISH_CHECKS)[number], z.ZodLiteral<true>>), reviewer_name: z.string().trim().min(3).max(120) }), req.body);
    await publish(db, a.userId, p.slug, p.version, { ...body.checks, reviewer_name: body.reviewer_name, reviewed_on: ctx.clock().toISOString().slice(0, 10) });
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'content.publish', targetType: 'content', targetId: `${p.slug}@${p.version}`, reason: `Review by ${body.reviewer_name}` });
    return { status: 'published' };
  });

  // Learning Centre (LRN)
  app.get('/v1/learn/paths', async (req) => {
    const plan = req.user ? await userPlan(db, req.user.userId, ctx.clock()) : null;
    const progress = req.user ? await db.query<{ lesson_slug: string; completed_at: string | null; quiz_score: number | null }>(`SELECT lesson_slug, completed_at, quiz_score FROM app.learning_progress WHERE user_id=$1`, [req.user.userId]) : [];
    return { path: { id: 'beginner', title: 'Beginner path', lessons: LESSONS.map((l) => ({ slug: l.slug, order: l.order, title: l.title, minutes: l.minutes, progress: progress.find((p) => p.lesson_slug === l.slug) ?? null })) }, all_lessons_included: !!plan?.entitlements.learning_all_lessons };
  });
  app.get('/v1/learn/lessons/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().max(60) }), req.params);
    const l = LESSONS.find((x) => x.slug === slug);
    if (!l) throw notFound();
    return { ...l, quiz: l.quiz.map((q) => ({ q: q.q, options: q.options })) };
  });
  app.post('/v1/learn/progress', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ lesson: z.string().max(60), answers: z.array(z.number().int().min(0).max(5)).max(5).optional(), return_to: z.string().max(300).optional(), started: z.boolean().optional() }), req.body);
    const l = LESSONS.find((x) => x.slug === body.lesson);
    if (!l) throw notFound();
    if (body.started || !body.answers) {
      await db.query(`INSERT INTO app.learning_progress (user_id, lesson_slug, return_to) VALUES ($1,$2,$3) ON CONFLICT (user_id, lesson_slug) DO UPDATE SET return_to=COALESCE(EXCLUDED.return_to, app.learning_progress.return_to)`, [u.userId, l.slug, body.return_to ?? null]);
      return { started: true };
    }
    const score = l.quiz.reduce((s, q, i) => s + (body.answers![i] === q.answer ? 1 : 0), 0);
    const row = await db.one<{ return_to: string | null }>(
      `INSERT INTO app.learning_progress (user_id, lesson_slug, completed_at, quiz_score, return_to) VALUES ($1,$2,now(),$3,$4)
       ON CONFLICT (user_id, lesson_slug) DO UPDATE SET completed_at=now(), quiz_score=EXCLUDED.quiz_score RETURNING return_to`,
      [u.userId, l.slug, score, body.return_to ?? null],
    );
    await track(db, 'lesson_completed', { lesson: l.slug, score }, { userId: u.userId, origin: 'server' });
    return { score, of: l.quiz.length, explanations: l.quiz.map((q) => ({ answer: q.answer, why: q.why })), return_to: row.return_to };
  });

  // Support and feedback (SUP-01, SUP-03, SUP-04, J12)
  const ticketRef = () => `ATL-${randomToken(5).toUpperCase().replace(/[^A-Z0-9]/g, '7').slice(0, 7)}`;
  app.post('/v1/feedback', async (req) => {
    const body = parse(z.object({ kind: z.enum(['feedback', 'data_issue', 'ai_issue', 'support', 'billing', 'coverage_request']).default('feedback'), subject: z.string().trim().min(2).max(200), comment: z.string().max(5000).optional(), page: z.string().max(300).optional(), surface: z.string().max(80).optional(), context: z.record(z.unknown()).optional(), email: z.string().email().max(254).optional(), screenshot_data_url: z.string().max(2_500_000).optional() }), req.body);
    const u = req.user;
    if (!u && !body.email) throw badRequest('Add an email address so we can reply.');
    const plan = u ? await userPlan(db, u.userId, ctx.clock()) : null;
    const days = plan?.entitlements.support_reply_business_days ?? 3;
    let screenshotKey: string | null = null;
    if (body.screenshot_data_url) {
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.screenshot_data_url);
      if (!m) throw badRequest('Screenshots must be PNG, JPEG or WebP images.');
      screenshotKey = `support/screenshots/${randomToken(12)}.${m[1]}`;
      await ctx.store.put(screenshotKey, Buffer.from(m[2]!, 'base64'));
    }
    const ref = ticketRef();
    const t = await db.one<{ ticket_id: string }>(
      `INSERT INTO app.support_tickets (ticket_ref, user_id, email, kind, surface, page, context, subject, comment, screenshot_key, plan_code, priority, due_first_response_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ticket_id`,
      [ref, u?.userId ?? null, u ? null : body.email, body.kind, body.surface ?? null, body.page ?? null, JSON.stringify(body.context ?? {}), body.subject, body.comment ?? null, screenshotKey, plan?.plan ?? 'anonymous', plan?.entitlements.support_priority ? 'priority' : 'normal', addBusinessDays(ctx.clock(), days).toISOString()],
    );
    if (body.kind === 'data_issue' || body.kind === 'ai_issue') {
      const issueId = await raiseQualityIssue(db, { kind: 'user_report', severity: 'warn', dataset: body.kind === 'ai_issue' ? 'ai_answers' : String((body.context as { dataset?: string } | undefined)?.dataset ?? 'unknown'), entityRef: String((body.context as { evidence_id?: string } | undefined)?.evidence_id ?? body.page ?? ''), title: body.subject, details: { ticket_ref: ref, comment: body.comment ?? null, context: body.context ?? {} } });
      await db.query(`UPDATE calc.quality_issues SET support_ticket_id=$2 WHERE issue_id=$1`, [issueId, t.ticket_id]);
      if (u) await track(db, 'issue_reported', { issue_type: body.kind, surface: body.surface ?? 'unknown' }, { userId: u.userId, origin: 'server' });
    }
    return { ticket_ref: ref, status: 'open', first_response_due: addBusinessDays(ctx.clock(), days).toISOString(), triage: body.kind.endsWith('issue') ? 'Data operations triage reports within 2 business days.' : `Reply within ${days} business day${days === 1 ? '' : 's'}.` };
  });
  app.get('/v1/feedback/mine', async (req) => {
    const u = requireUser(req);
    return { tickets: await db.query(`SELECT ticket_ref, kind, subject, status, created_at, first_response_at, resolved_at, resolution FROM app.support_tickets WHERE user_id=$1 ORDER BY created_at DESC`, [u.userId]) };
  });
  app.post('/v1/grievances', async (req) => {
    const body = parse(z.object({ subject: z.string().trim().min(3).max(200), comment: z.string().max(5000), email: z.string().email().max(254).optional() }), req.body);
    if (!req.user && !body.email) throw badRequest('Add an email address so we can reply.');
    const ref = ticketRef();
    const t = await db.one<{ ticket_id: string }>(`INSERT INTO app.support_tickets (ticket_ref, user_id, email, kind, subject, comment, priority, due_first_response_at) VALUES ($1,$2,$3,'grievance',$4,$5,'priority',$6) RETURNING ticket_id`, [ref, req.user?.userId ?? null, req.user ? null : body.email, body.subject, body.comment, addBusinessDays(ctx.clock(), 1).toISOString()]);
    // Acknowledgement period is set by counsel; 1 business day is the interim internal target.
    await db.query(`INSERT INTO app.grievances (ticket_id, ack_due_at) VALUES ($1,$2)`, [t.ticket_id, addBusinessDays(ctx.clock(), 1).toISOString()]);
    return { ticket_ref: ref, status: 'registered' };
  });

  // Client analytics (ANL-01): only allow-listed events, only with consent.
  app.post('/v1/analytics/events', async (req, reply) => {
    const body = parse(z.object({ name: z.string().max(60), props: z.record(z.unknown()).default({}), anon_id: z.string().max(64).optional() }), req.body);
    if (!CLIENT_EVENTS.has(body.name as EventName)) return reply.status(202).send({ accepted: false, reason: 'server-side event' });
    if (!req.user || !(await hasAnalyticsConsent(db, req.user.userId))) return reply.status(202).send({ accepted: false, reason: 'no analytics consent' });
    const ok = await track(db, body.name, body.props, { userId: req.user.userId, sessionId: req.user.sessionHash, origin: 'client' });
    return reply.status(202).send({ accepted: ok });
  });
}
