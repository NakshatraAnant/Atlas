'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import type * as ThreeNS from 'three';
import { LAND_H, LAND_MASK, LAND_W } from '@/lib/land-mask';
import { Scene3DFrame, useScene3D } from './scene3d';

// The ATLAS globe: real geography as a field of platinum and gold points (Natural Earth land mask), a soft
// atmosphere, two orbital rings carrying "satellite" nodes, and selectable region markers. It turns slowly,
// can be dragged, zoomed and clicked; selecting a marker flies the camera to it. Rendering is on demand
// (shared 3D runtime): it stops off-screen, and with reduced motion it is a still, fully usable globe.

export interface GlobeNode { id: string; label: string; lat?: number; lon?: number; orbit?: 0 | 1; phase?: number }
const R = 4;
const rad = (d: number) => (d * Math.PI) / 180;

function landPoints(): Float32Array {
  const bin = atob(LAND_MASK);
  const out: number[] = [];
  for (let y = 0; y < LAND_H; y++) for (let x = 0; x < LAND_W; x++) {
    const i = y * LAND_W + x;
    if (!((bin.charCodeAt(i >> 3) >> (i & 7)) & 1)) continue;
    const lat = rad(90 - (y + 0.5) * 2), lon = rad(-180 + (x + 0.5) * 2);
    // Fewer points near the poles, where 2-degree cells crowd together.
    if (Math.cos(lat) < 0.35 && x % 2) continue;
    out.push(R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat), R * Math.cos(lat) * Math.cos(lon));
  }
  return new Float32Array(out);
}

