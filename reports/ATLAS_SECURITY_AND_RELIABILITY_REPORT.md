# ATLAS security and reliability

Session 12, 30 Oct 2026. Standing policy is in [docs/ATLAS_SECURITY_AND_SECRETS.md](../docs/ATLAS_SECURITY_AND_SECRETS.md) and [docs/SECURITY_AND_PRIVACY.md](../docs/SECURITY_AND_PRIVACY.md).

Status words used here: **completed**, **tested**, **failed**, **blocked**, **requires your action**.

## 1. Secrets

| Check | Result | Status |
|---|---|---|
| Where keys live | Only in `.env.local` (git-ignored, untracked). They are read server-side and are not present in the web bundle, API responses, logs, screenshots, reports or this repository | Completed |
| Key-leak scan | Every working-tree file (473, tracked and untracked, excluding ignored) and the **full git history** were searched for the exact values of the 5 configured secrets (EODHD, FRED, EIA, CoinGecko, APP_SECRET). No value was printed during the scan. **0 matches** | Tested |
| Walkthrough video | Sign-in happens before capture starts, so no credentials appear on screen. Key values are never rendered by any page. The data-sources page shows provider status, never keys | Completed (see the recording notes) |
| Exposed EODHD token from session 10 | That token was pasted in chat. You were asked to rotate it | **Requires your action** if it has not been rotated |

## 2. New attack surface in this session, and its controls

| Endpoint | Control | Tested |
|---|---|---|
| `GET /v1/find` (search) | Sign-in required. 240 requests per minute per user. Query at most 80 characters, parameterised SQL. Personal research results are limited to the signed-in user (`user_id = $1`, soft-deleted rows excluded) | Privacy: another user's notebook entry is never returned. Unauthenticated → 401 |
| `POST /v1/macro/explore` | Sign-in required. Series keys are validated by regex, then must exist (404). The window must be 6–120. Weekly comparison of a monthly series is refused (400) | Yes |
| `GET/PUT /v1/follows` | Sign-in required. The key is validated by regex and must exist. At most 50 follows per user. Rows are deleted with the account | Yes (400, 404, own follows only) |
| `GET /v1/home/attention` | Sign-in required. Followed series are the caller's own only | Yes |
| `PATCH /v1/me` `display_prefs` | Previously **any** JSON object was accepted (no size limit). Now it is a strict schema: known keys only, enumerated panels and markets, no duplicates, bounded arrays. Unknown keys → 400 | Yes (oversized and unknown key, unknown panel, duplicate, bad theme) |
| `app.series_follows` | Row-level security enabled, with no permissive policy (same rule as every ATLAS table) | Yes (RLS test) |

## 3. Reliability

| Item | Result | Status |
|---|---|---|
| Backup before changes | `atlas-backup-2026-10-30_04-31-49.tar.gz`. The restore drill (`verify-backup`) passed | Tested |
| Schedulers during a week offline | Kept data current: NIFTY to 29 Oct, commodities to 27 Oct, DGS10 to 28 Oct | Verified at baseline |
| Provider gate | Unchanged: durable pauses, Retry-After handling, a single recovery probe, a 24-hour recheck after an authentication failure | Tested (prior and current suites) |
| New background job | Follow notices and the weekly digest run every 30 minutes under their own guard, so a failure is logged and does not block other jobs. They read only stored data, with no provider calls | Completed |
| Database migration | `015_series_follows.sql` is forward-only and additive | Applied in the test fixture and on the local database at restart |

## 4. Open items

- **Requires your action:** rotate the EODHD token if you have not already.
- The QA crawl and tests cover the local build. No penetration test or third-party audit was done.
- Local hosting runs `next start` with the API on loopback only. Production hosting, TLS and a WAF are out of scope (docs/deployment).

---

## Session 13 update (5 Nov 2026)

### Secrets

