'use client';
import { use, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, Problem, useApi } from '@/components/ui';

type Param = { key: string; label: string; min: number; max: number; step: number; default: number; unit?: string };
type Game =
  | { id: string; title: string; mechanic: 'classify'; intro: string; options: string[]; items: { prompt: string; data: [string, string][] | null }[] }
  | { id: string; title: string; mechanic: 'tune'; intro: string; rounds: { prompt: string; fixed: Record<string, number>; params: Param[] }[] };
interface Outcome { ok: boolean; metrics: Record<string, number | null>; message: string }

export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const g = useApi<Game>(`/v1/academy/games/${id}`);
  if (g.loading) return <Loading lines={6} label="Loading game" />;
  if (g.error) return <Problem error={g.error} retry={g.reload} />;
  const game = g.data!;
  return (
    <div className="academy narrow">
      <p><a href="/app/academy/games">← Games</a></p>
      <h1>{game.title}</h1>
      <p>{game.intro}</p>
      {game.mechanic === 'classify' ? <Classify game={game} /> : <Tune game={game} />}
    </div>
  );
}

function Classify({ game }: { game: Extract<Game, { mechanic: 'classify' }> }) {
  const [answers, setAnswers] = useState<(number | null)[]>(game.items.map(() => null));
  const [res, setRes] = useState<{ correct: number; total: number; outcomes: { correct: boolean; expected: number; why: string }[] } | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const submit = async () => {
    setErr(null);
    try { setRes(await api(`/v1/academy/games/${game.id}/play`, { body: { answers } })); } catch (e) { setErr(e as ApiError); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {game.items.map((it, i) => {
        const o = res?.outcomes[i];
        return (
          <fieldset key={i} className={`qcard${o ? (o.correct ? ' right' : ' wrong') : ''}`}>
            <legend><span className="mu">{i + 1} of {game.items.length}</span><br /><strong>{it.prompt}</strong></legend>
            {it.data && <table className="game-data"><tbody>{it.data.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody></table>}
            <div className="chips" role="radiogroup" aria-label={`Answer for item ${i + 1}`}>
              {game.options.map((opt, k) => (
                <label key={opt} className={`chip${answers[i] === k ? ' on' : ''}${o && o.expected === k ? ' key' : ''}`}>
                  <input type="radio" name={`g${i}`} checked={answers[i] === k} disabled={!!res} onChange={() => setAnswers(answers.map((a, j) => (j === i ? k : a)))} /> {opt}
                </label>
              ))}
            </div>
            {o && <p className="feedback" role="status"><strong>{o.correct ? 'Correct.' : `Answer: ${game.options[o.expected]}.`}</strong> {o.why}</p>}
          </fieldset>
        );
      })}
      {res ? <p className="okbox" role="status"><strong>{res.correct} of {res.total} correct.</strong> <button type="button" className="link" onClick={() => { setRes(null); setAnswers(game.items.map(() => null)); }}>Play again</button></p>
        : <button className="btn" type="submit" disabled={answers.some((a) => a === null)}>{answers.some((a) => a === null) ? 'Answer every item to check' : 'Check answers'}</button>}
      <Problem error={err} />
    </form>
  );
}

function Tune({ game }: { game: Extract<Game, { mechanic: 'tune' }> }) {
  const [vals, setVals] = useState(game.rounds.map((r) => Object.fromEntries(r.params.map((p) => [p.key, p.default]))));
  const [live, setLive] = useState<(Outcome | null)[]>(game.rounds.map(() => null));
  const [res, setRes] = useState<{ correct: number; total: number } | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void Promise.all(game.rounds.map((_, i) => api<Outcome>(`/v1/academy/games/${game.id}/evaluate`, { body: { round: i, params: vals[i] } }).catch(() => null))).then(setLive);
    }, 250);
    return () => clearTimeout(t);
  }, [vals, game]);
  const submit = async () => {
    setErr(null);
    try { setRes(await api(`/v1/academy/games/${game.id}/play`, { body: { rounds: vals } })); } catch (e) { setErr(e as ApiError); }
  };
  return (
    <div>
      {game.rounds.map((r, i) => (
        <section key={i} className={`qcard${live[i] ? (live[i]!.ok ? ' right' : '') : ''}`} aria-labelledby={`r${i}`}>
          <h2 id={`r${i}`} style={{ fontSize: 16 }}>Round {i + 1}</h2>
          <p>{r.prompt}</p>
          <div className="row">
            {r.params.map((p) => (
              <label key={p.key} className="field">{p.label}: <strong>{vals[i]![p.key]}{p.unit ?? ''}</strong>
                <input type="range" min={p.min} max={p.max} step={p.step} value={vals[i]![p.key]} onChange={(e) => setVals(vals.map((v, j) => (j === i ? { ...v, [p.key]: Number(e.target.value) } : v)))} />
              </label>
            ))}
          </div>
          {live[i] && (
            <div aria-live="polite">
              <p><strong>{live[i]!.ok ? '✓ Target met.' : 'Not yet.'}</strong> {live[i]!.message}</p>
              <p className="mu">{Object.entries(live[i]!.metrics).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v === null ? 'n/a' : v.toLocaleString('en-IN')}`).join(' · ')}</p>
            </div>
          )}
        </section>
      ))}
      {res ? <p className="okbox" role="status"><strong>{res.correct} of {res.total} rounds solved.</strong></p> : <button className="btn" onClick={() => void submit()}>Submit my answers</button>}
      <Problem error={err} />
    </div>
  );
}
