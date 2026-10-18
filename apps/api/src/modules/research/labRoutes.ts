import { formatIndianNumber, COSTS_EXCLUDED_WATERMARK } from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { sha256Hex } from '../../lib/crypto.js';
import { notFound, parse, badRequest } from '../../lib/http.js';
import { renderPdf, type PdfBlock } from '../../lib/pdf.js';
import { track } from '../analytics/events.js';
import { consume, requireFeature, userPlan } from '../billing/entitlements.js';
import { requireUser, requireVerified } from '../auth/service.js';
import { METRIC_BY_CODE } from '../calc/definitions.js';
import { getCompany, getMetrics, getQualityFlags } from '../companies/service.js';
import { DEFAULT_COST_TABLE } from '../backtest/costs.js';
import { TEMPLATES } from '../backtest/templates.js';
import { backtestRequestSchema, createRun, getRun, rerun } from '../backtest/service.js';
import { ENGINE_VERSION } from '../backtest/engine.js';
import { ask } from '../ai/service.js';
import { isEnabled } from '../ops/flags.js';

const uuid = z.string().uuid();

/** Report numbers use one formatter for screen and PDF so exports equal on-screen values (BKT-13, EXP-01). */
export function fmtReport(code: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return 'n/a';
  const unit = METRIC_BY_CODE.get(code)?.unit;
  if (unit === 'percent') return `${formatIndianNumber(v, 1)}%`;
  if (unit === 'pp') return `${formatIndianNumber(v, 1)} pp`;
  if (unit === 'INR') return `₹${formatIndianNumber(v, 0)}`;
  if (unit === 'count') return formatIndianNumber(v, 0);
  return formatIndianNumber(v, 2);
}

export const REPORT_METRICS: [string, string][] = [
  ['bt_total_return', 'total_return'], ['bt_cagr', 'cagr'], ['bt_max_drawdown', 'max_drawdown'], ['bt_max_drawdown_duration', 'max_drawdown_duration'], ['bt_volatility', 'volatility'], ['bt_sharpe', 'sharpe'],
  ['bt_trades', 'trades'], ['bt_win_rate', 'win_rate'], ['bt_avg_gain', 'avg_gain'], ['bt_avg_loss', 'avg_loss'], ['bt_exposure', 'exposure'], ['bt_turnover', 'turnover'], ['bt_total_costs', 'total_costs'],
  ['bt_benchmark_return', 'benchmark_return'], ['bt_excess_return', 'excess_return'],
];

