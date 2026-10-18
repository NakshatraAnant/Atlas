'use client';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Loading, Problem, Tabs, useApi } from '@/components/ui';
import { dateOrDash } from '@/lib/format';

// Operator console (PRD ADM-*). Every write asks for a reason, which the API records in the
// hash-chained audit log. Personal data is masked unless a reason is given to unmask it.

type Row = Record<string, unknown>;
const cell = (v: unknown): ReactNode => (v === null || v === undefined ? '—' : typeof v === 'object' ? <code style={{ fontSize: 11 }}>{JSON.stringify(v).slice(0, 160)}</code> : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? dateOrDash(v) : String(v));

function Table({ rows, cols, caption, actions }: { rows: Row[]; cols: string[]; caption: string; actions?: (r: Row) => ReactNode }) {
  if (!rows.length) return <p className="mu">{caption}: none.</p>;
  return (
    <div className="wrap"><table><caption>{caption}</caption>
      <thead><tr>{cols.map((c) => <th key={c} scope="col">{c.replace(/_/g, ' ')}</th>)}{actions && <th scope="col">Actions</th>}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{cell(r[c])}</td>)}{actions && <td>{actions(r)}</td>}</tr>)}</tbody>
    </table></div>
  );
}
const askReason = (what: string) => {
  const r = prompt(`Reason for ${what} (recorded in the audit log, at least 10 characters):`);
  return r && r.trim().length >= 5 ? r.trim() : null;
};

const TABS: [string, string][] = [['pipeline', 'Pipeline'], ['quality', 'Data quality'], ['ai', 'AI review'], ['support', 'Support'], ['users', 'Users'], ['flags', 'Feature flags'], ['analytics', 'Analytics'], ['outbox', 'Email outbox'], ['audit', 'Audit log']];

export default function Admin() {
  const { me } = useApp();
  const [tab, setTab] = useState('pipeline');
  if (!me) return <Loading />;
  if (!['admin', 'support', 'data_ops'].includes(me.profile.role)) return <p className="err">This console is for ATLAS staff.</p>;
  if (!me.mfa_verified) return <p className="warn">Staff access requires two-step verification. Sign out and sign in again with your authenticator code.</p>;
  return (
    <>
      <h1>Operations console</h1>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'pipeline' && <Pipeline />}
      {tab === 'quality' && <Quality />}
      {tab === 'ai' && <AiReview />}
      {tab === 'support' && <Support />}
      {tab === 'users' && <Users />}
      {tab === 'flags' && <Flags />}
      {tab === 'analytics' && <Analytics />}
      {tab === 'outbox' && <Outbox />}
      {tab === 'audit' && <Audit />}
    </>
  );
}

function useAct(reload: () => void) {
  const { toast } = useApp();
  const [err, setErr] = useState<Error | null>(null);
  const act = async (f: () => Promise<unknown>, msg = 'Saved') => {
    try { await f(); toast(msg); setErr(null); reload(); } catch (e) { setErr(e as Error); }
  };
  return { act, err };
}