export function Globe3D({ nodes = [], selected = null, onSelect, height = 460, interactive = true, title = 'ATLAS globe', fallback = null, hint, bare = false }: { bare?: boolean; nodes?: GlobeNode[]; selected?: string | null; onSelect?: (id: string) => void; height?: number; interactive?: boolean; title?: string; fallback?: ReactNode; hint?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<{ select: (id: string | null) => void } | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const { state, reset } = useScene3D(host, (api) => {
    const { THREE, scene } = api;
    const globe = new THREE.Group();
    scene.add(globe);
    const uniforms = { uTime: { value: 0 }, uPixel: { value: Math.min(2, devicePixelRatio) } };

    // Body (hides the far side), land points, atmosphere.
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 48, 32), new THREE.MeshBasicMaterial({ color: 0x08101f })));
    const land = new THREE.BufferGeometry();
    const lp = landPoints();
    land.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const seed = new Float32Array(lp.length / 3).map(() => Math.random());
    land.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    globe.add(new THREE.Points(land, new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false,
      vertexShader: `uniform float uTime; uniform float uPixel; attribute float aSeed; varying float vS; varying float vTw;
        void main() { vS = aSeed; vTw = 0.75 + 0.25 * sin(uTime * 1.3 + aSeed * 40.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (1.9 + 1.3 * step(0.9, aSeed)) * uPixel * (13.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vS; varying float vTw;
        void main() { float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5));
          vec3 platinum = vec3(0.78, 0.83, 0.90); vec3 gold = vec3(0.91, 0.76, 0.48);
          gl_FragColor = vec4(mix(platinum, gold, step(0.82, vS)), a * vTw * 0.95); }`,
    })));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 48, 32), new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vN; void main() { float f = pow(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(0.35, 0.55, 0.95, 1.0) * clamp(f, 0.0, 1.0) * 0.9; }`,
    })));

    // Stars.
    const sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) { const u = Math.random() * 2 - 1, th = Math.random() * 6.283, r = 40 + Math.random() * 30, s = Math.sqrt(1 - u * u); sp[i * 3] = r * s * Math.cos(th); sp[i * 3 + 1] = r * u; sp[i * 3 + 2] = r * s * Math.sin(th); }
    const stars = new THREE.BufferGeometry();
    stars.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x9fb4d8, size: 0.12, transparent: true, opacity: 0.7, depthWrite: false })));

    // Two orbital rings.
    const rings = [{ r: R * 1.42, tilt: [1.15, 0.2] }, { r: R * 1.7, tilt: [1.45, -0.5] }].map((o) => {
      const g = new THREE.Group();
      g.rotation.set(o.tilt[0]!, 0, o.tilt[1]!);
      const pts: ThreeNS.Vector3[] = [];
      for (let i = 0; i <= 128; i++) pts.push(new THREE.Vector3(Math.cos((i / 128) * 6.2832) * o.r, 0, Math.sin((i / 128) * 6.2832) * o.r));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xd9b56c, transparent: true, opacity: 0.28 })));
      scene.add(g);
      return { g, r: o.r };
    });

    // Markers: regions on the surface, satellites on the rings.
    const gold = new THREE.MeshBasicMaterial({ color: 0xe7c27a });
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const ringGeo = new THREE.RingGeometry(0.16, 0.2, 32);
    const items = nodes.map((n) => {
      const holder = new THREE.Group();
      const dot = new THREE.Mesh(new THREE.SphereGeometry(n.orbit === undefined ? 0.085 : 0.13, 16, 12), gold);
      const halo = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xe7c27a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), hitMat);
      hit.userData.id = n.id;
      holder.add(dot, halo, hit);
      if (n.orbit === undefined) {
        const lat = rad(n.lat!), lon = rad(n.lon!);
        holder.position.set(R * 1.01 * Math.cos(lat) * Math.sin(lon), R * 1.01 * Math.sin(lat), R * 1.01 * Math.cos(lat) * Math.cos(lon));
        halo.lookAt(holder.position.clone().multiplyScalar(2));
        globe.add(holder);
      } else rings[n.orbit]!.g.add(holder);
      const label = api.label(n.label, new THREE.Vector3(), 'globe');
      return { n, holder, halo, hit, label, angle: (n.phase ?? 0) * 6.2832 };
    });

    const world = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    let sel: string | null = selected;
    let t = 0;
    const layout = (dt: number) => {
      t += dt;
      uniforms.uTime.value = t;
      if (!sel && !api.reducedMotion) globe.rotation.y += dt * 0.045;
      camDir.copy(api.camera.position).normalize();
      for (const it of items) {
        if (it.n.orbit !== undefined) {
          if (!api.reducedMotion && !sel) it.angle += dt * (it.n.orbit ? 0.05 : 0.08);
          it.holder.position.set(Math.cos(it.angle) * rings[it.n.orbit]!.r, 0, Math.sin(it.angle) * rings[it.n.orbit]!.r);
          it.halo.quaternion.copy(api.camera.quaternion);
        }
        it.holder.getWorldPosition(world);
        const facing = world.clone().normalize().dot(camDir);
        const on = it.n.id === sel;
        const s = 1 + (on ? 0.25 : 0) + 0.18 * Math.sin(t * 2.2 + it.angle * 3);
        it.halo.scale.setScalar(s);
        (it.halo.material as ThreeNS.MeshBasicMaterial).opacity = on ? 1 : 0.55;
        it.label.moveTo(world.clone().multiplyScalar(1 + 0.09));
        it.label.el.style.opacity = it.n.orbit !== undefined || facing > 0.2 ? '1' : '0';
        it.label.el.classList.toggle('on', on);
      }
    };
    layout(0);
    if (!api.reducedMotion) api.animate((dt) => { layout(dt); return true; });

    const flyTo = (id: string | null) => {
      sel = id;
      const it = items.find((x) => x.n.id === id);
      if (!it) { api.view.flyTo({ distance: 13 }, 0.9); layout(0); api.invalidate(); return; }
      it.holder.getWorldPosition(world);
      const d = world.clone().normalize();
      api.view.flyTo({ yaw: Math.atan2(d.x, d.z), pitch: Math.asin(d.y) * 0.85, distance: it.n.orbit === undefined ? 10 : 12.5 }, 1.2);
      layout(0);
      api.invalidate();
    };
    ctl.current = { select: flyTo };

    if (interactive) {
      const ray = new THREE.Raycaster();
      api.onClick((ndc) => {
        ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), api.camera);
        const h = ray.intersectObjects(items.map((i) => i.hit), false)[0];
        if (h) pick.current?.(h.object.userData.id as string);
      });
      // Pointer feedback over a marker.
      const el = host.current!;
      const over = (e: PointerEvent) => {
        if (e.buttons) return;
        const r = el.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), api.camera);
        el.style.cursor = ray.intersectObjects(items.map((i) => i.hit), false).length ? 'pointer' : '';
      };
      el.addEventListener('pointermove', over);
      return () => { el.removeEventListener('pointermove', over); ctl.current = null; };
    }
    return () => { ctl.current = null; };
  }, { height, target: [0, 0, 0], distance: 13, yaw: 1.2, pitch: 0.32, minPitch: -1.1, zoom: interactive ? [7, 20] : undefined });

  useEffect(() => { ctl.current?.select(selected); }, [selected, state]);
  if (bare) return <div ref={host} className={`globe-bare${state === 'ready' ? ' ready' : ''}`} aria-hidden="true" style={{ height }} />;
  return (
    <Scene3DFrame state={state} onReset={() => { reset(); pick.current?.(''); }} title={title} hint={hint ?? 'Drag to turn · scroll or +/− to zoom · click a gold marker'} fallback={fallback}>
      <div ref={host} className="scene3d-host globe-host" tabIndex={0} aria-label={`${title}. 3D view; the same choices are listed as buttons beside it.`} style={{ height }} />
    </Scene3DFrame>
  );
}
