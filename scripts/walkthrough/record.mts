// Records the ATLAS product walkthrough from the running local app (http://localhost:3000, real-data mode).
//   1. Narration: Windows built-in speech, offline (scripts/video/narrate.ps1); a synthetic voice.
//   2. Tour: Microsoft Edge (Playwright) drives the real app; every repaint is captured with the
//      DevTools screencast (JPEG frames with timestamps). Sign-in happens before capture starts, so no
//      credentials are ever on screen; a drawn pointer shows where the mouse is.
//   3. Mix: narration placed at each scene's start, one 48 kHz mono track.
//   4. Captions: SRT cues from the narration, also burned into the picture.
//   5. Compose: Edge draws frames, title cards and captions to a canvas and records canvas + audio with
//      MediaRecorder as H.264/AAC MP4 (real time).
//   6. Verify: the MP4 is played back in Edge (duration, size, picture at sampled times, audio level).
// Usage: npx tsx scripts/walkthrough/record.mts [--skip-tour]   (writes artifacts/ATLAS_COMPLETE_PRODUCT_WALKTHROUGH.mp4)
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { DEV_PASSWORD } from '../../apps/api/src/seed.js';
import { SCENES, type Helpers, type Scene } from './scenes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BASE = process.env.ATLAS_URL ?? 'http://localhost:3000';
const WORK = join(ROOT, '.atlas', 'walkthrough-work');
const FRAMES = join(WORK, 'frames');
const ART = join(ROOT, 'artifacts');
const MP4 = join(ART, 'ATLAS_COMPLETE_PRODUCT_WALKTHROUGH.mp4');
const SRT = join(ART, 'ATLAS_WALKTHROUGH.srt');
const VOICE = 'Microsoft Zira Desktop';
const RATE = 48000;
const W = 1280;
const H = 720;
const PAD = 0.9; // seconds of quiet after each scene's narration
const LEAD = 0.35; // narration starts this long after a scene begins
const skipTour = process.argv.includes('--skip-tour');
const log = (m: string) => console.log(`[walkthrough] ${m}`);

// ── 1. Narration ──
function wavInfo(file: string): { pcm: Buffer; seconds: number } {
  const b = readFileSync(file);
  let p = 12;
  let fmtOk = false;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmtOk = b.readUInt32LE(p + 12) === RATE && b.readUInt16LE(p + 22) === 16 && b.readUInt16LE(p + 10) === 1;
    if (id === 'data') {
      if (!fmtOk) throw new Error(`${file}: expected 48 kHz 16-bit mono`);
      const pcm = b.subarray(p + 8, p + 8 + size);
      return { pcm, seconds: pcm.length / 2 / RATE };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

function narrate(): Map<string, { file: string; seconds: number }> {
  const dir = join(WORK, 'narration');
  mkdirSync(dir, { recursive: true });
  const manifest = SCENES.map((s) => ({ file: join(dir, `${s.id}.wav`).replace(/\\/g, '/'), text: s.narration }));
  writeFileSync(join(dir, 'segments.json'), JSON.stringify(manifest, null, 1));
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'video', 'narrate.ps1'), '-Manifest', join(dir, 'segments.json'), '-Voice', VOICE, '-Rate', '0'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`narration failed: ${r.stderr || r.stdout}`);
  const out = new Map<string, { file: string; seconds: number }>();
  for (const m of manifest) out.set(m.file.split('/').pop()!.replace('.wav', ''), { file: m.file, seconds: wavInfo(m.file).seconds });
  return out;
}

// ── 2. Tour ──
interface Mark { id: string; chapter: string; start: number; end: number }
interface Frame { f: string; t: number; w: number; h: number }

