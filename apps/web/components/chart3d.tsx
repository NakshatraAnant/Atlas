'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type * as ThreeNS from 'three';
import { Scene3DFrame, useScene3D } from './scene3d';
import { Loading, Problem, useApi } from './ui';

// 3D chart analysis for the Academy. One engine draws every surface: a lit mesh (cells with a missing
// corner stay open, never filled), ridgelines per row, a zero plane for signed values, labelled axes, a
// cursor you move by hovering or with the sliders (keyboard and screen-reader friendly), a rise-in
// animation and a smooth morph when a second grid (for example out-of-sample) is shown. Without WebGL,
// or with reduced motion, the same numbers are in the table and the CSV.

export interface Grid3D {
  id: string;
  title: string;
  x: { title: string; labels: string[] };
  z: { title: string; labels: string[] };
  y: { title: string; unit: string };
  values: (number | null)[][];
  compare?: { title: string; values: (number | null)[][] };
  colour: 'diverging' | 'sequential';
  facts: { label: string; value: string }[];
  method: string;
  source: { name: string; series: string[]; first: string | null; last: string | null; note: string };
}

const W = 10;
const D = 10;
const H = 4;

function fmtVal(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'no data';
  if (unit === '%') return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  // Indian digit grouping (1,383; 1,23,456) so large values read at a glance.
  const s = v.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2, minimumFractionDigits: Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2 });
  return unit ? `${s} ${unit}` : s;
}

/** Colour for a value: diverging (red · slate · green around zero) or sequential (deep blue → sky → gold). */
function colourOf(THREE: typeof ThreeNS, v: number, lo: number, hi: number, mode: 'diverging' | 'sequential'): ThreeNS.Color {
  if (mode === 'diverging') {
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const k = Math.min(1, Math.abs(v) / m);
    const base = new THREE.Color('#3a4458');
    return base.lerp(new THREE.Color(v >= 0 ? '#47b07a' : '#e0646f'), 0.25 + 0.75 * k);
  }
  const t = (v - lo) / (hi - lo || 1);
  const a = new THREE.Color('#25406b');
  const b = new THREE.Color('#7fb2ec');
  const c = new THREE.Color('#d9b56c');
  return t < 0.5 ? a.lerp(b, t * 2) : b.lerp(c, (t - 0.5) * 2);
}

interface Controls { setCursor: (i: number, j: number) => void; morph: (values: (number | null)[][]) => void }