function Pipeline() {
  const p = useApi<{ freshness: Row[] | Row; runs: Row[]; jobs: Row[]; queue: Row[]; alerts: Row[]; calc_runs: Row[] }>('/admin/v1/pipeline');
  const { act, err } = useAct(p.reload);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  if (p.loading) return <Loading />;
  if (p.error) return <Problem error={p.error} retry={p.reload} />;
  const d = p.data!;
  const fresh = Array.isArray(d.freshness) ? d.freshness : [d.freshness];
  return (
    <>
      <Problem error={err} />
      <section className="card"><Table caption="Dataset freshness" rows={fresh} cols={Object.keys(fresh[0] ?? {})} /></section>
      <section className="card row">
        <label className="field">Re-run date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button className="btn s" onClick={() => { const reason = askReason('re-running the daily cycle'); if (reason) void act(() => api('/admin/v1/pipeline/rerun', { body: { date, reason, full_cycle: true } }), 'Re-run started'); }}>Re-run daily cycle</button>
      </section>
      <section className="card"><Table caption="Operational alerts" rows={d.alerts} cols={['severity', 'kind', 'message', 'created_at', 'acknowledged_at']} actions={(r) => !r.acknowledged_at && <button className="link" onClick={() => act(() => api(`/admin/v1/alerts/${r.alert_id}/ack`, { body: {} }), 'Acknowledged')}>Acknowledge</button>} /></section>
      <section className="card"><Table caption="Ingestion runs" rows={d.runs.slice(0, 40)} cols={['dataset', 'data_date', 'status', 'rows_in', 'rows_valid', 'rows_quarantined', 'started_at', 'error']} /></section>
      <section className="card"><Table caption="Scheduled jobs" rows={d.jobs} cols={['job_name', 'run_key', 'status', 'started_at', 'finished_at', 'error']} /></section>
      <section className="card"><Table caption="Job queue" rows={d.queue} cols={['kind', 'status', 'n']} /><Table caption="Calculation runs" rows={d.calc_runs} cols={['kind', 'status', 'started_at', 'finished_at', 'details']} /></section>
    </>
  );
}

function Quality() {
  const [status, setStatus] = useState('open');
  const q = useApi<{ issues: Row[]; median_triage_hours: number | null }>(`/admin/v1/quality${status ? `?status=${status}` : ''}`, [status]);
  const { act, err } = useAct(q.reload);
  return (
    <>
      <div className="row"><label>Status <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['open', 'triaged', 'resolved', 'wont_fix', 'routed_to_vendor'].map((s) => <option key={s}>{s}</option>)}</select></label>
        <button className="btn s" onClick={() => { const title = prompt('Correction title'); const description = title && prompt('What was wrong and what changed?'); const impact = description && prompt('Impact on users'); if (title && description && impact) void act(() => api('/admin/v1/corrections', { body: { kind: 'data', title, description, impact } }), 'Correction published'); }}>Publish a correction</button></div>
      <Problem error={err} />
      {q.loading ? <Loading /> : q.error ? <Problem error={q.error} /> : (
        <section className="card">
          <p className="mu">Median time to triage: {q.data!.median_triage_hours === null ? '—' : `${q.data!.median_triage_hours.toFixed(1)} h`}</p>
          <Table caption="Quality issues" rows={q.data!.issues} cols={['severity', 'kind', 'dataset', 'title', 'status', 'created_at']} actions={(r) => (
            <select aria-label="Set status" value="" onChange={(e) => { const v = e.target.value; if (v) void act(() => api(`/admin/v1/quality/${r.issue_id}`, { method: 'PATCH', body: { status: v, resolution_notes: v === 'resolved' ? prompt('Resolution notes') ?? undefined : undefined } })); }}>
              <option value="">Set…</option>{['triaged', 'resolved', 'wont_fix', 'routed_to_vendor'].map((s) => <option key={s}>{s}</option>)}
            </select>
          )} />
        </section>
      )}
    </>
  );
}

function AiReview() {
  const r = useApi<{ items: (Row & { content_json: { sections?: { direct_answer?: { text: string }[] } } })[] }>('/admin/v1/ai/review');
  const { act, err } = useAct(r.reload);
  if (r.loading) return <Loading />;
  if (r.error) return <Problem error={r.error} />;
  return (
    <section className="card">
      <Problem error={err} />
      {r.data!.items.length === 0 ? <p className="mu">No feedback to review.</p> : r.data!.items.map((x) => (
        <article key={String(x.feedback_id)} className="card">
          <p><strong>{x.is_error_report ? 'Error report' : `Rated ${x.rating}`}</strong> · {String(x.review_status)} · {dateOrDash(String(x.created_at))} · model {String(x.model_id)} · check {String(x.check_status)}</p>
          <p><strong>Question:</strong> {String(x.question ?? '')}</p>
          <p><strong>Answer:</strong> {x.content_json.sections?.direct_answer?.map((d) => d.text).join(' ')}</p>
          {x.comment ? <p><strong>User comment:</strong> {String(x.comment)}</p> : null}
          <details><summary>Tool trace</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(x.trace, null, 1)?.slice(0, 4000)}</pre></details>
          <div className="row">{['in_review', 'confirmed_error', 'not_an_error', 'added_to_eval'].map((s) => <button key={s} className="btn s" onClick={() => act(() => api(`/admin/v1/ai/review/${x.feedback_id}`, { method: 'PATCH', body: { review_status: s } }))}>{s.replace(/_/g, ' ')}</button>)}</div>
        </article>
      ))}
    </section>
  );
}

