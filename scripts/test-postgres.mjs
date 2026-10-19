// Runs the real-PostgreSQL integration suite (apps/api/test/postgres.integration.test.ts) against a
// throwaway PostgreSQL 17 started from the embedded-postgres dev dependency: no Docker, WSL or admin
// rights needed. Listens on 127.0.0.1 only, uses a temporary data directory, and is always removed.
// Usage: npm run test:postgres
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
const EmbeddedPostgres = (await import(pathToFileURL(require.resolve('embedded-postgres')).href)).default;

const port = Number(process.env.ATLAS_TEST_PG_PORT ?? 54329);
const dir = mkdtempSync(join(tmpdir(), 'atlas-pg-'));
// Throwaway credentials for a loopback-only test server that is deleted afterwards.
const pg = new EmbeddedPostgres({ databaseDir: join(dir, 'data'), user: 'atlas_test', password: 'atlas_test', port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-c', 'listen_addresses=127.0.0.1'] });
let code = 1;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('atlas_test');
  const url = `postgres://atlas_test:atlas_test@127.0.0.1:${port}/atlas_test`;
  code = await new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', 'test/postgres.integration.test.ts'], { cwd: join(process.cwd(), 'apps', 'api'), stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, TEST_DATABASE_URL: url } });
    child.on('exit', (c) => resolve(c ?? 1));
  });
} catch (err) {
  console.error('Could not start the embedded PostgreSQL server:', err instanceof Error ? err.message : err);
} finally {
  await pg.stop().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
