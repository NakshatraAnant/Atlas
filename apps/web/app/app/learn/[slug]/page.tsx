'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';
import { dateOrDash } from '@/lib/format';

interface Lesson { slug: string; title: string; minutes: number; published_on: string; price_data_cutoff: string | null; editorial_checklist: { reviewer: string; signed_on: string | null }; body: string[]; product_links: { label: string; href: string }[]; quiz: { q: string; options: string[] }[] }

export default function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const l = useApi<Lesson>(`/v1/learn/lessons/${slug}`);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<{ score: number; of: number; explanations: { answer: number; why: string }[]; return_to: string | null } | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    const r = new URLSearchParams(location.search).get('return_to');
    const safe = r && r.startsWith('/') && !r.startsWith('//') ? r : null;
    setReturnTo(safe);
    void api('/v1/learn/progress', { body: { lesson: slug, started: true, return_to: safe ?? undefined } }).catch(() => undefined);
  }, [slug]);
  if (l.loading) return <Loading lines={8} />;
  if (l.error) return <Problem error={l.error} retry={l.reload} />;
  const d = l.data!;
  const back = result?.return_to ?? returnTo;
  return (
    <article className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
      <p><a href="/app/learn">← Learn</a>{back && <> · <a href={back}>Back to where you were</a></>}</p>
      <h1>{d.title}</h1>
      <p className="mu">{d.minutes} min · published {dateOrDash(d.published_on)} · editorial review: {d.editorial_checklist.signed_on ? `${d.editorial_checklist.reviewer}, ${dateOrDash(d.editorial_checklist.signed_on)}` : 'pending'}</p>
      {d.body.map((p, i) => <p key={i}>{p}</p>)}
      {d.product_links.length > 0 && <p>Try it: {d.product_links.map((x, i) => <span key={x.href}>{i > 0 && ' · '}<a href={x.href}>{x.label}</a></span>)}</p>}
      <section aria-labelledby="quiz"><h2 id="quiz">Check your understanding</h2>
        {d.quiz.map((q, i) => (
          <fieldset key={i} style={{ border: 0, padding: 0, marginBottom: 12 }}>
            <legend><strong>{i + 1}. {q.q}</strong></legend>
            {q.options.map((o, k) => (
              <label key={k} style={{ display: 'block' }}>
                <input type="radio" name={`q${i}`} checked={answers[i] === k} disabled={!!result} onChange={() => { const a = [...answers]; a[i] = k; setAnswers(a); }} /> {o}
                {result && result.explanations[i]!.answer === k && <span className="up"> ✓ correct answer</span>}
              </label>
            ))}
            {result && <p className="mu">{result.explanations[i]!.why}</p>}
          </fieldset>
        ))}
        {result ? <p className="okbox">You answered {result.score} of {result.of} correctly. Lesson marked complete.</p> : (
          <button className="btn" disabled={answers.filter((a) => a !== undefined).length < d.quiz.length} onClick={async () => setResult(await api('/v1/learn/progress', { body: { lesson: slug, answers, return_to: returnTo ?? undefined } }))}>Check answers</button>
        )}
      </section>
    </article>
  );
}
