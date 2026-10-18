import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { activation, churn, cohorts, eventHealth, funnel, weeklyActiveResearchers } from '../analytics/dashboards.js';
import { requireRole } from '../auth/service.js';
import { refundPayment } from '../billing/service.js';
import { audit, verifyAuditChain } from '../ops/audit.js';
import { FLAGS, setFlag } from '../ops/flags.js';
import { freshness } from '../provenance/evidence.js';
import { ingestDataset } from '../../pipeline/ingest.js';
import { runDailyCycle } from '../../pipeline/daily.js';
import type { DatasetName } from '../../pipeline/vendor.js';
import { queueEmail } from '../notify/email.js';

// Admin and operations console (PRD ADM-01..ADM-08). Every route requires an admin-class role
// with two-step verification; personal data is masked unless unmasked with a recorded reason.

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, local.length - 1))}@${domain.replace(/^[^.]+/, (d) => d.slice(0, 1) + '***')}`;
}

export async function adminRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const staff = ['admin', 'support', 'data_ops'] as const;

  // ADM-01: user and subscription lookup, masked by default
  app.get('/admin/v1/users', async (req) => {
    requireRole(req, ['admin', 'support']);
    const q = parse(z.object({ q: z.string().max(120).optional() }), req.query);
    const rows = await db.query<{ user_id: string; email: string; role: string; created_at: string; email_verified_at: string | null; status: string; plan: string | null; sub_status: string | null }>(
      `SELECT u.user_id, u.email, u.role, u.created_at, u.email_verified_at, u.status, s.plan_code AS plan, s.status AS sub_status FROM app.users u
         LEFT JOIN LATERAL (SELECT plan_code, status FROM app.subscriptions WHERE user_id=u.user_id ORDER BY created_at DESC LIMIT 1) s ON true
        WHERE $1::text IS NULL OR u.user_id::text = $1 OR lower(u.email) = lower($1) ORDER BY u.created_at DESC LIMIT 50`,
      [q.q ?? null],
    );
    return { users: rows.map((r) => ({ ...r, email: maskEmail(r.email) })), masked: true };
  });
  app.post('/admin/v1/users/:id/unmask', async (req) => {
    const a = requireRole(req, ['admin', 'support']);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(500) }), req.body);
    const u = await db.maybeOne<{ email: string; display_name: string | null }>(`SELECT email, display_name FROM app.users WHERE user_id=$1`, [id]);
    if (!u) throw notFound();
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'pii.unmask', targetType: 'user', targetId: id, reason });
    return { user_id: id, email: u.email, display_name: u.display_name };
  });
  app.get('/admin/v1/users/:id', async (req) => {
    requireRole(req, ['admin', 'support']);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const u = await db.maybeOne<{ email: string } & Record<string, unknown>>(`SELECT user_id, email, role, created_at, email_verified_at, status, is_beta, totp_enabled_at FROM app.users WHERE user_id=$1`, [id]);
    if (!u) throw notFound();
    return {
      user: { ...u, email: maskEmail(u.email) },
      subscriptions: await db.query(`SELECT * FROM app.subscriptions WHERE user_id=$1 ORDER BY created_at DESC`, [id]),
      payments: await db.query(`SELECT payment_id, kind, amount_inr, status, is_sandbox, created_at FROM app.payments WHERE user_id=$1 ORDER BY created_at DESC`, [id]),
      overrides: await db.query(`SELECT * FROM app.entitlement_overrides WHERE user_id=$1 ORDER BY created_at DESC`, [id]),
      usage: await db.query(`SELECT metric, period_start, count FROM app.usage_counters WHERE user_id=$1 ORDER BY period_start DESC`, [id]),
    };
  });

  // ADM-02: entitlement overrides and refunds (mandatory reason, audit-logged)
  app.post('/admin/v1/users/:id/entitlements', async (req) => {
    const a = requireRole(req, ['admin', 'support']);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ key: z.string().max(60), value: z.number().int().min(-1).max(100000), expires_at: z.string().datetime().optional(), reason: z.string().trim().min(10).max(500) }), req.body);
    const r = await db.one(`INSERT INTO app.entitlement_overrides (user_id, key, value, expires_at, reason, granted_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING override_id`, [id, body.key, body.value, body.expires_at ?? null, body.reason, a.userId]);
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'entitlement.override', targetType: 'user', targetId: id, reason: body.reason, details: { key: body.key, value: body.value, expires_at: body.expires_at ?? null } });
    return r;
  });
  app.post('/admin/v1/payments/:id/refund', async (req) => {
    const a = requireRole(req, ['admin']);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(500) }), req.body);
    const r = await refundPayment(ctx, a, id, reason);
    return { ...r, note: 'The gateway confirms the refund by webhook; the credit note is issued when it arrives.' };
  });

  // ADM-03: data pipeline monitor with safe re-run controls
  app.get('/admin/v1/pipeline', async (req) => {
    requireRole(req, [...staff]);
    return {
      freshness: await freshness(db, ctx.clock()),
      runs: await db.query(`SELECT run_id, source_id, dataset, data_date, status, started_at, finished_at, rows_in, rows_valid, rows_quarantined, checks, error FROM ops.ingestion_runs ORDER BY started_at DESC LIMIT 100`),
      jobs: await db.query(`SELECT job_name, run_key, status, started_at, finished_at, error FROM ops.job_runs ORDER BY started_at DESC LIMIT 50`),
      queue: await db.query(`SELECT kind, status, count(*)::int AS n FROM ops.job_queue GROUP BY kind, status`),
      alerts: await db.query(`SELECT alert_id, kind, severity, message, created_at, acknowledged_at FROM ops.ops_alerts ORDER BY created_at DESC LIMIT 50`),
      calc_runs: await db.query(`SELECT calc_run_id, kind, status, started_at, finished_at, details FROM calc.calc_runs ORDER BY started_at DESC LIMIT 20`),
    };
  });
  app.post('/admin/v1/pipeline/rerun', async (req) => {
    const a = requireRole(req, ['admin', 'data_ops']);
    const body = parse(z.object({ dataset: z.string().max(40).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(5).max(500), full_cycle: z.boolean().default(false) }), req.body);
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'pipeline.rerun', targetType: 'dataset', targetId: body.dataset ?? 'daily_cycle', reason: body.reason, details: { date: body.date } });
    const pctx = { db, store: ctx.store, cfg: ctx.cfg, log: ctx.log, now: ctx.clock };
    if (body.full_cycle) {
      // Safe: the cycle is idempotent; a failed run is released for retry, a succeeded run is not repeated.
      await db.query(`UPDATE ops.job_runs SET status='failed' WHERE job_name='daily_cycle' AND run_key=$1 AND status='running' AND started_at < now() - interval '30 minutes'`, [body.date]);
      return runDailyCycle(pctx, ctx.vendor, body.date);
    }
    if (!body.dataset) throw badRequest('Choose a dataset or a full cycle.');
    return ingestDataset(pctx, ctx.vendor, body.dataset as DatasetName, { asOf: body.date, mode: 'daily' });
  });
  app.post('/admin/v1/alerts/:id/ack', async (req) => {
    const a = requireRole(req, [...staff]);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await db.query(`UPDATE ops.ops_alerts SET acknowledged_at=now(), acknowledged_by=$2 WHERE alert_id=$1`, [id, a.userId]);
    return { acknowledged: true };
  });

  // ADM-04: data-quality queue and correction publishing (MTH-05)
  app.get('/admin/v1/quality', async (req) => {
    requireRole(req, [...staff]);
    const q = parse(z.object({ status: z.string().max(20).optional() }), req.query);
    return {
      issues: await db.query(`SELECT * FROM calc.quality_issues WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 200`, [q.status ?? null]),
      median_triage_hours: (await db.one<{ h: number | null }>(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM triaged_at - created_at) / 3600) AS h FROM calc.quality_issues WHERE triaged_at IS NOT NULL`)).h,
    };
  });
  app.patch('/admin/v1/quality/:id', async (req) => {
    const a = requireRole(req, ['admin', 'data_ops']);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ status: z.enum(['triaged', 'resolved', 'wont_fix', 'routed_to_vendor']), owner_user_id: z.string().uuid().optional(), resolution_notes: z.string().max(4000).optional() }), req.body);
    const r = await db.query(`UPDATE calc.quality_issues SET status=$2, owner_user_id=COALESCE($3, owner_user_id, $5), resolution_notes=COALESCE($4, resolution_notes), triaged_at=COALESCE(triaged_at, now()), resolved_at=CASE WHEN $2 IN ('resolved','wont_fix','routed_to_vendor') THEN now() ELSE resolved_at END WHERE issue_id=$1 RETURNING support_ticket_id`, [id, body.status, body.owner_user_id ?? null, body.resolution_notes ?? null, a.userId]);
    if (!r.length) throw notFound();
    const ticket = (r[0] as { support_ticket_id: string | null }).support_ticket_id;
    if (ticket) await db.query(`UPDATE app.support_tickets SET status=CASE WHEN $2 IN ('resolved','wont_fix','routed_to_vendor') THEN 'resolved' ELSE 'triaged' END, first_response_at=COALESCE(first_response_at, now()), resolution=COALESCE($3, resolution), resolved_at=CASE WHEN $2 IN ('resolved','wont_fix','routed_to_vendor') THEN now() ELSE resolved_at END WHERE ticket_id=$1`, [ticket, body.status, body.resolution_notes ?? null]);
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'quality.update', targetType: 'quality_issue', targetId: id, reason: body.resolution_notes ?? null, details: { status: body.status } });
    return { saved: true };
  });
  app.post('/admin/v1/corrections', async (req) => {
    const a = requireRole(req, ['admin', 'data_ops']);
    const body = parse(z.object({ kind: z.enum(['data', 'calculation', 'ai_behaviour', 'methodology']), title: z.string().trim().min(5).max(200), description: z.string().max(4000), impact: z.string().max(2000), company_ids: z.array(z.string().uuid()).max(100).default([]), issue_id: z.string().uuid().optional() }), req.body);
    const c = await db.one<{ correction_id: string }>(`INSERT INTO calc.corrections (kind, title, description, impact, affected) VALUES ($1,$2,$3,$4,$5) RETURNING correction_id`, [body.kind, body.title, body.description, body.impact, JSON.stringify({ company_ids: body.company_ids })]);
    // Notify users with affected saved items (watchlists, notes, workspaces).
    const users = body.company_ids.length ? await db.query<{ user_id: string; email: string }>(
      `SELECT DISTINCT u.user_id, u.email FROM app.users u WHERE u.status='active' AND (
         EXISTS (SELECT 1 FROM app.watchlist_items i JOIN app.watchlists w USING (watchlist_id) WHERE w.user_id=u.user_id AND w.deleted_at IS NULL AND i.company_id = ANY($1::uuid[]))
         OR EXISTS (SELECT 1 FROM app.notes n WHERE n.user_id=u.user_id AND n.deleted_at IS NULL AND n.attached_type='company' AND n.attached_id = ANY($1::text[]))
         OR EXISTS (SELECT 1 FROM app.workspaces s WHERE s.user_id=u.user_id AND s.deleted_at IS NULL AND s.company_id = ANY($1::uuid[])))`,
      [body.company_ids],
    ) : [];
    for (const u of users) {
      await queueEmail(db, { to: u.email, userId: u.user_id, template: 'correction', category: 'service', subject: `ATLAS correction: ${body.title}`, text: `${body.description}\n\nImpact: ${body.impact}\n\nThe correction log lists every material correction: /methodology/corrections` });
      await db.query(`INSERT INTO app.notifications (user_id, kind, title, body, href) VALUES ($1,'correction',$2,$3,'/methodology/corrections')`, [u.user_id, `Correction: ${body.title}`, body.impact]);
    }
    await db.query(`UPDATE calc.corrections SET users_notified=$2 WHERE correction_id=$1`, [c.correction_id, users.length]);
    if (body.issue_id) await db.query(`UPDATE calc.quality_issues SET correction_id=$2, status='resolved', resolved_at=now() WHERE issue_id=$1`, [body.issue_id, c.correction_id]);
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'correction.publish', targetType: 'correction', targetId: c.correction_id, details: { notified: users.length } });
    return { correction_id: c.correction_id, users_notified: users.length };
  });

  // ADM-05: AI review queue with full traces
  app.get('/admin/v1/ai/review', async (req) => {
    requireRole(req, ['admin', 'data_ops', 'support']);
    const rows = await db.query(
      `SELECT f.feedback_id, f.rating, f.reason, f.comment, f.is_error_report, f.review_status, f.created_at, m.message_id, m.content_json, m.model_id, m.prompt_version, m.tool_versions, m.check_status, m.latency_ms, m.cost_inr,
              (SELECT content_json->>'text' FROM ai.messages u WHERE u.conversation_id=m.conversation_id AND u.role='user' AND u.created_at <= m.created_at ORDER BY u.created_at DESC LIMIT 1) AS question,
              (SELECT json_agg(json_build_object('tool', t.tool, 'input', t.input, 'output', t.output, 'fields_sent', t.fields_sent_to_model, 'fields_withheld', t.fields_withheld)) FROM ai.tool_calls t WHERE t.message_id=m.message_id) AS trace
         FROM ai.feedback f JOIN ai.messages m USING (message_id) ORDER BY f.is_error_report DESC, f.created_at DESC LIMIT 100`,
    );
    return { items: rows };
  });
  app.patch('/admin/v1/ai/review/:id', async (req) => {
    const a = requireRole(req, ['admin', 'data_ops']);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ review_status: z.enum(['in_review', 'confirmed_error', 'not_an_error', 'added_to_eval']), review_label: z.string().max(500).optional(), expected: z.record(z.unknown()).optional() }), req.body);
    const f = await db.maybeOne<{ message_id: string }>(`UPDATE ai.feedback SET review_status=$2, review_label=$3, reviewer_user_id=$4, triaged_at=COALESCE(triaged_at, now()) WHERE feedback_id=$1 RETURNING message_id`, [id, body.review_status, body.review_label ?? null, a.userId]);
    if (!f) throw notFound();
    if (body.review_status === 'added_to_eval' || body.review_status === 'confirmed_error') {
      const q = await db.maybeOne<{ text: string; context: unknown }>(`SELECT u.content_json->>'text' AS text, u.content_json->'context' AS context FROM ai.messages m JOIN ai.messages u ON u.conversation_id=m.conversation_id AND u.role='user' AND u.created_at <= m.created_at WHERE m.message_id=$1 ORDER BY u.created_at DESC LIMIT 1`, [f.message_id]);
      if (q) await db.query(`INSERT INTO ai.eval_cases (case_id, suite, category, question, context, expected, snapshot_label, origin) VALUES ($1,'golden','user_report',$2,$3,$4,'current','user_report') ON CONFLICT DO NOTHING`, [`user-${id}`, q.text, JSON.stringify(q.context ?? {}), JSON.stringify(body.expected ?? { review_label: body.review_label })]);
    }
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'ai.review', targetType: 'ai_feedback', targetId: id, details: { status: body.review_status } });
    return { saved: true };
  });

  // ADM-07: feature flags with legal approval records
  app.get('/admin/v1/flags', async (req) => {
    requireRole(req, ['admin']);
    return { flags: await db.query(`SELECT * FROM ops.feature_flags ORDER BY legal_gated DESC, flag_key`), catalogue: FLAGS };
  });
  app.post('/admin/v1/flags/:key', async (req) => {
    const a = requireRole(req, ['admin']);
    const { key } = parse(z.object({ key: z.string().max(60) }), req.params);
    const body = parse(z.object({ enabled: z.boolean(), reason: z.string().trim().min(5).max(500), plan_scope: z.array(z.string().max(10)).max(3).optional(), user_allowlist: z.array(z.string().uuid()).max(500).optional(), approval: z.object({ approver: z.string().trim().min(3).max(200), approved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), document_ref: z.string().trim().min(3).max(300) }).optional() }), req.body);
    await setFlag(db, key, { enabled: body.enabled, planScope: body.plan_scope, userAllowlist: body.user_allowlist, approval: body.approval }, { userId: a.userId, role: a.role, reason: body.reason });
    return { saved: true };
  });

  // ADM-08: audit log
  app.get('/admin/v1/audit', async (req) => {
    requireRole(req, ['admin']);
    return { entries: await db.query(`SELECT audit_id, at, actor_user_id, actor_role, action, target_type, target_id, reason, details FROM ops.audit_log ORDER BY audit_id DESC LIMIT 200`), chain: await verifyAuditChain(db) };
  });

  // Support queue, grievances, outbox (dev), status incidents
  app.get('/admin/v1/support', async (req) => {
    requireRole(req, ['admin', 'support']);
    return {
      tickets: await db.query(`SELECT ticket_id, ticket_ref, kind, subject, status, priority, plan_code, created_at, due_first_response_at, first_response_at FROM app.support_tickets ORDER BY (status IN ('open','triaged')) DESC, priority DESC, created_at LIMIT 200`),
      grievances: await db.query(`SELECT g.*, t.ticket_ref, t.subject FROM app.grievances g JOIN app.support_tickets t USING (ticket_id) ORDER BY g.received_at DESC`),
      sla: await db.one(`SELECT count(*) FILTER (WHERE first_response_at IS NOT NULL AND first_response_at <= due_first_response_at)::int AS on_time, count(*) FILTER (WHERE first_response_at IS NOT NULL)::int AS responded FROM app.support_tickets`),
    };
  });
  app.post('/admin/v1/support/:id/respond', async (req) => {
    const a = requireRole(req, ['admin', 'support']);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ message: z.string().trim().min(2).max(5000), resolve: z.boolean().default(false) }), req.body);
    const t = await db.maybeOne<{ user_id: string | null; email: string | null; ticket_ref: string; kind: string }>(`UPDATE app.support_tickets SET first_response_at=COALESCE(first_response_at, now()), status=CASE WHEN $2 THEN 'resolved' ELSE 'waiting' END, resolved_at=CASE WHEN $2 THEN now() ELSE resolved_at END, resolution=CASE WHEN $2 THEN $3 ELSE resolution END, assignee=$4 WHERE ticket_id=$1 RETURNING user_id, email, ticket_ref, kind`, [id, body.resolve, body.message, a.userId]);
    if (!t) throw notFound();
    const to = t.email ?? (t.user_id ? (await db.one<{ email: string }>(`SELECT email FROM app.users WHERE user_id=$1`, [t.user_id])).email : null);
    if (to) await queueEmail(db, { to, userId: t.user_id, template: 'support_reply', category: 'service', subject: `ATLAS support ${t.ticket_ref}`, text: body.message });
    if (t.kind === 'grievance') await db.query(`UPDATE app.grievances SET acknowledged_at=COALESCE(acknowledged_at, now()), resolved_at=CASE WHEN $2 THEN now() ELSE resolved_at END WHERE ticket_id=$1`, [id, body.resolve]);
    return { sent: !!to };
  });
  app.get('/admin/v1/outbox', async (req) => {
    requireRole(req, ['admin', 'support']);
    if (ctx.cfg.isProduction) throw notFound();
    return { emails: await db.query(`SELECT email_id, to_email, template, category, subject, body_text, status, created_at FROM app.email_outbox ORDER BY created_at DESC LIMIT 100`) };
  });
  app.post('/admin/v1/status/incidents', async (req) => {
    const a = requireRole(req, ['admin', 'data_ops']);
    const body = parse(z.object({ component: z.string().max(80), title: z.string().max(200), severity: z.enum(['SEV1', 'SEV2', 'SEV3']), status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']), update: z.string().max(2000) }), req.body);
    const r = await db.one(`INSERT INTO ops.status_incidents (component, title, severity, status, posted_at, updates, resolved_at) VALUES ($1,$2,$3,$4,now(),$5, CASE WHEN $4='resolved' THEN now() END) RETURNING incident_id`, [body.component, body.title, body.severity, body.status, JSON.stringify([{ at: new Date().toISOString(), text: body.update }])]);
    await audit(db, { actorUserId: a.userId, actorRole: a.role, action: 'status.incident', targetType: 'incident', targetId: (r as { incident_id: string }).incident_id });
    return r;
  });

  // Analytics and cost dashboards (ANL-02, ANL-03, Blueprint §13)
  app.get('/admin/v1/analytics', async (req) => {
    requireRole(req, ['admin']);
    // Analytics events are stamped with wall-clock time, so reporting windows use it too.
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    return {
      activation: await activation(db, from, now.toISOString()),
      war: await weeklyActiveResearchers(db, 12),
      funnel: await funnel(db, from, now.toISOString()),
      cohorts: await cohorts(db),
      churn: await churn(db),
      events: await eventHealth(db),
      ai_quality: await db.one(`SELECT count(*)::int AS answers, avg(latency_ms)::float8 AS avg_latency_ms, percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_ms, percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms, count(*) FILTER (WHERE check_status='fallback')::int AS fallbacks, avg(cost_inr)::float8 AS avg_cost_inr FROM ai.messages WHERE role='assistant' AND created_at > now() - interval '7 days'`),
      feedback: await db.one(`SELECT count(*) FILTER (WHERE rating='up')::int AS up, count(*) FILTER (WHERE rating='down')::int AS down, count(*) FILTER (WHERE is_error_report)::int AS error_reports FROM ai.feedback WHERE created_at > now() - interval '7 days'`),
      costs: await db.query(`SELECT category, date_trunc('month', at)::date AS month, sum(amount_inr)::float8 AS inr FROM ops.cost_ledger GROUP BY 1, 2 ORDER BY 2 DESC, 1`),
      budgets: await db.query(`SELECT * FROM ops.budgets`),
      subscriptions: await db.one(`SELECT count(*) FILTER (WHERE status='active')::int AS active, count(*) FILTER (WHERE status='past_due')::int AS past_due, count(*) FILTER (WHERE status IN ('pending','created'))::int AS pending FROM app.subscriptions`),
      webhooks: await db.one(`SELECT count(*) FILTER (WHERE status='failed')::int AS failed, count(*) FILTER (WHERE status='rejected')::int AS rejected, count(*)::int AS total FROM app.webhook_events WHERE received_at > now() - interval '7 days'`),
    };
  });
}
