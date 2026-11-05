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
