'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type * as ThreeNS from 'three';

// Reusable 3D learning runtime. Three.js is loaded only when a scene mounts (code-split). Frames are
// rendered on demand: while something animates or the learner drags, and never while the scene is
// off-screen. Labels are HTML (sharp text, screen-reader friendly) projected from 3D anchors.
// Without WebGL the caller's fallback (an equivalent table) is all that shows.

export type Three = typeof ThreeNS;
export interface LabelHandle { el: HTMLDivElement; setText: (t: string) => void; moveTo: (at: ThreeNS.Vector3) => void }
export interface SceneApi {
  THREE: Three;
  scene: ThreeNS.Scene;
  camera: ThreeNS.PerspectiveCamera;
  /** Request one more frame. */
  invalidate: () => void;
  /** Keep rendering until `until` returns false (used for short transitions). */
  animate: (step: (dt: number) => boolean) => void;
  /** Place an HTML label at a 3D point; the handle updates its text or moves it. */
  label: (text: string, at: ThreeNS.Vector3, className?: string) => LabelHandle;
  reducedMotion: boolean;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function useScene3D(host: RefObject<HTMLDivElement | null>, setup: (api: SceneApi) => (() => void) | void, opts: { height?: number; target?: [number, number, number]; distance?: number; yaw?: number; pitch?: number } = {}) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'failed'>('loading');
  const resetRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!host.current) return;
    if (!webglAvailable()) {
      setState('unavailable');
      return;
    }
    let cancelled = false;
    let teardown = () => undefined as void;
    void import('three').then((THREE) => {
      if (cancelled || !host.current) return;
      const el = host.current;
      const height = opts.height ?? 360;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      renderer.setSize(el.clientWidth || 600, height);
      renderer.domElement.style.display = 'block';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      el.appendChild(renderer.domElement);
      const labelLayer = document.createElement('div');
      labelLayer.className = 'scene3d-labels';
      el.appendChild(labelLayer);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, (el.clientWidth || 600) / height, 0.1, 200);
      const target = new THREE.Vector3(...(opts.target ?? [0, 1.5, 0]));
      const distance = opts.distance ?? 16;
      const yaw0 = opts.yaw ?? -0.35;
      const pitch0 = opts.pitch ?? 0.42;
      let yaw = yaw0;
      let pitch = pitch0;
      const placeCamera = () => {
        camera.position.set(target.x + distance * Math.sin(yaw) * Math.cos(pitch), target.y + distance * Math.sin(pitch), target.z + distance * Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(target);
      };
      placeCamera();
      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(6, 12, 8);
      scene.add(key);

      const labels: { el: HTMLDivElement; at: ThreeNS.Vector3 }[] = [];
      const placeLabels = () => {
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        const v = new THREE.Vector3();
        for (const l of labels) {
          v.copy(l.at).project(camera);
          const hidden = v.z > 1;
          l.el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
          l.el.style.visibility = hidden ? 'hidden' : 'visible';
        }
      };
      const animations = new Set<(dt: number) => boolean>();
      let raf = 0;
      let visible = true;
      let last = performance.now();
      const frame = (t: number) => {
        raf = 0;
        // A frame's timestamp can be slightly earlier than the moment it was requested (more so in background
        // or headless tabs); a negative step would run animations backwards, so it is clamped to [0, 0.1] s.
        const dt = Math.max(0, Math.min(0.1, (t - last) / 1000));
        last = t;
        for (const a of [...animations]) if (!a(dt)) animations.delete(a);
        renderer.render(scene, camera);
        placeLabels();
        if (animations.size && visible) raf = requestAnimationFrame(frame);
      };
      const invalidate = () => {
        if (!raf && visible) {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      };
      const api: SceneApi = {
        THREE, scene, camera, invalidate, reducedMotion,
        animate: (step) => {
          if (reducedMotion) {
            while (step(1)) { /* jump straight to the end state */ }
            invalidate();
            return;
          }
          animations.add(step);
          invalidate();
        },
        label: (text, at, className = '') => {
          const d = document.createElement('div');
          d.className = `scene3d-label ${className}`;
          d.textContent = text;
          labelLayer.appendChild(d);
          const entry = { el: d, at: at.clone() };
          labels.push(entry);
          return { el: d, setText: (t: string) => { d.textContent = t; }, moveTo: (p: ThreeNS.Vector3) => { entry.at.copy(p); } };
        },
      };
      const disposeScene = setup(api) ?? (() => undefined);

      // Orbit: drag with pointer, or arrow keys when the scene has focus; Home resets.
      let dragging = false;
      let lx = 0;
      let ly = 0;
      const onDown = (e: PointerEvent) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture?.(e.pointerId); };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        yaw -= (e.clientX - lx) * 0.006;
        pitch = Math.max(0.05, Math.min(1.2, pitch + (e.clientY - ly) * 0.004));
        lx = e.clientX;
        ly = e.clientY;
        placeCamera();
        invalidate();
      };
      const onUp = () => { dragging = false; };
      const reset = () => { yaw = yaw0; pitch = pitch0; placeCamera(); invalidate(); };
      resetRef.current = reset;
      const onKey = (e: KeyboardEvent) => {
        const k = e.key;
        if (k === 'ArrowLeft') yaw += 0.12; else if (k === 'ArrowRight') yaw -= 0.12; else if (k === 'ArrowUp') pitch = Math.min(1.2, pitch + 0.08); else if (k === 'ArrowDown') pitch = Math.max(0.05, pitch - 0.08); else if (k === 'Home') { reset(); e.preventDefault(); return; } else return;
        e.preventDefault();
        placeCamera();
        invalidate();
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('keydown', onKey);
      const resize = new ResizeObserver(() => {
        const w = el.clientWidth || 600;
        renderer.setSize(w, height);
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
        invalidate();
      });
      resize.observe(el);
      const io = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; if (visible) invalidate(); });
      io.observe(el);
      invalidate();
      setState('ready');
      teardown = () => {
        if (raf) cancelAnimationFrame(raf);
        resize.disconnect();
        io.disconnect();
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('keydown', onKey);
        disposeScene();
        scene.traverse((o) => {
          const m = o as ThreeNS.Mesh;
          m.geometry?.dispose?.();
          const mat = m.material as ThreeNS.Material | ThreeNS.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
        });
        renderer.dispose();
        el.innerHTML = '';
      };
    }).catch(() => setState('failed'));
    return () => { cancelled = true; teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { state, reset: () => resetRef.current() };
}

/** Frame for a 3D scene: status, controls hint and the always-present equivalent table. */
export function Scene3DFrame({ state, onReset, title, hint, children, fallback }: { state: string; onReset: () => void; title: string; hint: string; children: ReactNode; fallback: ReactNode }) {
  return (
    <figure className="scene3d" aria-label={title}>
      {children}
      {state === 'ready' && <figcaption className="row mu" style={{ justifyContent: 'space-between' }}><span>{hint}</span><button className="link" onClick={onReset}>Reset view</button></figcaption>}
      {state === 'loading' && <p className="mu">Loading the 3D scene…</p>}
      {(state === 'unavailable' || state === 'failed') && <p className="warn" role="status">{state === 'unavailable' ? '3D is not available in this browser (no WebGL).' : 'The 3D scene could not load.'} The table below has the same information.</p>}
      {fallback}
    </figure>
  );
}