export function Surface3D({ grid, mode = 'surface', height = 380 }: { grid: Grid3D; mode?: 'surface' | 'bars'; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<Controls | null>(null);
  const R = grid.z.labels.length;
  const C = grid.x.labels.length;
  const [showCompare, setShowCompare] = useState(false);
  const values = showCompare && grid.compare ? grid.compare.values : grid.values;
  // Start the cursor on the most recent row and the middle column.
  const [cur, setCur] = useState<[number, number]>([R - 1, Math.floor(C / 2)]);
  const rowId = useId();
  const all = useMemo(() => [...grid.values.flat(), ...(grid.compare?.values.flat() ?? [])].filter((v): v is number => v !== null && Number.isFinite(v)), [grid]);
  const lo = Math.min(...all, grid.colour === 'diverging' ? 0 : Infinity);
  const hi = Math.max(...all, grid.colour === 'diverging' ? 0 : -Infinity);

  const { state, reset } = useScene3D(host, (api) => {
    const { THREE, scene } = api;
    const yOf = (v: number) => ((v - lo) / (hi - lo || 1)) * H;
    const xOf = (j: number) => (C === 1 ? 0 : -W / 2 + (j / (C - 1)) * W);
    const zOf = (i: number) => (R === 1 ? 0 : -D / 2 + (i / (R - 1)) * D);
    // Bars sit at cell centres.
    const xb = (j: number) => -W / 2 + (j + 0.5) * (W / C);
    const zb = (i: number) => -D / 2 + (i + 0.5) * (D / R);
    const group = new THREE.Group();
    scene.add(group);

    // Base: outline, a few guide lines, and the zero plane for signed values.
    const baseMat = new THREE.LineBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.6 });
    const pts: number[] = [];
    for (let k = 0; k <= 4; k++) { const z = -D / 2 + (k / 4) * D; pts.push(-W / 2, 0, z, W / 2, 0, z); const x = -W / 2 + (k / 4) * W; pts.push(x, 0, -D / 2, x, 0, D / 2); }
    pts.push(-W / 2, 0, -D / 2, -W / 2, H, -D / 2);
    const base = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), baseMat);
    group.add(base);
    if (grid.colour === 'diverging' && lo < 0 && hi > 0) {
      const zp = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: 0x9aa6b8, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      zp.rotation.x = -Math.PI / 2;
      zp.position.y = yOf(0);
      group.add(zp);
    }

    // Data: a surface mesh (or bars) plus ridgelines, both rebuilt from `heights` while morphing.
    let current = values.map((r) => r.map((v) => (v === null || !Number.isFinite(v) ? null : v)));
    let mesh: ThreeNS.Mesh | null = null;
    let ridges: ThreeNS.LineSegments | null = null;
    const bars: ThreeNS.Mesh[] = [];
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(R * C * 3);
    const col = new Float32Array(R * C * 3);
    const draw = (vals: (number | null)[][]) => {
      if (mode === 'bars') {
        let k = 0;
        vals.forEach((row, i) => row.forEach((v, j) => {
          let b = bars[k];
          if (!b) {
            b = new THREE.Mesh(new THREE.BoxGeometry((W / Math.max(1, C)) * 0.72, 1, (D / Math.max(1, R)) * 0.72), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 }));
            bars.push(b);
            group.add(b);
          }
          const h = v === null ? 0.001 : Math.max(0.02, yOf(v));
          b.visible = v !== null;
          b.scale.y = h;
          b.position.set(xb(j), h / 2, zb(i));
          if (v !== null) (b.material as ThreeNS.MeshStandardMaterial).color.copy(colourOf(THREE, v, lo, hi, grid.colour));
          k++;
        }));
        return;
      }
      vals.forEach((row, i) => row.forEach((v, j) => {
        const n = (i * C + j) * 3;
        pos[n] = xOf(j); pos[n + 1] = v === null ? 0 : yOf(v); pos[n + 2] = zOf(i);
        const c = colourOf(THREE, v ?? 0, lo, hi, grid.colour);
        col[n] = c.r; col[n + 1] = c.g; col[n + 2] = c.b;
      }));
      if (!mesh) {
        const idx: number[] = [];
        for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
          const a = i * C + j, b = a + 1, c = a + C, d = c + 1;
          // A cell is drawn only when all four corners have data: missing data stays an open gap.
          if ([a, b, c, d].every((q) => vals[Math.floor(q / C)]![q % C] !== null)) idx.push(a, c, b, b, c, d);
        }
        geo.setIndex(idx);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.94 }));
        group.add(mesh);
      }
      (geo.getAttribute('position') as ThreeNS.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('color') as ThreeNS.BufferAttribute).needsUpdate = true;
      geo.computeVertexNormals();
      // Ridgelines along each row (thin, light): the eye reads them as a stack of curves.
      const lp: number[] = [];
      const stepRows = Math.max(1, Math.ceil(R / 60));
      for (let i = 0; i < R; i += stepRows) for (let j = 0; j < C - 1; j++) {
        const a = vals[i]![j], b = vals[i]![j + 1];
        if (a === null || b === null) continue;
        lp.push(xOf(j), yOf(a) + 0.01, zOf(i), xOf(j + 1), yOf(b) + 0.01, zOf(i));
      }
      if (ridges) { ridges.geometry.dispose(); group.remove(ridges); }
      ridges = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)), new THREE.LineBasicMaterial({ color: 0xe8edf5, transparent: true, opacity: R > 60 ? 0.18 : 0.32 }));
      group.add(ridges);
    };
    draw(current);

    // Axis titles and a few tick labels (HTML: sharp and readable at any angle).
    api.label(grid.x.title, new THREE.Vector3(0, 0, D / 2 + 1.3), 'axis');
    api.label(grid.z.title, new THREE.Vector3(W / 2 + 1.9, 0, 0), 'axis');
    api.label(`${grid.y.title}${grid.y.unit && grid.y.unit !== '%' ? ` (${grid.y.unit})` : ''}`, new THREE.Vector3(-W / 2 - 0.4, H + 0.7, -D / 2), 'axis');
    api.label(fmtVal(hi, grid.y.unit), new THREE.Vector3(-W / 2 - 0.6, H, -D / 2), 'tick');
    api.label(fmtVal(lo, grid.y.unit), new THREE.Vector3(-W / 2 - 0.6, 0, -D / 2), 'tick');
    const ticks = (n: number) => [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    const tickJ = mode === 'bars' ? [...Array(C).keys()] : ticks(C);
    const tickI = mode === 'bars' ? [...Array(R).keys()] : ticks(R);
    for (const j of tickJ) api.label(grid.x.labels[j]!, new THREE.Vector3(mode === 'bars' ? xb(j) : xOf(j), 0, D / 2 + 0.55), 'tick');
    for (const i of tickI) api.label(grid.z.labels[i]!, new THREE.Vector3(W / 2 + 0.7, 0, mode === 'bars' ? zb(i) : zOf(i)), 'tick');

    // Cursor: a marker, a drop line to the floor and a value label.
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.12, gapSize: 0.08 }));
    group.add(marker, drop);
    const tag = api.label('', new THREE.Vector3(), 'cursor');
    let ci = cur[0], cj = cur[1];
    const placeCursor = () => {
      const v = current[ci]?.[cj] ?? null;
      const p = new THREE.Vector3(mode === 'bars' ? xb(cj) : xOf(cj), v === null ? 0 : yOf(v) + (mode === 'bars' ? 0.2 : 0.05), mode === 'bars' ? zb(ci) : zOf(ci));
      marker.position.copy(p);
      drop.geometry.setFromPoints([p, new THREE.Vector3(p.x, 0, p.z)]);
      drop.computeLineDistances();
      tag.moveTo(p.clone().add(new THREE.Vector3(0, 0.55, 0)));
      tag.setText(fmtVal(v, grid.y.unit));
      // Exposed for automated checks: the value and height the 3D cursor is drawn at.
      host.current?.setAttribute('data-cursor', `${v ?? ''}|${p.y.toFixed(3)}`);
      api.invalidate();
    };
    placeCursor();

    // Rise-in, then morph between grids with an ease-in-out.
    group.scale.y = 0.001;
    let t0 = 0;
    api.animate((dt) => { t0 = Math.max(0, Math.min(1, t0 + dt / 1.1)); group.scale.y = Math.max(0.001, 1 - (1 - t0) ** 3); return t0 < 1; });
    ctl.current = {
      setCursor: (i, j) => { ci = i; cj = j; placeCursor(); },
      morph: (next) => {
        const from = current.map((r) => [...r]);
        const to = next.map((r) => r.map((v) => (v === null || !Number.isFinite(v) ? null : v)));
        let k = 0;
        api.animate((dt) => {
          k = Math.max(0, Math.min(1, k + dt / 0.8));
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out, 0 → 1
          current = to.map((r, i) => r.map((v, j) => (v === null || from[i]![j] === null ? v : from[i]![j]! + (v - from[i]![j]!) * e)));
          draw(current);
          placeCursor();
          return k < 1;
        });
      },
    };

    // Hover picks the nearest grid point (only while not dragging to orbit).
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const el = host.current!;
    let pending = false;
    const onHover = (e: PointerEvent) => {
      if (e.buttons || pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const r = el.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, api.camera);
        const hit = ray.intersectObjects(mode === 'bars' ? bars : mesh ? [mesh] : [], false)[0];
        if (!hit) return;
        let i: number, j: number;
        if (mode === 'bars') { const k = bars.indexOf(hit.object as ThreeNS.Mesh); i = Math.floor(k / C); j = k % C; }
        else { j = Math.round(((hit.point.x + W / 2) / W) * (C - 1)); i = Math.round(((hit.point.z + D / 2) / D) * (R - 1)); }
        if (i >= 0 && i < R && j >= 0 && j < C) setCur([i, j]);
      });
    };
    el.addEventListener('pointermove', onHover);
    return () => { el.removeEventListener('pointermove', onHover); ctl.current = null; };
  }, { height, target: [0, H / 2, 0], distance: 19, yaw: -0.65, pitch: 0.5 });

  useEffect(() => { ctl.current?.setCursor(cur[0], cur[1]); }, [cur]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } ctl.current?.morph(values); }, [values]);

  const v = values[cur[0]]?.[cur[1]] ?? null;
  return (
    <div className="chart3d">
      {grid.compare && (
        <div className="seg" role="group" aria-label="Which results to show">
          <button className={!showCompare ? 'on' : ''} aria-pressed={!showCompare} onClick={() => setShowCompare(false)}>In-sample</button>
          <button className={showCompare ? 'on' : ''} aria-pressed={showCompare} onClick={() => setShowCompare(true)}>{grid.compare.title}</button>
        </div>
      )}
      <Scene3DFrame state={state} onReset={reset} title={`${grid.title}: 3D chart. The same values are in the table below.`} hint="Drag or use the arrow keys to turn it · hover to read a point · Home resets"
        fallback={<GridTable grid={grid} values={values} />}>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label={`${grid.title}. 3D view; use the sliders below to read values.`} style={{ height }} />
      </Scene3DFrame>
      <div className="chart3d-cursor" aria-live="polite">
        <label htmlFor={`${rowId}-z`}>{grid.z.title}: <strong>{grid.z.labels[cur[0]]}</strong></label>
        <input id={`${rowId}-z`} type="range" min={0} max={R - 1} value={cur[0]} onChange={(e) => setCur([Number(e.target.value), cur[1]])} />
        <label htmlFor={`${rowId}-x`}>{grid.x.title}: <strong>{grid.x.labels[cur[1]]}</strong></label>
        <input id={`${rowId}-x`} type="range" min={0} max={C - 1} value={cur[1]} onChange={(e) => setCur([cur[0], Number(e.target.value)])} />
        <p className="chart3d-readout">{grid.y.title}: <strong className={grid.colour === 'diverging' && v !== null ? (v >= 0 ? 'up' : 'dn') : ''}>{fmtVal(v, grid.y.unit)}</strong>{grid.compare && <span className="mu"> ({showCompare ? grid.compare.title.toLowerCase() : 'in-sample'})</span>}</p>
      </div>
    </div>
  );
}

