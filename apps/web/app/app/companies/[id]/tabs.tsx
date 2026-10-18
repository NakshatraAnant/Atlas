'use client';
import { useMemo, useState } from 'react';
import { LineChart } from '@/components/charts';
import { Empty, Loading, Problem, Tag, useApi, Value } from '@/components/ui';
import { cls, dateOrDash, fmt, formatDate, prettyPeriod } from '@/lib/format';

export interface Company {
  company: { company_id: string; legal_name: string; short_name: string; former_names: string[]; sector: string; industry: string; sector_template: string; status: string; coverage: string; is_synthetic: boolean; isin: string; listed_on: string | null; delisted_on: string | null; description: string | null; description_source_id: string | null; description_as_of: string | null; segments_reported: boolean; nse_symbol: string | null; bse_code: string | null; primary_basis: string };
  access: { full: boolean; used: number; limit: number };
  since_last_visit: { last_visit_at: string; changes: { kind: string; title: string; at: string }[] } | null;
  recent_developments: Announcement[];
}
interface Announcement { announcement_id: string; category: string; subcategory: string | null; subject: string; published_at: string; received_at: string; document_url: string | null }
interface Cell { value: number | null; missing: string | null; evidence_id: string | null; quality: string; restated?: boolean; original_value?: number | null; as_of?: string }
interface MetricTable { basis: string; freq: string; periods: string[]; metrics: { code: string; name: string; unit: string; definition_url: string; lesson: string | null; applies: boolean; cells: Cell[] }[] }

const QualityMark = ({ c }: { c: Cell }) => (
  <>
    {c.quality === 'conflict' && <span className="t r" title="Sources disagree beyond tolerance; open the evidence for both values">conflict</span>}
    {c.restated && <span className="t m" title={`Restated; originally ${fmt(c.original_value ?? null)}`}>restated</span>}
  </>
);

export function Overview({ id, c }: { id: string; c: Company }) {
  const sum = useApi<{ enabled: boolean; label: string; sections: { id: string; title: string; sentences: { type: string; text: string; evidence: string[] }[] }[]; sources: string; versions: Record<string, string>; generated_at: string; reason?: string }>(c.access.full ? `/v1/companies/${id}/research-summary` : null);
  const key = useApi<MetricTable>(c.access.full ? `/v1/companies/${id}/metrics?freq=LATEST&codes=revenue_growth_yoy,operating_margin,roce,roe,debt_equity,cash_conversion,pe_ttm,pb,dividend_yield,market_cap` : null);
  const co = c.company;
  return (
    <div className="grid2">
      <div>
        <section className="card"><h2>About</h2>
          <p>{co.description ?? 'No description available.'}</p>
          <p className="mu">Source: {co.description_source_id ?? '—'}, as of {dateOrDash(co.description_as_of)} · Reporting basis shown by default: {co.primary_basis} · {co.segments_reported ? 'Segments reported' : 'No segment disclosure'}</p>
        </section>
        {key.data && (
          <section className="card"><h2>Key figures (latest)</h2>
            <div className="grid">{key.data.metrics.map((m) => (
              <div key={m.code}><div className="mu"><a href={m.definition_url}>{m.name}</a></div><div className="big"><Value v={m.cells[0]?.value} unit={m.unit} missing={m.cells[0]?.missing} evidence={m.cells[0]?.evidence_id} surface="company_overview" /></div></div>
            ))}</div>
          </section>
        )}
        {sum.data?.enabled && (
          <section className="card" aria-labelledby="rs"><h2 id="rs">{sum.data.label}</h2>
            {sum.data.sections.map((s) => (
              <div key={s.id}><h3>{s.title}</h3>{s.sentences.length === 0 ? <p className="mu">Nothing to report.</p> : s.sentences.map((x, i) => <p key={i}><Tag kind={x.type} />{x.text} {x.evidence.slice(0, 3).map((e, k) => <Value key={e} evidence={e} surface="research_summary">{`[${k + 1}]`}</Value>)}</p>)}</div>
            ))}
            <p className="mu">{sum.data.sources} · generator {sum.data.versions.generator}, model {sum.data.versions.model} · {dateOrDash(sum.data.generated_at)}</p>
          </section>
        )}
        {sum.data && !sum.data.enabled && <p className="mu">{sum.data.reason ?? 'Research summaries are switched off in this environment.'}</p>}
      </div>
      <section className="card"><h2>Recent developments</h2>
        {c.recent_developments.length === 0 ? <Empty>No recent announcements.</Empty> : <ul>{c.recent_developments.map((a) => <li key={a.announcement_id}><a href={a.document_url ?? '#'}>{a.subject}</a><br /><span className="mu">{a.category} · {dateOrDash(a.published_at)}</span></li>)}</ul>}
      </section>
    </div>
  );
}

