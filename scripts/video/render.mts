// Renders the ATLAS Academy videos locally: offline narration (Windows speech) + canvas animation
// encoded in Microsoft Edge with WebCodecs (VP9/Opus) + WebM muxing. No network, no external service.
// Usage: npx tsx scripts/video/render.mts [video-id ...]
// Output: apps/api/media/academy-videos/<id>.{webm,png,vtt,txt} and
//         apps/api/src/modules/academy/videos.generated.json (metadata read by the API).
// The files are served by the API (/v1/academy/videos/...), behind the same sign-in and
// review-status gate as the lesson they belong to, never as public static files.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { equalWeightVol } from '../../packages/shared/src/learning-sims-courses.js';
import { threeStatements, DEFAULT_STATEMENT_INPUTS } from '../../packages/shared/src/three-statements.js';
import { impermanentLoss, simulateTokenomics } from '../../packages/shared/src/crypto-sims.js';
import { VIDEO_SCRIPTS, type VideoScript } from './scripts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(ROOT, 'apps', 'api', 'media', 'academy-videos');
const META = join(ROOT, 'apps', 'api', 'src', 'modules', 'academy', 'videos.generated.json');
const WORK = join(ROOT, '.atlas', 'video-work');
const VOICE = 'Microsoft Zira Desktop';
const LEAD_IN = 0.5;
const TAIL = 0.9;

// ── 1. Check every number in the scripts against the tested shared functions ──
function checkScripts() {
  const fail = (m: string) => { throw new Error(`Script check failed: ${m}`); };
  const close = (a: number, b: number, tol: number, what: string) => { if (Math.abs(a - b) > tol) fail(`${what}: script ${a}, computed ${b}`); };
  const s = threeStatements(DEFAULT_STATEMENT_INPUTS);
  const ed = VIDEO_SCRIPTS.find((v) => v.id === 'ed-intro')!;
  const pl = ed.scenes[1]!.visual as { steps: { label: string; value: number }[] };
  const get = (steps: { label: string; value: number }[], l: string) => steps.find((x) => x.label === l)!.value;
  close(get(pl.steps, 'Revenue'), s.income.revenue, 1e-9, 'revenue');
  close(-get(pl.steps, 'Operating costs'), s.income.operatingCosts, 1e-9, 'operating costs');
  close(get(pl.steps, 'EBITDA'), s.income.ebitda, 1e-9, 'EBITDA');
  close(get(pl.steps, 'Net profit'), s.income.pat, 1e-9, 'net profit');
  const cf = ed.scenes[2]!.visual as { steps: { label: string; value: number }[] };
  close(get(cf.steps, 'Operating cash flow'), s.cashFlow.operating, 1e-9, 'operating cash flow');
  close(get(cf.steps, 'Free cash flow'), s.links.freeCashFlow, 1e-9, 'free cash flow');
  const ratios = ed.scenes[4]!.visual as { items: { value: number }[] };
  close(ratios.items[1]!.value, s.links.cashConversionPct!, 0.5, 'cash conversion');
  close(ratios.items[2]!.value, (s.balanceSheet.opening.debt / s.balanceSheet.opening.equity) * 100, 1e-9, 'debt to equity');
  const se = VIDEO_SCRIPTS.find((v) => v.id === 'se-intro')!;
  const mt = se.scenes[3]!.visual as { items: { value: number }[] };
  [1, 5, 10, 20].forEach((n, i) => close(mt.items[i]!.value, (1 - 0.95 ** n) * 100, 0.05, `false-positive chance for ${n} tests`));
  const ma = VIDEO_SCRIPTS.find((v) => v.id === 'ma-intro')!;
  const dcf = ma.scenes[2]!.visual as { items: { value: number }[] };
  [0.1, 0.12, 0.14].forEach((r, i) => close(dcf.items[i]!.value, 100 / (r - 0.04), 0.01, `value at ${r * 100}%`));
  const pv = ma.scenes[4]!.visual as { items: { value: number }[] };
  [1, 5, 20].forEach((n, i) => close(pv.items[i]!.value, equalWeightVol(30, n, 0.3), 0.05, `portfolio volatility with ${n}`));
  close(pv.items[3]!.value, 30 * Math.sqrt(0.3), 0.05, 'volatility floor');
  const md = VIDEO_SCRIPTS.find((v) => v.id === 'md-intro')!;
  const line = md.scenes[4]!.visual as { points: { value: number }[] };
  close(line.points[2]!.value, 100 * 1.2 * 0.8, 1e-9, '+20% then −20%');
  // Digital-assets track
  const cd = VIDEO_SCRIPTS.find((v) => v.id === 'cd-intro')!;
  const conf = cd.scenes[2]!.visual as { points: { value: number }[] };
  conf.points.forEach((p, i) => close(p.value, i + 1, 0, `confirmations at block ${100 + i}`));
  const mc = cd.scenes[5]!.visual as { items: { value: number }[] };
  close(mc.items[0]!.value, (20_000_000 * 50_000) / 1e12, 1e-9, 'market cap');
  close(mc.items[1]!.value, (21_000_000 * 50_000) / 1e12, 1e-9, 'FDV');
  const td = VIDEO_SCRIPTS.find((v) => v.id === 'td-intro')!;
  const sup = td.scenes[2]!.visual as { items: { value: number }[] };
  const sim = simulateTokenomics({ initialCirculating: 400, tranches: [{ label: 'team', amount: 200, cliffMonths: 12, vestingMonths: 24 }, { label: 'investors', amount: 150, cliffMonths: 6, vestingMonths: 12 }], monthlyEmission: 0, monthlyBurnRate: 0, maxSupply: null, price: 1, months: 36 });
  [0, 12, 24, 36].forEach((m, i) => close(sup.items[i]!.value, sim[m]!.circulating, 0.5, `circulating at month ${m}`));
  const oe = VIDEO_SCRIPTS.find((v) => v.id === 'oe-intro')!;
  const ann = oe.scenes[3]!.visual as { items: { value: number }[] };
  close(ann.items[0]!.value, 3 * Math.sqrt(365), 0.05, '3% x sqrt(365)');
  close(ann.items[1]!.value, 3 * Math.sqrt(252), 0.05, '3% x sqrt(252)');
  const fp = oe.scenes[4]!.visual as { items: { value: number }[] };
  [1, 5, 20].forEach((n, i) => close(fp.items[i]!.value, (1 - 0.95 ** n) * 100, 0.05, `false positives with ${n} rules`));
  const aa = VIDEO_SCRIPTS.find((v) => v.id === 'aa-intro')!;
  const il = aa.scenes[3]!.visual as { items: { value: number }[] };
  [1.5, 2, 4].forEach((x, i) => close(il.items[i]!.value, impermanentLoss(x) * 100, 0.01, `impermanent loss at ${x}x`));
  console.log('Script numbers checked against packages/shared: OK');
}