const CURSOR = `(() => {
  const add = () => {
    if (document.getElementById('__wt_cursor')) return;
    const c = document.createElement('div');
    c.id = '__wt_cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.4 19.1 L10.3 12.6 L16.5 12.6 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:-40px;top:-40px;z-index:2147483647;pointer-events:none;transition:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX - 3 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  const status = await page.evaluate(`(async () => {
    await fetch('/v1/auth/csrf', { credentials: 'same-origin' });
    // Signing in issues a new CSRF token, so read the cookie on every request.
    const tok = () => (document.cookie.match(/atlas_csrf=([^;]+)/) || [])[1] || '';
    const post = (u, b, m) => fetch(u, { method: m || 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': tok() }, body: JSON.stringify(b), credentials: 'same-origin' });
    const r = await post('/v1/auth/login', { email: 'pro@atlas.test', password: ${JSON.stringify(DEV_PASSWORD)} });
    if (r.status !== 200) return r.status;
    // A clean, repeatable starting state: default Home, notices on, streaks shown, dark theme,
    // two followed series (Brent, the US 10-year yield) and the rupee rate not yet followed.
    const setup = [];
    setup.push(await post('/v1/me', { display_prefs: { home_panels: ['attention', 'following', 'indices', 'commodities', 'macro', 'crypto', 'learning'], markets: [], notify: { releases: true, digest: false }, show_streak: true, theme: 'dark', tour_done: true, mode: 'explore' } }, 'PATCH'));
    setup.push(await post('/v1/follows', { key: 'macro:DEXINUS', follow: false }, 'PUT'));
    setup.push(await post('/v1/follows', { key: 'commodity:fred:DCOILBRENTEU', follow: true }, 'PUT'));
    setup.push(await post('/v1/follows', { key: 'macro:DGS10', follow: true }, 'PUT'));
    const bad = setup.find((x) => !x.ok);
    if (bad) return 'setup ' + bad.status + ' ' + bad.url;
    localStorage.setItem('atlas-theme', 'dark');
    localStorage.setItem('atlas-mode', 'explore');
    return 200;
  })()`);
  if (status !== 200) throw new Error(`sign-in failed (${status})`);
}

async function tour(narr: Map<string, { seconds: number }>): Promise<{ marks: Mark[]; frames: Frame[]; t0: number }> {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()}: ${m.text().slice(0, 200)}`); });
  await signIn(page);
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.mouse.move(W / 2, H / 2);
  const frames: Frame[] = [];
  const cdp = await context.newCDPSession(page);
  let n = 0;
  let t0 = 0;
  cdp.on('Page.screencastFrame', (e: { data: string; sessionId: number; metadata: { timestamp?: number; deviceWidth: number; deviceHeight: number } }) => {
    const f = `${String(n++).padStart(6, '0')}.jpg`;
    const buf = Buffer.from(e.data, 'base64');
    writeFileSync(join(FRAMES, f), buf);
    const ts = e.metadata.timestamp ?? Date.now() / 1000;
    if (!t0) t0 = ts;
    // JPEG dimensions (SOF0/SOF2 marker) for letterboxing narrow (phone) frames.
    let w = W, h = H;
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) break;
      const m = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      if (m === 0xc0 || m === 0xc2) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      i += 2 + len;
    }
    frames.push({ f, t: ts, w, h });
    void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => undefined);
  });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let mouse = { x: W / 2, y: H / 2 };
  const h: Helpers = {
    go: async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 20_000 }).catch(() => undefined); await page.mouse.move(mouse.x, mouse.y); },
    wait: sleep,
    moveTo: async (x, y, ms = 600) => {
      const steps = Math.max(1, Math.round(ms / 16));
      const from = { ...mouse };
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
        await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
        await sleep(16);
      }
      mouse = { x, y };
    },
    scroll: async (px, ms = 1200) => {
      const steps = Math.max(1, Math.round(ms / 40));
      for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await sleep(40); }
    },
    hover: async (sel) => {
      const b = await page.locator(sel).first().boundingBox({ timeout: 3000 }).catch(() => null);
      if (b) await h.moveTo(b.x + b.width / 2, b.y + b.height / 2, 600); else log(`  (not found: ${sel})`);
    },
    click: async (sel) => {
      const loc = page.locator(sel).first();
      const b = await loc.boundingBox({ timeout: 4000 }).catch(() => null);
      if (!b) { log(`  (not found: ${sel})`); return; }
      if (b.y < 0 || b.y + b.height > page.viewportSize()!.height) { await loc.scrollIntoViewIfNeeded().catch(() => undefined); await sleep(300); }
      const b2 = (await loc.boundingBox().catch(() => null)) ?? b;
      await h.moveTo(b2.x + b2.width / 2, b2.y + b2.height / 2, 550);
      await sleep(150);
      await page.mouse.click(mouse.x, mouse.y);
    },
    type: async (text, perCharMs = 110) => { for (const ch of text) { await page.keyboard.type(ch); await sleep(perCharMs); } },
  };
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(400);
  const marks: Mark[] = [];
  const clock = () => Date.now() / 1000;
  const start0 = clock();
  for (const s of SCENES.filter((x) => x.kind === 'app')) {
    if (s.viewport) { await page.setViewportSize(s.viewport); mouse = { x: s.viewport.width / 2, y: s.viewport.height / 2 }; }
    const start = clock();
    log(`scene ${s.id}`);
    await Promise.race([s.run!(page, h), sleep(45_000)]).catch((e) => log(`  scene ${s.id} action error: ${(e as Error).message}`));
    const minEnd = start + LEAD + narr.get(s.id)!.seconds + PAD;
    const left = minEnd - clock();
    if (left > 0) await sleep(left * 1000);
    marks.push({ id: s.id, chapter: s.chapter, start: start - start0, end: clock() - start0 });
    // A scene is bounded at 45 s of actions plus its narration. Far longer means the machine slept or the
    // browser hung; the composer works in real time, so stop rather than encode hours of a frozen frame.
    if (clock() - start > 180) throw new Error(`scene ${s.id} took ${Math.round(clock() - start)} s (machine asleep or browser hung); take abandoned`);
  }
  await sleep(300);
  await cdp.send('Page.stopScreencast');
  await sleep(500);
  await browser.close();
  // Frame timestamps are on the same wall clock; re-base them on the tour's start.
  const rebased = frames.map((f) => ({ ...f, t: f.t - start0 }));
  writeFileSync(join(WORK, 'tour.json'), JSON.stringify({ marks, frames: rebased, console_errors: errors }, null, 1));
  log(`tour: ${marks.length} scenes, ${frames.length} frames, ${errors.length} console errors`);
  return { marks, frames: rebased, t0: start0 };
}

