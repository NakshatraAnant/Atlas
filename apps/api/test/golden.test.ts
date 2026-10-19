import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GOLDEN, runGolden } from './golden/cases.js';

// Runs the financial golden set and writes the measured result to test-results/golden-report.json
// (rendered into docs/execution/TEST_RESULTS.md). The PRD target is ≥ 99%; on a deterministic
// engine any failing case is a defect, so this test requires every case to pass.

describe('financial golden set', () => {
  it('has at least 50 independently derived cases across critical, major and edge severities', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(50);
    expect(new Set(GOLDEN.map((c) => c.id)).size).toBe(GOLDEN.length);
    for (const s of ['critical', 'major', 'edge']) expect(GOLDEN.some((c) => c.severity === s)).toBe(true);
  });
  it('meets the accuracy target (measured): every case within tolerance', () => {
    const r = runGolden();
    const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-results');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'golden-report.json'), JSON.stringify({ generated_at: new Date().toISOString(), ...r }, null, 2));
    const failed = r.results.filter((x) => !x.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(r.accuracy_pct).toBeGreaterThanOrEqual(99);
  });
});
