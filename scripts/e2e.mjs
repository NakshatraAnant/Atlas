// Browser end-to-end suite: prepares an isolated database from the test fixture, builds the web
// app, runs Playwright (Edge), then restarts the API and checks that data written during the run
// survived the restart. Usage: npm run test:e2e   (ports 3000 and 4000 must be free)
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = process.env.ATLAS_E2E_DIR ?? join(tmpdir(), 'atlas-e2e');
const env = { ...process.env, ATLAS_E2E_DIR: DATA };
const shell = process.platform === 'win32';
const run = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell, env: { ...env, ...extra } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
};

run('npx', ['tsx', 'scripts/e2e-prepare.mts', DATA]);
run('npx', ['tsx', 'scripts/e2e-crypto-seed.mts', join(DATA, 'pglite')]);
run('npm', ['run', 'build', '-w', '@atlas/shared']);
run('npm', ['run', 'build', '-w', '@atlas/web']);
const pw = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit', shell, env });
let code = pw.status ?? 1;

// Restart and recovery: the note created by the research spec must still exist after a restart.
const apiEnv = { ...env, PGLITE_DIR: join(DATA, 'pglite'), OBJECT_STORE_DIR: join(DATA, 'objects'), ATLAS_BACKGROUND_JOBS: 'false', CRYPTO_INGESTION: 'false', CRYPTO_LIVE_FEED: 'false', LOG_LEVEL: 'warn', APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e' };
const api = spawn('npx', ['tsx', 'apps/api/src/server.ts'], { shell, env: apiEnv, stdio: 'ignore' });
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    up = await fetch('http://127.0.0.1:4000/healthz').then((r) => r.ok).catch(() => false);
  }
  if (!up) throw new Error('API did not restart');
  const csrfRes = await fetch('http://127.0.0.1:4000/v1/auth/csrf');
  const cookie = (csrfRes.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const csrf = /atlas_csrf=([^;]+)/.exec(cookie)?.[1] ?? '';
  const login = await fetch('http://127.0.0.1:4000/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie, origin: 'http://localhost:3000' }, body: JSON.stringify({ email: 'pro@atlas.test', password: 'atlas-dev-Password-2026' }) });
  const session = [cookie, ...(login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])].join('; ');
  const notes = await (await fetch('http://127.0.0.1:4000/v1/notes', { headers: { cookie: session } })).json();
  const ok = Array.isArray(notes.notes) && notes.notes.some((n) => n.title === 'E2E persisted note');
  console.log(ok ? 'restart check: the note written during the run survived an API restart' : 'restart check FAILED: note not found after restart');
  if (!ok) code = 1;
} catch (err) {
  console.error('restart check FAILED:', err instanceof Error ? err.message : err);
  code = 1;
} finally {
  if (shell) spawnSync('taskkill', ['/pid', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
  else api.kill('SIGTERM');
}
process.exit(code);