// ── 3–4. Timeline, audio mix, captions ──
interface Cue { s: number; e: number; text: string }
interface Timeline { total: number; frames: Frame[]; cues: Cue[]; chapters: { s: number; e: number; label: string }[]; cards: { s: number; e: number; title: string; lines: string[] }[]; tourOffset: number }

function chunks(text: string, max = 88): string[] {
  const out: string[] = [];
  for (const sentence of text.match(/[^.!?]+[.!?]+/g) ?? [text]) {
    let cur = '';
    for (const w of sentence.trim().split(/\s+/)) {
      if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    }
    if (cur) out.push(cur);
  }
  return out;
}

function timeline(narr: Map<string, { file: string; seconds: number }>, marks: Mark[], frames: Frame[]): { tl: Timeline; audio: Buffer } {
  const cardDur = (s: Scene) => LEAD + narr.get(s.id)!.seconds + PAD + 0.6;
  const intro = SCENES[0]!;
  const outro = SCENES[SCENES.length - 1]!;
  const tourOffset = cardDur(intro);
  const tourEnd = marks[marks.length - 1]!.end;
  const outroStart = tourOffset + tourEnd;
  const total = outroStart + cardDur(outro) + 0.4;
  const starts = new Map<string, number>([[intro.id, 0], [outro.id, outroStart], ...marks.map((m) => [m.id, tourOffset + m.start] as [string, number])]);
  const cues: Cue[] = [];
  const pcm = Buffer.alloc(Math.ceil(total * RATE) * 2);
  for (const s of SCENES) {
    const n = narr.get(s.id)!;
    const at = starts.get(s.id)! + LEAD;
    const src = wavInfo(n.file).pcm;
    src.copy(pcm, Math.round(at * RATE) * 2, 0, Math.min(src.length, pcm.length - Math.round(at * RATE) * 2));
    const parts = chunks(s.narration);
    const totalChars = parts.reduce((a, p) => a + p.length, 0);
    let t = at;
    for (const p of parts) {
      const d = (p.length / totalChars) * n.seconds;
      cues.push({ s: t, e: t + d, text: p });
      t += d;
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  const chapters = marks.map((m) => ({ s: tourOffset + m.start, e: tourOffset + m.end, label: m.chapter }));
  const cards = [intro, outro].map((s) => ({ s: starts.get(s.id)!, e: s === intro ? tourOffset : total, title: s.card!.title, lines: s.card!.lines }));
  const tl: Timeline = { total, frames: frames.filter((f) => f.t >= -1).map((f) => ({ ...f, t: f.t + tourOffset })), cues, chapters, cards, tourOffset };
  return { tl, audio: Buffer.concat([header, pcm]) };
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

// ── 5. Compose (Edge, canvas + MediaRecorder) ──
const COMPOSER = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
const W = ${W}, H = ${H};
async function main() {
  const tl = await (await fetch('timeline.json')).json();
  const c = document.getElementById('c'); const g = c.getContext('2d');
  const ac = new AudioContext({ sampleRate: ${RATE} });
  const buf = await ac.decodeAudioData(await (await fetch('mix.wav')).arrayBuffer());
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource(); src.buffer = buf; src.connect(dest);
  const cache = new Map();
  const load = (i) => { const fr = tl.frames[i]; if (!fr || cache.has(i)) return; const im = new Image(); im.src = 'frames/' + fr.f; const p = im.decode().then(() => im).catch(() => null); cache.set(i, { im, p, ok: false }); p.then((r) => { const e = cache.get(i); if (e) e.ok = !!r; }); };
  for (let i = 0; i < 90 && i < tl.frames.length; i++) load(i);
  await Promise.all([...cache.values()].map((e) => e.p));
  const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', videoBitsPerSecond: 2_600_000, audioBitsPerSecond: 128_000 });
  rec.ondataavailable = async (e) => { if (e.data.size) { const b = new Uint8Array(await e.data.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); await window.putChunk(btoa(s)); } };
  const stopped = new Promise((r) => (rec.onstop = r));
  let fi = 0; let last = null;
  const wrap = (text, max) => { const words = text.split(' '); const lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; };
  const draw = (t) => {
    g.fillStyle = '#0b0f17'; g.fillRect(0, 0, W, H);
    const card = tl.cards.find((k) => t >= k.s && t < k.e);
    if (card) {
      const k = Math.min(1, (t - card.s) / 0.8);
      g.globalAlpha = k;
      const grd = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, W * 0.7); grd.addColorStop(0, '#182033'); grd.addColorStop(1, '#0b0f17'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#d9b56c'; g.textAlign = 'center'; g.font = '600 ' + (card.title.length < 8 ? 92 : 56) + 'px Segoe UI, sans-serif'; g.fillText(card.title, W / 2, H * 0.36);
      g.fillStyle = '#d9b56c'; g.fillRect(W / 2 - 60, H * 0.36 + 26, 120, 3);
      g.font = '400 25px Segoe UI, sans-serif'; g.fillStyle = '#e8ebf1';
      card.lines.forEach((l, i) => g.fillText(l, W / 2, H * 0.36 + 82 + i * 40));
      g.globalAlpha = 1; g.textAlign = 'left';
    } else {
      while (fi + 1 < tl.frames.length && tl.frames[fi + 1].t <= t) fi++;
      for (let j = fi; j < fi + 90 && j < tl.frames.length; j++) load(j);
      for (const key of cache.keys()) if (key < fi - 2) cache.delete(key);
      let e = null; for (let j = fi; j >= Math.max(0, fi - 30); j--) { const x = cache.get(j); if (x && x.ok) { e = x; break; } }
      const im = e ? e.im : last;
      if (im) {
        last = im;
        const s = Math.min(W / im.naturalWidth, H / im.naturalHeight); const w = im.naturalWidth * s, h = im.naturalHeight * s;
        if (w < W - 4) { g.fillStyle = '#05070b'; g.fillRect(0, 0, W, H); g.strokeStyle = '#263149'; g.lineWidth = 2; g.strokeRect((W - w) / 2 - 1, (H - h) / 2 - 1, w + 2, h + 2); }
        g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
      }
      const ch = tl.chapters.find((k) => t >= k.s && t < k.e);
      if (ch) { g.font = '600 15px Segoe UI, sans-serif'; const tw = g.measureText(ch.label).width; g.fillStyle = 'rgba(8,11,18,.82)'; g.beginPath(); g.textAlign = 'left'; g.roundRect(20, H - 162, tw + 28, 30, 15); g.fill(); g.fillStyle = '#d9b56c'; g.fillText(ch.label, 34, H - 142); }
    }
    const cue = tl.cues.find((q) => t >= q.s && t < q.e + 0.15);
    if (cue) {
      g.font = '500 25px Segoe UI, sans-serif';
      const lines = wrap(cue.text, W - 260);
      const lh = 34, bh = lines.length * lh + 22; const y0 = H - bh - 26;
      let bw = 0; for (const l of lines) bw = Math.max(bw, g.measureText(l).width); bw += 40;
      g.fillStyle = 'rgba(5,7,11,.84)'; g.beginPath(); g.roundRect((W - bw) / 2, y0, bw, bh, 10); g.fill();
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; lines.forEach((l, i) => g.fillText(l, W / 2, y0 + 36 + i * lh)); g.textAlign = 'left';
    }
    g.fillStyle = '#d9b56c'; g.fillRect(0, H - 3, W * Math.min(1, t / tl.total), 3);
  };
  draw(0);
  rec.start(1000);
  const t0 = ac.currentTime + 0.25; src.start(t0);
  await new Promise((resolve) => {
    const iv = setInterval(() => { const t = ac.currentTime - t0; draw(Math.max(0, t)); if (t >= tl.total) { clearInterval(iv); resolve(); } }, 1000 / 30);
  });
  rec.stop(); await stopped; await window.putChunk('');
  return { mime: rec.mimeType };
}
window.compose = main;
</script>`;

const VERIFY = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><video id="v" src="out.mp4" preload="auto" playsinline></video><canvas id="c" width="${W}" height="${H}"></canvas>
<script>
window.check = async (times) => {
  const v = document.getElementById('v'); const c = document.getElementById('c'); const g = c.getContext('2d');
  await new Promise((r, j) => { if (v.readyState >= 1) r(); v.onloadedmetadata = r; v.onerror = () => j(new Error('cannot load: ' + (v.error && v.error.message))); });
  let duration = v.duration;
  if (!isFinite(duration)) { v.currentTime = 1e9; await new Promise((r) => (v.ondurationchange = r)); duration = v.duration; }
  const shots = [];
  for (const t of times) {
    v.currentTime = Math.min(t, duration - 0.2); await new Promise((r) => (v.onseeked = r));
    g.drawImage(v, 0, 0, ${W}, ${H}); const px = g.getImageData(0, 0, ${W}, ${H}).data; let sum = 0; for (let i = 0; i < px.length; i += 400) sum += px[i] + px[i + 1] + px[i + 2];
    shots.push({ t, png: c.toDataURL('image/png'), brightness: sum / (px.length / 400) / 3 });
  }
  const ac = new AudioContext(); const node = ac.createMediaElementSource(v); const an = ac.createAnalyser(); an.fftSize = 2048; const mute = ac.createGain(); mute.gain.value = 0;
  node.connect(an); an.connect(mute); mute.connect(ac.destination);
  const levels = [];
  for (const t of [times[1], times[Math.floor(times.length / 2)], times[times.length - 2]]) {
    v.currentTime = t; await new Promise((r) => (v.onseeked = r)); await v.play(); let peak = 0; const d = new Float32Array(an.fftSize);
    const end = performance.now() + 2500; while (performance.now() < end) { an.getFloatTimeDomainData(d); let s = 0; for (const x of d) s += x * x; peak = Math.max(peak, Math.sqrt(s / d.length)); await new Promise((r) => setTimeout(r, 50)); }
    v.pause(); levels.push({ t, rms_peak: peak });
  }
  return { duration, width: v.videoWidth, height: v.videoHeight, shots, levels };
};
</script>`;

function serve(dir: string, files: Record<string, string>): Promise<{ url: string; close: () => void }> {
  const types: Record<string, string> = { '.html': 'text/html', '.json': 'application/json', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
  return new Promise((ok) => {
    const srv = createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\/+/, '');
      if (files[path] !== undefined) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(files[path]); return; }
      const file = resolve(dir, path);
      if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
      const size = statSync(file).size;
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      const body = readFileSync(file);
      if (range) {
        const a = Number(range[1]); const b = range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 });
        res.end(body.subarray(a, b + 1));
      } else { res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': size }); res.end(body); }
    });
    srv.listen(0, '127.0.0.1', () => { const a = srv.address() as { port: number }; ok({ url: `http://127.0.0.1:${a.port}`, close: () => srv.close() }); });
  });
}

