#!/usr/bin/env node
// Shares the local ATLAS through a Cloudflare quick tunnel (https://<random>.trycloudflare.com).
//
//   node scripts/share.mjs start    start the tunnel (or reuse a working one), point ATLAS at its address,
//                                   and update .atlas/share/SHARE_WITH_FRIEND.txt with the link
//   node scripts/share.mjs status   show the current link and whether it answers
//   node scripts/share.mjs stop     close the tunnel (the link stops working)
//
// A quick tunnel gets a new address every time it starts. ATLAS only accepts sign-ins from the address in
// WEB_ORIGIN (.env.local), so `start` writes the new address there and restarts ATLAS when it changed.
// Requires cloudflared (winget install Cloudflare.cloudflared). No Cloudflare account is used.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = join(ROOT, '.atlas', 'run');
const LOG = join(ROOT, '.atlas', 'logs', 'tunnel.log');
const PID = join(RUN, 'tunnel.pid');
const ENV = join(ROOT, '.env.local');
const SHARE = join(ROOT, '.atlas', 'share', 'SHARE_WITH_FRIEND.txt');
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const log = (m) => console.log(`[share] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cloudflared() {
  for (const p of ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe']) if (existsSync(p)) return p;
  const w = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  const p = w.stdout?.split(/\r?\n/)[0]?.trim();
  if (p) return p;
  throw new Error('cloudflared is not installed. Install it with: winget install Cloudflare.cloudflared');
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readPid = () => { try { return Number(readFileSync(PID, 'utf8').trim()) || null; } catch { return null; } };
const tunnelUrl = () => { try { return readFileSync(LOG, 'utf8').match(new RegExp(URL_RE.source, 'g'))?.pop() ?? null; } catch { return null; } };
const webPort = () => { try { return Number(readFileSync(ENV, 'utf8').match(/^WEB_PORT=(\d+)/m)?.[1]) || 3000; } catch { return 3000; } };

async function answers(url, tries = 1) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${url}/v1/status`, { signal: AbortSignal.timeout(10_000) }); if (r.ok) return true; } catch { /* not yet */ }
    if (i < tries - 1) await sleep(3000);
  }
  return false;
}

/** Point WEB_ORIGIN at the tunnel; returns true when the value changed. Only that one line is touched. */
function setOrigin(url) {
  const text = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
  if (new RegExp(`^WEB_ORIGIN=${url.replace(/[.]/g, '\\.')}\\s*$`, 'm').test(text)) return false;
  const line = `WEB_ORIGIN=${url}`;
  const next = /^WEB_ORIGIN=.*$/m.test(text) ? text.replace(/^WEB_ORIGIN=.*$/m, line) : `${text.replace(/\s*$/, '\n')}# Public tunnel address, written by scripts/share.mjs\n${line}\n`;
  writeFileSync(ENV, next);
  return true;
}

function updateShareFile(url) {
  mkdirSync(dirname(SHARE), { recursive: true });
  if (existsSync(SHARE)) {
    const t = readFileSync(SHARE, 'utf8');
    writeFileSync(SHARE, /^Link:.*$/m.test(t) ? t.replace(/^Link:.*$/m, `Link:      ${url}`) : `Link:      ${url}\n${t}`);
  } else {
    writeFileSync(SHARE, `Link:      ${url}\n(Ask the owner for the guest email and password.)\n`);
  }
}

async function start() {
  const exe = cloudflared();
  let pid = readPid();
  let url = pid && alive(pid) ? tunnelUrl() : null;
  if (url && (await answers(url))) {
    log(`Tunnel already running: ${url}`);
  } else {
    if (pid && alive(pid)) { try { process.kill(pid); } catch { /* gone */ } }
    mkdirSync(RUN, { recursive: true });
    mkdirSync(dirname(LOG), { recursive: true });
    writeFileSync(LOG, '');
    const child = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${webPort()}`, '--logfile', LOG], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    writeFileSync(PID, String(child.pid));
    log('Starting a Cloudflare quick tunnel…');
    url = null;
    for (let i = 0; i < 60 && !url; i++) { await sleep(1000); url = tunnelUrl(); }
    if (!url) throw new Error(`The tunnel did not report an address within 60 s. See ${LOG}.`);
  }
  if (setOrigin(url)) {
    log('ATLAS now accepts sign-ins from the new address; restarting it…');
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'atlas.mjs'), 'restart'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ATLAS did not restart; run node scripts/atlas.mjs restart.');
  }
  updateShareFile(url);
  // A brand-new quick-tunnel name can take a few seconds to resolve worldwide.
  const ok = await answers(url, 20);
  log(ok ? `Link ready: ${url}` : `Tunnel started at ${url}, but it did not answer yet; try status in a minute.`);
  log(`Message to send: ${SHARE}`);
}

async function status() {
  const pid = readPid();
  const url = pid && alive(pid) ? tunnelUrl() : null;
  if (!url) { log('No tunnel is running. Start one with: node scripts/share.mjs start'); return; }
  log(`${url} · ${(await answers(url)) ? 'answering' : 'not answering'} (pid ${pid})`);
}

function stop() {
  const pid = readPid();
  if (pid && alive(pid)) { process.kill(pid); log('Tunnel stopped; the link no longer works.'); } else log('No tunnel was running.');
}

const cmd = process.argv[2] ?? 'status';
try {
  if (cmd === 'start') await start();
  else if (cmd === 'stop') stop();
  else if (cmd === 'status') await status();
  else { console.log('Usage: node scripts/share.mjs <start|status|stop>'); process.exit(1); }
} catch (e) {
  console.error(`[share] ERROR: ${e.message}`);
  process.exit(1);
}
