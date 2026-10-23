# ATLAS production-readiness audit

Date: 23 Oct 2026. Branch `feat/atlas-mvp`. Baseline at the start of this mandate: commit `873d2e2`, clean tree, ATLAS running on embedded PGlite (migrations 001–013), demo mode on.

## Baseline findings (before this mandate's changes)

| Area | Finding | Remediation (this mandate) |
|---|---|---|
| Demo data | Fictional companies, indices, breadth, briefings, screener, backtests and assistant were the default customer experience. Home and the public landing page showed fictional index values | Real-data mode (`ALLOW_SYNTHETIC_DATA=false`) set for this installation: demo sections hidden from navigation and refused by the API (403); real Home, landing, Status and Data sources pages; Academy tasks on demo pages marked unavailable; demo pipeline and its catch-up not run |
| Provider credentials | EODHD configured. FRED (CSV only), EIA and CoinGecko keyless or unconfigured | FRED, EIA and CoinGecko keys configured in `.env.local`; each verified with a real response; canonical names and aliases documented |
| Quota and pause state | EODHD: durable daily ledger. Other providers: in-memory backoff (lost on restart); CoinGecko had no monthly cap control | Shared durable gate (`ops.provider_state`, `ops.provider_requests`) for FRED, EIA, CoinGecko, data.gov.in and EODHD; auto-resume with a single health-check probe; CoinGecko monthly pacing |
| Indian official sources | Not integrated. Earlier sessions found NSE terms prohibit automated collection | Re-verified NSE, BSE and MCX terms (all prohibit automated collection or redistribution); data.gov.in mandi adapter built (needs your key) |
| Macro | None | FRED API macro module (18 series) with vintages and revisions |
| Diagnostics exposure | Customer pages showed quota ledgers, request logs and raw provider errors | Customer responses trimmed; full diagnostics in Admin → Data providers (admin or data_ops plus two-step verification, backend-enforced) |
| Reliability | The API exited once without any log line; nothing restarted it | Fatal-error logging; launcher supervisor with backoff (kill test passed: restarted in about 40 s) |
| Freshness | Per-module rules; "stale" did not reflect publication schedules | Schedule-aware model (fresh / delayed / stale / unavailable / provider error / discontinued), calibrated on real release lags |

## Route inventory

Customer routes, their data sources and status: `docs/ATLAS_CUSTOMER_FEATURE_READINESS.md`. Provider endpoints, limits and rights: `docs/ATLAS_DATA_SOURCE_REGISTER.md`.

| Route group | Backend | Database | Real-data mode |
|---|---|---|---|
| `/app` | `/v1/equity/market`, `/v1/commodities`, `/v1/macro`, `/v1/crypto/overview` | equity, commodity, macro, crypto | Real |
| `/app/equities/**` | `/v1/equity/*`, `/admin/v1/equity/*` | `equity.*` (migrations 011–012) | Real |
| `/app/crypto/**` | `/v1/crypto/*` | `crypto.*` (010) | Real |
| `/app/commodities/**` | `/v1/commodities/*`, `/admin/v1/commodities/*` | `commodity.*` (013–014) | Real |
| `/app/macro/**` | `/v1/macro/*`, `/admin/v1/macro/refresh` | `macro.*` (014) | Real |
| `/app/research-hub`, `/app/research/datasets`, `/app/equities/statements` | `/v1/research/*`, `/v1/datasets*` | `research.*`, `app.user_datasets` | Real or your own data |
| `/app/academy/**`, `/app/learn/**` | `/v1/academy/*`, `/v1/learn/*` | `acad.*` | Educational content |
| `/app/data-health`, `/status` | `/v1/data-sources`, `/v1/status` | `ops.provider_state` | Real |
| `/admin` | `/admin/v1/*` | all | Operators only |
| `/app/terminal`, `/app/market/**`, `/app/companies/**`, `/app/assistant`, `/app/screener`, `/app/lab/**`, `/app/briefings/**`, `/app/research`, `/briefing-sample` | demo-only API sections | `ref`, `market`, `fund`, `calc`, `bt`, `ai` (synthetic) | Hidden; API 403 |

## Remaining risks

See `KNOWN_LIMITATIONS.md` and `docs/ATLAS_SECURITY_AND_SECRETS.md`. The main ones:
- no licensed Indian share or derivatives data;
- free-plan personal-use licences (EODHD, CoinGecko Demo) are not a basis for commercial redistribution;
- Academy content awaits expert review;
- the installation is local only and not hardened for public multi-user deployment.