async function compose(tl: Timeline): Promise<string> {
  const part = join(WORK, 'out.mp4');
  rmSync(part, { force: true });
  const srv = await serve(WORK, { 'compose.html': COMPOSER });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  let bytes = 0;
  await page.exposeFunction('putChunk', (b64: string) => { if (!b64) { done(); return; } const b = Buffer.from(b64, 'base64'); bytes += b.length; appendFileSync(part, b); });
  page.on('console', (m) => { if (m.type() === 'error') log(`composer: ${m.text()}`); });
  await page.goto(`${srv.url}/compose.html`);
  log(`composing ${tl.total.toFixed(1)} s in real time…`);
  const r = (await page.evaluate('window.compose()', undefined)) as { mime: string };
  await finished;
  await browser.close();
  srv.close();
  log(`composed ${(bytes / 1e6).toFixed(1)} MB (${r.mime})`);
  return part;
}

async function verify(tl: Timeline): Promise<Record<string, unknown>> {
  const srv = await serve(WORK, { 'verify.html': VERIFY });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`${srv.url}/verify.html`);
  const times = [2, ...tl.chapters.map((c) => (c.s + c.e) / 2), tl.total - 3];
  const r = (await page.evaluate(`window.check(${JSON.stringify(times)})`, undefined)) as { duration: number; width: number; height: number; shots: { t: number; png: string; brightness: number }[]; levels: { t: number; rms_peak: number }[] };
  await browser.close();
  srv.close();
  const shotDir = join(ART, 'walkthrough-frames');
  rmSync(shotDir, { recursive: true, force: true });
  mkdirSync(shotDir, { recursive: true });
  r.shots.forEach((s, i) => writeFileSync(join(shotDir, `${String(i).padStart(2, '0')}-${s.t.toFixed(0)}s.png`), Buffer.from(s.png.split(',')[1]!, 'base64')));
  const head = readFileSync(MP4).subarray(0, 12);
  return {
    file: MP4, bytes: statSync(MP4).size, container: head.toString('ascii', 4, 8) === 'ftyp' ? `MP4 (${head.toString('ascii', 8, 12)})` : 'not MP4',
    duration_s: Number(r.duration.toFixed(2)), expected_s: Number(tl.total.toFixed(2)), width: r.width, height: r.height,
    frames_checked: r.shots.map((s) => ({ t: Number(s.t.toFixed(1)), mean_brightness: Number(s.brightness.toFixed(1)) })),
    audio_checked: r.levels.map((l) => ({ t: Number(l.t.toFixed(1)), rms_peak: Number(l.rms_peak.toFixed(4)) })),
  };
}