export function Financials({ id }: { id: string }) {
  const [statement, setStatement] = useState('pl');
  const [freq, setFreq] = useState('Q');
  const [basis, setBasis] = useState<string | null>(null);
  const f = useApi<{ basis: string; basis_label: string; unit_note: string; periods: { key: string; label: string; period_end: string; filed_at: string; restated: boolean }[]; rows: { code: string; name: string; unit: string; cells: Cell[] }[]; history_limited: string | null; bases_available: string[] }>(`/v1/companies/${id}/financials?statement=${statement}&freq=${freq}${basis ? `&basis=${basis}` : ''}`);
  return (
    <section className="card">
      <div className="row">
        <label>Statement <select value={statement} onChange={(e) => setStatement(e.target.value)}><option value="pl">Profit and loss</option><option value="bs">Balance sheet</option><option value="cf">Cash flow</option></select></label>
        <label>Periods <select value={freq} onChange={(e) => setFreq(e.target.value)}><option value="Q">Quarterly</option><option value="FY">Annual</option></select></label>
        {f.data && f.data.bases_available.length > 1 && <label>Basis <select value={basis ?? f.data.basis} onChange={(e) => setBasis(e.target.value)}>{f.data.bases_available.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>}
      </div>
      {f.loading ? <Loading lines={6} /> : f.error ? <Problem error={f.error} retry={f.reload} /> : (() => {
        const d = f.data!;
        const periods = d.periods.slice(-12);
        const off = d.periods.length - periods.length;
        return (
          <>
            <p className="mu">{d.basis_label} · {d.unit_note}</p>
            {d.history_limited && <p className="warn">{d.history_limited} <a href="/pricing">Compare plans</a></p>}
            <div className="wrap"><table>
              <caption className="sr-only">Financial statement</caption>
              <thead><tr><th scope="col">Line item</th>{periods.map((p) => <th key={p.key} scope="col" title={`Filed ${dateOrDash(p.filed_at)}`}>{p.label}{p.restated && '*'}</th>)}</tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.code}><th scope="row">{r.name}</th>{periods.map((p, i) => { const c = r.cells[i + off]!; return <td key={p.key}><Value v={c.value} unit={r.unit === 'INR_cr' ? null : r.unit} missing={c.missing} evidence={c.evidence_id} surface="financials" /><QualityMark c={c} /></td>; })}</tr>
              ))}</tbody>
            </table></div>
            <p className="mu">* restated period: the evidence shows the original figure. Values are as filed (point in time).</p>
          </>
        );
      })()}
    </section>
  );
}

export function Ratios({ id }: { id: string }) {
  const [freq, setFreq] = useState('FY');
  const m = useApi<MetricTable>(`/v1/companies/${id}/metrics?freq=${freq}`);
  return (
    <section className="card">
      <label>Periods <select value={freq} onChange={(e) => setFreq(e.target.value)}><option value="FY">Annual</option><option value="Q">Quarterly</option></select></label>
      {m.loading ? <Loading lines={6} /> : m.error ? <Problem error={m.error} retry={m.reload} /> : (() => {
        const d = m.data!;
        const periods = d.periods.slice(-10);
        const off = d.periods.length - periods.length;
        return (
          <div className="wrap"><table>
            <caption>Ratios and growth ({d.basis})</caption>
            <thead><tr><th scope="col">Measure</th>{periods.map((p) => <th key={p} scope="col">{prettyPeriod(p)}</th>)}</tr></thead>
            <tbody>{d.metrics.filter((x) => x.applies).map((x) => (
              <tr key={x.code}><th scope="row"><a href={x.definition_url}>{x.name}</a>{x.lesson && <> <a className="mu" href={`/app/learn/${x.lesson}?return_to=${encodeURIComponent(`/app/companies/${id}?tab=ratios`)}`} title="Lesson">?</a></>}</th>
                {periods.map((p, i) => { const c = x.cells[i + off]!; return <td key={p}><Value v={c.value} unit={x.unit} missing={c.missing} evidence={c.evidence_id} surface="ratios" /><QualityMark c={c} /></td>; })}</tr>
            ))}</tbody>
          </table></div>
        );
      })()}
    </section>
  );
}

