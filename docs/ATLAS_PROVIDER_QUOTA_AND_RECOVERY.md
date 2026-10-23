# Provider quotas, pauses and automatic recovery

Code: `apps/api/src/lib/providerGate.ts` (shared gate), `apps/api/src/modules/equity/quota.ts` (EODHD daily ledger), `apps/api/src/modules/crypto/http.ts` (CoinGecko per-minute and monthly pacing). State: `ops.provider_state` and `ops.provider_requests` (migration 014), `equity.quota_days` and `equity.provider_requests` (migration 012), `crypto.request_usage` (migration 010). Everything is in the database, so pauses and counts survive restarts.

## How a request is made

1. **Admit.** `admit(provider)` refuses if the provider is not configured or is paused (`next_eligible_at` in the future). A refusal is logged as `skipped_paused` and the request is not sent.
2. **Budget.** EODHD calls are charged to the daily ledger before sending. CoinGecko checks its monthly pace (below).
3. **Send.** Requests have a 20–30 s timeout. Keys go only to their own provider's host.
4. **Record.** `record(provider, outcome)` updates the provider state and appends to the request log. The log holds provider, endpoint, job, HTTP status, outcome, failure category, cost and quota event; it never holds a URL or key.

## Rules by failure

| Failure | What ATLAS does |
|---|---|
| HTTP 429 with `Retry-After` | Pause exactly that long (seconds or HTTP date) |
| HTTP 429 without it | Back off 1, 5, 15, then 60 minutes |
| Quota exhausted with a documented reset (EODHD HTTP 402: midnight GMT) | Pause until the reset; `reset_at` shown |
| Quota exhausted with no published reset (CoinGecko monthly cap) | Recheck hourly; the reset is shown as unknown, never guessed |
| HTTP 401/403 (credential or entitlement) | Mark unavailable; one recheck a day, or after a restart (the usual way a key is changed); never a loop |
| HTTP 404 / unknown series | About one item, not the provider: the item fails, the provider is not paused (EODHD shares: the instrument waits 7 days) |
| 5xx, timeout, network, malformed | Back off 1, 5, 15, 60 minutes; "degraded" after 3 in a row |

## Recovery without a restart

When the pause ends, the next caller is admitted as a **single health check** (`recovering`); every other caller waits 60 seconds. This is an atomic conditional update, so concurrent jobs cannot stampede. A success restores normal scheduling; a failure applies the rules above again.

Jobs simply try again on their next scheduled tick:
- equity: every 10 minutes, one run per IST slot;
- commodities and macro: every 3 hours;
- crypto: per job.

An operator can clear a pause in Admin → Data providers → "Resume now". That also admits just one health check.

## Provider specifics

| Provider | Accounting | Confidence |
|---|---|---|
| EODHD | Daily ledger by purpose (refresh 12, backfill 2, validation 2, manual 2, reserve 2), charged before sending; reconciled with `/api/user` (free) | provider-reported |
| CoinGecko Demo | Per-minute budget, plus a monthly cap of 10,000: ATLAS keeps 5% in hand and allows (cap × 0.95 − used before today) ÷ days left in the month (UTC) per day; non-critical calls beyond that are refused, not sent | estimated (the usage endpoint is for paid plans) |
| FRED API | Request log; 120/min is far above ATLAS's use (two calls per series per refresh, and the observations call only when FRED reports a change) | estimated |
| FRED CSV fallback (`fred_csv`) | Request log; one request at a time with a 1 s pause | estimated |
| EIA | Request log; paging at 5,000 rows | estimated |
| data.gov.in | Request log; at most twice a day | estimated |

## Verified behaviour

- **Automated tests** (`apps/api/test/providers.test.ts`):
  - durable pause across a simulated restart;
  - Retry-After in seconds and as a date;
  - a single recovery probe among concurrent callers;
  - known and unknown resets;
  - auth handling;
  - 404 not pausing the provider;
  - manual resume;
  - no key in any log.
- **EODHD ledger tests** (`equity-ops.test.ts`): 30 concurrent spends yield exactly 12, also on real PostgreSQL 17.
- **Live (23 Oct 2026):** FRED, EIA and CoinGecko all ran through the gate; EODHD's reported usage reconciled with ATLAS's own count.
