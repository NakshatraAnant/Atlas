'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as ThreeNS from 'three';
import { Scene3DFrame, useScene3D } from '@/components/scene3d';
import { Loading, Problem, useApi } from '@/components/ui';

// Intelligence Network: stored series as nodes, correlation of weekly changes as edges (API: /v1/network).
// Gold edges moved together, blue edges moved opposite; brightness is strength. Method, window and n are shown.

interface NNode { key: string; label: string; short: string; group: string; units: string; source: string; href: string; timing: string; latest: { d: string; v: number } }
interface NEdge { a: string; b: string; r: number; n: number }
interface Net { window: string; from: string; to: string; nodes: NNode[]; edges: NEdge[]; not_stored: string[]; method: string; caveats: string[] }

const GROUPS: Record<string, { label: string; colour: string; at: [number, number, number] }> = {
  india: { label: 'Indian indices', colour: '#e7c27a', at: [0, 2.2, 0] },
  rates: { label: 'US rates', colour: '#7fb2ec', at: [-5, 0.4, 1.5] },
  fx: { label: 'Currencies', colour: '#5fd0d8', at: [-2.4, -1.6, -4.2] },
  conditions: { label: 'Financial conditions', colour: '#c9d3e4', at: [3, -1.8, -4] },
  energy: { label: 'Energy', colour: '#f0a35e', at: [5, 0.6, 1.6] },
  crypto: { label: 'Digital assets', colour: '#c3a3ef', at: [0, -0.4, 5] },
};

function place(nodes: NNode[]): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  for (const g of Object.keys(GROUPS)) {
    const mine = nodes.filter((n) => n.group === g);
    mine.forEach((n, i) => {
      const a = (i / Math.max(1, mine.length)) * 6.2832 + 0.6;
      const r = mine.length > 1 ? 1.25 : 0;
      const c = GROUPS[g]!.at;
      out.set(n.key, [c[0] + Math.cos(a) * r, c[1] + ((i % 2) - 0.5) * 0.9, c[2] + Math.sin(a) * r]);
    });
  }
  return out;
}

