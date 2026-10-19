'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Empty, Loading, Problem, Tabs, useApi } from '@/components/ui';
import { cls, dateOrDash, fmt, formatDate, pct } from '@/lib/format';

const TABS: [string, string][] = [['watchlists', 'Watchlists'], ['alerts', 'Alerts'], ['notes', 'Notes'], ['workspaces', 'Workspaces'], ['hypotheses', 'Hypotheses'], ['history', 'History']];

export default function Research() {
  const [tab, setTab] = useState('watchlists');
  const [newNote, setNewNote] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const t = p.get('tab');
    if (t && TABS.some((x) => x[0] === t)) setTab(t);
    setNewNote(p.get('new'));
  }, []);
  return (
    <>
      <h1>My research</h1>
      <p><a href="/app/research/datasets">Your own data: upload and analyse prices you are entitled to use</a></p>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'watchlists' && <Watchlists />}
      {tab === 'alerts' && <Alerts />}
      {tab === 'notes' && <Notes attach={newNote} />}
      {tab === 'workspaces' && <Workspaces />}
      {tab === 'hypotheses' && <Hypotheses />}
      {tab === 'history' && <History />}
    </>
  );
}

interface WL { watchlist_id: string; name: string; read_only: boolean; items: { company_id: string; short_name: string; sector: string; added_at: string; close: number | null; ret_1d: number | null }[] }

function Watchlists() {
  const { toast } = useApp();
  const w = useApi<{ limits: { watchlists: number; size: number }; watchlists: WL[] }>('/v1/watchlists');
  const [name, setName] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  if (w.loading) return <Loading />;
  if (w.error) return <Problem error={w.error} retry={w.reload} />;
  const d = w.data!;
  const act = async (f: () => Promise<unknown>, msg?: string) => {
    try { await f(); if (msg) toast(msg); setErr(null); w.reload(); } catch (e) { setErr(e as Error); }
  };
  return (
    <>
      <p className="mu">Up to {d.limits.watchlists < 0 ? 'unlimited' : d.limits.watchlists} watchlists of {d.limits.size < 0 ? 'unlimited' : d.limits.size} companies on your plan. Lists over a lower plan’s limit become read-only; nothing is deleted.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void act(() => api('/v1/watchlists', { body: { name } }), 'Watchlist created').then(() => setName('')); }}>
        <input aria-label="New watchlist name" placeholder="New watchlist name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /><button className="btn s" type="submit">Create</button>
      </form>
      <Problem error={err} />
      {d.watchlists.length === 0 && <Empty>No watchlists yet.</Empty>}
      {d.watchlists.map((l) => (
        <section key={l.watchlist_id} id={l.watchlist_id} className="card">
          <h2>{l.name} {l.read_only && <span className="t m">read-only on your plan</span>}</h2>
          {l.items.length === 0 ? <Empty>Empty. Add companies from a company page, the screener or search.</Empty> : (
            <div className="wrap"><table><caption className="sr-only">{l.name}</caption>
              <thead><tr><th scope="col">Company</th><th scope="col">Sector</th><th scope="col">Close</th><th scope="col">1-day</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{l.items.map((i) => <tr key={i.company_id}><th scope="row"><a href={`/app/companies/${i.company_id}`}>{i.short_name}</a></th><td>{i.sector}</td><td>{fmt(i.close, 'INR')}</td><td className={cls(i.ret_1d)}>{i.ret_1d === null ? '—' : pct(i.ret_1d * 100)}</td><td>{dateOrDash(i.added_at)}</td>
                <td>{!l.read_only && <button className="link" onClick={() => act(() => api(`/v1/watchlists/${l.watchlist_id}/items/${i.company_id}`, { method: 'DELETE' }), 'Removed')}>Remove</button>}</td></tr>)}</tbody>
            </table></div>
          )}
          <div className="row">
            {!l.read_only && <button className="link" onClick={() => { const n = prompt('New name', l.name); if (n) void act(() => api(`/v1/watchlists/${l.watchlist_id}`, { method: 'PATCH', body: { name: n } }), 'Renamed'); }}>Rename</button>}
            <button className="link" onClick={() => { if (confirm(`Delete watchlist “${l.name}”? Its companies stay in ATLAS; only the list is removed.`)) void act(() => api(`/v1/watchlists/${l.watchlist_id}`, { method: 'DELETE' }), 'Watchlist deleted'); }}>Delete list</button>
          </div>
        </section>
      ))}
    </>
  );
}

