'use client';
import { useEffect, useState } from 'react';
import { api, download } from '@/lib/api';
import { useApp } from '@/components/providers';
import { Loading, Problem, useApi, Value } from '@/components/ui';
import { fmt } from '@/lib/format';

interface FieldDef { code: string; name: string; category: string; unit: string; description: string; formula: string; templates: string[]; definition_url: string; lesson: string | null }
interface Filter { field: string; op: 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'eq'; value: number; value2?: number }
interface Def { filters: Filter[]; sectors: string[]; templates: string[]; columns?: string[]; sort?: { field: string; dir: 'asc' | 'desc' }; limit: number; offset: number }
interface Result { as_of: string; total: number; rows: { company_id: string; short_name: string; sector: string; industry: string; values: Record<string, { value: number | null; missing: string | null; evidence_id?: string }> }[]; columns: string[]; definitions: { code: string; name: string; unit: string; url: string; data_date: string }[]; missing_rule: string; ms: number }

const OPS: [Filter['op'], string][] = [['gte', '≥'], ['gt', '>'], ['lte', '≤'], ['lt', '<'], ['between', 'between'], ['eq', '=']];
const SECTORS = ['IT', 'FMCG', 'Auto', 'Pharma', 'Banks', 'NBFC', 'Metals', 'Capital Goods', 'Chemicals', 'Retail', 'Utilities', 'Materials', 'Insurance', 'Telecom'];

