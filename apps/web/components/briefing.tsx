'use client';

import { Loading, Problem, Synthetic, Tag, useApi, Value } from './ui';
import { formatDate } from '@/lib/format';

interface Claim { id: string; value: number; label: string; evidenceId: string; unit?: string }
interface Item { type: string; text: string; claims: string[]; links?: { label: string; href: string }[] }
interface Section { id: string; title: string; items: Item[]; table?: { columns: string[]; rows: (string | number)[][]; evidence: string[][] } }
interface Briefing { trade_date: string; status: 'published' | 'held' | 'holiday'; published_at: string | null; content: { headline?: string; sections?: Section[]; claims?: Claim[]; tiles?: { label: string; value: string; change: string | null; claim: string }[]; synthetic?: boolean; notice?: string; reasons?: string[]; next_session?: string | null; regime?: Record<string, { label: string; inputs: Record<string, number | null> }> }; checks: { name: string; passed: boolean; detail: string }[] }

export function BriefingView({ date = 'latest', compact = false }: { date?: string; compact?: boolean }) {
  const b = useApi<Briefing>(`/v1/market/briefings/${date}`);
  if (b.loading) return <Loading lines={5} />;
  if (b.error) return <Problem error={b.error} retry={b.reload} />;
  const d = b.data!;
  if (d.status !== 'published') {
    return (
      <div className="card">
        <h2>{formatDate(d.trade_date)} briefing</h2>
        <div className="warn">{d.content.notice}</div>
        {d.content.next_session && <p className="mu">Next session: {formatDate(d.content.next_session)}.</p>}
      </div>
    );
  }
  const c = d.content;
  const claimById = new Map((c.claims ?? []).map((x) => [x.id, x]));
  const regime = c.regime;
  return (
    <article className="card" aria-labelledby={`b-${d.trade_date}`}>
      <h2 id={`b-${d.trade_date}`}>{c.headline}</h2>
      <p className="mu">Published {d.published_at ? new Date(d.published_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) + ' IST' : ''} · automated number checks {d.checks.every((x) => x.passed) ? 'passed' : 'flagged'} · every figure opens its evidence {c.synthetic && <Synthetic />}</p>
      <div className="grid">
        {(c.tiles ?? []).map((t) => {
          const cl = claimById.get(t.claim);
          return (
            <div key={t.label} className="card" style={{ margin: 0 }}>
              <div className="mu">{t.label}</div>
              <div className="big"><Value evidence={cl?.evidenceId} surface="briefing">{t.value}</Value></div>
              <div className={t.change?.startsWith('−') ? 'dn' : 'up'}>{t.change}</div>
              <div className="mu">End of day</div>
            </div>
          );
        })}
      </div>
      {regime && (
        <p className="mu">Regime labels (rules on click): {Object.entries(regime).filter(([k]) => k !== 'version').map(([k, r]) => (
          <span key={k} style={{ marginRight: 10 }}>{k}: <a href="/methodology/metrics/regime_trend" title={JSON.stringify(r.inputs)}>{r.label}</a></span>
        ))}</p>
      )}
      {(c.sections ?? []).filter((s) => !compact || ['what_happened', 'how_broad'].includes(s.id)).map((s) => (
        <section key={s.id}>
          <h3>{s.title}</h3>
          {s.items.map((i, k) => (
            <p key={k}><Tag kind={i.type} />{i.text}{' '}
              {i.claims.length > 0 && <span className="mu">[{i.claims.map((cid) => claimById.get(cid)).filter(Boolean).map((cl, n) => <span key={cl!.id}>{n > 0 && ', '}<Value evidence={cl!.evidenceId} surface="briefing">{cl!.label}</Value></span>)}]</span>}
              {i.links?.map((l) => <span key={l.href}> · <a href={l.href}>{l.label}</a></span>)}
            </p>
          ))}
          {s.table && !compact && (
            <div className="wrap"><table><caption>{s.title}</caption><thead><tr>{s.table.columns.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{s.table.rows.map((r, k) => <tr key={k}>{r.map((v, j) => <td key={j} className={typeof v === 'string' && /^[+−]/.test(v) ? (v.startsWith('−') ? 'dn' : 'up') : ''}>{j === 0 ? <a href={`/app/market/sectors/${encodeURIComponent(String(v))}?date=${d.trade_date}`}>{v}</a> : v}</td>)}</tr>)}</tbody></table></div>
          )}
        </section>
      ))}
      {compact && <p><a href={`/app/briefings/${d.trade_date}`}>Read the full briefing</a></p>}
    </article>
  );
}