const ALERT_KINDS: [string, string][] = [['results_filed', 'Results filed'], ['announcement', 'Announcements'], ['promoter_change', 'Promoter holding change'], ['pledge_change', 'Pledge change'], ['auditor_change', 'Auditor change'], ['correction', 'ATLAS data correction']];

function Alerts() {
  const { toast } = useApp();
  const a = useApi<{ limit: number; rules: { rule_id: string; kind: string; watchlist_name: string | null; company_id: string | null; config: { kinds?: string[] }; digest: boolean; status: string; created_at: string }[]; history: { event_id: string; kind: string; title: string; status: string; created_at: string; sent_at: string | null }[]; price_alerts_available: boolean }>('/v1/alerts');
  const w = useApi<{ watchlists: WL[] }>('/v1/watchlists');
  const [wl, setWl] = useState('');
  const [kinds, setKinds] = useState<string[]>(ALERT_KINDS.map((k) => k[0]));
  const [digest, setDigest] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  if (a.loading) return <Loading />;
  if (a.error) return <Problem error={a.error} retry={a.reload} />;
  const d = a.data!;
  const create = async () => {
    try {
      await api('/v1/alerts', { body: { kind: 'material_change', watchlist_id: wl || w.data?.watchlists[0]?.watchlist_id, kinds, digest } });
      toast('Alert created');
      setErr(null);
      a.reload();
    } catch (e) { setErr(e as Error); }
  };
  return (
    <>
      <section className="card stack"><h2>New material-change alert</h2>
        <p className="mu">Alerts report filings and data changes for companies in a watchlist — not price targets or trading signals. {d.price_alerts_available ? '' : 'Price and volume alerts are switched off pending legal sign-off.'}</p>
        <label className="field">Watchlist<select value={wl} onChange={(e) => setWl(e.target.value)}>{w.data?.watchlists.map((l) => <option key={l.watchlist_id} value={l.watchlist_id}>{l.name}</option>)}</select></label>
        <fieldset style={{ border: 0, padding: 0 }}><legend>Notify me about</legend><div className="row">{ALERT_KINDS.map(([k, l]) => <label key={k}><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} /> {l}</label>)}</div></fieldset>
        <label><input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} /> Send as one daily digest instead of separate emails</label>
        <Problem error={err} />
        <button className="btn" onClick={create} disabled={!w.data?.watchlists.length}>Create alert</button>
        {!w.data?.watchlists.length && <p className="mu">Create a watchlist first.</p>}
      </section>
      <section className="card"><h2>Your alerts <span className="mu">({d.rules.filter((r) => r.status === 'active').length} active of {d.limit < 0 ? 'unlimited' : d.limit})</span></h2>
        {d.rules.length === 0 ? <Empty>No alerts.</Empty> : <ul>{d.rules.map((r) => <li key={r.rule_id}>{r.watchlist_name ?? 'Company'} · {(r.config.kinds ?? []).length} event types · {r.digest ? 'daily digest' : 'immediate'} · <strong>{r.status}</strong>{' '}
          <button className="link" onClick={async () => { await api(`/v1/alerts/${r.rule_id}`, { method: 'PATCH', body: { status: r.status === 'active' ? 'paused' : 'active' } }).catch((e) => setErr(e)); a.reload(); }}>{r.status === 'active' ? 'Pause' : 'Resume'}</button>{' '}
          <button className="link" onClick={async () => { await api(`/v1/alerts/${r.rule_id}`, { method: 'DELETE' }); a.reload(); }}>Delete</button></li>)}</ul>}
        <h3>Recent alerts</h3>
        {d.history.length === 0 ? <Empty>None sent yet.</Empty> : <ul>{d.history.map((h) => <li key={h.event_id}>{h.title} <span className="mu">{dateOrDash(h.created_at)} · {h.status}</span></li>)}</ul>}
      </section>
    </>
  );
}

interface Note { note_id: string; attached_type: string; attached_id: string | null; title: string; body: string; tags: string[]; updated_at: string; read_only?: boolean }

