'use client';
import { Loading, Problem, useApi } from '@/components/ui';
import { formatIstDateTime } from '@/lib/format';

interface S { demo_mode?: boolean; components: { name: string; status: string; last_success_at?: string | null }[]; incidents: { incident_id: string; title: string; status: string; severity: string; started_at: string; updates: { at: string; text: string }[] }[]; latest_briefing: { trade_date: string; status: string } | null }

export default function Status() {
  const s = useApi<S>('/v1/status');
  if (s.loading) return <Loading />;
  if (s.error) return <Problem error={s.error} retry={s.reload} />;
  const d = s.data!;
  return (
    <>
      <h1>Status</h1>
      <div className="card">
        <ul>{d.components.map((c) => <li key={c.name}>{c.name}: <span className={`t ${c.status === 'operational' || c.status === 'published' ? 'o' : c.status === 'not connected' ? 'm' : 'i'}`}>{c.status}</span>{c.last_success_at ? <span className="mu"> · last successful update {formatIstDateTime(c.last_success_at)}</span> : null}</li>)}</ul>
        {d.latest_briefing && <p className="mu">Latest briefing: {d.latest_briefing.trade_date} ({d.latest_briefing.status}).</p>}
      </div>
      <h2>Incidents</h2>
      {d.incidents.length
        ? d.incidents.map((i) => <div key={i.incident_id} className="card"><h3>{i.title} <span className="t i">{i.severity}</span> <span className="t m">{i.status}</span></h3><p className="mu">Started {formatIstDateTime(i.started_at)}</p><ul>{i.updates.map((u) => <li key={u.at}>{formatIstDateTime(u.at)}: {u.text}</li>)}</ul></div>)
        : <p className="mu">No incidents reported.</p>}
    </>
  );
}