export default function Screener() {
  const { me, toast } = useApp();
  const meta = useApi<{ max_filters: number; fields: FieldDef[]; templates: { id: string; name: string; description: string; definition: Partial<Def> }[] }>('/v1/screener/fields');
  const saved = useApi<{ limit: number; screens: { screen_id: string; name: string; definition: Def; updated_at: string }[] }>('/v1/screens');
  const [def, setDef] = useState<Def>({ filters: [{ field: 'roce', op: 'gte', value: 15 }], sectors: [], templates: [], limit: 50, offset: 0 });
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('screen');
    const s = saved.data?.screens.find((x) => x.screen_id === id);
    if (s) setDef({ ...s.definition, offset: 0 });
  }, [saved.data]);
  const run = async (d: Def = def) => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api<Result>('/v1/screener/run', { body: d }));
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };
  if (meta.loading) return <Loading lines={6} />;
  if (meta.error) return <Problem error={meta.error} retry={meta.reload} />;
  const fields = meta.data!.fields;
  const byCode = new Map(fields.map((f) => [f.code, f]));
  const cats = [...new Set(fields.map((f) => f.category))];
  const setFilter = (i: number, f: Partial<Filter>) => setDef({ ...def, filters: def.filters.map((x, k) => (k === i ? { ...x, ...f } : x)) });
  const max = meta.data!.max_filters;
  return (
    <>
      <h1>Screener</h1>
      <p className="mu">Filter the covered universe on published definitions. Results describe data; they are not a list of recommendations.</p>
      <div className="grid2">
        <section className="card stack" aria-labelledby="flt">
          <h2 id="flt">Filters {max > 0 && <span className="mu">({def.filters.length} of {max})</span>}</h2>
          {def.filters.map((f, i) => {
            const fd = byCode.get(f.field);
            return (
              <div key={i} className="row" role="group" aria-label={`Filter ${i + 1}`}>
                <select aria-label="Measure" value={f.field} onChange={(e) => setFilter(i, { field: e.target.value })}>{cats.map((c) => <optgroup key={c} label={c}>{fields.filter((x) => x.category === c).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</optgroup>)}</select>
                <select aria-label="Operator" value={f.op} onChange={(e) => setFilter(i, { op: e.target.value as Filter['op'] })}>{OPS.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
                <input aria-label="Value" type="number" step="any" value={f.value} onChange={(e) => setFilter(i, { value: Number(e.target.value) })} style={{ width: 100 }} />
                {f.op === 'between' && <input aria-label="Upper value" type="number" step="any" value={f.value2 ?? ''} onChange={(e) => setFilter(i, { value2: Number(e.target.value) })} style={{ width: 100 }} />}
                <span className="mu">{fd?.unit === 'percent' ? '%' : fd?.unit === 'INR_cr' ? '₹ cr' : fd?.unit === 'ratio' ? '×' : ''}</span>
                {fd && <a href={fd.definition_url} title={fd.formula}>definition</a>}
                <button className="link" aria-label="Remove filter" onClick={() => setDef({ ...def, filters: def.filters.filter((_, k) => k !== i) })}>Remove</button>
              </div>
            );
          })}
          <div className="row">
            <button className="btn s" disabled={max > 0 && def.filters.length >= max} onClick={() => setDef({ ...def, filters: [...def.filters, { field: 'debt_equity', op: 'lte', value: 1 }] })}>Add filter</button>
            {max > 0 && def.filters.length >= max && <span className="mu">Your plan allows {max} filters. <a href="/pricing">Compare plans</a></span>}
          </div>
          <fieldset style={{ border: 0, padding: 0 }}><legend>Sectors (none = all)</legend>
            <div className="row">{SECTORS.map((s) => <label key={s}><input type="checkbox" checked={def.sectors.includes(s)} onChange={(e) => setDef({ ...def, sectors: e.target.checked ? [...def.sectors, s] : def.sectors.filter((x) => x !== s) })} /> {s}</label>)}</div>
          </fieldset>
          <div className="row">
            <button className="btn" onClick={() => run()} disabled={busy}>{busy ? 'Running…' : 'Run screen'}</button>
            <input aria-label="Screen name" placeholder="Name to save" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <button className="btn s" disabled={!name.trim()} onClick={async () => { try { await api('/v1/screens', { body: { name, definition: def } }); toast('Screen saved'); saved.reload(); setName(''); } catch (e) { setErr(e as Error); } }}>Save</button>
            <button className="btn s" title={me?.entitlements.csv_export ? undefined : 'CSV export is part of Plus and Pro'} onClick={async () => { try { await download('/v1/screener/export', def, 'atlas-screen.csv'); } catch (e) { setErr(e as Error); } }}>Export CSV</button>
          </div>
          <Problem error={err} />
        </section>
        <aside className="card"><h2>Start from a template</h2>
          <ul>{meta.data!.templates.map((t) => <li key={t.id}><button className="link" onClick={() => { const d = { ...def, filters: t.definition.filters ?? [], templates: t.definition.templates ?? [], columns: t.definition.columns, offset: 0 }; setDef(d); void run(d); }}>{t.name}</button><br /><span className="mu">{t.description}</span></li>)}</ul>
          <h2>Saved screens</h2>
          {saved.data?.screens.length ? <ul>{saved.data.screens.map((s) => <li key={s.screen_id}><button className="link" onClick={() => { setDef({ ...s.definition, offset: 0 }); void run({ ...s.definition, offset: 0 }); }}>{s.name}</button> <button className="link mu" aria-label={`Delete ${s.name}`} onClick={async () => { await api(`/v1/screens/${s.screen_id}`, { method: 'DELETE' }); saved.reload(); }}>×</button></li>)}</ul> : <p className="mu">None yet{saved.data ? ` (up to ${saved.data.limit} on your plan)` : ''}.</p>}
        </aside>
      </div>
      {res && (
        <section className="card" aria-live="polite">
          <h2>{res.total} {res.total === 1 ? 'company' : 'companies'} match</h2>
          <p className="mu">Data as of {res.as_of}. {res.missing_rule} · {res.ms} ms</p>
          <div className="wrap"><table><caption className="sr-only">Screen results</caption>
            <thead><tr><th scope="col">Company</th><th scope="col">Sector</th>{res.definitions.map((d) => <th key={d.code} scope="col"><button className="link" onClick={() => { const nd = { ...def, sort: { field: d.code, dir: def.sort?.field === d.code && def.sort.dir === 'desc' ? 'asc' as const : 'desc' as const }, offset: 0 }; setDef(nd); void run(nd); }} aria-label={`Sort by ${d.name}`}>{d.name}{def.sort?.field === d.code ? (def.sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</button></th>)}</tr></thead>
            <tbody>{res.rows.map((r) => <tr key={r.company_id}><th scope="row"><a href={`/app/companies/${r.company_id}`}>{r.short_name}</a></th><td>{r.sector}</td>{res.definitions.map((d) => { const c = r.values[d.code]; return <td key={d.code}>{c ? <Value v={c.value} unit={d.unit} missing={c.missing} evidence={c.evidence_id} surface="screener" /> : '—'}</td>; })}</tr>)}</tbody>
          </table></div>
          {res.total > def.limit && (
            <div className="row">
              <button className="btn s" disabled={def.offset === 0} onClick={() => { const nd = { ...def, offset: Math.max(0, def.offset - def.limit) }; setDef(nd); void run(nd); }}>Previous</button>
              <span className="mu">{def.offset + 1}–{Math.min(def.offset + def.limit, res.total)} of {fmt(res.total, 'count')}</span>
              <button className="btn s" disabled={def.offset + def.limit >= res.total} onClick={() => { const nd = { ...def, offset: def.offset + def.limit }; setDef(nd); void run(nd); }}>Next</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
