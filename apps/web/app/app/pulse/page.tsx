'use client';
import { useEffect, useRef, useState } from 'react';
import { Loading, useApi } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { Scene3DFrame, useScene3D } from '@/components/scene3d';

interface Hist { series: { short: string; href: string; first: string; last: string; unit: string; high: { d: string; v: number }; low: { d: string; v: number }; moves: { short: string; href: string; date: string; prev_date: string; prev: number; value: number; change: number; kind: 'pct' | 'pp' }[] }[]; method: string }

/**
 * Move field: one column of particles per instrument. Height is the size of its move (scaled within the
 * group shown), gold rises and red falls, and switching group makes the particles flow to the new layout.
 * The particles carry the data: nothing moves that is not a measured change.
 */
function MoveField({ groups }: { groups: [string, Move[]][] }) {
  const host = useRef<HTMLDivElement>(null);
  const [g, setG] = useState(0);
  const ctl = useRef<{ show: (i: number) => void } | null>(null);
  const PER = 40;
  const { state, reset } = useScene3D(host, (api) => {
    const { THREE, scene } = api;
    const maxCols = Math.max(...groups.map((x) => Math.min(8, x[1].length)));
    const N = maxCols * PER;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const target = new Float32Array(N * 3), tcol = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(pts);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), new THREE.MeshBasicMaterial({ color: 0x1b2742, transparent: true, opacity: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const labels = Array.from({ length: maxCols }, () => api.label('', new THREE.Vector3(), 'net'));
    const up = new THREE.Color('#e7c27a'), dn = new THREE.Color('#e0646f');
    const layout = (i: number) => {
      const list = [...groups[i]![1]].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, maxCols);
      const max = Math.max(1e-9, ...list.map((m) => Math.abs(m.change)));
      for (let c = 0; c < maxCols; c++) {
        const m = list[c];
        const x = (c - (list.length - 1) / 2) * 1.6;
        const h = m ? 0.3 + (Math.abs(m.change) / max) * 4.2 : 0;
        for (let k = 0; k < PER; k++) {
          const n = (c * PER + k) * 3;
          const f = k / (PER - 1);
          const a = k * 2.399;
          const r = 0.28 * Math.sqrt((k % 10) / 10);
          target[n] = m ? x + Math.cos(a) * r : (Math.random() - 0.5) * 12;
          target[n + 1] = m ? (m.change >= 0 ? 1 : -1) * h * f : -6;
          target[n + 2] = m ? Math.sin(a) * r : (Math.random() - 0.5) * 4;
          const cc = (m && m.change >= 0 ? up : dn).clone().multiplyScalar(m ? 0.45 + 0.55 * f : 0);
          tcol[n] = cc.r; tcol[n + 1] = cc.g; tcol[n + 2] = cc.b;
        }
        const lbl = labels[c]!;
        lbl.setText(m ? `${m.label.length > 18 ? `${m.label.slice(0, 16)}…` : m.label} ${m.change >= 0 ? '+' : ''}${(m.change * 100).toFixed(1)}%` : '');
        lbl.el.style.opacity = m ? '1' : '0';
        lbl.moveTo(new THREE.Vector3(x, m ? (m.change >= 0 ? h + 0.45 : 0.45) : 0, 0));
      }
      const from = pos.slice(), cfrom = col.slice();
      let k = 0;
      api.animate((dt) => {
        k = Math.max(0, Math.min(1, k + dt / 1.1));
        const e = 1 - (1 - k) ** 3;
        for (let n = 0; n < pos.length; n++) { pos[n] = from[n]! + (target[n]! - from[n]!) * e; col[n] = cfrom[n]! + (tcol[n]! - cfrom[n]!) * e; }
        (geo.getAttribute('position') as InstanceType<typeof THREE.BufferAttribute>).needsUpdate = true;
        (geo.getAttribute('color') as InstanceType<typeof THREE.BufferAttribute>).needsUpdate = true;
        return k < 1;
      });
    };
    for (let n = 0; n < pos.length; n += 3) { pos[n] = (Math.random() - 0.5) * 14; pos[n + 1] = -5 + Math.random(); pos[n + 2] = (Math.random() - 0.5) * 4; }
    layout(0);
    ctl.current = { show: layout };
    return () => { ctl.current = null; };
  }, { height: 360, target: [0, 1.4, 0], distance: 13, yaw: -0.25, pitch: 0.22, minPitch: -0.2, zoom: [8, 20] });
  useEffect(() => { ctl.current?.show(g); }, [g, state]);
  return (
    <section className="card pulse-field" aria-labelledby="pf-h">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 id="pf-h">Move field</h2>
        <div className="seg" role="group" aria-label="Group">{groups.map(([t], i) => <button key={t} className={g === i ? 'on' : ''} aria-pressed={g === i} onClick={() => setG(i)}>{t === 'End of day' ? 'Indian indices' : t.startsWith('Delayed') ? 'Digital assets' : 'Commodities'}</button>)}</div>
      </div>
      <p className="mu">Each column is one instrument: height is the size of its move within this group, gold up, red down. {groups[g]?.[1][0] ? `Change over ${groups[g]![1][0]!.period}; ${groups[g]![0].toLowerCase()}.` : ''}</p>
      <Scene3DFrame state={state} onReset={reset} title="Move field" hint="Drag to turn · scroll to zoom" fallback={null}>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label="Move field in 3D. The same moves are listed in the cards below." style={{ height: 360 }} />
      </Scene3DFrame>
    </section>
  );
}