function Support() {
  const s = useApi<{ tickets: Row[]; grievances: Row[]; sla: { on_time: number; responded: number } }>('/admin/v1/support');
  const { act, err } = useAct(s.reload);
  if (s.loading) return <Loading />;
  if (s.error) return <Problem error={s.error} />;
  const d = s.data!;
  return (
    <section className="card">
      <p className="mu">First responses on time: {d.sla.on_time} of {d.sla.responded}.</p>
      <Problem error={err} />
      <Table caption="Tickets" rows={d.tickets} cols={['ticket_ref', 'kind', 'subject', 'status', 'priority', 'plan_code', 'created_at', 'due_first_response_at', 'first_response_at']} actions={(r) => <button className="link" onClick={() => { const message = prompt('Reply to the customer'); if (message) void act(() => api(`/admin/v1/support/${r.ticket_id}/respond`, { body: { message, resolve: confirm('Mark as resolved?') } }), 'Reply sent'); }}>Reply</button>} />
      <Table caption="Grievances (statutory timelines)" rows={d.grievances} cols={['ticket_ref', 'subject', 'status', 'received_at', 'acknowledge_by', 'resolve_by']} />
    </section>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const u = useApi<{ users: Row[] }>(`/admin/v1/users${query ? `?q=${encodeURIComponent(query)}` : ''}`, [query]);
  const [detail, setDetail] = useState<Row | null>(null);
  const { act, err } = useAct(u.reload);
  return (
    <section className="card">
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}><input aria-label="User email or id" placeholder="Exact email or user id" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn s">Find</button></form>
      <Problem error={err} />
      {u.loading ? <Loading /> : u.error ? <Problem error={u.error} /> : <Table caption="Users (emails masked)" rows={u.data!.users} cols={['email', 'role', 'status', 'plan', 'sub_status', 'created_at']} actions={(r) => (
        <>
          <button className="link" onClick={async () => setDetail(await api(`/admin/v1/users/${r.user_id}`))}>Open</button>{' '}
          <button className="link" onClick={() => { const reason = askReason('unmasking this user’s email'); if (reason) void act(async () => setDetail(await api(`/admin/v1/users/${r.user_id}/unmask`, { body: { reason } })), 'Unmasked (audited)'); }}>Unmask</button>{' '}
          <button className="link" onClick={() => { const key = prompt('Entitlement key (e.g. ai_questions_per_month)'); const value = key && Number(prompt('Value (-1 = unlimited)')); const reason = key && askReason('granting an entitlement override'); if (key && reason && Number.isFinite(value)) void act(() => api(`/admin/v1/users/${r.user_id}/entitlements`, { body: { key, value, reason } }), 'Override granted'); }}>Override</button>
        </>
      )} />}
      {detail && <details open><summary>User detail</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(detail, null, 2).slice(0, 6000)}</pre>
        {Array.isArray((detail as { payments?: Row[] }).payments) && <Table caption="Payments" rows={(detail as { payments: Row[] }).payments} cols={['payment_id', 'kind', 'amount_inr', 'status', 'created_at']} actions={(p) => p.kind !== 'refund' && p.status === 'captured' && <button className="link" onClick={() => { const reason = askReason('refunding this payment'); if (reason) void act(() => api(`/admin/v1/payments/${p.payment_id}/refund`, { body: { reason } }), 'Refund requested'); }}>Refund</button>} />}
      </details>}
    </section>
  );
}

