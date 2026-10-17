import type { Db } from '../../db/db.js';
import { queueEmail } from '../notify/email.js';

// Material-change alerts (PRD ALR-01/03, J8). Events are derived from validated data only.
// Delivery: email within 60 minutes of ingestion, deduplicated per user and event, at most
// 20 alert emails per user per day (the rest roll into a digest), paused rules send nothing.

export const ALERT_CAP_PER_DAY = 20;
export const ANNOUNCEMENT_CATEGORIES = ['Financial Results', 'Board Meeting', 'Dividend', 'Change in Auditor', 'Acquisition', 'Credit Rating', 'Investor Presentation', 'ESOP', 'Analyst Meet'];

export interface MaterialEvent {
  companyId: string;
  kind: 'results_filed' | 'announcement' | 'promoter_change' | 'pledge_change' | 'auditor_change' | 'correction';
  ref: string;
  title: string;
  evidenceHref: string;
  ingestedAt: string;
  category?: string;
}

/** Events from data ingested since `since` (ISO instant). */
export async function detectEvents(db: Db, since: string): Promise<MaterialEvent[]> {
  const events: MaterialEvent[] = [];
  const results = await db.query<{ company_id: string; period_id: string; period_type: string; fiscal_year: number; fiscal_quarter: number | null; short_name: string; ingested: string }>(
    `SELECT fp.company_id, fp.period_id, fp.period_type, fp.fiscal_year, fp.fiscal_quarter, c.short_name, r.finished_at AS ingested
       FROM fund.financial_periods fp JOIN ops.ingestion_runs r ON r.run_id = fp.ingestion_run_id JOIN ref.companies c USING (company_id)
      WHERE r.finished_at > $1 AND fp.version = 1 AND (fp.period_type = 'Q') AND fp.basis = CASE WHEN EXISTS (SELECT 1 FROM fund.financial_periods x WHERE x.company_id=fp.company_id AND x.basis='consolidated') THEN 'consolidated' ELSE 'standalone' END`,
    [since],
  );
  for (const r of results) {
    const label = `Q${r.fiscal_quarter} FY${String(r.fiscal_year % 100).padStart(2, '0')}`;
    events.push({ companyId: r.company_id, kind: 'results_filed', ref: r.period_id, title: `${r.short_name} filed ${label} results`, evidenceHref: `/app/companies/${r.company_id}?tab=financials`, ingestedAt: r.ingested });
  }
  const anns = await db.query<{ announcement_id: string; company_id: string; category: string; subject: string; short_name: string; received_at: string }>(
    `SELECT a.announcement_id, a.company_id, a.category, a.subject, c.short_name, a.received_at FROM disc.announcements a JOIN ref.companies c USING (company_id)
      JOIN ops.ingestion_runs r ON r.run_id = a.ingestion_run_id WHERE r.finished_at > $1 AND a.category <> 'Financial Results'`,
    [since],
  );
  for (const a of anns) {
    events.push({ companyId: a.company_id, kind: a.category === 'Change in Auditor' ? 'auditor_change' : 'announcement', ref: a.announcement_id, title: `${a.short_name}: ${a.subject}`, evidenceHref: `/v1/documents/${a.announcement_id}`, ingestedAt: a.received_at, category: a.category });
  }
  const shp = await db.query<{ company_id: string; snapshot_id: string; quarter_end: string; short_name: string; promoter: number; prev_promoter: number | null; pledge: number | null; prev_pledge: number | null; ingested: string }>(
    `WITH cur AS (
       SELECT s.company_id, s.snapshot_id, s.quarter_end, r.finished_at AS ingested, v.pct AS promoter, v.pledged_pct_of_promoter AS pledge
         FROM fund.shareholding_snapshots s JOIN ops.ingestion_runs r ON r.run_id = s.ingestion_run_id
         JOIN fund.shareholding_values v ON v.snapshot_id = s.snapshot_id AND v.category = 'promoter' WHERE r.finished_at > $1)
     SELECT cur.*, c.short_name,
       (SELECT v.pct FROM fund.shareholding_snapshots p JOIN fund.shareholding_values v ON v.snapshot_id=p.snapshot_id AND v.category='promoter' WHERE p.company_id=cur.company_id AND p.quarter_end < cur.quarter_end ORDER BY p.quarter_end DESC LIMIT 1) AS prev_promoter,
       (SELECT v.pledged_pct_of_promoter FROM fund.shareholding_snapshots p JOIN fund.shareholding_values v ON v.snapshot_id=p.snapshot_id AND v.category='promoter' WHERE p.company_id=cur.company_id AND p.quarter_end < cur.quarter_end ORDER BY p.quarter_end DESC LIMIT 1) AS prev_pledge
     FROM cur JOIN ref.companies c USING (company_id)`,
    [since],
  );
  for (const s of shp) {
    if (s.prev_promoter !== null && Math.abs(s.promoter - s.prev_promoter) >= 1) {
      events.push({ companyId: s.company_id, kind: 'promoter_change', ref: s.snapshot_id, title: `${s.short_name}: promoter holding moved from ${s.prev_promoter.toFixed(2)}% to ${s.promoter.toFixed(2)}%`, evidenceHref: `/app/companies/${s.company_id}?tab=ownership`, ingestedAt: s.ingested });
    }
    if (s.pledge !== null && s.prev_pledge !== null && Math.abs(s.pledge - s.prev_pledge) >= 0.5) {
      events.push({ companyId: s.company_id, kind: 'pledge_change', ref: `${s.snapshot_id}:pledge`, title: `${s.short_name}: pledged share of promoter holding moved from ${s.prev_pledge.toFixed(2)}% to ${s.pledge.toFixed(2)}%`, evidenceHref: `/app/companies/${s.company_id}?tab=ownership`, ingestedAt: s.ingested });
    }
  }
  const corr = await db.query<{ correction_id: string; title: string; affected: { company_ids?: string[] }; published_at: string }>(`SELECT correction_id, title, affected, published_at FROM calc.corrections WHERE published_at > $1`, [since]);
  for (const c of corr) for (const cid of c.affected.company_ids ?? []) events.push({ companyId: cid, kind: 'correction', ref: c.correction_id, title: `Correction: ${c.title}`, evidenceHref: '/methodology/corrections', ingestedAt: c.published_at });
  return events;
}

