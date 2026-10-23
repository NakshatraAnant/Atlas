'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Classification } from '@/components/research';
import { Loading, Problem, Tabs, useApi } from '@/components/ui';

// Indian equities, real data only: market overview and explorer over the tracked universe, and the data
// operations behind them (daily quota, refresh schedule, tracked universe, calendar, requests, imports).
// Synthetic development companies are listed elsewhere (Companies (demo)) and are never mixed in here.

interface Budget { category: string; budget: number; spent: number; remaining: number }
interface Quota { usage_date: string; reset_note: string; next_reset_at: string; daily_limit: number; spent_local: number; provider_reported: number | null; provider_reported_at: string | null; remaining: number; exhausted: boolean; exhausted_reason: string | null; budgets: Budget[]; discrepancy_note: string | null }
interface UItem { exchange: string; symbol: string; name: string | null; kind: string; provider_id: string; provider_symbol: string; verification: string | null; priority: number; enabled: boolean; note: string | null; last_date: string | null; observations: number; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; last_error_category: string | null; retry_after: string | null; state: string }
interface Status {
  diagnostics_visible?: boolean;
  providers: { provider_id: string; name: string; docs_url: string; terms_url: string; docs_checked_on: string; coverage_note: string; limits_note: string; licence_note: string; health: string; configured: boolean; env: string; last_success_at: string | null; last_error_at: string | null; last_error: string | null; last_error_category: string | null }[];
  quota?: { eodhd: Quota; alphavantage: Quota };
  schedule: { enabled: boolean; next_run_at: string; slots_ist: string[]; running?: boolean; note?: string };
  expected_session: string;
  expected_session_note: string;
  universe: UItem[];
  instruments: { exchange: string; symbol: string; name: string | null; kind: string; provider_id: string; classification: string; basis: string; first_date: string | null; last_date: string | null; observations: number; last_import_at: string | null }[];
  jobs?: { job_id: string; provider_id: string; dry_run: boolean; status: string; started_at: string; received: number; stored: number; unchanged: number; corrected: number; rejected: number; error: string | null; error_category: string | null; detail: { symbol?: string; exchange?: string } }[];
  runs?: { run_id: string; trigger: string; started_at: string; expected_session: string; status: string; attempted: number; succeeded: number; failed: number; up_to_date: number; deferred_budget: number; calls_spent: number; stop_reason: string | null }[];
  requests?: { requested_at: string; provider_id: string; category: string; endpoint: string; target: string | null; cost: number; outcome: string; http_status: number | null; error_category: string | null }[];
  calendar: { day: string; kind: string; description: string | null; source: string }[];
  calendar_note: string;
  counts: { instruments: number; prices: number; quarantined: number; revisions: number; corporate_actions: number };
  synthetic_notice?: string;
  classification: Record<string, string>;
  market_status_note: string;
}

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const cls = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
const inr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const ist = (iso: string | null | undefined) => (iso ? `${new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST` : '—');
const STATE: Record<string, [string, string]> = { up_to_date: ['o', 'up to date'], due: ['i', 'due'], awaiting_first_import: ['m', 'awaiting first import'], waiting_retry: ['r', 'waiting to retry'], disabled: ['m', 'removed'] };

export default function Equities() {
  const s = useApi<Status>('/v1/equity/status');
  const [tab, setTab] = useState('overview');
  if (s.loading && !s.data) return <Loading lines={8} />;
  if (s.error) return <Problem error={s.error} retry={s.reload} />;
  const d = s.data!;
  const anyConfigured = d.providers.some((p) => p.configured);
  return (
    <>
      <h1>Indian equities: real data</h1>
      {d.synthetic_notice && <p className="mu">{d.synthetic_notice}</p>}
      {!anyConfigured && <SetupSteps />}
      {d.quota ? <QuotaStrip q={d.quota.eodhd} configured={!!d.providers.find((p) => p.provider_id === 'eodhd')?.configured} schedule={d.schedule} expected={d.expected_session} /> : <CustomerStrip d={d} />}
      <Tabs tabs={[['overview', 'Market overview'], ['explorer', 'Explorer and screen'], ['ops', d.diagnostics_visible ? 'Data operations' : 'Coverage and sources']]} active={tab} onChange={setTab} />
      {tab === 'overview' && <Overview />}
      {tab === 'explorer' && <Explorer />}
      {tab === 'ops' && <Operations d={d} reload={s.reload} />}
    </>
  );
}

