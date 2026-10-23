#!/usr/bin/env node
// ATLAS local hosting control script. Runs the API and web app on this computer, bound to
// loopback only, with data persisted under ./data. No dependencies beyond Node 20+.
//
//   node scripts/atlas.mjs <start|stop|restart|status|logs|backup|restore|update|test|seed> [options]
//
// Safety rules: never deletes ./data or a backup; restore moves current data aside first;
// the database is only seeded when it does not exist yet.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const RUN = join(ROOT, '.atlas', 'run');
const LOGS = join(ROOT, '.atlas', 'logs');
const BACKUPS = join(ROOT, 'backups');
const ENV_FILE = join(ROOT, '.env.local');
const API_DIR = join(ROOT, 'apps', 'api');
const WEB_DIR = join(ROOT, 'apps', 'web');
const HOST = '127.0.0.1';
// Windows ships bsdtar in System32. Under Git Bash, GNU tar comes first on PATH and reads "C:..." as a
// remote host, so always use the system tar on Windows.
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const log = (...a) => console.log('[atlas]', ...a);
class AtlasError extends Error {}
// Throw instead of process.exit(): exiting while a fetch is still closing trips a libuv assertion on Windows.
const fail = (msg, code = 1) => {
  process.exitCode = code;
  throw new AtlasError(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

// ---------- configuration ----------

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/** Local settings live in .env.local (git-ignored). A random APP_SECRET is created on first run. */
function loadLocalEnv() {
  let file = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
  if (!file.APP_SECRET) {
    const secret = randomBytes(32).toString('hex');
    const header = existsSync(ENV_FILE) ? '' : '# ATLAS local settings (created by scripts/atlas.mjs). Never commit this file.\n# See docs/deployment/LOCAL_HOSTING.md for every option.\n';
    writeFileSync(ENV_FILE, `${existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').replace(/\s*$/, '\n') : header}APP_SECRET=${secret}\n`);
    log('Created .env.local with a new random APP_SECRET.');
    file = parseEnv(readFileSync(ENV_FILE, 'utf8'));
  }
  const apiPort = Number(file.API_PORT ?? 4000);
  const webPort = Number(file.WEB_PORT ?? 3000);
  const env = {
    NODE_ENV: 'development',
    EMAIL_TRANSPORT: 'outbox',
    AI_PROVIDER: 'deterministic',
    PAYMENT_GATEWAY: 'sandbox',
    LOG_LEVEL: 'info',
    ...file,
    // Paths are always absolute so the processes agree regardless of their working directory.
    PGLITE_DIR: file.PGLITE_DIR ? resolve(ROOT, file.PGLITE_DIR) : join(DATA, 'pglite'),
    OBJECT_STORE_DIR: file.OBJECT_STORE_DIR ? resolve(ROOT, file.OBJECT_STORE_DIR) : join(DATA, 'objects'),
    API_PORT: String(apiPort),
    WEB_ORIGIN: file.WEB_ORIGIN ?? `http://localhost:${webPort}`,
    ATLAS_API_URL: `http://${HOST}:${apiPort}`,
    ATLAS_RUN_DIR: RUN,
  };
  if (env.NODE_ENV === 'production') fail('Local hosting runs in development mode with synthetic data. Production deployment is not part of this build; see docs/RUNBOOK.md and docs/KNOWN_LIMITATIONS.md.');
  return { env, apiPort, webPort };
}

// ---------- process helpers ----------

const pidFile = (name) => join(RUN, `${name}.pid`);
const readPid = (name) => (existsSync(pidFile(name)) ? Number(readFileSync(pidFile(name), 'utf8').trim()) || null : null);
function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}
function killTree(pid) {
  if (!alive(pid)) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
    }
  }
}

function launch(name, args, cwd, env) {
  mkdirSync(LOGS, { recursive: true });
  mkdirSync(RUN, { recursive: true });
  const out = openSync(join(LOGS, `${name}.log`), 'a');
  writeFileSync(out, `\n===== ${new Date().toISOString()} starting ${name} =====\n`);
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  closeSync(out);
  writeFileSync(pidFile(name), String(child.pid));
  return child.pid;
}