/** Match events to active rules, create deduplicated alert events and queue emails within the cap. */
export async function dispatchAlerts(db: Db, events: MaterialEvent[], now: Date): Promise<{ created: number; emailed: number; digested: number; suppressed: number }> {
  if (!events.length) return { created: 0, emailed: 0, digested: 0, suppressed: 0 };
  const rules = await db.query<{ rule_id: string; user_id: string; watchlist_id: string | null; company_id: string | null; config: { kinds?: string[]; categories?: string[] }; digest: boolean; status: string; email: string; verified: string | null }>(
    `SELECT r.rule_id, r.user_id, r.watchlist_id, r.company_id, r.config, r.digest, r.status, u.email, u.email_verified_at AS verified
       FROM app.alert_rules r JOIN app.users u USING (user_id) WHERE r.deleted_at IS NULL AND r.kind='material_change' AND u.status='active'`,
  );
  const wl = await db.query<{ watchlist_id: string; company_id: string }>(`SELECT i.watchlist_id, i.company_id FROM app.watchlist_items i JOIN app.watchlists w USING (watchlist_id) WHERE w.deleted_at IS NULL`);
  const members = new Map<string, Set<string>>();
  for (const w of wl) members.set(w.watchlist_id, (members.get(w.watchlist_id) ?? new Set()).add(w.company_id));
  let created = 0, emailed = 0, digested = 0, suppressed = 0;
  const day = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  for (const rule of rules) {
    if (!rule.verified) continue; // ACC-02: alerts require a verified email
    const covered = rule.company_id ? new Set([rule.company_id]) : members.get(rule.watchlist_id ?? '') ?? new Set<string>();
    for (const e of events) {
      if (!covered.has(e.companyId)) continue;
      if (rule.config.kinds?.length && !rule.config.kinds.includes(e.kind)) continue;
      if (e.kind === 'announcement' && rule.config.categories?.length && !rule.config.categories.includes(e.category ?? '')) continue;
      const dedupe = `${e.kind}:${e.ref}`;
      const status = rule.status === 'paused' ? 'paused' : 'pending';
      const ins = await db.query<{ event_id: string }>(
        `INSERT INTO app.alert_events (user_id, rule_id, company_id, kind, dedupe_key, title, payload, source_ingested_at, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING event_id`,
        [rule.user_id, rule.rule_id, e.companyId, e.kind, dedupe, e.title, JSON.stringify({ evidence: e.evidenceHref, category: e.category ?? null }), e.ingestedAt, status],
      );
      if (!ins[0]) continue;
      created++;
      if (status === 'paused') continue;
      const sentToday = await db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.alert_events WHERE user_id=$1 AND status='sent' AND (sent_at + interval '330 minutes')::date = $2::date`,
        [rule.user_id, day],
      );
      if (rule.digest) {
        await db.query(`UPDATE app.alert_events SET status='digested' WHERE event_id=$1`, [ins[0].event_id]);
        digested++;
      } else if (sentToday.n >= ALERT_CAP_PER_DAY) {
        await db.query(`UPDATE app.alert_events SET status='suppressed_cap' WHERE event_id=$1`, [ins[0].event_id]);
        suppressed++;
      } else {
        await queueEmail(db, { to: rule.email, userId: rule.user_id, template: 'alert', category: 'alert', subject: `ATLAS alert: ${e.title}`, text: `${e.title}\n\nOpen the evidence: ${e.evidenceHref}\n\nYou receive this because the company is on your watchlist with material-change alerts on. Manage alerts in ATLAS → My research → Alerts.` });
        await db.query(`UPDATE app.alert_events SET status='sent', sent_at=$2, attempts=attempts+1 WHERE event_id=$1`, [ins[0].event_id, now.toISOString()]);
        emailed++;
      }
    }
  }
  return { created, emailed, digested, suppressed };
}

/** Daily digest of digested and cap-suppressed events (one email per user). */
export async function sendDigests(db: Db, now: Date): Promise<number> {
  const pending = await db.query<{ user_id: string; email: string; titles: string[]; ids: string[] }>(
    `SELECT e.user_id, u.email, array_agg(e.title ORDER BY e.created_at) AS titles, array_agg(e.event_id::text) AS ids FROM app.alert_events e JOIN app.users u USING (user_id)
      WHERE e.status IN ('digested','suppressed_cap') AND e.sent_at IS NULL GROUP BY e.user_id, u.email`,
  );
  for (const p of pending) {
    await queueEmail(db, { to: p.email, userId: p.user_id, template: 'alert_digest', category: 'alert', subject: `ATLAS daily digest: ${p.titles.length} change(s) in your watchlist`, text: p.titles.map((t) => `• ${t}`).join('\n') });
    await db.query(`UPDATE app.alert_events SET sent_at=$2 WHERE event_id = ANY($1::uuid[])`, [p.ids, now.toISOString()]);
  }
  return pending.length;
}
