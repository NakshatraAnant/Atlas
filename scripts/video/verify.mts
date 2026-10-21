// Playback check for rendered Academy videos, in Microsoft Edge (the same engine users run):
// loads each file, checks the duration against the metadata, plays it muted and confirms that both
// video and audio are decoded, loads the caption track, and saves frames at several points for a
// visual check. Usage: npx tsx scripts/video/verify.mts [video-id ...]
// Frames: .atlas/video-work/<id>/check-<n>.png
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseRange } from '../../apps/api/src/modules/academy/videos.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA = join(ROOT, 'apps', 'api', 'media', 'academy-videos');
const META = join(ROOT, 'apps', 'api', 'src', 'modules', 'academy', 'videos.generated.json');
const WORK = join(ROOT, '.atlas', 'video-work');

// Served over HTTP with byte ranges, as the API serves them (a file:// page cannot read file:// media with CORS).
const TYPES: Record<string, string> = { webm: 'video/webm', vtt: 'text/vtt', html: 'text/html' };
const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '');
  const file = name.endsWith('.html') ? join(WORK, name) : join(MEDIA, name);
  if (name.includes('..') || !existsSync(file)) { res.writeHead(404).end(); return; }
  const size = statSync(file).size;
  const type = TYPES[name.split('.').pop()!] ?? 'application/octet-stream';
  const r = parseRange(req.headers.range, size);
  if (r === 'invalid') { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
  if (!r) { res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' }); createReadStream(file).pipe(res); return; }
  res.writeHead(206, { 'content-type': type, 'content-length': r.end - r.start + 1, 'content-range': `bytes ${r.start}-${r.end}/${size}`, 'accept-ranges': 'bytes' });
  createReadStream(file, r).pipe(res);
});
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const meta = JSON.parse(readFileSync(META, 'utf8')) as { id: string; duration_s: number; bytes: number }[];
const only = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
try {
  for (const v of meta.filter((m) => !only.length || only.includes(m.id))) {
    const webm = join(MEDIA, `${v.id}.webm`);
    if (!existsSync(webm)) { console.log(`${v.id}: FAIL file missing`); failed++; continue; }
    const dir = join(WORK, v.id);
    mkdirSync(dir, { recursive: true });
    const html = join(WORK, `verify-${v.id}.html`);
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><video id="v" muted playsinline src="/${v.id}.webm"><track kind="captions" src="/${v.id}.vtt" default></video>`);
    const page = await browser.newPage();
    // tsx compiles named inner functions with an __name helper that does not exist in the page.
    await page.addInitScript({ content: 'window.__name = (f) => f;' });
    await page.goto(`${BASE}/verify-${v.id}.html`);
    const r = await page.evaluate(async (expected) => {
      const el = document.getElementById('v') as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; webkitVideoDecodedByteCount?: number };
      const once = (e: string) => new Promise<void>((ok, bad) => { const t = setTimeout(() => bad(new Error(`timed out waiting for ${e} (readyState ${el.readyState}, networkState ${el.networkState}, error ${el.error?.code ?? 'none'})`)), 20000); el.addEventListener(e, () => { clearTimeout(t); ok(); }, { once: true }); el.addEventListener('error', () => bad(new Error(`media error ${el.error?.code} ${el.error?.message}`)), { once: true }); });
      if (el.readyState < 1) await once('loadedmetadata');
      // WebM written by a streaming muxer may report Infinity until the end is seen.
      if (!Number.isFinite(el.duration)) { el.currentTime = 1e9; await once('seeked'); el.currentTime = 0; await once('seeked'); }
      await el.play();
      await new Promise((ok) => setTimeout(ok, 1500));
      el.pause();
      const track = el.textTracks[0];
      if (track) track.mode = 'hidden';
      await new Promise((ok) => setTimeout(ok, 300));
      const frames: string[] = [];
      const c = document.createElement('canvas');
      c.width = el.videoWidth; c.height = el.videoHeight;
      for (const f of [0.03, 0.2, 0.45, 0.7, 0.97]) {
        el.currentTime = expected * f;
        await once('seeked');
        c.getContext('2d')!.drawImage(el, 0, 0);
        frames.push(c.toDataURL('image/png'));
      }
      return { duration: el.duration, width: el.videoWidth, height: el.videoHeight, audioBytes: el.webkitAudioDecodedByteCount ?? -1, videoBytes: el.webkitVideoDecodedByteCount ?? -1, cues: track?.cues?.length ?? 0, frames };
    }, v.duration_s);
    await page.close();
    r.frames.forEach((d, i) => writeFileSync(join(dir, `check-${i + 1}.png`), Buffer.from(d.split(',')[1]!, 'base64')));
    const problems = [
      Math.abs(r.duration - v.duration_s) > 0.6 && `duration ${r.duration.toFixed(2)}s vs ${v.duration_s}s`,
      (r.width !== 1280 || r.height !== 720) && `size ${r.width}x${r.height}`,
      r.videoBytes <= 0 && 'no video decoded',
      r.audioBytes <= 0 && 'no audio decoded',
      r.cues < 5 && `only ${r.cues} caption cues`,
    ].filter(Boolean);
    console.log(`${v.id}: ${problems.length ? 'FAIL ' + problems.join('; ') : 'OK'} (duration ${r.duration.toFixed(2)}s, ${r.width}x${r.height}, decoded video ${r.videoBytes} B, audio ${r.audioBytes} B, ${r.cues} cues, ${(v.bytes / 1e6).toFixed(1)} MB)`);
    if (problems.length) failed++;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
