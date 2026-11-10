// Decodes the whole soundtrack of the walkthrough MP4 in Edge and compares speech with the caption timings
// (per-second RMS; quiet seconds inside captions). Usage: npx tsx scripts/walkthrough/verify-audio.mts
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
const MP4 = 'artifacts/ATLAS_COMPLETE_PRODUCT_WALKTHROUGH.mp4';
const srv = createServer((req, res) => { if (req.url === '/a.mp4') { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': statSync(MP4).size }); createReadStream(MP4).pipe(res); } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); } });
await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
const port = (srv.address() as { port: number }).port;
const srt = readFileSync('artifacts/ATLAS_WALKTHROUGH.srt', 'utf8');
const sec = (s: string) => { const [h, m, r] = s.split(':'); const [x, ms] = r!.split(','); return +h! * 3600 + +m! * 60 + +x! + +ms! / 1000; };
const cues = [...srt.matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})/g)].map((m) => [sec(m[1]!), sec(m[2]!)] as const);
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage();
await p.goto(`http://127.0.0.1:${port}/`);
const rms = (await p.evaluate(`(async () => {
  const buf = await (await fetch('/a.mp4')).arrayBuffer();
  const ac = new OfflineAudioContext(1, 44100, 44100);
  const audio = await ac.decodeAudioData(buf);
  const d = audio.getChannelData(0); const sr = audio.sampleRate; const out = [];
  for (let s = 0; s * sr < d.length; s++) { let acc = 0, n = 0; for (let i = s * sr; i < Math.min(d.length, (s + 1) * sr); i++) { acc += d[i] * d[i]; n++; } out.push(Math.sqrt(acc / n)); }
  return [audio.duration, audio.numberOfChannels, out];
})()`)) as [number, number, number[]];
await b.close();
srv.close();
const [dur, ch, per] = rms;
const inCue = (t: number) => cues.some(([a, z]) => t + 1 > a && t < z);
let cueSecs = 0, cueSilent = 0;
per.forEach((v, t) => { if (inCue(t)) { cueSecs++; if (v < 0.005) cueSilent++; } });
const silentAt = per.map((v, t) => (inCue(t) && v < 0.005 ? t : -1)).filter((t) => t >= 0);
console.log("silent seconds inside captions:", silentAt.join(" "));
console.log(JSON.stringify({ audio_duration_s: +dur.toFixed(2), channels: ch, seconds: per.length, cue_count: cues.length, seconds_inside_captions: cueSecs, silent_seconds_inside_captions: cueSilent, overall_rms_mean: +(per.reduce((a, v) => a + v, 0) / per.length).toFixed(4) }));