async function httpOk(url, timeoutMs = 3000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: r.ok, status: r.status, body: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, body: String(e.cause?.code ?? e.message) };
  }
}
async function waitFor(url, label, timeoutMs, pidName) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const r = await httpOk(url);
    if (r.ok) return r;
    if (pidName && !alive(readPid(pidName))) fail(`${label} exited during startup. See: node scripts/atlas.mjs logs ${pidName}`);
    await sleep(1000);
  }
  fail(`${label} did not become healthy within ${Math.round(timeoutMs / 1000)} s. See: node scripts/atlas.mjs logs`);
}

const bin = (pkg, rel) => {
  const p = join(ROOT, 'node_modules', pkg, rel);
  if (!existsSync(p)) fail(`Dependency ${pkg} is not installed. Run: npm install   (or: node scripts/atlas.mjs update)`);
  return p;
};
const TSX = () => bin('tsx', join('dist', 'cli.mjs'));
const NEXT = () => bin('next', join('dist', 'bin', 'next'));

function run(cmd, args, cwd = ROOT, env = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed with exit code ${r.status}`);
}

// ---------- commands ----------

function isSeeded(env) {
  return existsSync(join(env.PGLITE_DIR, 'PG_VERSION'));
}

async function seedIfNeeded(env) {
  if (env.DATABASE_URL) return; // external PostgreSQL: seeding is an explicit `seed` command
  if (isSeeded(env)) return;
  log('First run: creating the local database and loading the synthetic development dataset.');
  log('This takes a few minutes and only happens once. Progress is written to .atlas/logs/seed.log');
  mkdirSync(LOGS, { recursive: true });
  const out = openSync(join(LOGS, 'seed.log'), 'a');
  const r = spawnSync(process.execPath, [TSX(), 'src/cli/seed.ts'], { cwd: API_DIR, env: { ...process.env, ...env }, stdio: ['ignore', out, out], windowsHide: true });
  closeSync(out);
  if (r.status !== 0) fail('Seeding failed. See .atlas/logs/seed.log. The partial database was left in place for inspection; move ./data aside before retrying.');
  log('Database seeded.');
}

/**
 * Runs missed end-of-day cycles before the API starts. The embedded database computes in-process,
 * so a catch-up inside the API would leave it unable to answer requests for several minutes.
 */
function catchUp(env) {
  if (env.DATABASE_URL || env.ATLAS_BACKGROUND_JOBS === 'false') return;
  log('Bringing market data up to date (missed trading days, if any). Progress: .atlas/logs/pipeline.log');
  mkdirSync(LOGS, { recursive: true });
  const out = openSync(join(LOGS, 'pipeline.log'), 'a');
  const r = spawnSync(process.execPath, [TSX(), 'src/cli/pipeline.ts'], { cwd: API_DIR, env: { ...process.env, ...env }, stdio: ['ignore', out, out], windowsHide: true });
  closeSync(out);
  // Not fatal: the API's own scheduler retries, it just answers slowly while it does.
  if (r.status !== 0) log('Catch-up did not finish; the API will retry it in the background. See .atlas/logs/pipeline.log');
  else log('Market data is up to date.');
}

function webBuilt() {
  return existsSync(join(WEB_DIR, '.next', 'BUILD_ID'));
}

async function start() {
  const { env, apiPort, webPort } = loadLocalEnv();
  if (alive(readPid('api')) || alive(readPid('web'))) {
    log('ATLAS is already running.');
    return status();
  }
  for (const [port, label] of [[apiPort, 'API'], [webPort, 'web']]) {
    const r = await httpOk(`http://${HOST}:${port}/`, 1500);
    if (r.status !== 0) fail(`Port ${port} (${label}) is already in use by another program. Set ${label === 'API' ? 'API_PORT' : 'WEB_PORT'} in .env.local.`);
  }
  if (!webBuilt()) {
    log('Web app is not built yet; building (one time).');
    run('npm', ['run', 'build', '-w', '@atlas/shared']);
    run('npm', ['run', 'build', '-w', '@atlas/web'], ROOT, { ATLAS_API_URL: env.ATLAS_API_URL });
  }
  await seedIfNeeded(env);
  catchUp(env);
  rmSync(join(RUN, 'api.stop'), { force: true });
  launch('api', [TSX(), 'src/server.ts'], API_DIR, env);
  await waitFor(`http://${HOST}:${apiPort}/readyz`, 'API', 120_000, 'api');
  launch('web', [NEXT(), 'start', '-p', String(webPort), '-H', HOST], WEB_DIR, env);
  await waitFor(`http://${HOST}:${webPort}/`, 'Web app', 90_000, 'web');
  log(`ATLAS is running at http://localhost:${webPort}  (API on ${HOST}:${apiPort}, loopback only)`);
  log('Sign in with a development account: free@atlas.test, plus@atlas.test, pro@atlas.test (password in apps/api/src/seed.ts).');
  log('Stop with: node scripts/atlas.mjs stop');
}

