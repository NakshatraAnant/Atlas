'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as ThreeNS from 'three';
import { Scene3DFrame, useScene3D } from '@/components/scene3d';
import { ProgressRing } from '@/components/academy-journey';
import { Loading, Problem, useApi } from '@/components/ui';

// Knowledge Constellation: every course is a cluster, every lesson a star. Gold stars are lessons you have
// completed, the pulsing star in each course is your next lesson, dim stars are still ahead. It reflects
// recorded progress only (API: /v1/academy/constellation).

interface CLesson { lesson_id: string; title: string; minutes: number; done: boolean; started: boolean }
interface CCourse { course_id: string; title: string; position: number; preceding: string | null; lessons: CLesson[]; completed: number }
type Pick = { kind: 'lesson'; course: CCourse; lesson: CLesson; next: boolean } | { kind: 'course'; course: CCourse };

function Sky({ courses, sel, onSelect }: { courses: CCourse[]; sel: string | null; onSelect: (id: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<{ select: (id: string | null) => void } | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const { state, reset } = useScene3D(host, (api) => {
    const { THREE, scene } = api;
    const root = new THREE.Group();
    scene.add(root);
    const GOLD = new THREE.Color('#e7c27a'), PLAT = new THREE.Color('#c9d3e4'), DIM = new THREE.Color('#3d5a8f');
    const centre = new Map<string, ThreeNS.Vector3>();
    const hits: ThreeNS.Mesh[] = [];
    const stars: { id: string; mesh: ThreeNS.Mesh; next: boolean; base: number }[] = [];
    const path: number[] = [], pathCol: number[] = [];
    courses.forEach((c, i) => {
      const a = (i / courses.length) * 6.2832;
      const ctr = new THREE.Vector3(Math.cos(a) * 7.2, Math.sin(i * 1.7) * 1.6, Math.sin(a) * 7.2);
      centre.set(c.course_id, ctr);
      const frac = c.lessons.length ? c.completed / c.lessons.length : 0;
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), new THREE.MeshStandardMaterial({ color: frac === 1 ? GOLD : PLAT, emissive: frac > 0 ? GOLD : DIM, emissiveIntensity: 0.25 + 0.6 * frac, roughness: 0.35 }));
      core.position.copy(ctr);
      core.userData.id = `course:${c.course_id}`;
      root.add(core);
      hits.push(core);
      api.label(`${c.title} · ${c.completed}/${c.lessons.length}`, ctr.clone().add(new THREE.Vector3(0, 0.75, 0)), 'net');
      const nextIdx = c.lessons.findIndex((l) => !l.done);
      let prev: ThreeNS.Vector3 | null = ctr;
      c.lessons.forEach((l, k) => {
        const t = (k / Math.max(1, c.lessons.length)) * 6.2832 + i;
        const r = 1.25 + (k % 3) * 0.28;
        const p = ctr.clone().add(new THREE.Vector3(Math.cos(t) * r, Math.sin(t * 2 + i) * 0.5, Math.sin(t) * r));
        const col = l.done ? GOLD : l.started ? PLAT : DIM;
        const m = new THREE.Mesh(new THREE.SphereGeometry(l.done ? 0.13 : 0.1, 14, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: l.done ? 1 : l.started ? 0.9 : 0.75 }));
        m.position.copy(p);
        root.add(m);
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.copy(p);
        hit.userData.id = l.lesson_id;
        root.add(hit);
        hits.push(hit);
        stars.push({ id: l.lesson_id, mesh: m, next: k === nextIdx, base: l.done ? 0.13 : 0.1 });
        if (prev) { const lit = l.done ? GOLD.clone().multiplyScalar(0.7) : DIM.clone().multiplyScalar(0.5); path.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); pathCol.push(lit.r, lit.g, lit.b, lit.r, lit.g, lit.b); }
        prev = p;
      });
    });
    // Course-to-course prerequisite lines.
    for (const c of courses) { const a = c.preceding ? centre.get(c.preceding) : null; const b = centre.get(c.course_id); if (a && b) { path.push(a.x, a.y, a.z, b.x, b.y, b.z); const k = PLAT.clone().multiplyScalar(0.35); pathCol.push(k.r, k.g, k.b, k.r, k.g, k.b); } }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(path, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(pathCol, 3));
    root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    // Background dust.
    const dp = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) { dp[i * 3] = (Math.random() - 0.5) * 60; dp[i * 3 + 1] = (Math.random() - 0.5) * 30; dp[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    scene.add(new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x8fa6cc, size: 0.09, transparent: true, opacity: 0.6, depthWrite: false })));

    let selected: string | null = null;
    let t = 0;
    const tick = (dt: number) => {
      t += dt;
      for (const s of stars) { const k = s.id === selected ? 2.2 : s.next ? 1.5 + 0.5 * Math.sin(t * 3) : 1; s.mesh.scale.setScalar(k); }
    };
    tick(0);
    if (!api.reducedMotion) api.animate((dt) => { tick(dt); if (!selected) { const v = api.view.get(); void v; } return true; });
    ctl.current = {
      select: (id) => {
        selected = id;
        tick(0);
        const h = hits.find((x) => x.userData.id === id);
        if (h) { const d = h.position.clone().normalize(); api.view.flyTo({ yaw: Math.atan2(d.x, d.z), pitch: 0.35, distance: 13 }, 1.1); }
        else api.view.flyTo({ distance: 21 }, 0.9);
        api.invalidate();
      },
    };
    const ray = new THREE.Raycaster();
    api.onClick((ndc) => { ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), api.camera); const h = ray.intersectObjects(hits, false)[0]; pick.current(h ? (h.object.userData.id as string) : null); });
    return () => { ctl.current = null; };
  }, { height: 500, target: [0, 0, 0], distance: 21, yaw: 0.4, pitch: 0.5, minPitch: -0.4, zoom: [9, 30] });
  useEffect(() => { ctl.current?.select(sel); }, [sel, state]);
  return (
    <Scene3DFrame state={state} onReset={() => { reset(); onSelect(null); }} title="Knowledge constellation" hint="Drag to turn · scroll to zoom · click a star or a course" fallback={null}>
      <div ref={host} className="scene3d-host" tabIndex={0} aria-label="Knowledge constellation in 3D. Every course and lesson is also listed below." style={{ height: 500 }} />
    </Scene3DFrame>
  );
}

