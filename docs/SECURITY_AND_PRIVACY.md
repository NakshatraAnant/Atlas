# Security and privacy

## Architecture boundary

The browser talks only to the ATLAS API (via the Next.js same-origin rewrite). The API is the only database client. Hosted Supabase tables are in non-public schemas with RLS enabled and **no** permissive policies, and the `anon`/`authenticated` roles have no privileges (migrations 004–006, ADR-012). No Supabase key is used in browser code; the service-role key is not used at all.

## Controls in place (with evidence)

| Control | Where | Evidence |
|---|---|---|
| Password hashing: scrypt (memory-hard), NFKC-normalised | `apps/api/src/lib/crypto.ts` | api.test.ts accounts suite |
| Breached-password check | `modules/auth/breached.ts` | api.test.ts |
| Login lockout: 5 failures in 15 min | `modules/auth` | api.test.ts "locks out after five failed sign-ins" |
| TOTP two-step; required for admin console | `modules/auth`, `requireRole` | api.test.ts "admin console requires an admin role with two-step verification" |
| httpOnly session cookie; CSRF double-submit + exact loopback/origin check | `app.ts` | security.test.ts |
| Server-side authorisation by session user id on every user-owned row | all routes | api.test.ts "user isolation", academy.test.ts isolation test |
| Privileged roles cannot be self-assigned (no API sets `role`; DB denies non-owner writes) | `app.users.role`, RLS | rls.test.ts (non-owner INSERT with role=admin rejected) |
| Input validation (zod) and RFC 9457 errors without internals | `lib/http.ts` | api.test.ts |
| Rate limits per route; 3 MB body limit | `app.ts`, `lib/rateLimit.ts` | **not directly tested** (tests run with `RATE_LIMIT_MULTIPLIER=1000`); plan-quota 429 is tested (api.test.ts AIA-10) |
| Append-only, hash-chained audit log | `ops.audit_log` trigger, `modules/ops/audit.ts` | api.test.ts "audit log is append-only" |
| PII masked in admin views; unmask needs a reason and is audited | `modules/admin` | api.test.ts |
| Legal-gated feature flags need approver, date and document (DB constraint) | `ops.feature_flags` | api.test.ts |
| Security headers (CSP, frame-ancestors none, nosniff, referrer policy) | `apps/web/next.config.mjs` | config |
| Secret scan in CI and before commits | `scripts/check-secrets.mjs` | CI workflow |
| Production refuses unsafe config (dev secret, synthetic data, sandbox payments, outbox email, draft Academy content, unverified DB TLS) | `config.ts` `assertProductionSafe` | code |
| Academy: answers never sent before submission; attempts owner-scoped | `modules/academy/routes.ts` | academy.test.ts |

## Not done / open

- No independent penetration test (B-SEC-01).
- File upload validation beyond support screenshots: no general upload feature exists yet.
- `npm audit` last run in CI (session 2); not re-run in session 3.
- Resource limits for expensive computations exist for backtests (queue, plan limits) but are not load-tested.
- The real-PostgreSQL driver path has not been exercised by tests (B-PG-01).

## Privacy

- Consent records per kind and version (`app.consents`); client analytics only with analytics consent (tested).
- Analytics events never include note text, questions or answers.
- Account export and deletion with re-authentication; erasure after a grace period keeps only legally required billing records, pseudonymised (`runRetention`).
- Development fixtures use `@atlas.test` addresses only; no real personal data.
- Supabase project in `ap-south-1` (Mumbai) keeps data in India (ADR-014).

## Regulatory boundaries (need qualified review; not claimed as compliant)

- ATLAS is positioned as research and education. It must not give personalised investment advice or recommendations (content rules in `packages/shared/src/content-rules.ts`, tested by content-policy.test.ts).
- Academy completion is not a qualification (stated on every course).
- A disclaimer does not by itself create compliance. Open questions are listed in `DATA_RIGHTS_AND_PROVIDERS.md`.