// ── main ──
mkdirSync(WORK, { recursive: true });
mkdirSync(ART, { recursive: true });
log('narrating (Windows speech, offline)…');
const narr = narrate();
for (const [id, n] of narr) log(`  ${id}: ${n.seconds.toFixed(1)} s`);
let tourData: { marks: Mark[]; frames: Frame[] };
if (skipTour && existsSync(join(WORK, 'tour.json'))) tourData = JSON.parse(readFileSync(join(WORK, 'tour.json'), 'utf8'));
else tourData = await tour(narr);
const { tl, audio } = timeline(narr, tourData.marks, tourData.frames);
writeFileSync(join(WORK, 'timeline.json'), JSON.stringify(tl));
writeFileSync(join(WORK, 'mix.wav'), audio);
writeFileSync(SRT, tl.cues.map((c, i) => `${i + 1}\n${srtTime(c.s)} --> ${srtTime(c.e)}\n${c.text}\n`).join('\n'));
log(`captions: ${tl.cues.length} cues → ${SRT}`);
const out = await compose(tl);
writeFileSync(MP4, readFileSync(out));
const report = await verify(tl);
writeFileSync(join(WORK, 'verify.json'), JSON.stringify({ ...report, scenes: tourData.marks, frames_captured: tourData.frames.length, console_errors: (JSON.parse(readFileSync(join(WORK, 'tour.json'), 'utf8')) as { console_errors: string[] }).console_errors }, null, 2));
console.log(JSON.stringify(report, null, 2));
log(`frames: ${readdirSync(FRAMES).length} captured; samples in artifacts/walkthrough-frames/`);