// ── 2. Narration ──
function readWav(file: string): { pcm: Float32Array; seconds: number } {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
  let p = 12;
  let rate = 0;
  let bits = 0;
  let channels = 0;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      channels = b.readUInt16LE(p + 10);
      rate = b.readUInt32LE(p + 12);
      bits = b.readUInt16LE(p + 22);
    } else if (id === 'data') {
      if (rate !== 48000 || bits !== 16 || channels !== 1) throw new Error(`${file}: expected 48 kHz 16-bit mono, got ${rate} Hz ${bits}-bit ${channels} ch`);
      const n = size / 2;
      const pcm = new Float32Array(n);
      for (let i = 0; i < n; i++) pcm[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return { pcm, seconds: n / rate };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

function narrate(v: VideoScript) {
  const dir = join(WORK, v.id);
  mkdirSync(dir, { recursive: true });
  const segs = v.scenes.map((s, i) => ({ file: join(dir, `seg-${String(i + 1).padStart(2, '0')}.wav`).replace(/\\/g, '/'), text: s.narration }));
  const manifest = join(dir, 'segments.json');
  writeFileSync(manifest, JSON.stringify(segs), 'utf8');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'narrate.ps1'), '-Manifest', manifest, '-Voice', VOICE], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Narration failed for ${v.id}: ${r.stderr || r.stdout}`);
  return segs.map((s) => readWav(s.file));
}

// ── 3. Captions and transcript ──
function cues(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= 90) { out.push(s); continue; }
    let cur = '';
    for (const part of s.split(/(?<=,)\s+/)) {
      if ((cur + ' ' + part).trim().length > 90 && cur) { out.push(cur.trim()); cur = part; } else cur = `${cur} ${part}`;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}
const ts = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};

async function main() {
  checkScripts();
  const only = process.argv.slice(2);
  const scripts = VIDEO_SCRIPTS.filter((v) => !only.length || only.includes(v.id));
  mkdirSync(OUT, { recursive: true });
  const meta: Record<string, unknown>[] = existsSync(META) ? JSON.parse(readFileSync(META, 'utf8')) : [];
  const page0 = join(WORK, 'engine.html');
  mkdirSync(WORK, { recursive: true });
  const muxerPath = join(ROOT, 'node_modules', 'webm-muxer', 'build', 'webm-muxer.js');
  writeFileSync(page0, `<!doctype html><meta charset="utf-8"><title>ATLAS video engine</title><script src="${pathToFileURL(muxerPath).href}"></script><script src="${pathToFileURL(join(HERE, 'engine.js')).href}"></script>`);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const v of scripts) {
      const t0 = Date.now();
      const audio = narrate(v);
      let at = 0;
      const timeline = v.scenes.map((s, i) => {
        const len = Math.max(i === 0 ? 5 : 3.5, LEAD_IN + audio[i]!.seconds + TAIL);
        const seg = { start: at, end: at + len, leadIn: LEAD_IN, speech: audio[i]!.seconds };
        at += len;
        return seg;
      });
      const total = at;
      const page = await browser.newPage();
      await page.goto(pathToFileURL(page0).href);
      const job = { script: v, timeline, total, posterAt: 2.6, audio: audio.map((a) => Buffer.from(a.pcm.buffer, a.pcm.byteOffset, a.pcm.byteLength).toString('base64')) };
      page.on('console', (m) => { if (m.type() === 'error') console.error(`[${v.id} page] ${m.text()}`); });
      // A stuck encoder must fail loudly, not hang the run: allow 6x real time, at least 5 minutes.
      const limitMs = Math.max(300_000, total * 6000);
      let timer: NodeJS.Timeout | undefined;
      const res = await Promise.race([
        page.evaluate(async (j) => (window as unknown as { renderVideo: (x: unknown) => Promise<{ webm: string; poster: string; frames: number; bytes: number }> }).renderVideo(j), job),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${v.id}: render exceeded ${Math.round(limitMs / 1000)}s`)), limitMs); }),
      ]).finally(() => clearTimeout(timer));
      await page.close();
      const webm = Buffer.from(res.webm, 'base64');
      if (webm.length < 10000 || webm.readUInt32BE(0) !== 0x1a45dfa3) throw new Error(`${v.id}: encoder produced no valid WebM`);
      writeFileSync(join(OUT, `${v.id}.webm`), webm);
      writeFileSync(join(OUT, `${v.id}.png`), Buffer.from(res.poster.split(',')[1]!, 'base64'));
      // Captions: each scene's narration split into cues across its spoken span, by character share.
      let vtt = 'WEBVTT\n\n';
      let n = 1;
      timeline.forEach((seg, i) => {
        const parts = cues(v.scenes[i]!.narration);
        const chars = parts.reduce((s, p) => s + p.length, 0);
        let t = seg.start + seg.leadIn;
        for (const p of parts) {
          const d = (p.length / chars) * seg.speech;
          vtt += `${n++}\n${ts(t)} --> ${ts(t + d)}\n${p}\n\n`;
          t += d;
        }
      });
      writeFileSync(join(OUT, `${v.id}.vtt`), vtt, 'utf8');
      const transcript = [`${v.title} (ATLAS Academy, ${v.scenes[0]!.visual.type === 'title' ? (v.scenes[0]!.visual as { course: string }).course : v.course_id})`, '', `Learning objective: ${v.objective}`, '', ...v.scenes.map((s) => s.narration), '', 'Narration: Microsoft Zira (Windows built-in offline speech). Animation rendered locally by scripts/video. Numbers are definitions or clearly labelled hypothetical or fictional examples. Status: in expert review. Education, not investment advice.'].join('\n');
      writeFileSync(join(OUT, `${v.id}.txt`), transcript, 'utf8');
      const sha = createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
      const entry = {
        id: v.id, course_id: v.course_id, lesson_id: v.lesson_id, title: v.title, objective: v.objective,
        // duration_s is the encoded length, as players report it.
        duration_s: Math.floor(((res.frames - 1) / 30) * 10) / 10,
        width: 1280, height: 720, fps: 30, codecs: 'VP9 + Opus (WebM)', bytes: webm.length,
        voice: VOICE, script_sha: sha, status: 'in_review', rendered_at: new Date().toISOString(),
      };
      const k = meta.findIndex((m) => m.id === v.id);
      if (k >= 0) meta[k] = entry; else meta.push(entry);
      console.log(`${v.id}: ${entry.duration_s}s, ${res.frames} frames, ${(webm.length / 1e6).toFixed(2)} MB, rendered in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  } finally {
    await browser.close();
  }
  meta.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  writeFileSync(META, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

await main();