export function Quality({ id }: { id: string }) {
  const q = useApi<{ flags: { code: string; name: string; triggered: boolean; status: string; rule: string; threshold: string; observed: { period: string; value: number | null }[]; note: string }[]; basis: string }>(`/v1/companies/${id}/quality-flags`);
  if (q.loading) return <Loading />;
  if (q.error) return <Problem error={q.error} retry={q.reload} />;
  return (
    <section className="card">
      <p className="mu">Rule-based flags on reported data ({q.data!.basis}). {q.data!.flags[0]?.note}</p>
      <div className="wrap"><table><caption className="sr-only">Quality flags</caption>
        <thead><tr><th scope="col">Flag</th><th scope="col">Status</th><th scope="col">Rule</th><th scope="col">Observed</th></tr></thead>
        <tbody>{q.data!.flags.map((f) => (
          <tr key={f.code}><th scope="row">{f.name}</th><td>{f.triggered ? <span className="t r">Triggered</span> : f.status === 'insufficient_data' ? <span className="t m">Insufficient data</span> : <span className="t o">Not triggered</span>}</td>
            <td>{f.rule}<br /><span className="mu">Threshold: {f.threshold}</span></td>
            <td>{f.observed.map((o) => `${o.period}: ${o.value === null ? '—' : fmt(o.value)}`).join(' · ') || '—'}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

export function Valuation({ id }: { id: string }) {
  const [measure, setMeasure] = useState<'pe_ttm' | 'pb' | 'ev_ebitda' | 'dividend_yield'>('pe_ttm');
  const v = useApi<{ latest: MetricTable; history: { trade_date: string; pe_ttm: number | null; pb: number | null; ev_ebitda: number | null; dividend_yield: number | null }[]; notes: string[] }>(`/v1/companies/${id}/valuation`);
  if (v.loading) return <Loading />;
  if (v.error) return <Problem error={v.error} retry={v.reload} />;
  const d = v.data!;
  const vals = d.history.map((h) => h[measure]).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor(vals.length / 2)]! : null;
  const labels = { pe_ttm: 'P/E (trailing twelve months)', pb: 'Price to book', ev_ebitda: 'EV / EBITDA', dividend_yield: 'Dividend yield (%)' };
  return (
    <>
      <section className="card"><h2>Latest</h2>
        <div className="grid">{d.latest.metrics.map((m) => <div key={m.code}><div className="mu"><a href={m.definition_url}>{m.name}</a></div><div className="big"><Value v={m.cells[0]?.value} unit={m.unit} missing={m.cells[0]?.missing} evidence={m.cells[0]?.evidence_id} surface="valuation" /></div></div>)}</div>
      </section>
      <section className="card"><h2>History</h2>
        <label>Measure <select value={measure} onChange={(e) => setMeasure(e.target.value as typeof measure)}>{Object.entries(labels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <LineChart title={labels[measure]} yLabel={labels[measure]} series={[{ name: labels[measure], points: d.history.map((h) => ({ x: h.trade_date, y: h[measure] })) }, ...(median !== null ? [{ name: 'Period median', dashed: true, points: d.history.map((h) => ({ x: h.trade_date, y: median })) }] : [])]} />
        <ul className="mu">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>
    </>
  );
}

export function Ownership({ id }: { id: string }) {
  const s = useApi<{ history: { quarter_end: string; filed_at: string; categories: Record<string, { pct: number; evidence_id: string }>; pledged_pct_of_promoter: number | null; pledge_change_pp: number | null; pledge_highlight: boolean; promoter_change_pp: number | null }[]; insider_trades: { person_category: string; transaction_type: string; shares: number; value_inr: number | null; transaction_date: string; disclosed_at: string }[]; quarters_available: number }>(`/v1/companies/${id}/shareholding`);
  if (s.loading) return <Loading />;
  if (s.error) return <Problem error={s.error} retry={s.reload} />;
  const d = s.data!;
  const rows = [...d.history].reverse().slice(0, 12);
  const cats = ['promoter', 'fii', 'dii', 'public', 'government', 'other'];
  const names: Record<string, string> = { promoter: 'Promoter', fii: 'Foreign institutions', dii: 'Domestic institutions', public: 'Public', government: 'Government', other: 'Other' };
  return (
    <>
      <section className="card">
        <div className="wrap"><table><caption>Shareholding pattern (% of shares)</caption>
          <thead><tr><th scope="col">Quarter</th>{cats.map((c) => <th key={c} scope="col">{names[c]}</th>)}<th scope="col">Promoter shares pledged</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.quarter_end}><th scope="row">{formatDate(r.quarter_end)}</th>
              {cats.map((c) => <td key={c}>{r.categories[c] ? <Value v={r.categories[c]!.pct} unit="percent" evidence={r.categories[c]!.evidence_id} surface="ownership" /> : '—'}{c === 'promoter' && r.promoter_change_pp ? <span className={cls(r.promoter_change_pp)}> ({fmt(r.promoter_change_pp, 'pp')})</span> : null}</td>)}
              <td>{fmt(r.pledged_pct_of_promoter, 'percent')}{r.pledge_highlight && <span className="t r" title="Pledge changed by more than the highlight threshold">changed {fmt(r.pledge_change_pp, 'pp')}</span>}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="mu">{d.quarters_available} quarters available. Pledged share is a percentage of promoter holding.</p>
      </section>
      <section className="card"><h2>Insider and promoter trades (SAST / PIT disclosures)</h2>
        {d.insider_trades.length === 0 ? <Empty>No disclosed trades in the period.</Empty> : (
          <div className="wrap"><table><caption className="sr-only">Insider trades</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Person</th><th scope="col">Type</th><th scope="col">Shares</th><th scope="col">Value</th><th scope="col">Disclosed</th></tr></thead>
            <tbody>{d.insider_trades.map((t, i) => <tr key={i}><td>{formatDate(t.transaction_date)}</td><td>{t.person_category}</td><td>{t.transaction_type}</td><td>{fmt(t.shares, 'shares')}</td><td>{t.value_inr === null ? '—' : fmt(t.value_inr / 1e7, 'INR_cr')}</td><td>{dateOrDash(t.disclosed_at)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

export function Technical({ id }: { id: string }) {
  const [range, setRange] = useState(252);
  const [adjusted, setAdjusted] = useState(true);
  const p = useApi<{ basis_label: string; delay_label: string; series: { date: string; close: number; total_return: number | null; sma_50: number | null; sma_200: number | null; volume: number; evidence_id: string }[]; range_52w: { high: number; low: number; basis: string }; latest: { date: string; close: number; vol_20d: number | null; rsi_14: number | null; stale: boolean }; corporate_actions: { action_type: string; ex_date: string; ratio_num: number | null; ratio_den: number | null; cash_amount: number | null; notes: string | null }[] }>(`/v1/companies/${id}/prices?adjusted=${adjusted}`);
  const ser = useMemo(() => (p.data?.series ?? []).slice(-range), [p.data, range]);
  if (p.loading) return <Loading />;
  if (p.error) return <Problem error={p.error} retry={p.reload} />;
  const d = p.data!;
  const last = d.series[d.series.length - 1];
  return (
    <>
      <section className="card">
        <div className="row">
          {[['3M', 63], ['1Y', 252], ['3Y', 756], ['All', 100000]].map(([l, n]) => <button key={l} className="btn s" aria-pressed={range === n} onClick={() => setRange(n as number)}>{l}</button>)}
          <label><input type="checkbox" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} /> Adjusted for corporate actions</label>
        </div>
        <p className="mu">{d.basis_label} · {d.delay_label}{d.latest.stale && ' · data is stale'}</p>
        <div className="grid">
          <div><div className="mu">Close {formatDate(d.latest.date)}</div><div className="big"><Value v={d.latest.close} unit="INR" evidence={last?.evidence_id} surface="technical" /></div></div>
          <div><div className="mu">52-week range ({d.range_52w.basis})</div><div className="big">{fmt(d.range_52w.low, 'INR')} – {fmt(d.range_52w.high, 'INR')}</div></div>
          <div><div className="mu"><a href="/methodology/metrics/rsi_14">RSI (14)</a></div><div className="big">{fmt(d.latest.rsi_14)}</div></div>
          <div><div className="mu"><a href="/methodology/metrics/realised_vol_20d">20-day volatility</a></div><div className="big">{d.latest.vol_20d === null ? '—' : fmt(d.latest.vol_20d * 100, 'percent')}</div></div>
        </div>
        <LineChart title="Closing price with moving averages" yLabel="Price (₹)" series={[{ name: 'Close', points: ser.map((r) => ({ x: r.date, y: r.close })) }, { name: '50-day average', dashed: true, points: ser.map((r) => ({ x: r.date, y: r.sma_50 })) }, { name: '200-day average', dashed: true, points: ser.map((r) => ({ x: r.date, y: r.sma_200 })) }]} />
        <p className="mu">Technical indicators describe past prices. They are not signals to trade.</p>
      </section>
      <section className="card"><h2>Corporate actions</h2>
        {d.corporate_actions.length === 0 ? <Empty>None in the period.</Empty> : (
          <div className="wrap"><table><caption className="sr-only">Corporate actions</caption><thead><tr><th scope="col">Ex-date</th><th scope="col">Action</th><th scope="col">Detail</th></tr></thead>
            <tbody>{[...d.corporate_actions].reverse().map((a, i) => <tr key={i}><td>{formatDate(a.ex_date)}</td><td>{a.action_type}</td><td>{a.cash_amount !== null ? `${fmt(a.cash_amount, 'INR')} per share` : a.ratio_num !== null ? `${a.ratio_num}:${a.ratio_den}` : ''} {a.notes}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}

export function Disclosures({ id }: { id: string }) {
  const [category, setCategory] = useState('');
  const a = useApi<{ announcements: Announcement[]; latency_target: string }>(`/v1/companies/${id}/announcements${category ? `?category=${encodeURIComponent(category)}` : ''}`);
  const cats = ['Financial Results', 'Board Meeting', 'Shareholding', 'Corporate Action', 'Insider Trading / SAST', 'Credit Rating', 'Acquisition', 'Other'];
  return (
    <section className="card">
      <label>Category <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
      {a.loading ? <Loading /> : a.error ? <Problem error={a.error} retry={a.reload} /> : (
        <>
          <p className="mu">Target: {a.data!.latency_target}. Documents open in the original filed form.</p>
          {a.data!.announcements.length === 0 ? <Empty>No announcements.</Empty> : <ul>{a.data!.announcements.map((x) => <li key={x.announcement_id}><a href={x.document_url ?? '#'}>{x.subject}</a> <span className="mu">{x.category}{x.subcategory ? ` / ${x.subcategory}` : ''} · {dateOrDash(x.published_at)}</span></li>)}</ul>}
        </>
      )}
    </section>
  );
}

export function Peers({ id }: { id: string }) {
  const p = useApi<{ peers: { company_id: string; short_name: string; is_subject: boolean; fy_end_month: number; values: Record<string, Cell> }[]; metrics: string[]; alignment: string; median: Record<string, number | null>; warnings: string[] }>(`/v1/companies/${id}/peers`);
  if (p.loading) return <Loading />;
  if (p.error) return <Problem error={p.error} retry={p.reload} />;
  const d = p.data!;
  const units: Record<string, string> = { revenue_growth_yoy: 'percent', operating_margin: 'percent', roce: 'percent', roe: 'percent', debt_equity: 'ratio', pe_ttm: 'ratio', ev_ebitda: 'ratio', pb: 'ratio', net_margin: 'percent' };
  return (
    <section className="card">
      <p className="mu">{d.alignment}</p>
      {d.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
      <div className="wrap"><table><caption>Peer comparison</caption>
        <thead><tr><th scope="col">Company</th>{d.metrics.map((m) => <th key={m} scope="col"><a href={`/methodology/metrics/${m}`}>{m.replace(/_/g, ' ')}</a></th>)}</tr></thead>
        <tbody>
          {d.peers.map((r) => <tr key={r.company_id} style={r.is_subject ? { fontWeight: 600 } : undefined}><th scope="row">{r.is_subject ? r.short_name : <a href={`/app/companies/${r.company_id}?tab=peers`}>{r.short_name}</a>}{r.fy_end_month !== 3 && <span className="mu"> (FY ends month {r.fy_end_month})</span>}</th>
            {d.metrics.map((m) => { const c = r.values[m]; return <td key={m}>{c ? <Value v={c.value} unit={units[m]} missing={c.missing} evidence={c.evidence_id} surface="peers" /> : '—'}</td>; })}</tr>)}
          <tr><th scope="row">Peer median</th>{d.metrics.map((m) => <td key={m}>{fmt(d.median[m] ?? null, units[m])}</td>)}</tr>
        </tbody>
      </table></div>
      <p className="mu">Plus and Pro can edit and save the peer set.</p>
    </section>
  );
}