/** Customer summary: when data updates and whether anything limits it, without operator diagnostics. */
function CustomerStrip({ d }: { d: Status }) {
  const eodhd = d.providers.find((p) => p.provider_id === 'eodhd') as (Status['providers'][number] & { status_note?: string | null }) | undefined;
  return (
    <section className="card" aria-label="Data status">
      <div className="cx-kpis">
        <div className="cx-kpi"><span className="k">Data</span><span className="v">End of day</span><span className="s">EODHD; not live prices</span></div>
        <div className="cx-kpi"><span className="k">Next scheduled update</span><span className="v">{d.schedule.enabled ? ist(d.schedule.next_run_at) : 'off'}</span><span className="s">slots {d.schedule.slots_ist.join(' and ')} IST</span></div>
        <div className="cx-kpi"><span className="k">Latest expected session</span><span className="v">{d.expected_session}</span><span className="s">weekdays minus evidenced holidays</span></div>
      </div>
      {eodhd?.status_note && <p className="warn">{eodhd.status_note}</p>}
    </section>
  );
}

function SetupSteps() {
  return (
    <div className="err" role="status">
      <p><strong>No provider is configured, so no real Indian prices can be imported.</strong> ATLAS cannot create provider accounts for you. To enable this:</p>
      <ol>
        <li>Create your own EODHD key (end-of-day prices; free plan: 20 API calls a day, one year of history, personal use, Indian indices but, as tested, not individual NSE/BSE shares) and read their terms. If a key was ever pasted into a chat, email or file, rotate it in the EODHD dashboard first.</li>
        <li>Add <code>EODHD_API_TOKEN=…</code> to <code>.env.local</code> in the ATLAS folder (git-ignored; never commit it or paste it anywhere else). <code>ALPHAVANTAGE_API_KEY</code> adds BSE (latest 100 days).</li>
        <li>Restart ATLAS (<code>node scripts/atlas.mjs restart</code>). An administrator adds instruments under Data operations; the scheduled refresh imports them within the daily budget.</li>
      </ol>
    </div>
  );
}

function QuotaStrip({ q, configured, schedule, expected }: { q: Quota; configured: boolean; schedule: Status['schedule']; expected: string }) {
  return (
    <section className="card" aria-label="EODHD daily quota">
      <div className="cx-kpis">
        <div className="cx-kpi"><span className="k">EODHD calls left today</span><span className="v">{configured ? `${q.remaining} of ${q.daily_limit}` : 'not configured'}</span><span className="s">{q.exhausted ? `Allowance spent: ${q.exhausted_reason}` : `ATLAS used ${q.spent_local}${q.provider_reported !== null ? `; provider reports ${q.provider_reported}` : ''}`}</span></div>
        <div className="cx-kpi"><span className="k">Quota resets</span><span className="v">{ist(q.next_reset_at)}</span><span className="s">{q.reset_note}</span></div>
        <div className="cx-kpi"><span className="k">Next scheduled refresh</span><span className="v">{schedule.enabled ? ist(schedule.next_run_at) : 'off'}</span><span className="s">{schedule.running ? 'running now' : `slots ${schedule.slots_ist.join(' and ')} IST`}</span></div>
        <div className="cx-kpi"><span className="k">Latest expected session</span><span className="v">{expected}</span><span className="s">weekdays minus evidenced holidays</span></div>
      </div>
      {q.discrepancy_note && <p className="warn">{q.discrepancy_note}</p>}
    </section>
  );
}