function Notes({ attach }: { attach: string | null }) {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const n = useApi<{ limit: number; notes: Note[] }>(`/v1/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`, [q]);
  const [edit, setEdit] = useState<Partial<Note> | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  useEffect(() => {
    if (attach) {
      const [type, id] = attach.split(':');
      setEdit({ attached_type: type, attached_id: id, title: '', body: '', tags: [] });
    }
  }, [attach]);
  const save = async () => {
    if (!edit) return;
    try {
      if (edit.note_id) await api(`/v1/notes/${edit.note_id}`, { method: 'PATCH', body: { title: edit.title, body: edit.body, tags: edit.tags } });
      else await api('/v1/notes', { body: { attached_type: edit.attached_type ?? 'none', attached_id: edit.attached_id ?? null, title: edit.title ?? '', body: edit.body ?? '', tags: edit.tags ?? [] } });
      toast('Note saved');
      setEdit(null);
      setErr(null);
      n.reload();
    } catch (e) { setErr(e as Error); }
  };
  return (
    <>
      <div className="row"><input type="search" aria-label="Search notes" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn s" onClick={() => setEdit({ title: '', body: '', tags: [] })}>New note</button></div>
      {edit && (
        <section className="card stack" aria-label="Edit note">
          {edit.attached_type && edit.attached_type !== 'none' && <p className="mu">Attached to a {edit.attached_type}.</p>}
          <label className="field">Title<input value={edit.title ?? ''} maxLength={200} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
          <label className="field">Note<textarea rows={8} value={edit.body ?? ''} maxLength={50000} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
          <label className="field">Tags (comma separated)<input value={(edit.tags ?? []).join(', ')} onChange={(e) => setEdit({ ...edit, tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20) })} /></label>
          <Problem error={err} />
          <div className="row"><button className="btn" onClick={save}>Save</button><button className="btn s" onClick={() => setEdit(null)}>Cancel</button></div>
        </section>
      )}
      {n.loading ? <Loading /> : n.error ? <Problem error={n.error} /> : n.data!.notes.length === 0 ? <Empty>No notes{q ? ' match' : ' yet'}.</Empty> : n.data!.notes.map((x) => (
        <article key={x.note_id} className="card">
          <h3>{x.title || 'Untitled'} {x.read_only && <span className="t m">read-only on your plan</span>}</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{x.body.slice(0, 600)}{x.body.length > 600 && '…'}</p>
          <p className="mu">{x.attached_type === 'company' && x.attached_id ? <><a href={`/app/companies/${x.attached_id}`}>Company</a> · </> : null}{x.tags.map((t) => `#${t}`).join(' ')} · updated {dateOrDash(x.updated_at)}</p>
          <div className="row"><button className="link" onClick={() => setEdit(x)}>Edit</button><button className="link" onClick={async () => { if (confirm('Delete this note?')) { await api(`/v1/notes/${x.note_id}`, { method: 'DELETE' }); n.reload(); } }}>Delete</button></div>
        </article>
      ))}
    </>
  );
}

function Workspaces() {
  const w = useApi<{ workspaces: { workspace_id: string; name: string; company_id: string | null; saved_as_of: string | null; updated_at: string }[] }>('/v1/workspaces');
  const [open, setOpen] = useState<{ id: string; refresh: { available: boolean; changed_figures: { metric_code: string; period_key: string; value: number | null; current: number | null }[] }; state: { tab?: string }; company_id: string | null } | null>(null);
  if (w.loading) return <Loading />;
  if (w.error) return <Problem error={w.error} />;
  return (
    <>
      <p className="mu">A workspace saves a view as of its data date. Reopening shows which saved figures have since changed.</p>
      {w.data!.workspaces.length === 0 ? <Empty>No saved workspaces. Use “Save workspace” on a company page.</Empty> : <ul className="card">{w.data!.workspaces.map((x) => (
        <li key={x.workspace_id}><button className="link" onClick={async () => { const r = await api<{ workspace: { state: { tab?: string }; company_id: string | null }; refresh: any }>(`/v1/workspaces/${x.workspace_id}`); setOpen({ id: x.workspace_id, refresh: r.refresh, state: r.workspace.state, company_id: r.workspace.company_id }); }}>{x.name}</button> <span className="mu">data as of {x.saved_as_of ? formatDate(x.saved_as_of) : '—'}</span>{' '}
          <button className="link mu" onClick={async () => { await api(`/v1/workspaces/${x.workspace_id}`, { method: 'DELETE' }); w.reload(); }}>Delete</button></li>
      ))}</ul>}
      {open && (
        <section className="card">
          {open.refresh.available ? <><p className="warn">Some saved figures have changed since this workspace was saved.</p><ul>{open.refresh.changed_figures.map((f) => <li key={f.metric_code + f.period_key}>{f.metric_code} ({f.period_key}): {fmt(f.value)} → {fmt(f.current)}</li>)}</ul></> : <p className="okbox">No saved figures have changed.</p>}
          {open.company_id && <a className="btn" href={`/app/companies/${open.company_id}?tab=${open.state.tab ?? 'overview'}`}>Open with latest data</a>}
        </section>
      )}
    </>
  );
}

