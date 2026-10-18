#!/usr/bin/env node
// Fails (exit 1) if a tracked file looks like it contains a real secret. Runs in CI and before
// commits. Development-only placeholders documented in .env.example and seed.ts are allowed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Razorpay live key', /\brzp_live_[A-Za-z0-9]{10,}\b/],
  ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{20,}\b/],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Postgres URL with password', /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{6,}@(?!localhost|127\.0\.0\.1)/],
];
const FORBIDDEN_FILES = [/^\.env$/, /^\.env\.local$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /\.pem$/, /\.key$/, /^data\//, /^backups\//];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];
for (const f of files) {
  if (FORBIDDEN_FILES.some((r) => r.test(f))) problems.push(`${f}: this file type must never be committed`);
  if (/\.(png|jpg|gif|ico|pdf|gz|woff2?|ttf)$/i.test(f)) continue;
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [name, re] of PATTERNS) if (re.test(line) && !/check-secrets: allow/.test(line)) problems.push(`${f}:${i + 1}: possible ${name}`);
  });
}
if (problems.length) {
  console.error(`Secret scan failed (${problems.length}):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Secret scan passed: ${files.length} tracked files checked.`);