async function stop() {
  const api = readPid('api');
  const web = readPid('web');
  if (!alive(api) && !alive(web)) {
    log('ATLAS is not running.');
  }
  if (alive(web)) {
    killTree(web); // the web server is stateless
    log('Web app stopped.');
  }
  if (alive(api)) {
    // Graceful: the API closes the database (flushing PGlite to disk) when it sees the stop file.
    mkdirSync(RUN, { recursive: true });
    writeFileSync(join(RUN, 'api.stop'), new Date().toISOString());
    const t = Date.now();
    while (alive(api) && Date.now() - t < 30_000) await sleep(300);
    if (alive(api)) {
      log('API did not stop within 30 s; forcing it to stop. Recent writes may need the last backup.');
      killTree(api);
    } else log('API stopped cleanly.');
  }
  rmSync(pidFile('api'), { force: true });
  rmSync(pidFile('web'), { force: true });
  rmSync(join(RUN, 'api.stop'), { force: true });
}

async function status() {
  const { env, apiPort, webPort } = loadLocalEnv();
  const api = readPid('api');
  const web = readPid('web');
  const ready = await httpOk(`http://${HOST}:${apiPort}/readyz`);
  const webR = await httpOk(`http://${HOST}:${webPort}/`);
  const line = (name, pid, r) => `${name.padEnd(4)} ${alive(pid) ? `running (pid ${pid})` : 'stopped'}${r.ok ? ' · healthy' : r.status ? ` · HTTP ${r.status}` : ''}`;
  console.log(line('API', api, ready));
  if (ready.ok) console.log(`     readiness: ${ready.body.slice(0, 300)}`);
  console.log(line('Web', web, webR));
  console.log(`Data: ${env.DATABASE_URL ? 'external PostgreSQL (DATABASE_URL)' : env.PGLITE_DIR} ${isSeeded(env) ? '' : '(not created yet)'}`);
  console.log(`URL:  http://localhost:${webPort}`);
  const healthy = alive(api) && alive(web) && ready.ok && webR.ok;
  process.exitCode = healthy ? 0 : alive(api) || alive(web) ? 2 : 3;
}

async function logs(args) {
  const which = args.find((a) => !a.startsWith('-')) ?? 'api';
  const n = Number((args.find((a) => a.startsWith('--lines=')) ?? '--lines=80').split('=')[1]);
  const file = join(LOGS, `${which}.log`);
  if (!existsSync(file)) fail(`No log yet at ${file}`);
  const print = () => readFileSync(file, 'utf8').split('\n').slice(-n).join('\n');
  console.log(print());
  if (args.includes('--follow') || args.includes('-f')) {
    let size = statSync(file).size;
    for (;;) {
      await sleep(1000);
      const s = statSync(file).size;
      if (s > size) {
        const stream = createReadStream(file, { start: size, end: s - 1 });
        for await (const chunk of stream) process.stdout.write(chunk);
        size = s;
      }
    }
  }
}

function sha256(file) {
  const h = createHash('sha256');
  h.update(readFileSync(file));
  return h.digest('hex');
}