function History() {
  const h = useApi<Hist>('/v1/pulse/history');
  if (h.loading && !h.data) return <Loading lines={3} />;
  if (!h.data?.series.length) return null;
  const all = h.data.series.flatMap((s) => s.moves).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const fmtC = (m: { change: number; kind: string }) => (m.kind === 'pp' ? `${m.change >= 0 ? '+' : ''}${m.change.toFixed(2)} pp` : `${m.change >= 0 ? '+' : ''}${(m.change * 100).toFixed(1)}%`);
  const n = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
  return (
    <Reveal as="section" className="card pulse-wide pulse-history">
      <h2>In stored history <span className="t i">Historical</span></h2>
      <p className="mu">The largest single moves and the record highs and lows ATLAS has stored for key series. Found in the data, with exact dates.</p>
      <div className="ph-grid">
        <div>
          <h3>Largest single moves</h3>
          <ol className="pulse-timeline">{all.slice(0, 8).map((m, i) => <li key={m.short + m.date} style={{ ['--i' as string]: i }}><span className="pt-date">{m.date}</span><a href={m.href}>{m.short}</a><span className="pt-val"><span className={m.change >= 0 ? 'up' : 'dn'}>{fmtC(m)}</span> <span className="mu">{n(m.prev)} → {n(m.value)} (from {m.prev_date})</span></span></li>)}</ol>
        </div>
        <div>
          <h3>Record highs and lows</h3>
          <div className="wrap"><table className="term-table"><thead><tr><th scope="col" style={{ textAlign: 'left' }}>Series</th><th scope="col">Low</th><th scope="col">High</th><th scope="col">Stored since</th></tr></thead>
            <tbody>{h.data.series.map((s) => <tr key={s.short}><td style={{ textAlign: 'left' }}><a href={s.href}>{s.short}</a></td><td className="num">{n(s.low.v)}<br /><span className="mu">{s.low.d}</span></td><td className="num">{n(s.high.v)}<br /><span className="mu">{s.high.d}</span></td><td className="num">{s.first}</td></tr>)}</tbody></table></div>
        </div>
      </div>
      <p className="mu">{h.data.method}</p>
    </Reveal>
  );
}

// Market Pulse: what moved and what was published, from stored observations only. Every item states its
// timing (end of day, delayed, latest official observation); nothing here is live.

interface Attn { releases: { title: string; href: string; period: string; value: number; units: string | null; published: string }[]; moves: { title: string; href: string; date: string; value: number; unit: string; change: number }[] }
interface Eq { indices: { symbol: string; name: string | null; last_close: number | null; last_date: string | null; returns: Record<string, number | null> }[] }
interface Cr { majors: { canonical_key: string; name: string; price: number; change_24h_pct: number | null; provider_updated_at: string | null }[]; gainers?: { canonical_key: string; name: string; price: number | null; change_24h_pct: number | null }[]; losers?: { canonical_key: string; name: string; price: number | null; change_24h_pct: number | null }[] }
interface Move { label: string; href: string; change: number; period: string; when: string; timing: string }

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

