import * as A from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { recordActivity } from './activity.js';
import { alignmentNote, describe } from './crossRoutes.js';
import { isInstrumentKey, resolveInstrument } from './instruments.js';
import { METRIC_DEFINITIONS, metricsFor } from './metrics.js';

// Research objects owned by one user: portfolios (hypothetical), saved views, notebook entries
// (notes, hypotheses, journal), reports and alerts. Every query is scoped by the session user id;
// another user's object is indistinguishable from a missing one (404). Nothing here places orders.

const DAY = A.DAY;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const instrumentKey = z.string().refine(isInstrumentKey, 'invalid instrument key');
export const REPORT_GENERATOR = 'report-builder-1';

export async function objectRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const now = () => ctx.clock();

  // ───────── Saved views (workbench, screens, correlation, backtest, scenario configs) ─────────
  app.get('/v1/research/views', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ kind: z.enum(['workbench', 'screen', 'correlation', 'backtest', 'scenario']).optional() }), req.query);
    return { rows: await db.query(`SELECT view_id, kind, name, config, created_at, updated_at FROM research.saved_views WHERE user_id=$1 AND deleted_at IS NULL AND ($2::text IS NULL OR kind=$2) ORDER BY updated_at DESC LIMIT 100`, [u.userId, q.kind ?? null]) };
  });
  app.post('/v1/research/views', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ kind: z.enum(['workbench', 'screen', 'correlation', 'backtest', 'scenario']), name: z.string().trim().min(1).max(80), config: z.record(z.unknown()).refine((c) => JSON.stringify(c).length <= 20_000, 'config too large') }), req.body);
    const n = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM research.saved_views WHERE user_id=$1 AND deleted_at IS NULL`, [u.userId])).n;
    if (n >= 200) throw badRequest('You can keep up to 200 saved views.');
    return db.one(`INSERT INTO research.saved_views (user_id, kind, name, config) VALUES ($1,$2,$3,$4) RETURNING view_id, kind, name, config, created_at`, [u.userId, b.kind, b.name, JSON.stringify(b.config)]);
  });
  app.delete('/v1/research/views/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.query(`UPDATE research.saved_views SET deleted_at=now() WHERE view_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING 1`, [id, u.userId]);
    if (!r.length) throw notFound('No such saved view.');
    return { ok: true };
  });

  // ───────── Features 3, 4, 16: research portfolios, risk lab, scenarios ─────────
  const ownPortfolio = async (userId: string, id: string) => {
    const p = await db.maybeOne<{ portfolio_id: string; name: string; description: string | null; benchmark_key: string | null; rebalance: 'none' | 'monthly'; created_at: string; updated_at: string }>(
      `SELECT portfolio_id, name, description, benchmark_key, rebalance, created_at, updated_at FROM research.portfolios WHERE portfolio_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, userId]);
    if (!p) throw notFound('No such portfolio.');
    const holdings = await db.query<{ instrument_key: string; weight: number; label: string | null; note: string | null; added_at: string }>(`SELECT instrument_key, weight::float8 AS weight, label, note, added_at FROM research.portfolio_holdings WHERE portfolio_id=$1 ORDER BY weight DESC, instrument_key`, [id]);
    return { ...p, holdings };
  };
  const portfolioBody = z.object({
    name: z.string().trim().min(1).max(80), description: z.string().max(2000).optional(), benchmark_key: instrumentKey.nullable().optional(), rebalance: z.enum(['none', 'monthly']).default('monthly'),
    holdings: z.array(z.object({ instrument_key: instrumentKey, weight: z.number().gt(0).lte(1), label: z.string().max(80).optional(), note: z.string().max(2000).optional() })).min(1).max(30),
  });
  const validateWeights = (h: { weight: number; instrument_key: string }[]) => {
    const keys = h.map((x) => x.instrument_key.split('@')[0]);
    if (new Set(keys).size !== keys.length) throw badRequest('Each instrument can appear only once.');
    const sum = h.reduce((a, x) => a + x.weight, 0);
    if (Math.abs(sum - 1) > 0.001) throw badRequest(`Weights must add up to 100% (they add up to ${(sum * 100).toFixed(2)}%).`);
  };
  app.get('/v1/research/portfolios', async (req) => {
    const u = requireUser(req);
    return { rows: await db.query(`SELECT p.portfolio_id, p.name, p.benchmark_key, p.rebalance, p.updated_at, count(h.*)::int AS holdings FROM research.portfolios p LEFT JOIN research.portfolio_holdings h USING (portfolio_id) WHERE p.user_id=$1 AND p.deleted_at IS NULL GROUP BY p.portfolio_id ORDER BY p.updated_at DESC`, [u.userId]), note: 'Research portfolios are hypothetical: ATLAS holds no assets and places no orders.' };
  });
  app.post('/v1/research/portfolios', async (req) => {
    const u = requireUser(req);
    const b = parse(portfolioBody, req.body);
    validateWeights(b.holdings);
    for (const h of b.holdings) await resolveInstrument(db, u.userId, h.instrument_key, now());
    const id = await db.tx(async (t) => {
      const p = await t.one<{ portfolio_id: string }>(`INSERT INTO research.portfolios (user_id, name, description, benchmark_key, rebalance) VALUES ($1,$2,$3,$4,$5) RETURNING portfolio_id`, [u.userId, b.name, b.description ?? null, b.benchmark_key ?? null, b.rebalance]);
      for (const h of b.holdings) await t.query(`INSERT INTO research.portfolio_holdings (portfolio_id, instrument_key, weight, label, note) VALUES ($1,$2,$3,$4,$5)`, [p.portfolio_id, h.instrument_key.split('@')[0], h.weight, h.label ?? null, h.note ?? null]);
      return p.portfolio_id;
    });
    return ownPortfolio(u.userId, id);
  });
  app.put('/v1/research/portfolios/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(portfolioBody, req.body);
    await ownPortfolio(u.userId, id);
    validateWeights(b.holdings);
    for (const h of b.holdings) await resolveInstrument(db, u.userId, h.instrument_key, now());
    await db.tx(async (t) => {
      await t.query(`UPDATE research.portfolios SET name=$3, description=$4, benchmark_key=$5, rebalance=$6, updated_at=now() WHERE portfolio_id=$1 AND user_id=$2`, [id, u.userId, b.name, b.description ?? null, b.benchmark_key ?? null, b.rebalance]);
      await t.query(`DELETE FROM research.portfolio_holdings WHERE portfolio_id=$1`, [id]);
      for (const h of b.holdings) await t.query(`INSERT INTO research.portfolio_holdings (portfolio_id, instrument_key, weight, label, note) VALUES ($1,$2,$3,$4,$5)`, [id, h.instrument_key.split('@')[0], h.weight, h.label ?? null, h.note ?? null]);
    });
    return ownPortfolio(u.userId, id);
  });
  app.delete('/v1/research/portfolios/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.query(`UPDATE research.portfolios SET deleted_at=now() WHERE portfolio_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING 1`, [id, u.userId]);
    if (!r.length) throw notFound('No such portfolio.');
    return { ok: true };
  });

  async function analyse(userId: string, id: string, range: '1y' | '3y' | 'max') {
    const p = await ownPortfolio(userId, id);
    const fromMs = range === 'max' ? undefined : now().getTime() - (range === '1y' ? 365 : 1095) * DAY;
    const insts = await Promise.all(p.holdings.map((h) => resolveInstrument(db, userId, h.instrument_key, now(), { fromMs })));
    const bench = p.benchmark_key ? await resolveInstrument(db, userId, p.benchmark_key, now(), { fromMs }) : null;
    const align = alignmentNote(bench ? [...insts, bench] : insts);
    const al = A.alignSeries((bench ? [...insts, bench] : insts).map((i) => i.observations));
    const prices = al.values.slice(0, insts.length);
    const weights = p.holdings.map((h) => h.weight);
    const res = A.portfolio(al.dates, prices, weights, p.rebalance);
    return { p, insts, bench, align, al, prices, weights, res };
  }

  app.get('/v1/research/portfolios/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return ownPortfolio(u.userId, id);
  });

  app.get('/v1/research/portfolios/:id/analysis', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const q = parse(z.object({ range: z.enum(['1y', '3y', 'max']).default('1y') }), req.query);
    const { p, insts, bench, align, al, prices, weights, res } = await analyse(u.userId, id, q.range);
    if (!res.ok) return { portfolio: p, instruments: insts.map(describe), alignment: align, result: null, reason: res.reason };
    const ann = align.annualisation;
    const valid = res.returns.filter((_, i) => (al.dates[i + 1]! - al.dates[i]!) / DAY <= align.max_gap_days);
    const rr = A.riskRatios(valid, ann, ctx.cfg.RESEARCH_RISK_FREE_RATE);
    const cols = prices.map((v) => A.alignedReturns(al.dates, v, align.max_gap_days));
    const keep = cols[0]!.map((_, i) => cols.every((c) => c[i] !== null));
    const clean = cols.map((c) => c.filter((_, i) => keep[i]) as number[]);
    const corr = clean.map((a) => clean.map((b) => (a.length >= 30 ? A.pearson(a, b) : null)));
    let benchOut: Record<string, unknown> | null = null;
    if (bench) {
      const bv = al.values[al.values.length - 1]!;
      const bt = bv[bv.length - 1]! / bv[0]! - 1;
      benchOut = { key: bench.key, label: bench.label, total_return: bt, excess_return: res.total_return - bt };
    }
    const exposure: Record<string, number> = {};
    insts.forEach((i, k) => { exposure[i.asset_class] = (exposure[i.asset_class] ?? 0) + weights[k]!; });
    await recordActivity(db, u.userId, 'portfolio_risk_review', `${id}|${q.range}`, now());
    return {
      portfolio: p, instruments: insts.map(describe), alignment: { ...align, shared_dates: al.dates.length, from: iso(al.dates[0]!), to: iso(al.dates[al.dates.length - 1]!) },
      result: {
        total_return: res.total_return, max_drawdown: res.drawdown?.max_drawdown ?? null, current_drawdown: res.drawdown?.current_drawdown ?? null, rebalances: res.rebalances,
        ratios: rr.ok ? rr : { reason: (rr as A.Insufficient).reason },
        contributions: p.holdings.map((h, i) => ({ key: h.instrument_key, label: insts[i]!.label, weight: h.weight, contribution: res.contributions[i] })),
        concentration: { hhi: res.hhi, effective_holdings: 1 / res.hhi, max_weight: res.max_weight }, exposure,
        correlations: { keys: insts.map((i) => i.key), matrix: corr, aligned_returns: clean[0]?.length ?? 0 },
        benchmark: benchOut, curve: res.dates.map((t, i) => ({ t: iso(t), v: res.value[i] })).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 400)) === 0 || i === a.length - 1),
      },
      assumptions: [`Starts at 1.0 on ${iso(al.dates[0]!)} with the target weights; ${p.rebalance === 'monthly' ? 'rebalanced to target at the last shared date of each month' : 'buy and hold (weights drift)'}.`, 'No transaction costs, taxes, cash or leverage. Contributions are arithmetic (they add up to the sum of periodic portfolio returns, not exactly to the compounded total).', align.note],
      disclaimer: 'Hypothetical research portfolio: not holdings, not advice. Historical results do not predict future results.',
    };
  });

  app.post('/v1/research/portfolios/:id/scenario', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ shocks: z.record(z.number().min(-1).max(5)).default({}), vol_multiplier: z.number().min(0.1).max(10).default(1), correlation_shift: z.number().min(-1).max(1).default(0), range: z.enum(['1y', '3y', 'max']).default('1y') }), req.body);
    const { p, insts, align, al, prices, weights } = await analyse(u.userId, id, b.range);
    const cols = prices.map((v) => A.alignedReturns(al.dates, v, align.max_gap_days));
    const keep = cols[0]!.map((_, i) => cols.every((c) => c[i] !== null));
    const clean = cols.map((c) => c.filter((_, i) => keep[i]) as number[]);
    if ((clean[0]?.length ?? 0) < 30) throw badRequest('Needs at least 30 aligned returns to estimate the covariance.');
    const r = A.stressScenario(A.covariance(clean), align.annualisation, { weights, shocks: p.holdings.map((h) => b.shocks[h.instrument_key] ?? 0), volMultiplier: b.vol_multiplier, correlationShift: b.correlation_shift });
    if (!r.ok) throw badRequest(r.reason);
    await recordActivity(db, u.userId, 'scenario_tested', `${id}|${JSON.stringify(b.shocks)}|${b.vol_multiplier}|${b.correlation_shift}`.slice(0, 200), now());
    return { portfolio: { portfolio_id: p.portfolio_id, name: p.name }, instruments: insts.map(describe), inputs: b, aligned_returns: clean[0]!.length, annualisation: align.annualisation, ...r, labels: { inputs: 'User assumptions', covariance: 'Estimated from history' } };
  });

  // ───────── Features 14, 19 and journal: notebook ─────────
  const entryBody = z.object({
    kind: z.enum(['note', 'hypothesis', 'journal']), title: z.string().trim().min(1).max(200), body: z.string().max(20000).default(''),
    instruments: z.array(instrumentKey).max(20).default([]), sources: z.array(z.object({ title: z.string().max(200), url: z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'only http(s) links').optional(), note: z.string().max(500).optional() })).max(30).default([]),
    chart_configs: z.array(z.record(z.unknown())).max(10).default([]), assumptions: z.string().max(5000).optional(), counterarguments: z.string().max(5000).optional(),
    thesis: z.string().max(5000).optional(), evidence_for: z.string().max(5000).optional(), evidence_against: z.string().max(5000).optional(), horizon_days: z.number().int().min(1).max(3650).optional(),
    benchmark_key: instrumentKey.optional(), review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    expected: z.string().max(5000).optional(), observed: z.string().max(5000).optional(), missed: z.string().max(5000).optional(),
  });
  const substantial = (s?: string | null) => (s ?? '').trim().length >= 20;
  async function creditEntry(userId: string, e: { entry_id: string; kind: string; body: string; thesis: string | null; evidence_for: string | null; evidence_against: string | null; review_date: string | null; expected: string | null; observed: string | null; missed: string | null }) {
    // XP only for substantive work: a note of ≥ 80 characters; a hypothesis with a thesis, evidence for
    // AND against, and a review date; a journal reflection with expected, observed and missed filled in.
    if (e.kind === 'note' && e.body.trim().length >= 80) await recordActivity(db, userId, 'note_written', e.entry_id, now());
    if (e.kind === 'hypothesis' && substantial(e.thesis) && substantial(e.evidence_for) && substantial(e.evidence_against) && e.review_date) await recordActivity(db, userId, 'hypothesis_recorded', e.entry_id, now());
    if (e.kind === 'journal' && substantial(e.expected) && substantial(e.observed) && substantial(e.missed)) await recordActivity(db, userId, 'journal_reflection', e.entry_id, now());
  }
  const ENTRY_COLS = 'entry_id, kind, title, body, instruments, sources, chart_configs, assumptions, counterarguments, thesis, evidence_for, evidence_against, horizon_days, benchmark_key, review_date, outcome, lessons, reviewed_at, expected, observed, missed, created_at, updated_at';
  app.get('/v1/research/notebook', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ kind: z.enum(['note', 'hypothesis', 'journal']).optional(), q: z.string().max(100).optional() }), req.query);
    const rows = await db.query(`SELECT ${ENTRY_COLS} FROM research.notebook_entries WHERE user_id=$1 AND deleted_at IS NULL AND ($2::text IS NULL OR kind=$2) AND ($3::text IS NULL OR lower(title || ' ' || body || ' ' || coalesce(thesis,'')) LIKE $3) ORDER BY updated_at DESC LIMIT 200`, [u.userId, q.kind ?? null, q.q ? `%${q.q.toLowerCase()}%` : null]);
    const due = await db.query(`SELECT entry_id, title, review_date FROM research.notebook_entries WHERE user_id=$1 AND deleted_at IS NULL AND kind='hypothesis' AND reviewed_at IS NULL AND review_date <= $2 ORDER BY review_date`, [u.userId, iso(now().getTime())]);
    return { rows, reviews_due: due };
  });
  app.post('/v1/research/notebook', async (req) => {
    const u = requireUser(req);
    const b = parse(entryBody, req.body);
    if (b.kind === 'hypothesis' && (!b.thesis || !b.review_date)) throw badRequest('A hypothesis needs a thesis and a review date, recorded before the outcome is known.');
    if (b.kind === 'hypothesis' && b.review_date! <= iso(now().getTime())) throw badRequest('The review date must be in the future: record the thesis before the outcome.');
    const e = await db.one<{ entry_id: string; kind: string; body: string; thesis: string | null; evidence_for: string | null; evidence_against: string | null; review_date: string | null; expected: string | null; observed: string | null; missed: string | null }>(
      `INSERT INTO research.notebook_entries (user_id, kind, title, body, instruments, sources, chart_configs, assumptions, counterarguments, thesis, evidence_for, evidence_against, horizon_days, benchmark_key, review_date, expected, observed, missed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING ${ENTRY_COLS}`,
      [u.userId, b.kind, b.title, b.body, b.instruments, JSON.stringify(b.sources), JSON.stringify(b.chart_configs), b.assumptions ?? null, b.counterarguments ?? null, b.thesis ?? null, b.evidence_for ?? null, b.evidence_against ?? null, b.horizon_days ?? null, b.benchmark_key ?? null, b.review_date ?? null, b.expected ?? null, b.observed ?? null, b.missed ?? null]);
    await creditEntry(u.userId, e);
    return e;
  });
  app.put('/v1/research/notebook/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(entryBody.omit({ kind: true, thesis: true, review_date: true }), req.body);
    // The thesis and review date of a hypothesis are frozen once recorded (no hindsight edits).
    const e = await db.maybeOne<{ entry_id: string; kind: string; body: string; thesis: string | null; evidence_for: string | null; evidence_against: string | null; review_date: string | null; expected: string | null; observed: string | null; missed: string | null }>(
      `UPDATE research.notebook_entries SET title=$3, body=$4, instruments=$5, sources=$6, chart_configs=$7, assumptions=$8, counterarguments=$9, evidence_for=coalesce($10, evidence_for), evidence_against=coalesce($11, evidence_against), horizon_days=coalesce($12, horizon_days), benchmark_key=coalesce($13, benchmark_key), expected=$14, observed=$15, missed=$16, updated_at=now()
        WHERE entry_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING ${ENTRY_COLS}`,
      [id, u.userId, b.title, b.body, b.instruments, JSON.stringify(b.sources), JSON.stringify(b.chart_configs), b.assumptions ?? null, b.counterarguments ?? null, b.evidence_for ?? null, b.evidence_against ?? null, b.horizon_days ?? null, b.benchmark_key ?? null, b.expected ?? null, b.observed ?? null, b.missed ?? null]);
    if (!e) throw notFound('No such notebook entry.');
    await creditEntry(u.userId, e);
    return e;
  });
  app.post('/v1/research/notebook/:id/review', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ outcome: z.string().trim().min(20).max(5000), lessons: z.string().trim().min(20).max(5000) }), req.body);
    const e = await db.maybeOne<{ entry_id: string; review_date: string; created_at: string }>(`SELECT entry_id, review_date, created_at FROM research.notebook_entries WHERE entry_id=$1 AND user_id=$2 AND kind='hypothesis' AND deleted_at IS NULL`, [id, u.userId]);
    if (!e) throw notFound('No such hypothesis.');
    if (now().getTime() - Date.parse(e.created_at) < DAY) throw badRequest('A review needs time to pass: review a hypothesis at least one day after recording it.');
    await db.query(`UPDATE research.notebook_entries SET outcome=$3, lessons=$4, reviewed_at=$5, updated_at=now() WHERE entry_id=$1 AND user_id=$2`, [id, u.userId, b.outcome, b.lessons, now().toISOString()]);
    // Credit is for reviewing honestly against the record, regardless of whether the thesis was right.
    await recordActivity(db, u.userId, 'hypothesis_reviewed', id, now(), { on_or_after_review_date: iso(now().getTime()) >= e.review_date });
    return { ok: true };
  });
  app.delete('/v1/research/notebook/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.query(`UPDATE research.notebook_entries SET deleted_at=now() WHERE entry_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING 1`, [id, u.userId]);
    if (!r.length) throw notFound('No such notebook entry.');
    return { ok: true };
  });
  app.get('/v1/research/notebook/export', async (req, reply) => {
    const u = requireUser(req);
    const rows = await db.query<Record<string, any>>(`SELECT ${ENTRY_COLS} FROM research.notebook_entries WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [u.userId]);
    const md = ['# ATLAS research notebook', `Exported ${now().toISOString()} · ${rows.length} entries · private to you`, ''];
    for (const r of rows) {
      md.push(`## ${r.title}`, `*${r.kind} · created ${r.created_at} · updated ${r.updated_at}*`, '');
      if (r.instruments?.length) md.push(`Instruments: ${r.instruments.join(', ')}`, '');
      for (const [k, label] of [['thesis', 'Thesis'], ['evidence_for', 'Evidence for'], ['evidence_against', 'Evidence against'], ['assumptions', 'Assumptions'], ['counterarguments', 'Counterarguments'], ['expected', 'What I expected'], ['observed', 'What the evidence showed'], ['missed', 'What I missed'], ['outcome', 'Outcome'], ['lessons', 'Lessons']] as const) if (r[k]) md.push(`**${label}:** ${r[k]}`, '');
      if (r.review_date) md.push(`Review date: ${r.review_date}${r.reviewed_at ? ` (reviewed ${r.reviewed_at})` : ''}`, '');
      if (r.body) md.push(r.body, '');
      for (const s of r.sources ?? []) md.push(`- Source: ${s.title}${s.url ? ` <${s.url}>` : ''}${s.note ? ` (${s.note})` : ''}`);
      md.push('');
    }
    reply.header('content-type', 'text/markdown; charset=utf-8').header('content-disposition', 'attachment; filename="atlas-notebook.md"');
    return md.join('\n');
  });

  // ───────── Feature 15: report builder ─────────
  app.post('/v1/research/reports', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ title: z.string().trim().min(1).max(200), question: z.string().trim().min(10).max(2000), keys: z.array(instrumentKey).min(1).max(8), benchmark: instrumentKey.optional(), range: z.enum(['1y', '3y', '5y', 'max']).default('1y') }), req.body);
    const days = { '1y': 365, '3y': 1095, '5y': 1826, max: null }[b.range];
    const fromMs = days === null ? undefined : now().getTime() - days * DAY;
    const insts = await Promise.all(b.keys.map((k) => resolveInstrument(db, u.userId, k, now(), { fromMs })));
    const bench = b.benchmark ? await resolveInstrument(db, u.userId, b.benchmark, now(), { fromMs }) : null;
    const all = bench ? [...insts, bench] : insts;
    const align = alignmentNote(all);
    const al = A.alignSeries(all.map((i) => i.observations));
    const rf = ctx.cfg.RESEARCH_RISK_FREE_RATE;
    const findings: { kind: 'calculation' | 'interpretation'; text: string; inputs: string[] }[] = [];
    const metricRows = insts.map((i) => ({ key: i.key, label: i.label, ...metricsFor(i, rf) }));
    for (const m of metricRows) {
      if (m.total_return !== null) findings.push({ kind: 'calculation', text: `${m.label}: total price return ${(m.total_return * 100).toFixed(1)}% from ${m.first} to ${m.last}.`, inputs: [m.key] });
      if (m.max_drawdown !== null) findings.push({ kind: 'calculation', text: `${m.label}: maximum drawdown ${(m.max_drawdown * 100).toFixed(1)}% within the range.`, inputs: [m.key] });
      if (m.vol_90d !== null) findings.push({ kind: 'calculation', text: `${m.label}: 90-day realised volatility ${(m.vol_90d * 100).toFixed(1)}% annualised (×√${m.annualisation}).`, inputs: [m.key] });
    }
    let relative: { key: string; correlation: number | null; relative_return: number | null; n: number }[] = [];
    if (bench && al.dates.length >= 2) {
      const bi = all.length - 1;
      const rb = A.alignedReturns(al.dates, al.values[bi]!, align.max_gap_days);
      relative = insts.map((i, k) => {
        const ra = A.alignedReturns(al.dates, al.values[k]!, align.max_gap_days);
        const pairs = ra.map((r, j) => [r, rb[j]] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
        const v = al.values[k]!;
        const bv = al.values[bi]!;
        return { key: i.key, correlation: pairs.length >= 30 ? A.pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : null, relative_return: (v[v.length - 1]! / v[0]!) / (bv[bv.length - 1]! / bv[0]!) - 1, n: pairs.length };
      });
      for (const r of relative) {
        const lbl = insts.find((i) => i.key === r.key)!.label;
        if (r.relative_return !== null) findings.push({ kind: 'calculation', text: `${lbl} vs ${bench.label}: relative return ${(r.relative_return * 100).toFixed(1)}% over ${al.dates.length} shared dates.`, inputs: [r.key, bench.key] });
        if (r.correlation !== null) findings.push({ kind: 'calculation', text: `${lbl} vs ${bench.label}: correlation of aligned returns ${r.correlation.toFixed(2)} (${r.n} returns).`, inputs: [r.key, bench.key] });
        if (r.correlation !== null && r.correlation > 0.7) findings.push({ kind: 'interpretation', text: `Interpretation: ${lbl} moved closely with ${bench.label} in this period, so it offered little diversification against it. This describes the past window only.`, inputs: [r.key, bench.key] });
      }
    }
    const limitations = [
      ...all.filter((i) => i.freshness !== 'fresh').map((i) => `${i.label}: data is ${i.freshness} (last observation ${i.last ?? 'none'}).`),
      ...all.flatMap((i) => i.notes.map((n) => `${i.label}: ${n}`)),
      align.note,
      ...Object.entries(metricRows.reduce<Record<string, string>>((acc, m) => ({ ...acc, ...Object.fromEntries(Object.entries(m.reasons).map(([k, v]) => [`${m.label} ${k}`, v])) }), {})).map(([k, v]) => `Not calculated, ${k}: ${v}.`),
    ];
    const content = {
      question: b.question, generated_at: now().toISOString(), generator: REPORT_GENERATOR,
      period: { range: b.range, shared_from: al.dates[0] ? iso(al.dates[0]) : null, shared_to: al.dates.length ? iso(al.dates[al.dates.length - 1]!) : null, shared_dates: al.dates.length },
      instruments: all.map(describe), methodology: METRIC_DEFINITIONS, risk_free: rf, metrics: metricRows.map(({ reasons: _r, ...m }) => m), relative, findings,
      alternative_interpretations: ['Results depend on the chosen period: a different start date can change returns, drawdowns and correlations materially.', 'Price relationships can reflect market-wide moves rather than anything specific to an instrument.'],
      limitations, unavailable: ['Fundamentals and valuation ratios: no real fundamentals provider is configured.', 'Forecasts: ATLAS does not produce price predictions.'],
      reproducible_parameters: { keys: insts.map((i) => i.key), benchmark: bench?.key ?? null, range: b.range, risk_free: rf, generator: REPORT_GENERATOR },
    };
    const r = await db.one<{ report_id: string; created_at: string }>(`INSERT INTO research.reports (user_id, title, question, params, content, generator_version) VALUES ($1,$2,$3,$4,$5,$6) RETURNING report_id, created_at`, [u.userId, b.title, b.question, JSON.stringify(content.reproducible_parameters), JSON.stringify(content), REPORT_GENERATOR]);
    await recordActivity(db, u.userId, 'report_created', r.report_id, now());
    return { report_id: r.report_id, created_at: r.created_at, title: b.title, ...content };
  });
  app.get('/v1/research/reports', async (req) => {
    const u = requireUser(req);
    return { rows: await db.query(`SELECT report_id, title, question, created_at FROM research.reports WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [u.userId]) };
  });
  app.get('/v1/research/reports/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.maybeOne<{ report_id: string; title: string; question: string; content: Record<string, unknown>; created_at: string }>(`SELECT report_id, title, question, content, created_at FROM research.reports WHERE report_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, u.userId]);
    if (!r) throw notFound('No such report.');
    return r;
  });
  app.get('/v1/research/reports/:id/markdown', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.maybeOne<{ title: string; content: any; created_at: string }>(`SELECT title, content, created_at FROM research.reports WHERE report_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, u.userId]);
    if (!r) throw notFound('No such report.');
    const c = r.content;
    const md = [`# ${r.title}`, `Generated ${c.generated_at} by ATLAS (${c.generator}). Education and research, not investment advice.`, '', '## Research question', c.question, '', '## Instruments and data',
      ...c.instruments.map((i: any) => `- ${i.label}: ${i.classification}, ${i.source}, ${i.basis}; ${i.observations} observations ${i.first ?? '?'} → ${i.last ?? '?'} (${i.freshness})`), '',
      '## Findings', ...c.findings.map((f: any) => `- [${f.kind}] ${f.text}`), '', '## Alternative interpretations', ...c.alternative_interpretations.map((x: string) => `- ${x}`), '',
      '## Limitations', ...c.limitations.map((x: string) => `- ${x}`), '', '## Unavailable inputs', ...c.unavailable.map((x: string) => `- ${x}`), '',
      '## Methodology', ...Object.entries(c.methodology).map(([k, v]) => `- ${k}: ${v}`), `- Risk-free rate used: ${c.risk_free}`, '', '## Reproducible parameters', '```json', JSON.stringify(c.reproducible_parameters, null, 2), '```'];
    reply.header('content-type', 'text/markdown; charset=utf-8').header('content-disposition', `attachment; filename="atlas-report-${id.slice(0, 8)}.md"`);
    return md.join('\n');
  });
  app.delete('/v1/research/reports/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.query(`UPDATE research.reports SET deleted_at=now() WHERE report_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING 1`, [id, u.userId]);
    if (!r.length) throw notFound('No such report.');
    return { ok: true };
  });

  // ───────── Feature 17: alerts ─────────
  const alertBody = z.object({
    kind: z.enum(['price_above', 'price_below', 'change_24h_abs_pct', 'volatility_30d_above', 'drawdown_below', 'data_stale', 'source_unhealthy']),
    instrument_key: instrumentKey.optional(), source_id: z.string().regex(/^[a-z0-9_]+$/).optional(), threshold: z.number().finite().optional(), cooldown_minutes: z.number().int().min(5).max(10080).default(360),
  });
  app.get('/v1/research/alerts', async (req) => {
    const u = requireUser(req);
    return {
      rules: await db.query(`SELECT rule_id, kind, instrument_key, source_id, threshold::float8 AS threshold, cooldown_minutes, enabled, last_evaluated_at, last_triggered_at, last_error, created_at FROM research.alert_rules WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [u.userId]),
      events: await db.query(`SELECT e.event_id, e.rule_id, e.observed_value::float8 AS observed_value, e.observed_at, e.triggered_at, e.message, e.status FROM research.alert_events e WHERE e.user_id=$1 ORDER BY e.triggered_at DESC LIMIT 50`, [u.userId]),
      definitions: ALERT_DEFINITIONS, delivery: 'In-app notifications (Notices). Rules are evaluated every 5 minutes against stored data; no orders are ever placed.',
    };
  });
  app.post('/v1/research/alerts', async (req) => {
    const u = requireUser(req);
    const b = parse(alertBody, req.body);
    if (b.kind === 'source_unhealthy') {
      if (!b.source_id || !(await db.maybeOne(`SELECT 1 FROM crypto.sources WHERE source_id=$1`, [b.source_id]))) throw badRequest('Choose an existing data source.');
    } else {
      if (!b.instrument_key) throw badRequest('Choose an instrument.');
      await resolveInstrument(db, u.userId, b.instrument_key, now());
      if (!['data_stale'].includes(b.kind) && b.threshold === undefined) throw badRequest('This alert needs a threshold.');
    }
    const n = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM research.alert_rules WHERE user_id=$1 AND deleted_at IS NULL`, [u.userId])).n;
    if (n >= 50) throw badRequest('You can keep up to 50 alert rules.');
    const r = await db.one<{ rule_id: string }>(`INSERT INTO research.alert_rules (user_id, kind, instrument_key, source_id, threshold, cooldown_minutes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING rule_id`,
      [u.userId, b.kind, b.kind === 'source_unhealthy' ? null : b.instrument_key!.split('@')[0], b.kind === 'source_unhealthy' ? b.source_id : null, ['data_stale', 'source_unhealthy'].includes(b.kind) ? null : b.threshold, b.cooldown_minutes]);
    await recordActivity(db, u.userId, 'alert_configured', r.rule_id, now());
    return { rule_id: r.rule_id };
  });
  app.patch('/v1/research/alerts/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ enabled: z.boolean() }), req.body);
    const r = await db.query(`UPDATE research.alert_rules SET enabled=$3 WHERE rule_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING 1`, [id, u.userId, b.enabled]);
    if (!r.length) throw notFound('No such alert.');
    return { ok: true };
  });
  app.delete('/v1/research/alerts/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.query(`UPDATE research.alert_rules SET deleted_at=now(), enabled=false WHERE rule_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING 1`, [id, u.userId]);
    if (!r.length) throw notFound('No such alert.');
    return { ok: true };
  });
  app.post('/v1/research/alerts/evaluate', { config: { rateLimit: { limit: 6, windowMs: 60_000, key: 'user' } } }, async (req) => {
    const u = requireUser(req);
    return evaluateAlerts(db, now(), u.userId);
  });
}