function Spark({ pts }: { pts: { t: string; v: number }[] }) {
  if (pts.length < 2) return null;
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * 120},${30 - ((p.v - lo) / (hi - lo || 1)) * 28}`).join(' ');
  return <svg width="120" height="32" role="img" aria-label={`Last ${pts.length} sessions, from ${lo.toFixed(0)} to ${hi.toFixed(0)}`}><path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

interface Row { exchange: string; symbol: string; name: string | null; kind: string; last_date: string | null; last_close: number | null; returns: Record<string, number | null>; vol_3m: number | null; rsi14: number | null; range_52w: { from_high: number } | null; behind: number | null; observations: number; basis: string; spark?: { t: string; v: number }[] }

function Behind({ n }: { n: number | null }) {
  if (n === null) return <span className="t m">no data</span>;
  return n === 0 ? <span className="t o">current</span> : <span className="t r" title="Sessions missing since the last stored close">{n} session{n > 1 ? 's' : ''} behind</span>;
}

function Overview() {
  const m = useApi<{ as_of_session: string | null; expected_session: string; indices: Row[]; breadth: { session: string; advancers: number; decliners: number; unchanged: number; counted: number; not_on_latest_session: number } | null; gainers: Row[]; losers: Row[]; coverage: { note: string }; basis_note: string; empty_reason: string | null }>('/v1/equity/market');
  if (m.loading && !m.data) return <Loading lines={5} />;
  if (m.error) return <Problem error={m.error} retry={m.reload} />;
  const d = m.data!;
  if (d.empty_reason) return <section className="card"><h2>Market overview</h2><p>Nothing imported yet.</p><p className="mu">{d.empty_reason}</p></section>;
  const link = (r: Row) => <a href={`/app/equities/${r.exchange}/${encodeURIComponent(r.symbol)}`}>{r.exchange === 'INDEX' ? r.name ?? r.symbol : r.symbol}</a>;
  return (
    <>
      <section className="card">
        <h2>Indices</h2>
        {d.indices.length ? <div className="cx-kpis">{d.indices.map((r) => (
          <div className="cx-kpi" key={r.symbol}><span className="k">{link(r)}</span><span className="v">{r.last_close?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span><span className={`s ${cls(r.returns.d1)}`}>{pct(r.returns.d1, 2)} on {r.last_date} · 1M {pct(r.returns.m1)}</span><Spark pts={r.spark ?? []} /><Behind n={r.behind} /></div>
        ))}</div> : <p className="mu">No index is tracked yet (add INDEX:NIFTY50 under Data operations).</p>}
      </section>
      {d.breadth && (
        <section className="card">
          <h2>Breadth on {d.breadth.session}</h2>
          <p><strong>{d.breadth.advancers}</strong> up · <strong>{d.breadth.decliners}</strong> down · {d.breadth.unchanged} unchanged, of {d.breadth.counted} tracked shares with a close that session{d.breadth.not_on_latest_session ? ` (${d.breadth.not_on_latest_session} more have no row for it yet)` : ''}.</p>
          <p className="mu">{d.coverage.note}</p>
          <div className="grid2">
            {[['Largest rises', d.gainers], ['Largest falls', d.losers]].map(([title, rows]) => (
              <div key={title as string}><h3>{title as string}</h3><table className="term-table"><tbody>{(rows as Row[]).map((r) => <tr key={r.symbol}><td style={{ textAlign: 'left' }}>{link(r)}</td><td className="num">{inr(r.last_close)}</td><td className={`num ${cls(r.returns.d1)}`}>{pct(r.returns.d1, 2)}</td></tr>)}</tbody></table></div>
            ))}
          </div>
        </section>
      )}
      <p className="mu">As of the provider’s session {d.as_of_session ?? '—'}; expected latest session {d.expected_session}. {d.basis_note}</p>
    </>
  );
}

function Explorer() {
  const [f, setF] = useState({ q: '', kind: 'all', sort: 'symbol', dir: 'asc', min_m1: '', max_vol: '', rsi_below: '', rsi_above: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString();
  const e = useApi<{ expected_session: string; rows: (Row & { classification: string; key: string })[]; excluded_for_missing_metric: Record<string, number>; definitions: Record<string, string> }>(`/v1/equity/explorer?${qs}`, [qs]);
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: ev.target.value });
  const head = (k: string, label: string) => <th scope="col"><button className="link" onClick={() => setF({ ...f, sort: k, dir: f.sort === k && f.dir === 'desc' ? 'asc' : 'desc' })} aria-label={`Sort by ${label}`}>{label}{f.sort === k ? (f.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>;
  return (
    <section className="card">
      <h2>Explorer and screen</h2>
      <p className="mu">Tracked instruments with stored provider prices. Filters drop rows where the metric cannot be computed (counted below), never treat them as zero.</p>
      <div className="cx-filters">
        <label className="field">Search<input value={f.q} onChange={set('q')} placeholder="symbol or name" /></label>
        <label className="field">Type<select value={f.kind} onChange={set('kind')}><option value="all">All</option><option value="equity">Shares</option><option value="index">Indices</option></select></label>
        <label className="field">1M return at least (decimal)<input inputMode="decimal" value={f.min_m1} onChange={set('min_m1')} placeholder="e.g. 0.05" /></label>
        <label className="field">3M volatility at most<input inputMode="decimal" value={f.max_vol} onChange={set('max_vol')} placeholder="e.g. 0.30" /></label>
        <label className="field">RSI below<input inputMode="decimal" value={f.rsi_below} onChange={set('rsi_below')} placeholder="e.g. 30" /></label>
        <label className="field">RSI above<input inputMode="decimal" value={f.rsi_above} onChange={set('rsi_above')} placeholder="e.g. 70" /></label>
      </div>
      {e.loading && !e.data ? <Loading lines={4} /> : e.error ? <Problem error={e.error} retry={e.reload} /> : (
        <>
          {e.data!.rows.length ? (
            <div className="wrap"><table className="term-table"><thead><tr>{head('symbol', 'Instrument')}<th scope="col">Last close</th>{head('d1', '1D')}{head('m1', '1M')}{head('m3', '3M')}{head('y1', '1Y')}{head('vol_3m', 'Vol 3M')}{head('rsi14', 'RSI 14')}{head('from_high', 'From 52W high')}<th scope="col">Freshness</th></tr></thead>
              <tbody>{e.data!.rows.map((r) => <tr key={r.key}><td style={{ textAlign: 'left' }}><a href={`/app/equities/${r.exchange}/${encodeURIComponent(r.symbol)}`}>{r.exchange}:{r.symbol}</a> <span className="mu">{r.name}</span> <Classification c={r.classification} /></td><td className="num">{inr(r.last_close)}</td><td className={`num ${cls(r.returns.d1)}`}>{pct(r.returns.d1, 2)}</td><td className={`num ${cls(r.returns.m1)}`}>{pct(r.returns.m1)}</td><td className={`num ${cls(r.returns.m3)}`}>{pct(r.returns.m3)}</td><td className={`num ${cls(r.returns.y1)}`}>{pct(r.returns.y1)}</td><td className="num">{r.vol_3m === null ? '—' : `${(r.vol_3m * 100).toFixed(1)}%`}</td><td className="num">{r.rsi14?.toFixed(1) ?? '—'}</td><td className="num">{pct(r.range_52w?.from_high)}</td><td><Behind n={r.behind} /></td></tr>)}</tbody></table></div>
          ) : <p>No instrument matches. {Object.keys(e.data!.excluded_for_missing_metric).length ? '' : 'Nothing imported yet.'}</p>}
          {Object.entries(e.data!.excluded_for_missing_metric).map(([k, n]) => <p className="mu" key={k}>{n} instrument(s) left out by “{k}” because that metric needs more stored history.</p>)}
          <details><summary>Definitions</summary><ul>{Object.entries(e.data!.definitions).map(([k, v]) => <li key={k}><strong>{k.replace(/_/g, ' ')}</strong>: {v}</li>)}</ul></details>
        </>
      )}
    </section>
  );
}

function Operations({ d, reload }: { d: Status; reload: () => void }) {
  const { me, toast } = useApp();
  const admin = !!me && ['admin', 'data_ops'].includes(me.profile.role);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [u, setU] = useState({ exchange: 'NSE', symbol: '', name: '', provider_symbol: '', priority: '3' });
  const act = async (label: string, fn: () => Promise<unknown>, msg?: (r: any) => string) => {
    setBusy(label);
    setErr(null);
    try {
      const r = await fn();
      toast(msg ? msg(r) : 'Done');
      reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  };
  const q = d.quota?.eodhd;
  return (
    <>
      {q && <section className="card">
        <h2>Daily budget (EODHD, quota day {q.usage_date} UTC)</h2>
        <p className="mu">Every call is charged before it is sent. When a budget is spent, the work waits for the reset instead of calling. The reserve is used only when an administrator asks for it on a manual import.</p>
        <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Purpose</th><th scope="col">Budget</th><th scope="col">Spent</th><th scope="col">Left</th></tr></thead>
          <tbody>{q.budgets.map((b) => <tr key={b.category}><td style={{ textAlign: 'left' }}>{b.category}</td><td className="num">{b.budget}</td><td className="num">{b.spent}</td><td className="num">{b.remaining}</td></tr>)}</tbody></table></div>
        <p className="mu">Last provider usage check: {q.provider_reported_at ? `${ist(q.provider_reported_at)} (${q.provider_reported} calls)` : 'none today'}. Free plan: refresh 12 (tracked instruments), backfill 2 (new instruments, a year of history each), validation 2 (calendar, splits and dividends), manual 2, reserve 2.</p>
        {admin && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!!busy} onClick={() => act('refresh', () => api('/admin/v1/equity/refresh', { body: {} }), (r) => `Refresh ${r.status}: ${r.succeeded} updated, ${r.deferred_budget} deferred`)}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh now (within budget)'}</button>
            <button className="btn ghost" disabled={!!busy} onClick={() => act('usage', () => api('/admin/v1/equity/usage-check', { body: {} }), () => 'Usage checked (no calls spent)')}>Check provider usage</button>
          </div>
        )}
      </section>}

      <section className="card">
        <h2>Tracked universe</h2>
        <p className="mu">Refreshed in priority order (1 first). New instruments wait for the backfill budget. Removing an instrument keeps its stored prices.</p>
        {d.universe.length ? (
          <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Instrument</th><th scope="col">Priority</th><th scope="col">Provider symbol</th><th scope="col">State</th><th scope="col">Latest session</th><th scope="col">Last attempt</th><th scope="col" style={{ textAlign: 'left' }}>Last problem</th>{admin && <th scope="col">Change</th>}</tr></thead>
            <tbody>{d.universe.map((x) => (
              <tr key={`${x.exchange}:${x.symbol}`}>
                <td style={{ textAlign: 'left' }}><a href={`/app/equities/${x.exchange}/${encodeURIComponent(x.symbol)}`}>{x.exchange}:{x.symbol}</a> <span className="mu">{x.name}</span></td>
                <td className="num">{x.priority}</td>
                <td>{x.provider_symbol} <span className={`t ${x.verification === 'verified' ? 'o' : x.verification === 'failed' ? 'r' : 'm'}`}>{x.verification ?? 'unverified'}</span></td>
                <td><span className={`t ${STATE[x.state]?.[0] ?? 'm'}`}>{STATE[x.state]?.[1] ?? x.state}</span>{x.retry_after && x.state === 'waiting_retry' ? <span className="mu"> until {ist(x.retry_after)}</span> : null}</td>
                <td>{x.last_date ?? '—'}</td>
                <td>{ist(x.last_attempt_at)}</td>
                <td style={{ textAlign: 'left' }}>{x.last_error ? `${x.last_error_category}: ${x.last_error}` : ''}</td>
                {admin && <td><select aria-label={`Priority for ${x.symbol}`} value={x.priority} onChange={(e) => act('prio', () => api(`/admin/v1/equity/universe/${x.exchange}/${encodeURIComponent(x.symbol)}`, { method: 'PATCH', body: { priority: Number(e.target.value) } }))}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select> <button className="link" onClick={() => act('toggle', () => api(`/admin/v1/equity/universe/${x.exchange}/${encodeURIComponent(x.symbol)}`, { method: 'PATCH', body: { enabled: !x.enabled } }))}>{x.enabled ? 'Remove' : 'Restore'}</button></td>}
              </tr>
            ))}</tbody></table></div>
        ) : <p>Nothing imported yet. {admin ? 'Add instruments below.' : 'An administrator adds instruments.'}</p>}
        {admin && (
          <>
            <h3>Add an instrument</h3>
            <div className="cx-filters">
              <label className="field">Exchange<select value={u.exchange} onChange={(e) => setU({ ...u, exchange: e.target.value })}><option>NSE</option><option>INDEX</option><option>BSE</option></select></label>
              <label className="field">Symbol<input value={u.symbol} onChange={(e) => setU({ ...u, symbol: e.target.value.toUpperCase() })} placeholder="e.g. RELIANCE" /></label>
              <label className="field">Name (optional)<input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></label>
              <label className="field">Provider code{u.exchange === 'INDEX' ? '' : ' (optional)'}<input value={u.provider_symbol} onChange={(e) => setU({ ...u, provider_symbol: e.target.value })} placeholder={u.exchange === 'INDEX' ? 'e.g. NSEI.INDX' : `${u.symbol || 'SYMBOL'}.${u.exchange}`} /></label>
              <label className="field">Priority<select value={u.priority} onChange={(e) => setU({ ...u, priority: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
              <button className="btn" disabled={!u.symbol || !!busy} onClick={() => act('add', () => api('/admin/v1/equity/universe', { body: { exchange: u.exchange, symbol: u.symbol, name: u.name || undefined, provider_symbol: u.provider_symbol || undefined, priority: Number(u.priority) } }), () => `${u.symbol} added; it is imported when the backfill budget allows`)}>Add</button>
              <button className="btn ghost" disabled={!!busy} onClick={() => act('starter', () => api('/admin/v1/equity/universe/starter', { body: {} }), (r) => `${r.added.length} added (no calls spent)`)}>Add starter list (NIFTY 50, SENSEX, NIFTY BANK)</button>
            </div>
            <p className="mu">Adding never calls the provider. The mapping stays “unverified” until the first successful response.</p>
          </>
        )}
        <Problem error={err} />
      </section>

      {d.runs && <section className="card">
        <h2>Refresh runs</h2>
        {d.runs.length ? <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Started</th><th scope="col">Trigger</th><th scope="col">Expected session</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col">Failed</th><th scope="col">Deferred (budget)</th><th scope="col">Calls</th><th scope="col" style={{ textAlign: 'left' }}>Note</th></tr></thead>
          <tbody>{d.runs.map((r) => <tr key={r.run_id}><td>{ist(r.started_at)}</td><td>{r.trigger}</td><td>{r.expected_session}</td><td><span className={`t ${r.status === 'succeeded' ? 'o' : r.status === 'failed' ? 'r' : 'i'}`}>{r.status}</span></td><td className="num">{r.succeeded}</td><td className="num">{r.failed}</td><td className="num">{r.deferred_budget}</td><td className="num">{r.calls_spent}</td><td style={{ textAlign: 'left' }}>{r.stop_reason}</td></tr>)}</tbody></table></div> : <p className="mu">No refresh has run yet. {d.schedule.note}</p>}
      </section>}

      {d.requests && <section className="card">
        <h2>Provider requests</h2>
        <p className="mu">Every request ATLAS made or decided not to make. URLs and keys are never stored.</p>
        {d.requests.length ? <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Time</th><th scope="col">Purpose</th><th scope="col">Endpoint</th><th scope="col">Target</th><th scope="col">Calls</th><th scope="col">Outcome</th></tr></thead>
          <tbody>{d.requests.map((r, i) => <tr key={i}><td>{ist(r.requested_at)}</td><td>{r.category}</td><td>{r.endpoint}</td><td>{r.target}</td><td className="num">{r.cost}</td><td>{r.outcome.replace(/_/g, ' ')}{r.http_status ? ` (HTTP ${r.http_status})` : ''}{r.error_category ? `: ${r.error_category}` : ''}</td></tr>)}</tbody></table></div> : <p className="mu">No provider requests yet.</p>}
      </section>}

      <section className="card">
        <h2>Exchange calendar (NSE)</h2>
        <p className="mu">{d.calendar_note} {d.expected_session_note}</p>
        {d.calendar.length ? <ul>{d.calendar.map((c) => <li key={`${c.day}${c.source}`}>{c.day}: {c.kind.replace(/_/g, ' ')}{c.description ? `, ${c.description}` : ''} <span className="mu">({c.source.replace(/_/g, ' ')})</span></li>)}</ul> : <p className="mu">No holidays recorded for the coming year.</p>}
      </section>

      <section className="card">
        <h2>Providers</h2>
        {d.providers.map((p) => (
          <details key={p.provider_id} className="qcard" open={!p.configured}>
            <summary><strong>{p.name}</strong> <span className={`t ${p.health === 'healthy' ? 'o' : p.health === 'not_configured' ? 'm' : 'r'}`}>{p.health.replace(/_/g, ' ')}</span> <span className="mu">{p.configured ? 'key configured' : `set ${p.env}`}</span></summary>
            <p><strong>Coverage:</strong> {p.coverage_note}</p>
            <p><strong>Limits:</strong> {p.limits_note}</p>
            <p><strong>Licence:</strong> {p.licence_note}</p>
            <p className="mu">Docs checked {p.docs_checked_on}: <a href={p.docs_url} target="_blank" rel="noreferrer noopener">documentation</a> · <a href={p.terms_url} target="_blank" rel="noreferrer noopener">terms</a>{p.last_error ? ` · last error (${p.last_error_category}) ${ist(p.last_error_at)}: ${p.last_error}` : ''}</p>
          </details>
        ))}
        <p className="mu">{d.market_status_note}</p>
      </section>

      <section className="card">
        <h2>Stored data</h2>
        <p className="mu">{d.counts.instruments} instruments · {d.counts.prices} stored daily rows · {d.counts.revisions} corrections recorded · {d.counts.quarantined} rows quarantined · {d.counts.corporate_actions} corporate actions.</p>
        {d.instruments.length ? (
          <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Instrument</th><th scope="col">Data</th><th scope="col">Basis</th><th scope="col">Provider</th><th scope="col">Coverage</th><th scope="col">Rows</th><th scope="col">Last import</th></tr></thead>
            <tbody>{d.instruments.map((i) => <tr key={`${i.exchange}${i.symbol}${i.basis}`}><td style={{ textAlign: 'left' }}>{i.exchange}:{i.symbol} <span className="mu">{i.name}</span></td><td><Classification c={i.classification} /></td><td>{i.basis === 'raw' ? 'raw (as traded)' : 'adjusted (splits + dividends)'}</td><td>{i.provider_id}</td><td>{i.first_date?.slice(0, 10)} → {i.last_date?.slice(0, 10)}</td><td className="num">{i.observations}</td><td>{ist(i.last_import_at)}</td></tr>)}</tbody></table></div>
        ) : <p className="mu">Nothing imported yet.</p>}
        <h3>What the labels mean</h3>
        <ul>{Object.entries(d.classification).map(([k, v]) => <li key={k}><Classification c={k} /> {v}</li>)}</ul>
      </section>

      {d.jobs && <section className="card">
        <h2>Import jobs</h2>
        {d.jobs.length ? <div className="wrap"><table className="term-table"><thead><tr><th scope="col">Started</th><th scope="col">Instrument</th><th scope="col">Status</th><th scope="col">Received</th><th scope="col">Stored</th><th scope="col">Unchanged</th><th scope="col">Corrected</th><th scope="col">Rejected</th><th scope="col" style={{ textAlign: 'left' }}>Error</th></tr></thead>
          <tbody>{d.jobs.map((j) => <tr key={j.job_id}><td>{ist(j.started_at)}{j.dry_run ? ' (dry run)' : ''}</td><td>{j.detail.exchange}:{j.detail.symbol}</td><td><span className={`t ${j.status === 'succeeded' ? 'o' : j.status === 'partial' ? 'i' : 'r'}`}>{j.status}</span></td><td className="num">{j.received}</td><td className="num">{j.stored}</td><td className="num">{j.unchanged}</td><td className="num">{j.corrected}</td><td className="num">{j.rejected}</td><td style={{ textAlign: 'left' }}>{j.error ? `${j.error_category}: ${j.error}` : ''}</td></tr>)}</tbody></table></div> : <p className="mu">No imports yet.</p>}
      </section>}
    </>
  );
}
