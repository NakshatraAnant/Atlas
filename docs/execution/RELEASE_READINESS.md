# Release readiness

_As of 19 Oct 2026, end of session 4. Evidence: `TEST_RESULTS.md`._

**Verdict: ready as a locally hosted, synthetic-data build for internal evaluation. Not ready for public release.** The public-release blockers are external (licensed data, legal and expert review, a penetration test, payments and GST), not code defects that are known and unfixed.

## Gate checklist

| Gate | Status | Evidence |
|---|---|---|
| Unit + API integration tests | pass | `npm test`: 332 passed, 8 skipped (the PostgreSQL suite, run separately below; the skips are not counted as passes) |
| Real PostgreSQL 17 (node-postgres) | pass | `npm run test:postgres`: 8/8 |
| Browser e2e (Edge) | pass | `npm run test:e2e`: 8/8 journeys + restart-persistence check |
| Financial golden set | pass | 59/59 hand-calculated cases |
| AI evaluation release gate | pass | `npm run eval`: 580 cases; golden 100%, red team 100%, causal 100%, numeric accuracy 1.0, 0 unsupported numbers, 0 content violations |
| Typecheck (all workspaces) | pass | `npm run typecheck` |
| Web production build | pass | `npm run build -w @atlas/web` |
| Secret scan | pass | `npm run check:secrets` |
| Production dependency audit | **accepted risk** | 2 advisories in the postcss that Next 15 pins (build-time, first-party CSS only); the fix is Next 16 (SECURITY_AND_PRIVACY.md) |
| Embedded engine at scale | pass | 40, 120 (launcher first run) and 602 companies seed; daily catch-up tested |
| Local hosting first run | pass | `node scripts/atlas.mjs start` on an empty `./data`: 120-company seed and start in 6 min 5 s; API and web healthy; sign-in, Home briefing and assistant checked in the browser |
| Supabase schema parity + RLS | pass | migrations 001–008 applied; fingerprint `99a30a294b137941ea3956be016bbc16` identical; every table RLS-enabled, no permissive policies |
| App connected to Supabase | **blocked** | needs the DB password (B-SB-01) |
| GitHub backup | **blocked** | no GitHub access in the agent environment (B-GH-01) |

## Not releasable to the public until

1. Licensed market data replaces the synthetic data (B-DATA-01) and the data-rights matrix is reviewed.
2. Academy and help content passes the seven-point expert review. All of it is AI-drafted and unreviewed today, and production refuses to serve drafts.
3. An independent penetration test is done (B-SEC-01). An automated accessibility audit is done.
4. Legal review covers the SEBI research-analyst and investment-adviser boundaries, DPDP, and the terms. Payments (Razorpay) and the GST invoice template are approved (B-PAY-01, B-GST-01).
5. A production deployment is designed and verified: availability, backups/PITR, TLS `verify-full`, and monitoring. None of it is part of this build.

## Residual risks accepted for local use

- PGlite is single-process. The API and CLI tools cannot share the data directory concurrently.
- The deterministic AI composer is the only evaluated provider.
- Mastery parameters are unvalidated.