export const ALERT_DEFINITIONS: Record<string, string> = {
  price_above: 'Latest stored close is at or above the threshold (instrument currency).',
  price_below: 'Latest stored close is at or below the threshold.',
  change_24h_abs_pct: 'The latest one-period move (latest close ÷ previous stored close − 1, absolute, in %) is at or above the threshold.',
  volatility_30d_above: '30-day realised volatility (annualised, in %) is at or above the threshold.',
  drawdown_below: 'Current drawdown from the stored peak (in %, e.g. −20) is at or below the threshold.',
  data_stale: 'The instrument’s latest stored observation is older than its freshness target.',
  source_unhealthy: 'A data source is failing, degraded, rate limited or disabled.',
};

/**
 * Evaluates enabled rules against stored data. A rule triggers at most once per cooldown and once per
 * (rule, observation) via a dedupe key, so re-running evaluation cannot duplicate notifications.
 */
export async function evaluateAlerts(db: Db, now: Date, onlyUser?: string): Promise<{ evaluated: number; triggered: number; errors: number }> {
  const rules = await db.query<{ rule_id: string; user_id: string; kind: string; instrument_key: string | null; source_id: string | null; threshold: number | null; cooldown_minutes: number; last_triggered_at: string | null }>(
    `SELECT rule_id, user_id, kind, instrument_key, source_id, threshold::float8 AS threshold, cooldown_minutes, last_triggered_at FROM research.alert_rules WHERE enabled AND deleted_at IS NULL AND ($1::uuid IS NULL OR user_id=$1)`, [onlyUser ?? null]);
  let triggered = 0;
  let errors = 0;
  for (const r of rules) {
    try {
      let value: number | null = null;
      let observedAt: string | null = null;
      let hit = false;
      let message = '';
      if (r.kind === 'source_unhealthy') {
        const s = await db.maybeOne<{ health: string; enabled: boolean; last_error: string | null; last_error_at: string | null }>(`SELECT health, enabled, last_error, last_error_at FROM crypto.sources WHERE source_id=$1`, [r.source_id]);
        hit = !!s && (!s.enabled || ['failing', 'degraded', 'rate_limited', 'disabled'].includes(s.health));
        observedAt = s?.last_error_at ?? null;
        message = `Data source ${r.source_id} is ${s?.enabled ? s.health : 'disabled'}${s?.last_error ? `: ${s.last_error.slice(0, 120)}` : ''}.`;
      } else {
        const inst = await resolveInstrument(db, r.user_id, r.instrument_key!, now, { fromMs: now.getTime() - 400 * DAY });
        const obs = inst.observations;
        const last = obs[obs.length - 1];
        observedAt = last ? new Date(last.t).toISOString() : null;
        if (r.kind === 'data_stale') {
          hit = inst.freshness !== 'fresh';
          message = `${inst.label}: data is ${inst.freshness} (last observation ${inst.last ?? 'none'}).`;
        } else if (!last) throw new Error('no stored observations');
        else if (r.kind === 'price_above' || r.kind === 'price_below') {
          value = last.v;
          hit = r.kind === 'price_above' ? value >= r.threshold! : value <= r.threshold!;
          message = `${inst.label}: close ${value} on ${inst.last?.slice(0, 10)} is ${r.kind === 'price_above' ? 'at or above' : 'at or below'} ${r.threshold}.`;
        } else if (r.kind === 'change_24h_abs_pct') {
          const prev = obs[obs.length - 2];
          if (!prev) throw new Error('needs two observations');
          value = (last.v / prev.v - 1) * 100;
          hit = Math.abs(value) >= r.threshold!;
          message = `${inst.label}: moved ${value.toFixed(2)}% between the last two stored observations (threshold ${r.threshold}%).`;
        } else if (r.kind === 'volatility_30d_above') {
          const v = A.realisedVol(obs, { window: 30, annualisation: inst.annualisation, minCoverage: inst.calendar === 'sessions' ? 0.6 : 0.9 });
          if (!v.ok) throw new Error(v.reason);
          value = v.value * 100;
          hit = value >= r.threshold!;
          message = `${inst.label}: 30-day realised volatility ${value.toFixed(1)}% (threshold ${r.threshold}%).`;
        } else if (r.kind === 'drawdown_below') {
          const d = A.drawdowns(obs);
          if (!d.ok) throw new Error(d.reason);
          value = d.current_drawdown * 100;
          hit = value <= r.threshold!;
          message = `${inst.label}: ${value.toFixed(1)}% below its peak in the last 400 days (threshold ${r.threshold}%).`;
        }
      }
      await db.query(`UPDATE research.alert_rules SET last_evaluated_at=$2, last_error=NULL WHERE rule_id=$1`, [r.rule_id, now.toISOString()]);
      if (!hit) continue;
      if (r.last_triggered_at && now.getTime() - Date.parse(r.last_triggered_at) < r.cooldown_minutes * 60_000) continue;
      const dedupe = `${r.rule_id}:${observedAt ?? 'none'}`;
      await db.tx(async (t) => {
        const ins = await t.query(`INSERT INTO research.alert_events (rule_id, user_id, dedupe_key, observed_value, observed_at, triggered_at, message, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'notified') ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING event_id`, [r.rule_id, r.user_id, dedupe, value, observedAt, now.toISOString(), message]);
        if (!ins.length) return;
        const n = await t.one<{ notification_id: string }>(`INSERT INTO app.notifications (user_id, kind, title, body, href) VALUES ($1,'research_alert',$2,$3,'/app/research-hub?tab=alerts') RETURNING notification_id`, [r.user_id, 'Research alert', message]);
        await t.query(`UPDATE research.alert_events SET notification_id=$2 WHERE event_id=$1`, [ins[0]!.event_id, n.notification_id]);
        await t.query(`UPDATE research.alert_rules SET last_triggered_at=$2 WHERE rule_id=$1`, [r.rule_id, now.toISOString()]);
        triggered++;
      });
    } catch (err) {
      errors++;
      await db.query(`UPDATE research.alert_rules SET last_evaluated_at=$2, last_error=$3 WHERE rule_id=$1`, [r.rule_id, now.toISOString(), (err as Error).message.slice(0, 300)]);
    }
  }
  return { evaluated: rules.length, triggered, errors };
}
