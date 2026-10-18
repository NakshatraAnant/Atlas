import { writeFileSync } from 'node:fs';
import { createContext } from '../bootstrap.js';
import { runEval } from '../modules/ai/eval.js';

// Runs the AI evaluation suite against the configured database and AI provider and records the
// result in ai.eval_runs. Usage: npm run eval [-- --limit=N] [-- --report=path.json]
// A partial run (--limit) is recorded but can never pass the release gate.

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const ctx = await createContext();
const limit = arg('limit') ? Number(arg('limit')) : undefined;
let last = 0;
const r = await runEval(ctx, {
  limit,
  onProgress: (done, total) => {
    if (done - last >= 50 || done === total) {
      last = done;
      process.stdout.write(`  ${done}/${total}\n`);
    }
  },
});
console.log(`Evaluation ${r.eval_run_id}: ${r.passed ? 'PASSED' : 'FAILED'} (provider ${ctx.ai.provider}, model ${ctx.ai.model})`);
for (const [k, v] of Object.entries(r.metrics)) console.log(`  ${k}: ${typeof v === 'number' && v <= 1 && k.endsWith('rate') ? `${(v * 100).toFixed(1)}%` : v}`);
for (const f of r.failures.slice(0, 25)) console.log(`  ✗ ${f.case_id} [${f.category}] ${f.failures.join('; ')}`);
if (r.failures.length > 25) console.log(`  … ${r.failures.length - 25} more failures`);
const report = arg('report');
if (report) writeFileSync(report, JSON.stringify(r, null, 2));
await ctx.db.close();
process.exitCode = r.passed ? 0 : 1;
