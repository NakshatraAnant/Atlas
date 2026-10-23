// Supervisor for the ATLAS API (used by scripts/atlas.mjs). Runs the server as a child process and
// restarts it if it exits abnormally (crash, uncaught exception), with backoff and a cap of 5 restarts
// an hour so a persistent fault cannot loop. A clean exit (code 0, e.g. after the stop file) ends the
// supervisor too. Output goes to the same log as the server.
//   node supervise.mjs <program> [args...]
import { spawn } from 'node:child_process';

const [program, ...args] = process.argv.slice(2);
if (!program) {
  console.error('usage: node supervise.mjs <program> [args...]');
  process.exit(2);
}
const BACKOFF_MS = [5_000, 15_000, 60_000, 120_000, 300_000];
const restarts = [];
let child = null;

const stamp = () => new Date().toISOString();
function start() {
  child = spawn(program, args, { stdio: 'inherit', env: process.env, windowsHide: true });
  child.on('exit', (code, signal) => {
    child = null;
    if (code === 0) {
      process.exit(0);
    }
    const now = Date.now();
    while (restarts.length && now - restarts[0] > 3_600_000) restarts.shift();
    if (restarts.length >= 5) {
      console.log(`${stamp()} [supervisor] API exited (code ${code}, signal ${signal ?? 'none'}); 5 restarts in the last hour, giving up. Run: node scripts/atlas.mjs restart`);
      process.exit(1);
    }
    const wait = BACKOFF_MS[Math.min(restarts.length, BACKOFF_MS.length - 1)];
    restarts.push(now);
    console.log(`${stamp()} [supervisor] API exited unexpectedly (code ${code}, signal ${signal ?? 'none'}); restarting in ${wait / 1000} s (restart ${restarts.length} this hour)`);
    setTimeout(start, wait);
  });
}
// Forward termination to the child so a supervised stop is still graceful.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (child ? child.kill(sig) : process.exit(0)));
start();