async function backup() {
  const { env } = loadLocalEnv();
  if (env.DATABASE_URL) fail('DATABASE_URL points to an external PostgreSQL server; back it up with pg_dump (see LOCAL_HOSTING.md).');
  if (!existsSync(DATA)) fail('There is no ./data directory to back up yet.');
  const wasRunning = alive(readPid('api'));
  if (wasRunning) {
    log('Stopping ATLAS so the backup is consistent.');
    await stop();
  }
  mkdirSync(BACKUPS, { recursive: true });
  const name = `atlas-backup-${stamp()}.tar.gz`;
  const file = join(BACKUPS, name);
  // Windows 10+ ships bsdtar as tar.exe; relative paths keep the archive portable.
  const r = spawnSync(TAR, ['-czf', file, '-C', ROOT, 'data'], { stdio: 'inherit' });
  if (r.status !== 0) fail('tar failed; no backup was written.');
  const manifest = { file: name, created_at: new Date().toISOString(), sha256: sha256(file), bytes: statSync(file).size, contains: 'data/ (PGlite database and object store)', atlas_version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version };
  writeFileSync(`${file}.json`, JSON.stringify(manifest, null, 2));
  log(`Backup written: backups/${name} (${(manifest.bytes / 1e6).toFixed(1)} MB, sha256 ${manifest.sha256.slice(0, 12)}…)`);
  if (wasRunning) await start();
  return file;
}

async function restore(args) {
  const arg = args[0];
  if (!arg) {
    const list = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => f.endsWith('.tar.gz')).sort() : [];
    console.log(list.length ? `Available backups:\n${list.map((f) => `  backups/${f}`).join('\n')}\n\nRestore with: node scripts/atlas.mjs restore backups/<file>` : 'No backups in ./backups');
    return;
  }
  const file = resolve(ROOT, arg);
  if (!existsSync(file)) fail(`Backup not found: ${file}`);
  if (existsSync(`${file}.json`)) {
    const m = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
    if (m.sha256 !== sha256(file)) fail('Checksum mismatch: the backup file is damaged or was changed. Nothing was restored.');
    log('Checksum verified.');
  } else log('No manifest found next to the backup; restoring without checksum verification.');
  const list = spawnSync(TAR, ['-tzf', file], { encoding: 'utf8' });
  if (list.status !== 0 || !list.stdout.split(/\r?\n/).every((l) => !l || l.startsWith('data/') || l === 'data')) fail('This archive is not an ATLAS data backup. Nothing was restored.');
  const wasRunning = alive(readPid('api'));
  if (wasRunning) await stop();
  if (existsSync(DATA)) {
    const aside = join(ROOT, `data.before-restore-${stamp()}`);
    renameSync(DATA, aside);
    log(`Current data moved aside to ${aside} (not deleted).`);
  }
  const r = spawnSync(TAR, ['-xzf', file, '-C', ROOT], { stdio: 'inherit' });
  if (r.status !== 0) fail('Extraction failed. Your previous data is in the data.before-restore-* folder; rename it back to data to recover.');
  log('Restore complete.');
  if (wasRunning || args.includes('--start')) await start();
}

async function update() {
  log('Update: back up data, install dependencies, rebuild, restart. Database migrations apply automatically and are forward-only.');
  const wasRunning = alive(readPid('api'));
  if (existsSync(DATA)) await backup();
  if (alive(readPid('api'))) await stop();
  run('npm', ['install']);
  run('npm', ['run', 'build']);
  if (wasRunning) await start();
  else log('Updated. Start with: node scripts/atlas.mjs start');
}

async function seedCmd() {
  const { env } = loadLocalEnv();
  if (alive(readPid('api'))) fail('Stop ATLAS before seeding (the embedded database allows one process at a time).');
  if (isSeeded(env)) fail('A database already exists; seeding is only done on an empty database. To start fresh, run backup, then move ./data aside yourself.');
  await seedIfNeeded(env);
}

