'use client';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';

export default function Legal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const p = useApi<{ title: string; status: string; body: string[] }>(`/v1/legal/${slug}`);
  const [g, setG] = useState({ subject: '', comment: '', email: '' });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  if (p.loading) return <Loading />;
  if (p.error) return <Problem error={p.error} />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ ticket_ref: string }>('/v1/grievances', { body: { ...g, email: g.email || undefined } });
      setDone(`Grievance registered: ${r.ticket_ref}.`);
    } catch (x) {
      setErr(x as Error);
    }
  };
  return (
    <article className="card">
      <h1>{p.data!.title}</h1>
      <p className="warn">{p.data!.status}</p>
      {p.data!.body.map((b) => <p key={b}>{b}</p>)}
      {slug === 'grievance' && (done ? <p className="okbox">{done}</p> : (
        <form className="stack" onSubmit={submit}>
          <h2>Raise a grievance</h2>
          <label className="field">Subject<input required minLength={3} value={g.subject} onChange={(e) => setG({ ...g, subject: e.target.value })} /></label>
          <label className="field">Details<textarea required rows={4} value={g.comment} onChange={(e) => setG({ ...g, comment: e.target.value })} /></label>
          <label className="field">Email (if not signed in)<input type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></label>
          <Problem error={err} />
          <button className="btn" type="submit">Submit grievance</button>
        </form>
      ))}
    </article>
  );
}
