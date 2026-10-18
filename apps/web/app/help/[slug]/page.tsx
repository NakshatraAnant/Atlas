'use client';
import { use } from 'react';
import { Loading, Problem, useApi } from '@/components/ui';

export default function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const a = useApi<{ title: string; body: string; category: string }>(`/v1/help/${slug}`);
  if (a.loading) return <Loading />;
  if (a.error) return <Problem error={a.error} />;
  return (
    <article className="card">
      <p className="mu"><a href="/help">Help centre</a> / {a.data!.category}</p>
      <h1>{a.data!.title}</h1>
      <p>{a.data!.body}</p>
      <p className="mu">Still stuck? Use “Send feedback” at the bottom of any page.</p>
    </article>
  );
}