| Check | Result | Status |
|---|---|---|
| Key-value scan | Values of EODHD, FRED, EIA, CoinGecko and APP_SECRET were searched in every tracked file, `.atlas/logs`, `reports/`, `artifacts/` and the built frontend (`apps/web/.next/static`). Counts only were printed: **0 occurrences** | Tested |
| `.env.local` | Git-ignored and untracked; only `.env.example` (placeholders) is tracked | Tested |
| EODHD token pasted in chat (session 10) | The session-10 checkpoint records that a rotated key was configured. Today's value scan found no key in any file | No action needed unless you never rotated it |
| Secret scan (`npm run check:secrets`) | Passed (478 tracked files) | Tested |

### Reliability: defects found and fixed

| Defect | Impact | Fix | Evidence |
|---|---|---|---|
| Local app down after a Windows restart | ATLAS unavailable | Restarted after a verified backup. The launcher has no OS service, so it does not restart itself after a reboot (documented) | `/readyz` ok |
| Crypto scheduler query blocked the API every 30 s | 20–35 s page stalls; the web proxy returned 500 after 30 s | Linear rewrite of `lastRuns()` | Test: 12 ms vs 9,573 ms on 8,000 rows, identical results. Live: 36 samples, max 0.63 s |
| Index pages used a stale adjusted series | Wrong "latest" values for NIFTY 50, NIFTY BANK, SENSEX | Basis rule fixed | Regression tests; live current to 4 Nov |

### Backup and restore

`backups/atlas-backup-2026-11-05_07-08-47.tar.gz` (151.1 MB). The `verify-backup` drill restored it into a separate directory, started the API on port 4100 against it and got `/readyz`: passed.

### Isolation

The automated tests that ran today cover cross-user isolation (`api.test.ts` "user isolation", `academy.test.ts`, `datasets.test.ts`, privacy cases in `discovery.test.ts`) and database row-level security (`rls.test.ts`). They were not re-done by hand this session.

### 11 Nov 2026 additions

| Finding | Severity | Fix | Evidence |
|---|---|---|---|
| **Oversized request bodies blocked the API.** One signed-in request with a 1.4-million-item list (2.8 MB, under the 3 MB body limit) was validated item by item for 18 s, during which the single-threaded API served nothing, and it returned a 128 MB error body listing every issue | High (denial of service by any account) | Bodies with a list or object of more than 10,000 entries (twice the largest schema limit, 5,000) are refused with 413 before validation. Validation errors report at most 20 issues, plus the total | `security.test.ts`: 413 in under 5 s for 1.4 million items and for 20,000 keys; 400 with at most 20 issues and a small body for 9,000 items; normal requests unaffected |
| fast-uri (moderate), fastify header validation (low) | Moderate / low | Targeted updates only: fast-uri 3.1.8 → 3.1.9 and 4.2.2 → 4.2.3; fastify 5.12.5 → 5.12.8 (patch, still pinned). The lockfile diff changes exactly these three versions | `npm audit --omit=dev`: both advisories cleared; full test suite re-run |
| zod advisory GHSA-mrhx-c7xc-m3w5 (high): memory exhaustion validating oversized arrays | High as published | Not upgraded: the only fix is zod 4, a breaking migration of 31 files, and `@anthropic-ai/sdk` depends on zod 3. The advisory's description names zod 4's array parser; ATLAS uses the zod 3 API. Its exposure, oversized arrays, is closed by the 10,000-entry guard above, which runs before zod | **Resolved later on 11 Nov:** migrated to zod 4.6.7 (object defaults moved to `prefault` to keep behaviour; the full API suite passes). `npm audit --omit=dev`: 0 vulnerabilities |
| Session check logged a 401 on every public page | Low (noise) | `/v1/me?optional=1` answers signed-out visitors with 200 `{ signed_in: false }`; without the flag it is still 401 | `api.test.ts` |
| Secret scan | — | — | `npm run check:secrets` passed on 11 Nov (479 tracked files before this session's commit; re-run after it) |

### Open

- No penetration test or third-party audit.
- (zod migration done on 11 Nov.)
- The launcher is not a supervised service: after a reboot, run `node scripts/atlas.mjs start`.
- The embedded database is single-threaded. A heavy background job can still slow requests; hosted PostgreSQL (`DATABASE_URL`) removes this.
