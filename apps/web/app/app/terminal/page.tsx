'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { LineChart, Bars } from '@/components/charts';
import { Since, Sparkline, TickValue } from '@/components/terminal';
import { Loading, Problem } from '@/components/ui';
import { formatIndianNumber, formatIstDateTime } from '@/lib/format';

interface Mover { company_id: string; short_name: string; sector: string; symbol: string | null; close: number; prev_close: number; change_pct: number; volume: number; traded_value: number }
interface Terminal {
  data_kind: 'end_of_day'; synthetic: boolean; as_of: string; previous_session: string | null;
  freshness: { stale: boolean; label: string } | null; version: string; generated_at: string; notice: string; sessions: number;
  indices: { code: string; name: string; close: number; prev_close: number | null; date: string; change_pct: number | null; series: { date: string; close: number }[] }[];
  breadth: { universe_code: string; traded: number; advances: number; declines: number; unchanged: number; new_highs: number; new_lows: number; turnover_cr: number } | null;
  movers: { gainers: Mover[]; losers: Mover[]; active: Mover[] };
  sectors: { sector: string; ret_cap: number; advances: number; declines: number; constituents: number }[];
  feed: { kind: string; items: { announcement_id: string; company_id: string; company: string; category: string; subject: string; published_at: string; document_url: string | null; source_id: string }[] };
  pipeline: { last_eod_run: { status: string; started_at: string; finished_at: string | null; data_date: string | null } | null; last_calc_finished_at: string | null };
}

const POLL_MS = 60_000;
const pct = (v: number) => `${v >= 0 ? '+' : ''}${formatIndianNumber(v * 100, 2)}%`;
const num = (v: number) => formatIndianNumber(v, 2);

