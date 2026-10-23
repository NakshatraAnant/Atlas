# Security and secrets (local installation)

## Secrets

- **Where keys live:** only in `.env.local` (git-ignored; `git check-ignore` verified). Never committed: `git grep` across all revisions found none of the configured key values. `npm run check:secrets` passes on every commit.
- **Canonical names:**
  - `EODHD_API_TOKEN` (alias `EODHD_API_KEY`)
  - `FRED_API_KEY`
  - `EIA_API_KEY`
  - `COINGECKO_DEMO_API_KEY` (alias `COINGECKO_API_KEY`)
  - `DATA_GOV_IN_API_KEY`
  - `ALPHAVANTAGE_API_KEY`
  - `ANTHROPIC_API_KEY`
  - Razorpay keys
- **Server-side only.** The web app never receives a key; the browser talks only to the ATLAS API (CSP `connect-src 'self'`).
- **Each key goes only to its own provider's host:**
  - EODHD: eodhd.com
  - FRED: api.stlouisfed.org
  - EIA: api.eia.gov
  - CoinGecko: api.coingecko.com, as a header
  - data.gov.in: api.data.gov.in
- **Not stored, not logged.** Request URLs are not stored. Error messages pass through redaction (`api_token`, `apikey`, `api_key`, `api-key` → `REDACTED`). Tests assert that a key never appears in job records, request logs, provider state or API responses.
- **Verified 23 Oct 2026:** after live use, no configured key appears in `.atlas/logs/*`, in any API response, or in any tracked file.
- **Keys pasted into the conversation:** the EODHD, FRED, EIA and CoinGecko keys were configured from values pasted into the conversation transcript. Treat them as exposed and rotate them at each provider when convenient, then update `.env.local` and restart.

## Access control

- **Sessions:** HttpOnly cookies with a CSRF double-submit token on every state-changing request. Rate limits apply per user or IP.
- **Customer data** is private: portfolios, notebooks, reports, alerts, uploads, imported statements and crypto notes. Another user receives 404; there are tests for each.
- **Account erasure** deletes research, crypto and upload data (a session-10 fix).
- **Operator diagnostics** need the `admin` or `data_ops` role and a two-step-verified session. Enforced on the backend by `requireRole` / `isOperator`:
  - `/admin/v1/providers`, plus refresh and resume controls;
  - full `/v1/equity/status`, `/v1/crypto/sources` and `/v1/commodities` detail.
- **Customer responses** omit quota ledgers, request logs, run history, raw provider errors and budgets. Customers see plain-language status ("Temporarily limited by the provider; resumes automatically").

## Code-level checks

- **SQL:** every query is parameterised. The only interpolated identifiers come from fixed whitelists (quota budget columns) or constants.
- **Rendering:** React escapes all text; no `dangerouslySetInnerHTML` was added. Notebook and report source links accept http(s) only (session 9).
- **Uploads:** size-limited CSV, validated per row, private to the uploader.

## Dependencies

`npm audit --omit=dev` (23 Oct 2026) reports one low-severity advisory: fastify header validation via JSON-schema `propertyNames` (GHSA-389g-gv7q-r4x8). ATLAS validates with zod, not fastify schemas, so it is not affected. The fix (5.12.7) was released 10 days earlier; the upgrade is deferred until it is at least two weeks old.

## Not ready for public deployment

This is a local, single-machine installation:
- the API listens on 127.0.0.1;
- the web app is served by `next start` locally.

Before any public, multi-user deployment, the following are mandatory:
- managed PostgreSQL with TLS (`DATABASE_SSL=verify-full`);
- a managed `APP_SECRET`;
- a real email transport and payment gateway (the production config refuses the sandbox ones);
- HTTPS termination and HSTS;
- external rate limiting;
- a security review;
- **data licences for redistribution:**
  - the free EODHD plan and CoinGecko Demo are for personal use;
  - NSE, BSE and MCX data cannot be redistributed without a licence.
