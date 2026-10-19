# Data rights and providers

## Current position (19 Oct 2026)

- **No licensed market data. No provider credentials. No data budget.**
- Every company, security, price, financial statement and disclosure in ATLAS today is **synthetic**: generated deterministically by `apps/api/src/pipeline/synthetic/*`, flagged `is_synthetic = true`, with ISINs starting `XXS` (not a valid country prefix, so a synthetic ISIN can never collide with a real one).
- The UI shows a synthetic badge, and production refuses to start with synthetic data (`assertProductionSafe` → `ALLOW_SYNTHETIC_DATA`).
- Synthetic values must never be used to claim anything about a real company.

## Official public sources: terms read on 20 Oct 2026

Before building an automated Nifty 50 / end-of-day / filings engine, the published terms of the official sites were read in a browser. The result is recorded in `apps/api/src/modules/datahealth/providers.ts` and shown on **Data health** (`/app/data-health`).

| Source | Terms | Automated retrieval | Outcome |
|---|---|---|---|
| NSE website (nseindia.com, nsearchives; all reports, bhavcopy, announcements, financial results, index files) | https://www.nseindia.com/static/nse-terms-of-use | **Prohibited.** The terms bar systematic or automated data collection (scraping, data mining, extraction, harvesting), and also bar copying or electronically storing site content. | Not fetched; no job targets it |
| NSE Indices (niftyindices.com; Nifty 50 constituent list) | https://www.niftyindices.com/terms-of-use | **Needs express written consent.** Use of the site is limited to personal, non-commercial purposes. | Not fetched |
| BSE (bseindia.com) | https://www.bseindia.com/termsofuse.html | **Unverified.** The page did not render its terms text, so they could not be read. | Treated as not permitted |

Consequences:
- The "automated real-data engine" against these sites is **blocked by their terms**, not by missing code. ATLAS does not scrape them, does not use undocumented endpoints and does not work around their controls.
- Real data needs one of the pending licences already in the registry (NSE Data & Analytics end-of-day, corporate and master data; NSE Indices for constituents; a fundamentals vendor), or written consent. Once a licence is signed, a provider adapter implements `VendorAdapter` (`apps/api/src/pipeline/vendor.ts`). Ingestion, validation, quarantine, provenance, freshness, scheduling, catch-up and data health then apply unchanged, because they already run on the synthetic vendor.
- Until then, every exercise and research screen runs on clearly labelled synthetic data, and users can upload price files they are entitled to use (private to them).

## How rights are enforced (fail closed)

`apps/api/src/modules/ref/rights.ts` builds a field-level rights matrix from `ref.licences` × `ref.licence_rights`:

| Right | Meaning |
|---|---|
| `store` | may be persisted |
| `display` | may be shown to signed-in users |
| `derive` | may be used to compute metrics |
| `export` | may appear in CSV/PDF exports |
| `ai_process` | may be sent to an external AI model |
| `public_web` | may appear on public (signed-out) pages |

- Only licences with status `signed` count, plus `dev_only` outside production. A dataset or field with **no matching row has no rights**: every operation is denied.
- A licence past its `end_date` stops matching, so its rights lapse automatically.
- The most specific match wins (exact field over `prefix.*` over `*`).
- AI tool calls record `fields_sent_to_model` and `fields_withheld` (`ai.tool_calls`); exports record `fields_omitted` (`app.exports`).

Gaps still open: commercial-use and redistribution are not separate columns yet; licence-expiry alerts to admins are not built; official-filing ingestion (exchange announcements as a real source) awaits a reviewed terms decision. Earlier note: (today they fall under `display`/`public_web`/`export`); there are no licence-expiry alerts to admins; there is no per-dataset "development only" flag beyond licence status.

## User-provided datasets (built, session 4)

- `/app/research/datasets`: upload a CSV (≤ 2 MB, ≤ 20,000 rows) of daily prices, confirm the suggested column mapping, and attest that you are entitled to use the data.
- Validation (row-level, nothing coerced): real calendar dates in documented formats and not in the future; positive prices; non-negative whole-number volume; OHLC integrity; no duplicate dates. Rejected rows are listed with reasons and never stored. Database constraints repeat the OHLC and positivity checks.
- Storage and use: `app.user_datasets` and `app.user_dataset_prices` (migration 008), private to the uploader (404 for anyone else), soft-deleted rows removed on delete, an exact-duplicate upload is refused. Labelled "User-provided data. ATLAS has not verified it" on every response. Never mixed with reference data, never shown to other users, never sent to an external AI model.
- Analysis is deterministic (total return, CAGR for periods of one year or more, annualised volatility, maximum drawdown, SMA 50/200) on unadjusted closes, with those caveats stated.
- Tests: `apps/api/test/datasets.test.ts`.

## Source hierarchy (what ATLAS may use, in order)

1. Official public disclosures (exchange filings, annual reports): ingest only with documented terms for storage and display; link to source documents.
2. User-provided datasets the user is entitled to use: **built** for daily price CSVs (see below). XLSX: save as CSV first.
3. Deterministic synthetic data for development and education (built).
4. Third-party APIs whose terms permit the intended use (none evaluated yet).
5. Commercial providers, once customer validation justifies the cost (budget in the financial model: ₹20.25 lakh/year base case).

## Provider evaluation scorecard

Nothing in this table has been verified yet. Before any row is filled in, someone must read the provider's **current** terms and record the URL and review date. Do not select a provider because its endpoint works.

| Field | Candidate A | Candidate B | Candidate C |
|---|---|---|---|
| Provider | _to evaluate_ | | |
| Fields supported (EOD prices, corporate actions, fundamentals, shareholding, announcements) | | | |
| Coverage (NSE/BSE, # securities) | | | |
| Historical depth | | | |
| Update frequency / delay | | | |
| API limits | | | |
| Commercial use permitted? | | | |
| Storage / caching rights | | | |
| Display rights (logged-in / public) | | | |
| Export rights | | | |
| External AI processing rights | | | |
| Attribution required | | | |
| Price | | | |
| Terms URL | | | |
| Reviewed on / by | | | |
| Fallback if unavailable | | | |

Candidates to evaluate (names only; no claims about their terms): the exchanges' own data-licensing programmes (NSE, BSE) and licensed redistributors of exchange data. Exchange market data is generally licensed for redistribution; assume nothing is free to redistribute until the terms are read.

## Questions for qualified legal review (not answered here)

1. Licence terms needed to display delayed end-of-day prices to paying subscribers, and on public pages.
2. Whether storing and re-displaying exchange announcement text (versus linking) is permitted.
3. Whether sending licensed fields to an external AI provider counts as redistribution.
4. Securities-law boundaries for research and education content (no personalised advice, no recommendations); see `SECURITY_AND_PRIVACY.md` §Regulatory.
5. DPDP Act 2023 obligations for learner and research data.