export default function TerminalPage() {
  const [sessions, setSessions] = useState(60);
  const [data, setData] = useState<Terminal | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checkedAt, setCheckedAt] = useState<number>(Date.now());
  const [changedAt, setChangedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'gainers' | 'losers' | 'active'>('gainers');

  const load = useCallback(async () => {
    try {
      const t = await api<Terminal>(`/v1/market/terminal?sessions=${sessions}`);
      setData((prev) => {
        if (prev && prev.version !== t.version) setChangedAt(Date.now());
        return t;
      });
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setCheckedAt(Date.now());
    }
  }, [sessions]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!data && !error) return <Loading lines={10} label="Loading the market terminal" />;
  if (!data) return <Problem error={error} retry={() => void load()} />;
  const d = data;
  const stale = !!d.freshness?.stale;
  const idx = d.indices.find((i) => i.code === (selected ?? d.indices[0]?.code)) ?? d.indices[0];
  const movers = d.movers[tab];

  return (
    <div className="terminal">
      <header className="term-bar" aria-label="Data status">
        <span className="term-tag">END OF DAY</span>
        <span>Session <strong>{d.as_of}</strong>{d.previous_session ? <span className="mu"> · vs {d.previous_session}</span> : null}</span>
        {d.synthetic && <span className="t i">Synthetic development data</span>}
        <span className={`t ${stale ? 'r' : 'o'}`}>{d.freshness?.label ?? 'Freshness unknown'}</span>
        <span className="mu">Checked <Since at={checkedAt} />{changedAt ? <> · new data <Since at={changedAt} /></> : ' · no new data since this page opened'}</span>
        {error && <span className="t r" role="status">Last check failed: showing the previous snapshot</span>}
      </header>
      <p className="mu term-note">{d.notice} The next session is stored after validation (target 20:30 IST on trading days); this page checks every minute and animates a value only when a newly stored record changes it.</p>

      <section aria-label="Indices" className="term-indices">
        {d.indices.map((i) => (
          <button key={i.code} className={`term-index ${idx?.code === i.code ? 'on' : ''}`} aria-pressed={idx?.code === i.code} onClick={() => setSelected(i.code)}>
            <span className="name">{i.name}</span>
            <TickValue value={i.close} format={num} stale={stale} className="val" />
            <span className={i.change_pct === null ? 'mu' : i.change_pct >= 0 ? 'up' : 'dn'}>{i.change_pct === null ? '—' : pct(i.change_pct)}</span>
            <Sparkline points={i.series.map((p) => p.close)} label={`${i.name}, last ${i.series.length} sessions`} />
          </button>
        ))}
      </section>

      <div className="term-grid">
        <section className="card term-chart" aria-labelledby="ch">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="ch">{idx?.name ?? 'Index'}</h2>
            <div role="group" aria-label="Chart period" className="seg">
              {[20, 60, 120, 250].map((n) => <button key={n} aria-pressed={sessions === n} className={sessions === n ? 'on' : ''} onClick={() => setSessions(n)}>{n} sessions</button>)}
            </div>
          </div>
          {idx && <LineChart title={`${idx.name}: closing level, last ${idx.series.length} sessions to ${d.as_of}`} yLabel="Index level" series={[{ name: idx.name, points: idx.series.map((p) => ({ x: p.date, y: p.close })) }]} height={260} note={`Source: stored end-of-day index levels${d.synthetic ? ' (synthetic)' : ''}.`} />}
        </section>

        <section className="card" aria-labelledby="br">
          <h2 id="br">Breadth</h2>
          {d.breadth ? (
            <dl className="term-kv">
              <dt>Advances</dt><dd className="up"><TickValue value={d.breadth.advances} format={(v) => String(Math.round(v))} stale={stale} /></dd>
              <dt>Declines</dt><dd className="dn"><TickValue value={d.breadth.declines} format={(v) => String(Math.round(v))} stale={stale} /></dd>
              <dt>Unchanged</dt><dd>{d.breadth.unchanged}</dd>
              <dt>New 52-week highs / lows</dt><dd>{d.breadth.new_highs} / {d.breadth.new_lows}</dd>
              <dt>Turnover</dt><dd>₹{formatIndianNumber(d.breadth.turnover_cr, 2)} cr</dd>
              <dt>Securities traded</dt><dd>{d.breadth.traded}</dd>
            </dl>
          ) : <p className="mu">No breadth record for this session.</p>}
          <p className="mu">Universe: {d.breadth?.universe_code ?? '—'}.</p>
        </section>
      </div>

      <div className="term-grid">
        <section className="card" aria-labelledby="mv">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="mv">Movers, {d.as_of}</h2>
            <div role="tablist" aria-label="Mover lists" className="seg">
              {(['gainers', 'losers', 'active'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k === 'active' ? 'Most traded' : k[0]!.toUpperCase() + k.slice(1)}</button>)}
            </div>
          </div>
          <div className="wrap"><table className="term-table">
            <caption className="sr-only">{tab} on {d.as_of}</caption>
            <thead><tr><th scope="col">Company</th><th scope="col">Symbol</th><th scope="col" className="num">Close</th><th scope="col" className="num">Change</th><th scope="col" className="num">Traded value</th></tr></thead>
            <tbody>{movers.map((m) => (
              <tr key={m.company_id}>
                <td><a href={`/app/companies/${m.company_id}`}>{m.short_name}</a></td>
                <td className="mu">{m.symbol ?? '—'}</td>
                <td className="num">₹<TickValue value={m.close} format={num} stale={stale} /></td>
                <td className={`num ${m.change_pct >= 0 ? 'up' : 'dn'}`}>{pct(m.change_pct)}</td>
                <td className="num">₹{formatIndianNumber(m.traded_value / 1e7, 2)} cr</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="mu">Ranked on the stored closing price against the previous close; listed companies with full coverage only.</p>
        </section>

        <section className="card" aria-labelledby="sc">
          <h2 id="sc">Sectors, {d.as_of}</h2>
          {d.sectors.length ? <Bars title="Capitalisation-weighted sector return" items={d.sectors.map((s) => ({ label: s.sector, value: s.ret_cap * 100 }))} /> : <p className="mu">No sector record for this session.</p>}
        </section>
      </div>

      <div className="term-grid">
        <section className="card" aria-labelledby="fd">
          <h2 id="fd">Disclosures feed <span className="mu">· {d.feed.kind}</span></h2>
          <p className="mu">Company announcements as published, newest first. This is not a general news feed.</p>
          <ol className="term-feed">
            {d.feed.items.map((f) => (
              <li key={f.announcement_id}>
                <time dateTime={f.published_at}>{formatIstDateTime(f.published_at)}</time>
                <span className="t c">{f.category}</span>
                <a href={`/app/companies/${f.company_id}?tab=disclosures`}>{f.company}</a>
                <span>{f.subject}</span>
                {f.document_url ? <a href={f.document_url} rel="noreferrer noopener" target="_blank">Source document</a> : <span className="mu">Source: {f.source_id}</span>}
              </li>
            ))}
          </ol>
        </section>
        <section className="card" aria-labelledby="pl">
          <h2 id="pl">Pipeline</h2>
          {d.pipeline.last_eod_run ? (
            <p>Last end-of-day import: <span className={`t ${d.pipeline.last_eod_run.status === 'succeeded' ? 'o' : 'r'}`}>{d.pipeline.last_eod_run.status}</span> for {d.pipeline.last_eod_run.data_date ?? '—'}, finished {d.pipeline.last_eod_run.finished_at ? formatIstDateTime(d.pipeline.last_eod_run.finished_at) : 'not finished'}.</p>
          ) : <p className="mu">No import has run yet.</p>}
          <p className="mu">Calculations last finished {d.pipeline.last_calc_finished_at ? formatIstDateTime(d.pipeline.last_calc_finished_at) : '—'}.</p>
          <p><a href="/app/data-health">Data health</a> · <a href="/app/market">Market overview</a></p>
        </section>
      </div>
    </div>
  );
}