function Hypotheses() {
  const { toast } = useApp();
  const h = useApi<{ hypotheses: { hypothesis_id: string; company_id: string | null; statement: string; review_date: string; due: boolean; metric_changes: { metric: string; at_creation: number | null; now: number | null }[]; note: string | null }[] }>('/v1/hypotheses');
  const cov = useApi<{ companies: { company_id: string; short_name: string }[] }>('/v1/coverage');
  const [f, setF] = useState({ statement: '', company_id: '', review_date: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10), metrics: 'operating_margin,roce' });
  const [err, setErr] = useState<Error | null>(null);
  const names = new Map((cov.data?.companies ?? []).map((c) => [c.company_id, c.short_name]));
  return (
    <>
      <section className="card stack"><h2>Write down a hypothesis</h2>
        <p className="mu">Record what you expect and when to review it. ATLAS shows how the chosen measures changed — it does not score you.</p>
        <label className="field">Hypothesis<textarea rows={3} minLength={5} maxLength={1000} value={f.statement} onChange={(e) => setF({ ...f, statement: e.target.value })} /></label>
        <div className="row">
          <label className="field">Company<select value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}><option value="">None</option>{cov.data?.companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.short_name}</option>)}</select></label>
          <label className="field">Review on<input type="date" value={f.review_date} onChange={(e) => setF({ ...f, review_date: e.target.value })} /></label>
          <label className="field">Measures to track (codes)<input value={f.metrics} onChange={(e) => setF({ ...f, metrics: e.target.value })} /></label>
        </div>
        <Problem error={err} />
        <button className="btn" onClick={async () => { try { await api('/v1/hypotheses', { body: { statement: f.statement, company_id: f.company_id || null, review_date: f.review_date, metrics: f.metrics.split(',').map((x) => x.trim()).filter(Boolean) } }); toast('Saved'); setF({ ...f, statement: '' }); setErr(null); h.reload(); } catch (e) { setErr(e as Error); } }}>Save hypothesis</button>
      </section>
      {h.loading ? <Loading /> : h.error ? <Problem error={h.error} /> : h.data!.hypotheses.length === 0 ? <Empty>None yet.</Empty> : h.data!.hypotheses.map((x) => (
        <article key={x.hypothesis_id} className="card">
          <p>{x.statement}</p>
          <p className="mu">{x.company_id ? names.get(x.company_id) ?? 'Company' : 'General'} · review {formatDate(x.review_date)} {x.due && <span className="t c">due</span>}</p>
          {x.due && x.metric_changes.length > 0 && <ul>{x.metric_changes.map((m) => <li key={m.metric}>{m.metric}: {fmt(m.at_creation)} then → {fmt(m.now)} now</li>)}</ul>}
          {x.note && <p className="mu">{x.note}</p>}
          <button className="link" onClick={async () => { await api(`/v1/hypotheses/${x.hypothesis_id}`, { method: 'DELETE' }); h.reload(); }}>Delete</button>
        </article>
      ))}
    </>
  );
}

function History() {
  const h = useApi<{ history: { kind: string; ref_id: string; label: string; at: string }[] }>('/v1/history');
  if (h.loading) return <Loading />;
  if (h.error) return <Problem error={h.error} />;
  const href = (x: { kind: string; ref_id: string }) => (x.kind === 'company_view' ? `/app/companies/${x.ref_id}` : x.kind === 'backtest' ? `/app/lab/runs/${x.ref_id}` : '#');
  return (
    <section className="card">
      <p className="mu">The last 90 days of research activity, visible only to you.</p>
      {h.data!.history.length === 0 ? <Empty>No history.</Empty> : <ul>{h.data!.history.map((x, i) => <li key={i}><a href={href(x)}>{x.label}</a> <span className="mu">{x.kind.replace('_', ' ')} · {dateOrDash(x.at)}</span></li>)}</ul>}
      <button className="btn s" onClick={async () => { if (confirm('Clear your research history? This cannot be undone.')) { await api('/v1/history', { method: 'DELETE' }); h.reload(); } }}>Clear history</button>
    </section>
  );
}
