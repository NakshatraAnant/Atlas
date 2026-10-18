'use client';
import { use } from 'react';
import { Loading, Problem, useApi } from '@/components/ui';

interface D { code: string; name: string; version: number; unit: string; formula: string; description: string; inputs: string[]; edgeRules: string[]; templates: string[]; lesson_url: string | null; versions: { version: number; published_at: string; change_note: string }[] }

export default function MetricPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const d = useApi<D>(`/v1/methodology/metrics/${code}`);
  if (d.loading) return <Loading />;
  if (d.error) return <Problem error={d.error} />;
  const m = d.data!;
  return (
    <article className="card">
      <p className="mu"><a href="/methodology">Methodology</a> / metric definitions</p>
      <h1>{m.name}</h1>
      <p>{m.description}</p>
      <dl>
        <dt className="mu">Formula</dt><dd><code>{m.formula}</code></dd>
        <dt className="mu">Inputs</dt><dd>{m.inputs.join(', ')}</dd>
        <dt className="mu">Unit</dt><dd>{m.unit}</dd>
        <dt className="mu">Edge cases</dt><dd><ul>{m.edgeRules.map((r) => <li key={r}>{r}</li>)}</ul></dd>
        <dt className="mu">Applies to</dt><dd>{m.templates.join(', ')} templates</dd>
        <dt className="mu">Code and version</dt><dd>{m.code} v{m.version}</dd>
      </dl>
      {m.lesson_url && <p><a href={m.lesson_url.replace('/learn/', '/app/learn/')}>Related lesson</a></p>}
      <h2>Version history</h2>
      <ul>{m.versions.map((v) => <li key={v.version}>v{v.version} · {v.published_at?.slice(0, 10)} · {v.change_note}</li>)}</ul>
    </article>
  );
}
