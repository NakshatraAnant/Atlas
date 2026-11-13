'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// Hero 3D scene: a living "market terrain" of glowing points, three flowing series ribbons with travelling
// light heads, and drifting dust, under a slowly orbiting camera that leans toward the pointer.
// Everything moves on the GPU (vertex shaders), so the main thread only updates a few uniforms per frame.
// It renders only while visible and the tab is active, caps the pixel ratio, and fades in once ready.
// With prefers-reduced-motion it draws one still frame; without WebGL it shows `fallback`.
// The scene is abstract: no data values are drawn.

type Palette = 'gold' | 'academy';
const COLOURS: Record<Palette, { low: string; high: string; ribbons: string[]; dust: string }> = {
  gold: { low: '#2b5ea8', high: '#e7c27a', ribbons: ['#e7c27a', '#7fb2ec', '#5fd0d8'], dust: '#9fb8dc' },
  academy: { low: '#5b3fa0', high: '#5fd0d8', ribbons: ['#c3a3ef', '#5fd0d8', '#e7c27a'], dust: '#b9a8e8' },
};

export function Hero3D({ palette = 'gold', height = 360, fallback, className = '' }: { palette?: Palette; height?: number; fallback?: ReactNode; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'loading' | 'ready' | 'fallback'>('loading');
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const canvasProbe = document.createElement('canvas');
    if (!(canvasProbe.getContext('webgl2') ?? canvasProbe.getContext('webgl'))) { setMode('fallback'); return; }
    let disposed = false;
    let cleanup = () => undefined as void;
    void import('three').then((THREE) => {
      if (disposed || !host.current) return;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const C = COLOURS[palette];
      const w = () => el.clientWidth || 600;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(1.75, devicePixelRatio));
      renderer.setSize(w(), height);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.style.display = 'block';
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x0b1220, 0.055);
      const camera = new THREE.PerspectiveCamera(42, w() / height, 0.1, 100);
      const uniforms = { uTime: { value: 0 }, uFade: { value: 0 }, uLow: { value: new THREE.Color(C.low) }, uHigh: { value: new THREE.Color(C.high) }, uPixel: { value: renderer.getPixelRatio() } };

      // 1. Terrain of points: height comes from layered waves computed in the vertex shader.
      const NX = 120, NZ = 70, SX = 22, SZ = 13;
      const pos = new Float32Array(NX * NZ * 3);
      let k = 0;
      for (let i = 0; i < NZ; i++) for (let j = 0; j < NX; j++) { pos[k++] = (j / (NX - 1) - 0.5) * SX; pos[k++] = 0; pos[k++] = (i / (NZ - 1) - 0.5) * SZ; }
      const terrainGeo = new THREE.BufferGeometry();
      terrainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const WAVE = /* glsl */ `
        float wave(vec2 p, float t) {
          return 0.55 * sin(p.x * 0.55 + t * 0.6) * cos(p.y * 0.7 - t * 0.35)
               + 0.30 * sin(p.x * 1.3 - t * 0.9 + p.y * 0.4)
               + 0.18 * cos(length(p - vec2(3.0, -1.0)) * 1.6 - t * 1.4);
        }`;
      const terrain = new THREE.Points(terrainGeo, new THREE.ShaderMaterial({
        uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime; uniform float uPixel; varying float vH; varying float vFog;
          ${WAVE}
          void main() {
            vec3 p = position;
            p.y = wave(p.xz, uTime);
            vH = clamp((p.y + 0.9) / 1.9, 0.0, 1.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vFog = clamp(1.0 - (-mv.z - 6.0) / 22.0, 0.0, 1.0);
            gl_PointSize = (1.6 + 2.6 * vH) * uPixel * (14.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uLow; uniform vec3 uHigh; uniform float uFade; varying float vH; varying float vFog;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            vec3 c = mix(uLow, uHigh, vH);
            gl_FragColor = vec4(c, a * (0.25 + 0.75 * vH) * vFog * uFade);
          }`,
      }));
      scene.add(terrain);

      // 2. Three flowing ribbons ("series") above the terrain, each with a travelling light head.
      const ribbons: { line: InstanceType<typeof THREE.Mesh>; head: InstanceType<typeof THREE.Mesh>; glow: InstanceType<typeof THREE.Sprite>; curve: InstanceType<typeof THREE.CatmullRomCurve3>; speed: number; offset: number }[] = [];
      const glowTex = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d')!; const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })();
      C.ribbons.forEach((hex, r) => {
        const pts: InstanceType<typeof THREE.Vector3>[] = [];
        for (let s = 0; s <= 24; s++) {
          const x = (s / 24 - 0.5) * SX * 0.92;
          const y = 1.4 + r * 0.55 + 0.55 * Math.sin(s * 0.55 + r * 1.7) + 0.25 * Math.sin(s * 1.3 + r) + (s / 24) * (1.1 - r * 0.45);
          pts.push(new THREE.Vector3(x, y, -1.5 + r * 1.6));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.035 - r * 0.006, 8, false), mat);
        line.geometry.setDrawRange(0, 0);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 }));
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.set(1.1, 1.1, 1);
        scene.add(line, head, glow);
        ribbons.push({ line, head, glow, curve, speed: 0.045 + r * 0.012, offset: r * 0.27 });
      });

      // 3. Drifting dust for depth.
      const DUST = 380;
      const dpos = new Float32Array(DUST * 3);
      const seed = new Float32Array(DUST);
      for (let i = 0; i < DUST; i++) { dpos[i * 3] = (Math.random() - 0.5) * 26; dpos[i * 3 + 1] = Math.random() * 7 - 1; dpos[i * 3 + 2] = (Math.random() - 0.5) * 16; seed[i] = Math.random() * 100; }
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
      dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uDust: { value: new THREE.Color(C.dust) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime; uniform float uPixel; attribute float aSeed; varying float vTw;
          void main() {
            vec3 p = position;
            p.y += mod(uTime * 0.12 + aSeed, 8.0) - 2.0;
            p.x += sin(uTime * 0.2 + aSeed) * 0.3;
            vTw = 0.5 + 0.5 * sin(uTime * 2.0 + aSeed * 3.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (1.0 + vTw) * uPixel * (10.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uDust; uniform float uFade; varying float vTw;
          void main() { float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(uDust, a * 0.45 * vTw * uFade); }`,
      }));
      scene.add(dust);

      // Camera: slow orbit plus a gentle lean toward the pointer (eased).
      let px = 0, py = 0, tx = 0, ty = 0;
      const onPointer = (e: PointerEvent) => { const r = el.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2; };
      el.addEventListener('pointermove', onPointer);
      const place = (t: number) => {
        px += (tx - px) * 0.04; py += (ty - py) * 0.04;
        const a = -0.35 + Math.sin(t * 0.07) * 0.25 + px * 0.18;
        camera.position.set(Math.sin(a) * 15.5, 5.2 - py * 0.9 + Math.sin(t * 0.11) * 0.3, Math.cos(a) * 15.5);
        camera.lookAt(0, 0.9, 0);
      };

      const clock = new THREE.Clock();
      let start: number | null = null;
      // Reduced motion shows the composed end state: everything drawn, at a pleasing phase of the waves.
      const stillAt = reduced ? 4 : null;
      let raf = 0;
      let visible = true;
      const frame = () => {
        raf = 0;
        const t = stillAt ?? clock.getElapsedTime();
        if (start === null) start = reduced ? t - 10 : t;
        const age = t - start;
        uniforms.uTime.value = t;
        uniforms.uFade.value = Math.min(1, age / 1.2);
        // Ribbons draw in left to right over the first seconds, then their light heads travel.
        ribbons.forEach((rb, i) => {
          const grow = Math.min(1, Math.max(0, (age - 0.4 - i * 0.25) / 1.8));
          const eased = 1 - (1 - grow) ** 3;
          const idx = rb.line.geometry.index!.count;
          rb.line.geometry.setDrawRange(0, Math.floor(idx * eased / 6) * 6);
          (rb.line.material as InstanceType<typeof THREE.MeshBasicMaterial>).opacity = 0.85 * Math.min(1, grow * 2);
          const u = grow < 1 ? eased : (rb.offset + (age - 2.6) * rb.speed) % 1;
          const p = rb.curve.getPointAt(Math.max(0, Math.min(1, u)));
          rb.head.position.copy(p); rb.glow.position.copy(p);
          const pulse = 0.85 + 0.15 * Math.sin(t * 3 + i);
          (rb.head.material as InstanceType<typeof THREE.MeshBasicMaterial>).opacity = Math.min(1, grow * 2);
          (rb.glow.material as InstanceType<typeof THREE.SpriteMaterial>).opacity = 0.9 * Math.min(1, grow * 2) * pulse;
        });
        place(t);
        renderer.render(scene, camera);
        if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(frame);
      };
      const kick = () => { if (!raf && visible && !document.hidden && !reduced) raf = requestAnimationFrame(frame); };
      const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; kick(); });
      io.observe(el);
      const onVis = () => kick();
      document.addEventListener('visibilitychange', onVis);
      const ro = new ResizeObserver(() => { renderer.setSize(w(), height); camera.aspect = w() / height; camera.updateProjectionMatrix(); if (reduced) frame(); });
      ro.observe(el);
      if (reduced) {
        frame();
      } else kick();
      setMode('ready');
      cleanup = () => {
        cancelAnimationFrame(raf);
        io.disconnect(); ro.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        el.removeEventListener('pointermove', onPointer);
        scene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          m.geometry?.dispose?.();
          const mat = m.material as { dispose?: () => void } | { dispose?: () => void }[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose?.()); else mat?.dispose?.();
        });
        glowTex.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => setMode('fallback'));
    return () => { disposed = true; cleanup(); };
  }, [palette, height]);
  return (
    <div className={`hero3d ${className}${mode === 'ready' ? ' ready' : ''}`} style={{ height: mode === 'fallback' ? 'auto' : height }}>
      <div ref={host} className="hero3d-canvas" hidden={mode === 'fallback'} />
      {mode === 'fallback' && fallback}
    </div>
  );
}