export default function Pulse() {
  const at = useApi<Attn>('/v1/home/attention');
  const eq = useApi<Eq>('/v1/equity/market');
  const cr = useApi<Cr>('/v1/crypto/overview');
  const moves: Move[] = [];
  for (const i of eq.data?.indices ?? []) if (i.returns.d1 !== null && i.returns.d1 !== undefined) moves.push({ label: i.name ?? i.symbol, href: `/app/equities/INDEX/${i.symbol}`, change: i.returns.d1, period: '1 session', when: i.last_date ?? '', timing: 'End of day' });
  for (const m of at.data?.moves ?? []) moves.push({ label: m.title.replace(/ \(.*\)$/, ''), href: m.href, change: m.change, period: 'about 1 month', when: m.date, timing: 'Latest official observation' });
  const seen = new Set<string>();
  for (const a of [...(cr.data?.majors ?? []), ...(cr.data?.gainers ?? []).slice(0, 3), ...(cr.data?.losers ?? []).slice(0, 3)]) {
    if (a.change_24h_pct === null || seen.has(a.canonical_key)) continue;
    seen.add(a.canonical_key);
    moves.push({ label: a.name, href: `/app/crypto/assets/${a.canonical_key}`, change: a.change_24h_pct / 100, period: '24 hours', when: 'latest snapshot', timing: 'Delayed about 15 minutes' });
  }
  const groups: [string, Move[]][] = [['End of day', []], ['Delayed about 15 minutes', []], ['Latest official observation', []]];
  for (const m of moves) groups.find((g) => g[0] === m.timing)![1].push(m);
  const max = Math.max(0.01, ...moves.map((m) => Math.abs(m.change)));
  const loading = at.loading || eq.loading || cr.loading;
  return (
    <div className="pulse">
      <header className="uni-hd">
        <p className="eyebrow">Market Pulse</p>
        <h1>What moved, and what was published.</h1>
        <p className="mu">Stored observations only, grouped by how current they are. Periods differ between groups, so compare within a group, not across.</p>
      </header>
      {!loading && groups.filter((x) => x[1].length).length > 0 && <MoveField groups={groups.filter((x) => x[1].length)} />}
      {loading && !moves.length ? <Loading lines={6} /> : (
        <div className="pulse-grid">
          {groups.filter((g) => g[1].length).map(([timing, list], gi) => (
            <Reveal key={timing} as="section" delay={gi * 80} className="card pulse-card">
              <h2>{timing === 'End of day' ? 'Indian indices' : timing.startsWith('Delayed') ? 'Digital assets' : 'Commodities'} <span className="t i">{timing}</span></h2>
              <p className="mu">Change over {list[0]!.period}</p>
              <ul className="pulse-list">
                {[...list].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 8).map((m, i) => (
                  <li key={m.href} style={{ ['--i' as string]: i }}>
                    <a href={m.href}>{m.label}</a>
                    <span className={`pulse-v ${m.change >= 0 ? 'up' : 'dn'}`}>{pct(m.change)}</span>
                    <span className="pulse-bar"><i className={m.change >= 0 ? 'up' : 'dn'} style={{ ['--w' as string]: `${(Math.abs(m.change) / max) * 100}%` }} /></span>
                    <span className="mu pulse-when">{m.when}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
          <Reveal as="section" delay={240} className="card pulse-card pulse-wide">
            <h2>Economic releases <span className="t i">Latest official observation</span></h2>
            <p className="mu">Monthly and slower series that published new data in the last 7 days.</p>
            {at.data?.releases.length ? (
              <ol className="pulse-timeline">
                {at.data.releases.map((r, i) => (
                  <li key={r.href} style={{ ['--i' as string]: i }}>
                    <span className="pt-date">{r.published}</span>
                    <a href={r.href}>{r.title}</a>
                    <span className="pt-val">{r.value.toLocaleString('en-IN', { maximumFractionDigits: 3 })} <span className="mu">{r.units ?? ''} · for {r.period}</span></span>
                  </li>
                ))}
              </ol>
            ) : <p className="mu">No monthly or slower series published new data in the last 7 days.</p>}
          </Reveal>
        </div>
      )}
      <History />
      <p className="mu">Want the relationships behind the moves? <a href="/app/network">Open the Intelligence Network</a>.</p>
    </div>
  );
}