/** Digital-assets data CLI (status, run <jobs…>, tick [rounds], jobs). Needs the API stopped: one process per embedded database. */
async function cryptoCmd(args) {
  const { env } = loadLocalEnv();
  if (!env.DATABASE_URL && alive(readPid('api'))) fail('Stop ATLAS first (node scripts/atlas.mjs stop): the embedded database allows one process at a time. While ATLAS runs, its own scheduler refreshes crypto data.');
  const r = spawnSync(process.execPath, [TSX(), 'src/cli/crypto.ts', ...(args.length ? args : ['status'])], { cwd: API_DIR, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) fail('The crypto command failed (see the output above).');
}

/**
 * Recovery drill: restores a backup into a TEMPORARY folder (never ./data), checks its integrity, starts a
 * second API on port 4100 against the copy, confirms /readyz, then stops it and deletes the copy.
 */
async function verifyBackup(args) {
  const arg = args[0] ?? (existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((x) => x.endsWith('.tar.gz')).sort().map((x) => join('backups', x)).pop() : undefined);
  if (!arg) fail('No backup to verify. Create one with: node scripts/atlas.mjs backup');
  const file = resolve(ROOT, arg);
  if (!existsSync(file)) fail(`Backup not found: ${file}`);
  if (existsSync(`${file}.json`)) {
    const m = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
    if (m.sha256 !== sha256(file)) fail('Checksum mismatch: the backup file is damaged or was changed.');
    log('Checksum verified.');
  } else log('No manifest next to the backup; checksum not verified.');
  const list = spawnSync(TAR, ['-tzf', file], { encoding: 'utf8' });
  if (list.status !== 0 || !list.stdout.split(/\r?\n/).every((l) => !l || l.startsWith('data/') || l === 'data')) fail('This archive is not an ATLAS data backup.');
  const tmp = join(ROOT, '.atlas', `verify-${stamp()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const x = spawnSync(TAR, ['-xzf', file, '-C', tmp], { stdio: 'inherit' });
    if (x.status !== 0) fail('Extraction failed.');
    log(`Restored a copy into ${tmp} (your ./data is untouched).`);
    const pg = join(tmp, 'data', 'pglite');
    const chk = spawnSync(process.execPath, [TSX(), 'src/cli/verify-backup.ts', pg], { cwd: API_DIR, stdio: 'inherit', windowsHide: true });
    if (chk.status !== 0) fail('Integrity check failed on the restored copy (see above).');
    const port = 4100;
    const { env } = loadLocalEnv();
    const child = spawn(process.execPath, [TSX(), 'src/server.ts'], { cwd: API_DIR, env: { ...process.env, ...env, PGLITE_DIR: pg, OBJECT_STORE_DIR: join(tmp, 'data', 'objects'), API_PORT: String(port), ATLAS_BACKGROUND_JOBS: 'false', LOG_LEVEL: 'warn' }, stdio: 'ignore', windowsHide: true });
    let ready = null;
    for (let i = 0; i < 120 && !ready; i++) {
      await sleep(1000);
      const r = await httpOk(`http://${HOST}:${port}/readyz`, 2000);
      if (r.status === 200) ready = r;
    }
    killTree(child.pid);
    await sleep(1500);
    if (!ready) fail('The API did not become ready against the restored copy.');
    log(`API started against the restored copy and answered /readyz on port ${port}.`);
    log('Recovery drill passed.');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  start, stop, status, backup,
  restart: async () => { await stop(); await start(); },
  logs: () => logs(rest),
  restore: () => restore(rest),
  update,
  test: () => run('npm', ['test']),
  seed: seedCmd,
  crypto: () => cryptoCmd(rest),
  'verify-backup': () => verifyBackup(rest),
};
if (!cmd || !commands[cmd]) {
  console.log('Usage: node scripts/atlas.mjs <start|stop|restart|status|logs [api|web|seed] [--follow]|backup|restore [file] [--start]|update|test|seed|crypto [status|run <job…>|tick [rounds]|jobs]|verify-backup [file]>');
  process.exit(cmd ? 1 : 0);
}
try {
  await commands[cmd]();
} catch (e) {
  if (!(e instanceof AtlasError)) throw e;
  console.error(`[atlas] ERROR: ${e.message}`);
}