export default function Constellation() {
  const d = useApi<{ courses: CCourse[] }>('/v1/academy/constellation');
  const [sel, setSel] = useState<string | null>(null);
  const courses = d.data?.courses ?? [];
  const picked: Pick | null = useMemo(() => {
    if (!sel) return null;
    if (sel.startsWith('course:')) { const c = courses.find((x) => `course:${x.course_id}` === sel); return c ? { kind: 'course', course: c } : null; }
    for (const c of courses) { const k = c.lessons.findIndex((l) => l.lesson_id === sel); if (k >= 0) return { kind: 'lesson', course: c, lesson: c.lessons[k]!, next: k === c.lessons.findIndex((l) => !l.done) }; }
    return null;
  }, [sel, courses]);
  if (d.loading && !d.data) return <Loading lines={8} label="Loading your constellation" />;
  if (d.error) return <Problem error={d.error} retry={d.reload} />;
  const total = courses.reduce((a, c) => a + c.lessons.length, 0);
  const done = courses.reduce((a, c) => a + c.completed, 0);
  const upNext = courses.map((c) => ({ c, l: c.lessons.find((l) => !l.done) })).find((x) => x.l && x.c.completed > 0) ?? courses.map((c) => ({ c, l: c.lessons.find((l) => !l.done) })).find((x) => x.l);
  return (
    <div className="netpage">
      <header className="uni-hd">
        <p className="eyebrow">Knowledge Constellation</p>
        <h1>Your learning, as a sky you light up.</h1>
        <p className="mu"><span className="lg gold">Gold</span> stars are lessons you completed. The pulsing star in each course is your next lesson. It shows recorded progress only.</p>
      </header>
      <div className="uni-grid">
        <div className="uni-globe"><Sky courses={courses} sel={sel} onSelect={setSel} /></div>
        <aside className="uni-panel" aria-live="polite">
          {!picked ? (
            <div>
              <div className="journey-hd"><ProgressRing value={total ? done / total : 0} label={`${done} of ${total} lessons completed`} /><div><h2 style={{ margin: 0 }}>{done} of {total} lessons</h2><p className="mu" style={{ margin: 0 }}>{courses.filter((c) => c.lessons.length && c.completed === c.lessons.length).length} of {courses.length} courses complete</p></div></div>
              {upNext?.l && <p><a className="btn btn-cta" href={`/app/academy/lesson/${upNext.l.lesson_id}`}>{done ? 'Continue' : 'Start'}: {upNext.l.title} <span aria-hidden="true">→</span></a></p>}
              <p><a href="/app/academy/progress">XP, levels, missions and badges</a> · <a href="/app/academy">Course list</a></p>
            </div>
          ) : picked.kind === 'course' ? (
            <div className="uni-detail" key={sel}>
              <h2>{picked.course.title}</h2>
              <p className="mu">{picked.course.completed} of {picked.course.lessons.length} lessons completed</p>
              <ol className="con-lessons">{picked.course.lessons.map((l) => <li key={l.lesson_id} className={l.done ? 'done' : ''}><button className="link" onClick={() => setSel(l.lesson_id)}>{l.title}</button>{l.done && <span className="t o">Completed</span>}</li>)}</ol>
              <p><a className="btn btn-cta" href={`/app/academy/${picked.course.course_id}`}>Open the course <span aria-hidden="true">→</span></a></p>
            </div>
          ) : (
            <div className="uni-detail" key={sel}>
              <p className="eyebrow">{picked.course.title}</p>
              <h2>{picked.lesson.title}</h2>
              <p className="mu">{picked.lesson.minutes} min · {picked.lesson.done ? 'Completed' : picked.lesson.started ? 'Started, not finished' : picked.next ? 'Your next lesson in this course' : 'Not started'}</p>
              <p><a className="btn btn-cta" href={`/app/academy/lesson/${picked.lesson.lesson_id}`}>{picked.lesson.done ? 'Review the lesson' : picked.lesson.started ? 'Resume the lesson' : 'Open the lesson'} <span aria-hidden="true">→</span></a></p>
              <p><button className="link" onClick={() => setSel(`course:${picked.course.course_id}`)}>See the whole course</button></p>
            </div>
          )}
        </aside>
      </div>
      <details className="chart3d-table"><summary>All courses and lessons as a list</summary>
        {courses.map((c) => <div key={c.course_id}><h3>{c.title} <span className="mu">· {c.completed}/{c.lessons.length}</span></h3><ol className="con-lessons">{c.lessons.map((l) => <li key={l.lesson_id} className={l.done ? 'done' : ''}><a href={`/app/academy/lesson/${l.lesson_id}`}>{l.title}</a>{l.done && <span className="t o">Completed</span>}</li>)}</ol></div>)}
      </details>
    </div>
  );
}