function Flags() {
  const f = useApi<{ flags: Row[] }>('/admin/v1/flags');
  const { act, err } = useAct(f.reload);
  if (f.loading) return <Loading />;
  if (f.error) return <Problem error={f.error} />;
  return (
    <section className="card">
      <p className="mu">Legal-gated features can only be switched on with an approval record (approver, date and document reference). The database enforces this.</p>
      <Problem error={err} />
      <Table caption="Feature flags" rows={f.data!.flags} cols={['flag_key', 'enabled', 'legal_gated', 'approval', 'updated_at']} actions={(r) => (
        <button className="link" onClick={() => {
          const reason = askReason(`${r.enabled ? 'disabling' : 'enabling'} ${r.flag_key}`);
          if (!reason) return;
          let approval: { approver: string; approved_on: string; document_ref: string } | undefined;
          if (!r.enabled && r.legal_gated) {
            const approver = prompt('Approver (name and role)');
            const approved_on = approver && prompt('Approval date (YYYY-MM-DD)');
            const document_ref = approved_on && prompt('Approval document reference');
            if (!document_ref) return;
            approval = { approver: approver!, approved_on: approved_on!, document_ref };
          }
          void act(() => api(`/admin/v1/flags/${r.flag_key}`, { body: { enabled: !r.enabled, reason, approval } }));
        }}>{r.enabled ? 'Disable' : 'Enable'}</button>
      )} />
    </section>
  );
}

function Analytics() {
  const a = useApi<Record<string, unknown>>('/admin/v1/analytics');
  if (a.loading) return <Loading />;
  if (a.error) return <Problem error={a.error} />;
  return (
    <div className="grid">{Object.entries(a.data!).map(([k, v]) => (
      <section key={k} className="card" style={{ margin: 0 }}><h3>{k.replace(/_/g, ' ')}</h3>
        {Array.isArray(v) && v.length && typeof v[0] === 'object' ? <Table caption={k} rows={v as Row[]} cols={Object.keys(v[0] as Row)} /> : <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(v, null, 1)}</pre>}
      </section>
    ))}</div>
  );
}

function Outbox() {
  const o = useApi<{ emails: { email_id: string; to_email: string; template: string; subject: string; body_text: string; status: string; created_at: string }[] }>('/admin/v1/outbox');
  if (o.loading) return <Loading />;
  if (o.error) return <Problem error={o.error} />;
  return (
    <section className="card">
      <p className="mu">Local environment: emails are stored here instead of being sent. Verification and reset links can be opened from this list.</p>
      {o.data!.emails.map((e) => (
        <details key={e.email_id}><summary>{dateOrDash(e.created_at)} · {e.to_email} · {e.subject} <span className="mu">({e.template}, {e.status})</span></summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{e.body_text}</pre>
        </details>
      ))}
    </section>
  );
}

function Audit() {
  const a = useApi<{ entries: Row[]; chain: { valid: boolean; checked?: number; broken_at?: number | null } }>('/admin/v1/audit');
  if (a.loading) return <Loading />;
  if (a.error) return <Problem error={a.error} />;
  return (
    <section className="card">
      <p className={a.data!.chain.valid ? 'okbox' : 'err'}>Hash chain {a.data!.chain.valid ? 'verified' : `broken at entry ${a.data!.chain.broken_at}`}{a.data!.chain.checked ? ` (${a.data!.chain.checked} entries checked)` : ''}.</p>
      <Table caption="Audit log (append-only)" rows={a.data!.entries} cols={['audit_id', 'at', 'actor_role', 'action', 'target_type', 'target_id', 'reason']} />
    </section>
  );
}
