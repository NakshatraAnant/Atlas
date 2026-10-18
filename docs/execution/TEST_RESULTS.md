# Test results

Newest first. Only results of commands that actually ran.

## 19 Oct 2026, session 3

Command: `npm test` (root) on Windows 11, Node 24.16.0.

| Suite | Result |
|---|---|
| packages/shared (content rules, formatting) | 27 passed |
| apps/api calc.test.ts | 29 passed |
| apps/api content-policy.test.ts | 38 passed |
| apps/api pipeline.test.ts | 23 passed |
| apps/api api.test.ts (HTTP integration) | 57 passed |
| apps/api rls.test.ts (new) | 3 passed |
| apps/api security.test.ts | 1 passed |
| apps/api postgres.integration.test.ts (new) | 8 **skipped**: no `TEST_DATABASE_URL` (B-PG-01) |
| **Total** | **178 passed, 8 skipped, 0 failed** |

Other checks:
- `tsc --noEmit` (api): pass.
- Schema fingerprint: local `81fdcafc59bd53cc0ef7683cd803c119` / 2241 lines == Supabase `81fdcafc59bd53cc0ef7683cd803c119` / 2241 lines.
- Supabase security advisor after migration 005: only INFO "RLS enabled, no policy" (intended deny-by-default). Two WARNs fixed by 005 (verified: `pg_trgm` now in `extensions`, `anon` has no USAGE on `app` and no SELECT on `ref.companies`).
- Not run this session: web typecheck/build, local startup script, `npm audit`.

## 18 Oct 2026, session 2 (from commit messages; not re-verified)

- "all 147 API tests pass" (commit 5a493ed).