function Graph({ net, edges, sel, onSelect }: { net: Net; edges: NEdge[]; sel: string | null; onSelect: (k: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<{ update: (e: NEdge[], s: string | null) => void } | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const pos = useMemo(() => place(net.nodes), [net.nodes]);
  const { state, reset } = useScene3D(host, (api) => {
    const { THREE, scene } = api;
    const root = new THREE.Group();
    scene.add(root);
    const items = net.nodes.map((n) => {
      const p = pos.get(n.key)!;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshStandardMaterial({ color: GROUPS[n.group]?.colour ?? '#fff', emissive: GROUPS[n.group]?.colour ?? '#fff', emissiveIntensity: 0.55, roughness: 0.4 }));
      mesh.position.set(...p);
      mesh.userData.key = n.key;
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(mesh.position);
      hit.userData.key = n.key;
      root.add(mesh, hit);
      return { n, mesh, hit, label: api.label(n.short, mesh.position.clone().add(new THREE.Vector3(0, 0.42, 0)), 'net') };
    });
    let lines: ThreeNS.LineSegments | null = null;
    const gold = new THREE.Color('#e7c27a'), blue = new THREE.Color('#5a9cf0');
    let current: NEdge[] = [];
    let selected: string | null = null;
    const draw = () => {
      if (lines) { lines.geometry.dispose(); root.remove(lines); }
      const v: number[] = [], c: number[] = [];
      const linked = new Set<string>();
      for (const e of current) {
        const on = !selected || e.a === selected || e.b === selected;
        if (selected && on) { linked.add(e.a); linked.add(e.b); }
        const a = pos.get(e.a), b = pos.get(e.b);
        if (!a || !b) continue;
        const k = (on ? 0.25 + 0.75 * Math.abs(e.r) : 0.04);
        const col = (e.r >= 0 ? gold : blue).clone().multiplyScalar(k);
        v.push(...a, ...b); c.push(col.r, col.g, col.b, col.r, col.g, col.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      root.add(lines);
      for (const it of items) {
        const on = !selected || it.n.key === selected || linked.has(it.n.key);
        it.mesh.scale.setScalar(it.n.key === selected ? 1.7 : on ? 1 : 0.7);
        (it.mesh.material as ThreeNS.MeshStandardMaterial).emissiveIntensity = on ? 0.6 : 0.08;
        it.label.el.style.opacity = on ? '1' : '0.25';
        it.label.el.classList.toggle('on', it.n.key === selected);
      }
      api.invalidate();
    };
    ctl.current = { update: (e, s) => { current = e; selected = s; draw(); } };
    // Slow turn while nothing is selected; labels follow.
    const w = new THREE.Vector3();
    if (!api.reducedMotion) api.animate((dt) => {
      if (!selected) root.rotation.y += dt * 0.05;
      for (const it of items) { it.mesh.getWorldPosition(w); it.label.moveTo(w.clone().add(new THREE.Vector3(0, 0.42, 0))); }
      return true;
    });
    const ray = new THREE.Raycaster();
    api.onClick((ndc) => {
      ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), api.camera);
      const h = ray.intersectObjects(items.map((i) => i.hit), false)[0];
      pick.current(h ? (h.object.userData.key as string) : null);
    });
    return () => { ctl.current = null; };
  }, { height: 480, target: [0, 0, 0], distance: 17, yaw: 0.5, pitch: 0.35, minPitch: -0.6, zoom: [9, 26] });
  useEffect(() => { ctl.current?.update(edges, sel); }, [edges, sel, state]);
  return (
    <Scene3DFrame state={state} onReset={() => { reset(); onSelect(null); }} title="Intelligence network" hint="Drag to turn · scroll to zoom · click a node" fallback={null}>
      <div ref={host} className="scene3d-host" tabIndex={0} aria-label="Intelligence network in 3D. The same relationships are listed in the panel and table." style={{ height: 480 }} />
    </Scene3DFrame>
  );
}

export default function Network() {
  const [win, setWin] = useState('1y');
  const [min, setMin] = useState(0.4);
  const [sel, setSel] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const d = useApi<Net>(`/v1/network?window=${win}`, [win]);
  const net = d.data;
  const edges = useMemo(() => (net?.edges ?? []).filter((e) => Math.abs(e.r) >= min && (!groups.length || [e.a, e.b].some((k) => groups.includes(net!.nodes.find((n) => n.key === k)?.group ?? '')))), [net, min, groups]);
  const node = net?.nodes.find((n) => n.key === sel) ?? null;
  const links = node ? (net?.edges ?? []).filter((e) => e.a === node.key || e.b === node.key).sort((a, b) => Math.abs(b.r) - Math.abs(a.r)) : [];
  const name = (k: string) => net?.nodes.find((n) => n.key === k)?.short ?? k;
  return (
    <div className="netpage">
      <header className="uni-hd">
        <p className="eyebrow">Intelligence Network</p>
        <h1>See how markets moved together.</h1>
        <p className="mu">Each line is a measured correlation of weekly changes between two stored series. <span className="lg gold">Gold</span> moved together, <span className="lg blue">blue</span> moved opposite; brighter is stronger. Correlation is not causation.</p>
      </header>
      <div className="net-controls">
        <div className="seg" role="group" aria-label="Time window">{['1y', '3y', '5y'].map((w) => <button key={w} className={win === w ? 'on' : ''} aria-pressed={win === w} onClick={() => { setWin(w); }}>{w === '1y' ? '1 year' : `${w[0]} years`}</button>)}</div>
        <label className="net-min">Show |correlation| ≥ <strong>{min.toFixed(2)}</strong><input type="range" min={0} max={0.9} step={0.05} value={min} onChange={(e) => setMin(Number(e.target.value))} /></label>
        <div className="net-groups" role="group" aria-label="Filter by group">{Object.entries(GROUPS).map(([g, v]) => <button key={g} className={`chip${groups.includes(g) ? ' on' : ''}`} aria-pressed={groups.includes(g)} onClick={() => setGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g])}><i style={{ background: v.colour }} />{v.label}</button>)}</div>
      </div>
      {d.loading && !net ? <Loading lines={6} label="Calculating relationships" /> : d.error ? <Problem error={d.error} retry={d.reload} /> : net && (
        <div className="uni-grid">
          <div className="uni-globe"><Graph key={net.window} net={net} edges={edges} sel={sel} onSelect={setSel} /></div>
          <aside className="uni-panel" aria-live="polite">
            {!node ? (
              <div>
                <h2>{net.nodes.length} series · {edges.length} relationships shown</h2>
                <p className="mu">{net.from} to {net.to}. Select a node to see what it moved with.</p>
                <ul className="uni-quick">{net.nodes.map((n) => <li key={n.key}><button className="link" onClick={() => setSel(n.key)}>{n.short}</button><span className="mu"> · {GROUPS[n.group]?.label}</span></li>)}</ul>
                {net.not_stored.length > 0 && <p className="mu">Not stored, so not shown: {net.not_stored.join(', ')}.</p>}
              </div>
            ) : (
              <div className="uni-detail" key={node.key}>
                <h2>{node.short}</h2>
                <p className="mu">{node.label} · {node.source}</p>
                <p className="net-latest"><strong>{node.latest.v.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</strong> <span className="mu">{node.units} · {node.latest.d} · {node.timing}</span></p>
                <h3>Moved most closely with</h3>
                {links.length ? <ul className="net-links">{links.slice(0, 8).map((e) => { const o = e.a === node.key ? e.b : e.a; return <li key={o}><button className="link" onClick={() => setSel(o)}>{name(o)}</button><span className={`net-r ${e.r >= 0 ? 'pos' : 'neg'}`}>{e.r >= 0 ? '+' : ''}{e.r.toFixed(2)}</span><span className="mu">n = {e.n} weeks</span><span className="net-bar"><i className={e.r >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.abs(e.r) * 100}%` }} /></span></li>; })}</ul> : <p className="mu">No pair has 26 shared weeks in this window.</p>}
                <p><a className="btn btn-cta" href={node.href}>Open {node.short} <span aria-hidden="true">→</span></a> <a className="btn s" href="/app/macro/explorer">Compare two series</a></p>
              </div>
            )}
            <details className="uni-missing"><summary>Method and limits</summary><p>{net.method}</p><ul>{net.caveats.map((c) => <li key={c}>{c}</li>)}</ul></details>
          </aside>
        </div>
      )}
      {net && (
        <details className="chart3d-table"><summary>All relationships as a table ({edges.length})</summary>
          <div className="wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="term-table"><caption>Correlation of weekly changes, {net.from} to {net.to}</caption>
            <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Series</th><th scope="col" style={{ textAlign: 'left' }}>Series</th><th scope="col">Correlation</th><th scope="col">Weeks</th></tr></thead>
            <tbody>{[...edges].sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).map((e) => <tr key={e.a + e.b}><td style={{ textAlign: 'left' }}>{name(e.a)}</td><td style={{ textAlign: 'left' }}>{name(e.b)}</td><td className="num">{e.r.toFixed(2)}</td><td className="num">{e.n}</td></tr>)}</tbody>
          </table></div>
        </details>
      )}
    </div>
  );
}