export async function labRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  // ── Quant Research Lab (BKT) ──
  app.get('/v1/backtests/templates', async () => ({
    templates: TEMPLATES, cost_table: DEFAULT_COST_TABLE, engine_version: ENGINE_VERSION,
    indices: await db.query(`SELECT index_code, name, kind, universe_size_class FROM ref.index_definitions ORDER BY index_code`),
    defaults: { slippage_bps: 10, liquidity: { max_adv_pct: 0.05, min_adv_cr: 1, mode: 'skip' }, capital_inr: 1_000_000, execution: 'Signals on the close; fills at the next session’s open; long only; equal weights' },
    no_forward_signals: 'ATLAS never shows today’s signal, current positions or strategy alerts (BKT-12).',
    strategy_alerts_enabled: await isEnabled(db, 'strategy_signals_and_alerts', { production: ctx.cfg.isProduction }),
  }));
  app.post('/v1/backtests', async (req, reply) => {
    const u = requireVerified(req);
    const body = parse(backtestRequestSchema, req.body);
    const plan = await userPlan(db, u.userId, ctx.clock());
    const key = req.headers['idempotency-key'] as string | undefined;
    const r = await createRun(ctx, u, plan, body, { idempotencyKey: key?.slice(0, 100) });
    return reply.status(r.status === 'queued' ? 202 : 201).send({ run_id: r.runId, status: r.status, position: r.position });
  });
  app.get('/v1/backtests', async (req) => {
    const u = requireUser(req);
    return { runs: await db.query(`SELECT run_id, name, template_code, status, saved, created_at, finished_at, results_hash, (metrics->>'total_return')::float8 AS total_return, benchmark_code, rerun_of FROM bt.backtest_runs WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [u.userId]) };
  });
  app.get('/v1/backtests/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const run = await getRun(db, id, u.userId);
    if (!run) throw notFound();
    const job = await db.maybeOne(`SELECT status, progress, error FROM ops.job_queue WHERE idempotency_key=$1`, [`backtest:${id}`]);
    return { run, job, definitions: REPORT_METRICS.map(([code]) => ({ code, name: METRIC_BY_CODE.get(code)!.name, url: `/methodology/metrics/${code}` })), methodology: '/methodology/backtests', watermark: run.cost_table_version === 'ZERO-COSTS' ? COSTS_EXCLUDED_WATERMARK : null };
  });
  app.get('/v1/backtests/:id/series', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const run = await getRun(db, id, u.userId);
    if (!run?.series_key) throw notFound();
    await track(db, 'backtest_report_viewed', { run_id: id }, { userId: u.userId, origin: 'server' });
    return JSON.parse((await ctx.store.get(run.series_key)).toString('utf8'));
  });
  app.get('/v1/backtests/:id/trades', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    if (!(await getRun(db, id, u.userId))) throw notFound();
    const rows = await db.query(`SELECT seq, symbol, side, trade_date, price, quantity, gross_value, costs, pnl, reason FROM bt.backtest_trades WHERE run_id=$1 ORDER BY seq LIMIT $2 OFFSET $3`, [id, q.limit, q.offset]);
    const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM bt.backtest_trades WHERE run_id=$1`, [id])).n;
    return { total, trades: rows };
  });
  app.post('/v1/backtests/:id/rerun', async (req) => {
    const u = requireVerified(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const plan = await userPlan(db, u.userId, ctx.clock());
    return rerun(ctx, u, plan, id);
  });
  app.patch('/v1/backtests/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ saved: z.boolean().optional(), name: z.string().max(120).optional() }), req.body);
    const r = await db.query(`UPDATE bt.backtest_runs SET saved=COALESCE($3,saved), name=COALESCE($4,name) WHERE run_id=$1 AND user_id=$2 RETURNING run_id`, [id, u.userId, body.saved ?? null, body.name ?? null]);
    if (!r.length) throw notFound();
    return { saved: true };
  });
  app.get('/v1/backtests/compare/:ids', async (req) => {
    const u = requireUser(req);
    const { ids } = parse(z.object({ ids: z.string().max(200) }), req.params);
    const list = ids.split(',').filter((x) => uuid.safeParse(x).success).slice(0, 4);
    if (list.length < 2) throw badRequest('Choose two to four runs to compare.');
    const runs = [];
    for (const id of list) {
      const r = await getRun(db, id, u.userId);
      if (!r) throw notFound();
      runs.push({ run_id: id, name: r.name, template: r.template_code, metrics: Object.fromEntries(REPORT_METRICS.map(([code, k]) => [code, fmtReport(code, (r.metrics as Record<string, number | null>)?.[k])])), warnings: r.warnings, results_hash: r.results_hash });
    }
    return { runs, metrics: REPORT_METRICS.map(([c]) => ({ code: c, name: METRIC_BY_CODE.get(c)!.name })) };
  });
  app.post('/v1/backtests/:id/export', async (req, reply) => {
    const u = requireVerified(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const run = await getRun(db, id, u.userId);
    if (!run || run.status !== 'succeeded') throw notFound();
    const plan = await userPlan(db, u.userId, ctx.clock());
    requireFeature(plan, 'pdf_exports_per_month', 'PDF exports');
    await consume(db, u.userId, 'pdf_exports', plan, ctx.clock());
    const m = run.metrics as Record<string, unknown> & { by_year: { year: string; return_pct: number }[]; benchmark: { name: string; type: string } };
    const w = (run.warnings as { title: string; why: string }[]) ?? [];
    const cfg = run.config as Record<string, unknown>;
    const blocks: PdfBlock[] = [
      ...(run.cost_table_version === 'ZERO-COSTS' ? [{ kind: 'watermark' as const, text: COSTS_EXCLUDED_WATERMARK }] : []),
      { kind: 'title', text: `Backtest report — ${TEMPLATES.find((t) => t.code === run.template_code)?.name ?? run.template_code}` },
      { kind: 'text', text: 'Historical simulation only. It describes what the rules would have done on past data and implies nothing about future results.' },
      ...w.map((x) => ({ kind: 'warning' as const, text: `${x.title}. ${x.why}` })),
      { kind: 'subtitle', text: 'Results' },
      { kind: 'table', columns: ['Metric', 'Value'], widths: [300, 200], rows: REPORT_METRICS.map(([code, k]) => [METRIC_BY_CODE.get(code)!.name, fmtReport(code, m[k] as number | null)]) },
      { kind: 'text', text: `Benchmark: ${m.benchmark?.name} (${m.benchmark?.type}).` },
      { kind: 'subtitle', text: 'Calendar years' },
      { kind: 'table', columns: ['Year', 'Return'], widths: [250, 250], rows: (m.by_year ?? []).map((y) => [y.year, fmtReport('bt_total_return', y.return_pct)]) },
      { kind: 'subtitle', text: 'Assumptions' },
      { kind: 'text', text: `Parameters: ${JSON.stringify(cfg.params)}. Universe: ${JSON.stringify(cfg.universe)}. Period: ${JSON.stringify(cfg.period)}. Costs: ${JSON.stringify(cfg.costs)}. Liquidity: ${JSON.stringify(cfg.liquidity)}.` },
      { kind: 'text', text: 'Signals on the close; execution at the next session’s open; long only; equal weights. Methodology: /methodology/backtests.' },
      { kind: 'footnote', text: `Record: run ${id} · snapshot ${run.snapshot_id} · ${run.engine_version} · cost table ${run.cost_table_version} · results hash ${run.results_hash}` },
    ];
    const pdf = await renderPdf(blocks, { footer: `ATLAS backtest ${String(id).slice(0, 8)}`, watermark: run.cost_table_version === 'ZERO-COSTS' ? COSTS_EXCLUDED_WATERMARK : undefined });
    await db.query(`INSERT INTO app.exports (user_id, kind, params, status, completed_at) VALUES ($1,'pdf_backtest',$2,'ready',now())`, [u.userId, JSON.stringify({ run_id: id })]);
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="atlas-backtest-${String(id).slice(0, 8)}.pdf"`).send(pdf);
  });

  // ── Company PDF summary (EXP-01) ──
  app.post('/v1/companies/:id/export', async (req, reply) => {
    const u = requireVerified(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const plan = await userPlan(db, u.userId, ctx.clock());
    requireFeature(plan, 'pdf_exports_per_month', 'PDF exports');
    const c = await getCompany(db, id);
    if (!c || c.coverage !== 'full') throw notFound();
    await consume(db, u.userId, 'pdf_exports', plan, ctx.clock());
    const codes = ['revenue_growth_yoy', 'operating_margin', 'net_margin', 'roe', 'roce', 'debt_equity', 'cash_conversion', 'pe_ttm', 'pb', 'dividend_yield'];
    const m = await getMetrics(db, id, { codes, freq: 'LATEST', limit: { years: -1, quarters: -1 } });
    const flags = await getQualityFlags(db, id);
    const rows = (m?.metrics ?? []).map((x) => {
      const cell = x.cells[0];
      const v = cell?.value;
      return [x.name, v === null || v === undefined ? (cell?.missing === 'not_meaningful' ? 'n/m' : 'Not available') : x.unit === 'percent' ? `${formatIndianNumber(v, 1)}%` : formatIndianNumber(v, 2), `Source: ATLAS calculation service; definition ${x.code} v${x.definition_version}; as of ${(cell as { as_of?: string } | null)?.as_of ?? 'n/a'}`];
    });
    const pdf = await renderPdf([
      { kind: 'title', text: `${c.short_name} — company summary` },
      { kind: 'text', text: `${c.sector} · ${c.industry} · ${c.primary_basis === 'consolidated' ? 'Consolidated' : 'Standalone'} · ₹ crore unless stated${c.is_synthetic ? ' · SYNTHETIC DEVELOPMENT DATA (fictional company)' : ''}` },
      { kind: 'table', columns: ['Measure', 'Latest', 'Source and period'], widths: [140, 80, 280], rows },
      { kind: 'subtitle', text: 'Quality checks' },
      ...(flags?.flags ?? []).map((f) => ({ kind: 'text' as const, text: `${f.name}: ${f.status === 'requires_review' ? 'requires review' : f.status === 'insufficient_data' ? 'insufficient data' : 'not triggered'} — ${f.rule}.` })),
      { kind: 'footnote', text: `Generated ${ctx.clock().toISOString()} for user ${u.userId}. Every figure links to its source in ATLAS.` },
    ], { footer: `ATLAS company summary ${c.short_name}` });
    await db.query(`INSERT INTO app.exports (user_id, kind, params, status, completed_at) VALUES ($1,'pdf_company',$2,'ready',now())`, [u.userId, JSON.stringify({ company_id: id })]);
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="atlas-${c.short_name.replace(/\W+/g, '-').toLowerCase()}.pdf"`).send(pdf);
  });

  app.get('/v1/exports/:id/download', async (req, reply) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(z.object({ token: z.string().min(10).max(100), format: z.enum(['json', 'csv']).default('json') }), req.query);
    const e = await db.maybeOne<{ token_hash: string; expires_at: string; object_key: string; status: string }>(`SELECT token_hash, expires_at, object_key, status FROM app.exports WHERE export_id=$1 AND kind='account_data'`, [id]);
    if (!e || e.token_hash !== sha256Hex(q.token) || e.status !== 'ready') throw notFound();
    if (e.expires_at < ctx.clock().toISOString()) throw notFound('This export link has expired. Request a new export from your account page.');
    const body = await ctx.store.get(`${e.object_key}atlas-export.${q.format}`);
    return reply.type(q.format === 'json' ? 'application/json' : 'text/csv').header('content-disposition', `attachment; filename="atlas-export.${q.format}"`).send(body);
  });

  // ── AI research assistant (AIA) ──
  const askSchema = z.object({ question: z.string().trim().min(2).max(1000), conversation_id: uuid.optional(), context: z.object({ company_id: uuid.optional(), metric: z.string().max(60).optional(), period: z.string().max(20).optional(), run_id: uuid.optional(), briefing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).default({}), onboarding: z.boolean().optional() });
  app.post('/v1/assistant/ask', async (req, reply) => {
    const u = requireUser(req);
    const body = parse(askSchema, req.body);
    const stream = (req.headers.accept ?? '').includes('text/event-stream');
    if (!stream) {
      const r = await ask(ctx, u, { conversationId: body.conversation_id, question: body.question, context: body.context, onboarding: body.onboarding }, () => undefined);
      return { conversation_id: r.conversationId, message_id: r.messageId, latency_ms: r.latencyMs, answer: r.result };
    }
    // Server-sent events: progress steps immediately, then the checked answer (AIA-11).
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const r = await ask(ctx, u, { conversationId: body.conversation_id, question: body.question, context: body.context, onboarding: body.onboarding }, (step) => send('progress', { step, at: Date.now() }));
      send('answer', { conversation_id: r.conversationId, message_id: r.messageId, latency_ms: r.latencyMs, answer: r.result });
    } catch (err) {
      const e = err as { status?: number; detail?: string; extra?: unknown };
      send('error', { status: e.status ?? 500, detail: e.detail ?? 'The assistant is unavailable. Your question was not counted.', extra: e.extra ?? null });
    }
    reply.raw.end();
    return reply;
  });
  app.get('/v1/assistant/conversations', async (req) => {
    const u = requireUser(req);
    return { conversations: await db.query(`SELECT conversation_id, title, created_at, updated_at FROM ai.conversations WHERE user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100`, [u.userId]) };
  });
  app.get('/v1/assistant/conversations/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const c = await db.maybeOne<{ user_id: string }>(`SELECT conversation_id, user_id, title, context, created_at FROM ai.conversations WHERE conversation_id=$1 AND deleted_at IS NULL`, [id]);
    if (!c || c.user_id !== u.userId) throw notFound();
    return { conversation: c, messages: await db.query(`SELECT message_id, role, content_json, check_status, latency_ms, created_at FROM ai.messages WHERE conversation_id=$1 ORDER BY created_at`, [id]) };
  });
  app.delete('/v1/assistant/conversations/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    // Removed from history now; purged from storage and analytics samples within 30 days (AIA-08).
    const r = await db.query(`UPDATE ai.conversations SET deleted_at=now(), purge_after=now() + interval '30 days' WHERE conversation_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING 1`, [id, u.userId]);
    if (!r.length) throw notFound();
    await db.query(`DELETE FROM app.research_history WHERE user_id=$1 AND kind='question' AND ref_id=$2`, [u.userId, id]);
    return { deleted: true };
  });
  app.post('/v1/assistant/messages/:id/feedback', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ rating: z.enum(['up', 'down']).optional(), reason: z.string().max(80).optional(), comment: z.string().max(2000).optional(), report_error: z.boolean().default(false) }), req.body);
    const own = await db.maybeOne(`SELECT 1 FROM ai.messages m JOIN ai.conversations c USING (conversation_id) WHERE m.message_id=$1 AND c.user_id=$2 AND m.role='assistant'`, [id, u.userId]);
    if (!own) throw notFound();
    const fb = await db.one<{ feedback_id: string }>(`INSERT INTO ai.feedback (message_id, user_id, rating, reason, comment, is_error_report) VALUES ($1,$2,$3,$4,$5,$6) RETURNING feedback_id`, [id, u.userId, body.rating ?? null, body.reason ?? null, body.comment ?? null, body.report_error]);
    if (body.rating) await track(db, 'ai_answer_rated', { rating: body.rating, reason: body.reason }, { userId: u.userId, origin: 'server' });
    if (body.report_error) await track(db, 'issue_reported', { issue_type: 'ai', surface: 'assistant' }, { userId: u.userId, origin: 'server' });
    return { feedback_id: fb.feedback_id, triage: body.report_error ? 'Factual-error reports are triaged within 2 business days.' : null };
  });
}