/** Table with the same numbers (sampled when large; the CSV always has every cell). */
function GridTable({ grid, values }: { grid: Grid3D; values: (number | null)[][] }) {
  const R = grid.z.labels.length;
  const C = grid.x.labels.length;
  const rs = Math.max(1, Math.ceil(R / 18));
  const cs = Math.max(1, Math.ceil(C / 13));
  const rows = Array.from({ length: Math.ceil(R / rs) }, (_, k) => Math.min(R - 1, k * rs));
  if (rows[rows.length - 1] !== R - 1) rows.push(R - 1);
  const cols = Array.from({ length: Math.ceil(C / cs) }, (_, k) => Math.min(C - 1, k * cs));
  const csv = () => {
    const lines = [[`${grid.z.title} \\ ${grid.x.title}`, ...grid.x.labels], ...grid.z.labels.map((z, i) => [z, ...values[i]!.map((v) => (v === null ? '' : String(v)))])];
    const blob = new Blob([lines.map((l) => l.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${grid.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <details className="chart3d-table">
      <summary>Table of values{rs > 1 || cs > 1 ? ' (sampled; the CSV has every cell)' : ''}</summary>
      <div className="wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table className="term-table">
          <caption>{grid.title} · {grid.y.title}{grid.y.unit ? ` (${grid.y.unit === '%' ? '%' : grid.y.unit})` : ''}</caption>
          <thead><tr><th scope="col">{grid.z.title} \ {grid.x.title}</th>{cols.map((j) => <th key={j} scope="col">{grid.x.labels[j]}</th>)}</tr></thead>
          <tbody>{rows.map((i) => <tr key={i}><th scope="row">{grid.z.labels[i]}</th>{cols.map((j) => <td key={j} className="num">{fmtVal(values[i]![j], grid.y.unit)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <p><button className="chip" onClick={csv}>Download CSV</button></p>
    </details>
  );
}

/** Facts, method and provenance under a 3D analysis. */
function Evidence({ grid }: { grid: Grid3D }) {
  return (
    <div className="chart3d-evidence">
      <dl className="chart3d-facts">{grid.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      <details><summary>Method and source</summary>
        <p>{grid.method}</p>
        <p className="mu">Source: {grid.source.name} ({grid.source.series.join(', ')}), {grid.source.first ?? '—'} to {grid.source.last ?? '—'}. {grid.source.note} Calculated by ATLAS from stored observations; nothing is simulated.</p>
      </details>
    </div>
  );
}

/** A 3D analysis on real stored data, loaded from the API. */
export function DataSurface3D({ chart, height }: { chart: string; height?: number }) {
  const d = useApi<Grid3D>(`/v1/academy/charts/${chart}`);
  if (d.loading && !d.data) return <Loading lines={4} label="Loading the 3D chart" />;
  if (d.error) return d.error.status === 404 ? <p className="mu">{d.error.problem.detail ?? 'The data for this chart is not stored yet.'} The 3D chart appears once ATLAS has imported it; it never substitutes invented values.</p> : <Problem error={d.error} retry={d.reload} />;
  const g = d.data!;
  return (
    <div className="lab lab3d">
      <h3 className="lab3d-title">{g.title}</h3>
      <Surface3D grid={g} height={height} />
      <Evidence grid={g} />
    </div>
  );
}

export { Evidence as Surface3DEvidence };
