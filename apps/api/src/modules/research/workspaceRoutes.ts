import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, notFound, parse, paymentRequired } from '../../lib/http.js';
import { track } from '../analytics/events.js';
import { assertWithinCount, editableIds, requireFeature, upgradeHint, userPlan } from '../billing/entitlements.js';
import { requireUser, requireVerified } from '../auth/service.js';
import { isEnabled } from '../ops/flags.js';
import { runScreen, screenSchema, validateScreen } from '../screener/service.js';

// Saved research (PRD WSR-01..WSR-06), alerts (ALR-01..ALR-03) and peer sets (CMP-13). Every
// query is scoped to the signed-in owner; another user's id returns 404, never 403, so existence
// is not disclosed (broken-access-control protection). Saved work is never deleted by a downgrade.

const uuid = z.string().uuid();

/** Strip markup from rich-text notes: ATLAS stores notes as limited Markdown, rendered escaped. */
export function sanitizeNoteBody(s: string): string {
  return s.replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '').replace(/\son\w+\s*=\s*"[^"]*"/gi, '').replace(/javascript:/gi, '').slice(0, 50_000);
}

export async function workspaceRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;

  // ── Watchlists (WSR-01) ──
  app.get('/v1/watchlists', async (req) => {
    const u = requireUser(req);
    const plan = await userPlan(db, u.userId, ctx.clock());
    const lists = await db.query<{ watchlist_id: string; name: string; position: number; created_at: string }>(`SELECT watchlist_id, name, position, created_at FROM app.watchlists WHERE user_id=$1 AND deleted_at IS NULL ORDER BY position, created_at`, [u.userId]);
    const items = await db.query<{ watchlist_id: string; company_id: string; short_name: string; sector: string; position: number; added_at: string; close: number | null; ret_1d: number | null }>(
      `SELECT i.watchlist_id, i.company_id, c.short_name, c.sector, i.position, i.added_at,
              (SELECT value FROM calc.metric_values m WHERE m.entity_id=c.company_id::text AND m.metric_code='close' AND m.period_key='LATEST') AS close,
              (SELECT d.ret_1d FROM calc.security_daily d JOIN ref.securities s ON s.security_id=d.security_id WHERE s.company_id=c.company_id ORDER BY d.trade_date DESC LIMIT 1) AS ret_1d
         FROM app.watchlist_items i JOIN app.watchlists w USING (watchlist_id) JOIN ref.companies c USING (company_id) WHERE w.user_id=$1 AND w.deleted_at IS NULL ORDER BY i.position, i.added_at`,
      [u.userId],
    );
    const editable = editableIds(lists.map((l) => ({ id: l.watchlist_id, created_at: l.created_at })), plan.entitlements.watchlists);
    return { limits: { watchlists: plan.entitlements.watchlists, size: plan.entitlements.watchlist_size }, watchlists: lists.map((l) => ({ ...l, read_only: !editable.has(l.watchlist_id), items: items.filter((i) => i.watchlist_id === l.watchlist_id) })) };
  });
  app.post('/v1/watchlists', async (req) => {
    const u = requireVerified(req);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    const plan = await userPlan(db, u.userId, ctx.clock());
    const n = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.watchlists WHERE user_id=$1 AND deleted_at IS NULL`, [u.userId])).n;
    assertWithinCount(plan, 'watchlists', n, 'watchlist');
    return db.one(`INSERT INTO app.watchlists (user_id, name, position) VALUES ($1,$2,$3) RETURNING watchlist_id, name, position`, [u.userId, name, n]);
  });
  const ownList = async (userId: string, id: string) => {
    const w = await db.maybeOne<{ watchlist_id: string; created_at: string }>(`SELECT watchlist_id, created_at FROM app.watchlists WHERE watchlist_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, userId]);
    if (!w) throw notFound('Watchlist not found.');
    const plan = await userPlan(db, userId, ctx.clock());
    const all = await db.query<{ watchlist_id: string; created_at: string }>(`SELECT watchlist_id, created_at FROM app.watchlists WHERE user_id=$1 AND deleted_at IS NULL`, [userId]);
    const readOnly = !editableIds(all.map((l) => ({ id: l.watchlist_id, created_at: l.created_at })), plan.entitlements.watchlists).has(id);
    return { w, plan, readOnly };
  };
  app.patch('/v1/watchlists/:id', async (req) => {
    const u = requireVerified(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), position: z.number().int().min(0).max(1000).optional(), order: z.array(uuid).max(200).optional() }), req.body);
    const { readOnly } = await ownList(u.userId, id);
    if (readOnly) throw paymentRequired('This watchlist is read-only on your current plan. Nothing in it has been deleted.', { upgrade: { plan: 'plus', adds: 'More watchlists' } });
    await db.query(`UPDATE app.watchlists SET name=COALESCE($3,name), position=COALESCE($4,position), updated_at=now() WHERE watchlist_id=$1 AND user_id=$2`, [id, u.userId, body.name ?? null, body.position ?? null]);
    if (body.order) for (const [i, cid] of body.order.entries()) await db.query(`UPDATE app.watchlist_items SET position=$3 WHERE watchlist_id=$1 AND company_id=$2`, [id, cid, i]);
    return { saved: true };
  });
  app.delete('/v1/watchlists/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await ownList(u.userId, id);
    await db.query(`UPDATE app.watchlists SET deleted_at=now() WHERE watchlist_id=$1 AND user_id=$2`, [id, u.userId]);
    return { deleted: true };
  });
  app.post('/v1/watchlists/:id/items', async (req) => {
    const u = requireVerified(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ company_id: uuid, source_surface: z.enum(['search', 'company', 'screener', 'assistant', 'home', 'briefing']).default('company') }), req.body);
    const { plan, readOnly } = await ownList(u.userId, id);
    if (readOnly) throw paymentRequired('This watchlist is read-only on your current plan.', { upgrade: { plan: 'plus', adds: 'More watchlists' } });
    const c = await db.maybeOne<{ coverage: string }>(`SELECT coverage FROM ref.companies WHERE company_id=$1`, [body.company_id]);
    if (!c) throw notFound('Company not found.');
    const n = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.watchlist_items WHERE watchlist_id=$1`, [id])).n;
    const exists = await db.maybeOne(`SELECT 1 FROM app.watchlist_items WHERE watchlist_id=$1 AND company_id=$2`, [id, body.company_id]);
    if (exists) return { added: false, already: true };
    assertWithinCount(plan, 'watchlist_size', n, 'watchlist size');
    await db.query(`INSERT INTO app.watchlist_items (watchlist_id, company_id, position, source_surface) VALUES ($1,$2,$3,$4)`, [id, body.company_id, n, body.source_surface]);
    await db.query(`UPDATE app.watchlists SET updated_at=now() WHERE watchlist_id=$1`, [id]);
    await track(db, 'watchlist_item_added', { watchlist_id: id, source_surface: body.source_surface }, { userId: u.userId, origin: 'server' });
    return { added: true };
  });
  app.delete('/v1/watchlists/:id/items/:companyId', async (req) => {
    const u = requireUser(req);
    const { id, companyId } = parse(z.object({ id: uuid, companyId: uuid }), req.params);
    await ownList(u.userId, id);
    await db.query(`DELETE FROM app.watchlist_items WHERE watchlist_id=$1 AND company_id=$2`, [id, companyId]);
    return { removed: true };
  });

  // ── Notes (WSR-02) ──
  const snapshotSchema = z.object({ kind: z.enum(['table', 'chart', 'answer', 'figure']), title: z.string().max(200), as_of: z.string().max(40), source: z.string().max(200), data: z.unknown() });
  app.get('/v1/notes', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ attached_type: z.string().max(20).optional(), attached_id: z.string().max(80).optional(), q: z.string().max(100).optional(), tag: z.string().max(40).optional() }), req.query);
    const plan = await userPlan(db, u.userId, ctx.clock());
    const rows = await db.query<{ note_id: string; created_at: string }>(
      `SELECT note_id, attached_type, attached_id, title, body, snapshots, tags, created_at, updated_at FROM app.notes WHERE user_id=$1 AND deleted_at IS NULL
        AND ($2::text IS NULL OR attached_type=$2) AND ($3::text IS NULL OR attached_id=$3) AND ($4::text IS NULL OR title ILIKE '%' || $4 || '%' OR body ILIKE '%' || $4 || '%') AND ($5::text IS NULL OR $5 = ANY(tags))
        ORDER BY updated_at DESC LIMIT 500`,
      [u.userId, q.attached_type ?? null, q.attached_id ?? null, q.q ?? null, q.tag ?? null],
    );
    const all = await db.query<{ note_id: string; created_at: string }>(`SELECT note_id, created_at FROM app.notes WHERE user_id=$1 AND deleted_at IS NULL`, [u.userId]);
    const editable = editableIds(all.map((n) => ({ id: n.note_id, created_at: n.created_at })), plan.entitlements.notes);
    return { limit: plan.entitlements.notes, notes: rows.map((r) => ({ ...r, read_only: !editable.has(r.note_id) })) };
  });
  app.post('/v1/notes', async (req) => {
    const u = requireVerified(req);
    const body = parse(z.object({ attached_type: z.enum(['company', 'watchlist', 'backtest', 'answer', 'briefing', 'none']).default('none'), attached_id: z.string().max(80).nullable().optional(), title: z.string().max(200).default(''), body: z.string().max(50_000).default(''), snapshots: z.array(snapshotSchema).max(20).default([]), tags: z.array(z.string().trim().max(40)).max(20).default([]) }), req.body);
    const plan = await userPlan(db, u.userId, ctx.clock());
    const n = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.notes WHERE user_id=$1 AND deleted_at IS NULL`, [u.userId])).n;
    assertWithinCount(plan, 'notes', n, 'note');
    const row = await db.one(`INSERT INTO app.notes (user_id, attached_type, attached_id, title, body, snapshots, tags) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING note_id, created_at, updated_at`, [u.userId, body.attached_type, body.attached_id ?? null, body.title, sanitizeNoteBody(body.body), JSON.stringify(body.snapshots), body.tags]);
    await track(db, 'note_saved', { attached_type: body.attached_type }, { userId: u.userId, origin: 'server' });
    return row;
  });
  app.patch('/v1/notes/:id', async (req) => {
    const u = requireVerified(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ title: z.string().max(200).optional(), body: z.string().max(50_000).optional(), snapshots: z.array(snapshotSchema).max(20).optional(), tags: z.array(z.string().trim().max(40)).max(20).optional() }), req.body);
    const plan = await userPlan(db, u.userId, ctx.clock());
    const all = await db.query<{ note_id: string; created_at: string }>(`SELECT note_id, created_at FROM app.notes WHERE user_id=$1 AND deleted_at IS NULL`, [u.userId]);
    if (!all.some((n) => n.note_id === id)) throw notFound();
    if (!editableIds(all.map((n) => ({ id: n.note_id, created_at: n.created_at })), plan.entitlements.notes).has(id)) throw paymentRequired('This note is read-only on your current plan. It has not been deleted.', { upgrade: upgradeHint(plan.plan, 'notes') });
    const r = await db.one(`UPDATE app.notes SET title=COALESCE($3,title), body=COALESCE($4,body), snapshots=COALESCE($5,snapshots), tags=COALESCE($6,tags), updated_at=now() WHERE note_id=$1 AND user_id=$2 RETURNING note_id, updated_at`, [id, u.userId, body.title ?? null, body.body !== undefined ? sanitizeNoteBody(body.body) : null, body.snapshots ? JSON.stringify(body.snapshots) : null, body.tags ?? null]);
    await track(db, 'note_saved', { attached_type: 'update' }, { userId: u.userId, origin: 'server' });
    return r;
  });
  app.delete('/v1/notes/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const r = await db.query(`UPDATE app.notes SET deleted_at=now() WHERE note_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING 1`, [id, u.userId]);
    if (!r.length) throw notFound();
    return { deleted: true };
  });

  // ── Workspaces (WSR-03): saved as of a date; reopening offers "refresh to latest" with changed figures ──
  app.post('/v1/workspaces', async (req) => {
    const u = requireVerified(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(120), company_id: uuid.nullable().optional(), state: z.record(z.unknown()), figures: z.array(z.object({ metric_code: z.string().max(60), period_key: z.string().max(40), value: z.number().nullable() })).max(100).default([]) }), req.body);
    const asOf = (await db.maybeOne<{ d: string | null }>(`SELECT max(trade_date) AS d FROM calc.market_daily`))?.d ?? null;
    return db.one(`INSERT INTO app.workspaces (user_id, name, company_id, state, saved_figures, saved_as_of) VALUES ($1,$2,$3,$4,$5,$6) RETURNING workspace_id, saved_as_of`, [u.userId, body.name, body.company_id ?? null, JSON.stringify(body.state), JSON.stringify(body.figures), asOf]);
  });
  app.get('/v1/workspaces', async (req) => {
    const u = requireUser(req);
    return { workspaces: await db.query(`SELECT workspace_id, name, company_id, saved_as_of, created_at, updated_at FROM app.workspaces WHERE user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC`, [u.userId]) };
  });
  app.get('/v1/workspaces/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const w = await db.maybeOne<{ company_id: string | null; saved_figures: { metric_code: string; period_key: string; value: number | null }[] } & Record<string, unknown>>(`SELECT * FROM app.workspaces WHERE workspace_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, u.userId]);
    if (!w) throw notFound();
    const changed = [];
    if (w.company_id) {
      for (const f of w.saved_figures) {
        const cur = await db.maybeOne<{ value: number | null }>(`SELECT value FROM calc.metric_values WHERE entity_id=$1 AND metric_code=$2 AND period_key=$3 ORDER BY definition_version DESC LIMIT 1`, [w.company_id, f.metric_code, f.period_key]);
        if (cur && cur.value !== f.value) changed.push({ ...f, current: cur.value });
      }
    }
    return { workspace: w, refresh: { available: changed.length > 0, changed_figures: changed } };
  });
  app.delete('/v1/workspaces/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await db.query(`UPDATE app.workspaces SET deleted_at=now() WHERE workspace_id=$1 AND user_id=$2`, [id, u.userId]);
    return { deleted: true };
  });

  // ── Research history (WSR-04): last 90 days, clearable ──
  app.get('/v1/history', async (req) => {
    const u = requireUser(req);
    const rows = await db.query(`SELECT kind, ref_id, label, at FROM app.research_history WHERE user_id=$1 AND at > now() - interval '90 days' ORDER BY at DESC LIMIT 300`, [u.userId]);
    return { history: rows };
  });
  app.delete('/v1/history', async (req) => {
    const u = requireUser(req);
    await db.query(`DELETE FROM app.research_history WHERE user_id=$1`, [u.userId]);
    return { cleared: true };
  });
  app.get('/v1/home/recent', async (req) => {
    const u = requireUser(req);
    // Three most recent research items with one-click resume (HOM-04).
    return { items: await db.query(`SELECT DISTINCT ON (kind, ref_id) kind, ref_id, label, at FROM app.research_history WHERE user_id=$1 AND kind <> 'briefing' ORDER BY kind, ref_id, at DESC`, [u.userId]).then((r) => (r as { at: string }[]).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 3)) };
  });

  // ── Hypotheses (WSR-05) ──
  app.post('/v1/hypotheses', async (req) => {
    const u = requireVerified(req);
    const body = parse(z.object({ company_id: uuid.nullable().optional(), statement: z.string().trim().min(5).max(1000), evidence: z.array(z.object({ label: z.string().max(200), href: z.string().max(300) })).max(20).default([]), review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), metrics: z.array(z.string().max(60)).max(10).default([]) }), req.body);
    const baseline: Record<string, number | null> = {};
    if (body.company_id) for (const m of body.metrics) baseline[m] = (await db.maybeOne<{ value: number | null }>(`SELECT value FROM calc.metric_values WHERE entity_id=$1 AND metric_code=$2 AND period_key='LATEST'`, [body.company_id, m]))?.value ?? null;
    return db.one(`INSERT INTO app.hypotheses (user_id, company_id, statement, evidence, baseline, review_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING hypothesis_id`, [u.userId, body.company_id ?? null, body.statement, JSON.stringify(body.evidence), JSON.stringify(baseline), body.review_date]);
  });
  app.get('/v1/hypotheses', async (req) => {
    const u = requireUser(req);
    const rows = await db.query<{ hypothesis_id: string; company_id: string | null; baseline: Record<string, number | null>; review_date: string } & Record<string, unknown>>(`SELECT * FROM app.hypotheses WHERE user_id=$1 AND deleted_at IS NULL ORDER BY review_date`, [u.userId]);
    const today = new Date(ctx.clock().getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const out = [];
    for (const h of rows) {
      const due = h.review_date <= today;
      const changes = [];
      if (due && h.company_id) {
        for (const [m, v] of Object.entries(h.baseline)) changes.push({ metric: m, at_creation: v, now: (await db.maybeOne<{ value: number | null }>(`SELECT value FROM calc.metric_values WHERE entity_id=$1 AND metric_code=$2 AND period_key='LATEST'`, [h.company_id, m]))?.value ?? null });
      }
      out.push({ ...h, due, metric_changes: changes, note: due ? 'Changes since creation are shown without judging whether the hypothesis was right.' : null });
    }
    return { hypotheses: out };
  });
  app.delete('/v1/hypotheses/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await db.query(`UPDATE app.hypotheses SET deleted_at=now() WHERE hypothesis_id=$1 AND user_id=$2`, [id, u.userId]);
    return { deleted: true };
  });

  // ── Saved screens (SCR-03) ──
  app.get('/v1/screens', async (req) => {
    const u = requireUser(req);
    const plan = await userPlan(db, u.userId, ctx.clock());
    const rows = await db.query<{ screen_id: string; created_at: string }>(`SELECT screen_id, name, definition, created_at, updated_at, last_run_at, last_as_of FROM app.saved_screens WHERE user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC`, [u.userId]);
    const editable = editableIds(rows.map((r) => ({ id: r.screen_id, created_at: r.created_at })), plan.entitlements.saved_screens);
    return { limit: plan.entitlements.saved_screens, screens: rows.map((r) => ({ ...r, read_only: !editable.has(r.screen_id) })) };
  });
  app.post('/v1/screens', async (req) => {
    const u = requireVerified(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80), definition: screenSchema }), req.body);
    const plan = await userPlan(db, u.userId, ctx.clock());
    validateScreen(body.definition, plan.entitlements.screener_filters_max);
    const n = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.saved_screens WHERE user_id=$1 AND deleted_at IS NULL`, [u.userId])).n;
    assertWithinCount(plan, 'saved_screens', n, 'saved screen');
    const r = await db.one(`INSERT INTO app.saved_screens (user_id, name, definition) VALUES ($1,$2,$3) RETURNING screen_id, name`, [u.userId, body.name, JSON.stringify(body.definition)]);
    await track(db, 'screen_run', { filters_count: body.definition.filters.length, results_count: 0, saved: true }, { userId: u.userId, origin: 'server' });
    return r;
  });
  app.patch('/v1/screens/:id', async (req) => {
    const u = requireVerified(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), definition: screenSchema.optional() }), req.body);
    const r = await db.query(`UPDATE app.saved_screens SET name=COALESCE($3,name), definition=COALESCE($4,definition), updated_at=now() WHERE screen_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING screen_id`, [id, u.userId, body.name ?? null, body.definition ? JSON.stringify(body.definition) : null]);
    if (!r.length) throw notFound();
    return { saved: true };
  });
  app.post('/v1/screens/:id/run', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const s = await db.maybeOne<{ definition: z.infer<typeof screenSchema> }>(`SELECT definition FROM app.saved_screens WHERE screen_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, u.userId]);
    if (!s) throw notFound();
    const r = await runScreen(db, screenSchema.parse(s.definition));
    await db.query(`UPDATE app.saved_screens SET last_run_at=now(), last_as_of=$3 WHERE screen_id=$1 AND user_id=$2`, [id, u.userId, r.as_of]);
    return r;
  });
  app.delete('/v1/screens/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await db.query(`UPDATE app.saved_screens SET deleted_at=now() WHERE screen_id=$1 AND user_id=$2`, [id, u.userId]);
    return { deleted: true };
  });

  // ── Peer sets (CMP-13, Pro: saved peer sets) ──
  app.put('/v1/me/peer-sets/:companyId', async (req) => {
    const u = requireVerified(req);
    const { companyId } = parse(z.object({ companyId: uuid }), req.params);
    const body = parse(z.object({ name: z.string().max(80).default('My peers'), peers: z.array(uuid).min(1).max(10) }), req.body);
    const plan = await userPlan(db, u.userId, ctx.clock());
    requireFeature(plan, 'peer_sets_saved', 'Saved peer sets');
    if (body.peers.length > plan.entitlements.peer_edit_max) throw badRequest(`Up to ${plan.entitlements.peer_edit_max} peers.`);
    const existing = await db.maybeOne<{ peer_set_id: string }>(`SELECT peer_set_id FROM app.peer_sets WHERE user_id=$1 AND company_id=$2`, [u.userId, companyId]);
    if (existing) {
      await db.query(`UPDATE app.peer_sets SET peers=$2, name=$3, updated_at=now() WHERE peer_set_id=$1`, [existing.peer_set_id, body.peers, body.name]);
      return { peer_set_id: existing.peer_set_id };
    }
    return db.one(`INSERT INTO app.peer_sets (user_id, company_id, name, peers) VALUES ($1,$2,$3,$4) RETURNING peer_set_id`, [u.userId, companyId, body.name, body.peers]);
  });

  // ── Alerts (ALR-01..03) ──
  app.get('/v1/alerts', async (req) => {
    const u = requireUser(req);
    const plan = await userPlan(db, u.userId, ctx.clock());
    const rules = await db.query(`SELECT r.rule_id, r.kind, r.watchlist_id, r.company_id, r.config, r.digest, r.status, r.created_at, w.name AS watchlist_name FROM app.alert_rules r LEFT JOIN app.watchlists w USING (watchlist_id) WHERE r.user_id=$1 AND r.deleted_at IS NULL ORDER BY r.created_at`, [u.userId]);
    const history = await db.query(`SELECT e.event_id, e.kind, e.title, e.status, e.created_at, e.sent_at, e.payload FROM app.alert_events e WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT 100`, [u.userId]);
    return { limit: plan.entitlements.alerts_active, rules, history, price_alerts_available: await isEnabled(db, 'price_volume_alerts', { production: ctx.cfg.isProduction }) };
  });
  app.post('/v1/alerts', async (req) => {
    const u = requireVerified(req);
    const body = parse(z.object({ kind: z.enum(['material_change', 'price_move', 'volume_spike']).default('material_change'), watchlist_id: uuid.optional(), company_id: uuid.optional(), kinds: z.array(z.enum(['results_filed', 'announcement', 'promoter_change', 'pledge_change', 'auditor_change', 'correction'])).max(6).default([]), categories: z.array(z.string().max(60)).max(20).default([]), digest: z.boolean().default(false), threshold_pct: z.number().min(1).max(50).optional(), volume_multiple: z.number().min(1.5).max(20).optional() }), req.body);
    if (!body.watchlist_id && !body.company_id) throw badRequest('Choose a watchlist or a company.');
    if (body.kind !== 'material_change' && !(await isEnabled(db, 'price_volume_alerts', { production: ctx.cfg.isProduction }))) throw badRequest('Price and volume alerts are switched off pending legal sign-off (ALR-02, CPL-03).');
    const plan = await userPlan(db, u.userId, ctx.clock());
    requireFeature(plan, 'alerts_active', 'Material-change alerts');
    const active = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.alert_rules WHERE user_id=$1 AND deleted_at IS NULL AND status='active'`, [u.userId])).n;
    assertWithinCount(plan, 'alerts_active', active, 'active alert');
    if (body.watchlist_id) {
      const w = await db.maybeOne(`SELECT 1 FROM app.watchlists WHERE watchlist_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [body.watchlist_id, u.userId]);
      if (!w) throw notFound('Watchlist not found.');
    }
    return db.one(`INSERT INTO app.alert_rules (user_id, watchlist_id, company_id, kind, config, digest) VALUES ($1,$2,$3,$4,$5,$6) RETURNING rule_id, status`, [u.userId, body.watchlist_id ?? null, body.company_id ?? null, body.kind, JSON.stringify({ kinds: body.kinds, categories: body.categories, threshold_pct: body.threshold_pct, volume_multiple: body.volume_multiple }), body.digest]);
  });
  app.patch('/v1/alerts/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ status: z.enum(['active', 'paused']).optional(), digest: z.boolean().optional() }), req.body);
    if (body.status === 'active') {
      const plan = await userPlan(db, u.userId, ctx.clock());
      const active = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app.alert_rules WHERE user_id=$1 AND deleted_at IS NULL AND status='active' AND rule_id <> $2`, [u.userId, id])).n;
      assertWithinCount(plan, 'alerts_active', active, 'active alert');
    }
    const r = await db.query(`UPDATE app.alert_rules SET status=COALESCE($3,status), digest=COALESCE($4,digest) WHERE rule_id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING rule_id`, [id, u.userId, body.status ?? null, body.digest ?? null]);
    if (!r.length) throw notFound();
    return { saved: true };
  });
  app.delete('/v1/alerts/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await db.query(`UPDATE app.alert_rules SET deleted_at=now() WHERE rule_id=$1 AND user_id=$2`, [id, u.userId]);
    return { deleted: true };
  });
  app.post('/v1/alerts/events/:id/opened', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const e = await db.maybeOne<{ kind: string; created_at: string; source_ingested_at: string }>(`UPDATE app.alert_events SET opened_at=COALESCE(opened_at, now()) WHERE event_id=$1 AND user_id=$2 RETURNING kind, created_at, source_ingested_at`, [id, u.userId]);
    if (!e) throw notFound();
    await track(db, 'alert_opened', { alert_type: e.kind, latency_minutes: Math.round((Date.now() - Date.parse(e.source_ingested_at)) / 60000) }, { userId: u.userId, origin: 'server' });
    return { opened: true };
  });
}
