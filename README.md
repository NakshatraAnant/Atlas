# ATLAS

Research workspace and learning academy for Indian equities and digital assets: an evidence-linked market briefing, company research with provenance on every figure, screener, an AI research assistant that never invents numbers, a Quant Research Lab for reproducible backtests, watchlists and notes, and the four-course ATLAS Academy.

**Current state (5 Nov 2026, session 13):** this installation runs in real-data mode. It shows only sourced data: FRED macro and commodity series, EIA inventories, CoinGecko crypto (about 15 minutes delayed), and NIFTY 50, SENSEX and NIFTY BANK end-of-day levels from EODHD. Individual Indian shares and company fundamentals are not available on the free plans in use. Every source is a free or personal tier, so ATLAS is for personal, local research until data licences are obtained (`reports/ATLAS_PROVIDER_AND_LICENSING_REGISTER.md`). Release status: `reports/ATLAS_FINAL_RELEASE_REPORT.md`.

**Demo data** (fictional companies, ISINs starting `XXS`) exists only for development and tests. Real-data mode (`ALLOW_SYNTHETIC_DATA=false`) hides it, and production mode refuses to start with it.

**ATLAS Digital Assets uses real data** from free public sources (CoinGecko, Binance, Coinbase Exchange, DefiLlama, public Ethereum and Bitcoin endpoints, official release feeds), stored locally with source, timestamp and validation status. It never mixes synthetic and real data, and never fills gaps with invented values. Sources, limits and terms: `docs/crypto/SOURCE_CAPABILITY_MATRIX.md`.

**Indian equities** (`/app/equities`): real NSE/BSE end-of-day prices from your own EODHD key, within the free plan's 20 calls a day (quota ledger, priority universe, refresh at 08:00/20:30 IST, calendar, data operations), market overview, explorer and screen, instrument research pages, and financial statements you import. Setup and operation: `docs/equity/INDIAN_EQUITY_DATA_RUNBOOK.md`. Demo pages with fictional companies are labelled "(demo)"; `ALLOW_SYNTHETIC_DATA=false` turns them off.

**Real-data mode** (`ALLOW_SYNTHETIC_DATA=false` in `.env.local`, the setting on this installation): customers see only modules running on real, sourced data. **Macro** (`/app/macro`): 18 FRED series. Operations: `docs/ATLAS_OPERATIONS_RUNBOOK.md`; sources: `docs/ATLAS_DATA_SOURCE_REGISTER.md`; readiness: `docs/ATLAS_CUSTOMER_FEATURE_READINESS.md`.

**Commodities** (`/app/commodities`): 25 benchmark series from FRED (EIA daily spot prices, IMF monthly prices) with spreads, seasonality, correlations and provenance. Indian futures and gold are stated as unavailable; term structure and inventories need a free EIA key. Details: `docs/commodity/COMMODITY_DATA.md`.

**Research hub** (`/app/research-hub`): cross-asset workbench, screener, portfolios and risk, correlation regimes, walk-forward backtests, event studies, data integrity, discovery, notebook, reports and alerts on real crypto data, real Indian equities (with your own EODHD or Alpha Vantage key; `docs/equity/SOURCE_CAPABILITY_MATRIX.md`) and your uploaded files. Methods: `docs/research/METHODS.md`. Progress rules: `docs/GAMIFICATION.md`. Database and recovery: `docs/DATABASE.md`. Status: `docs/IMPLEMENTATION_STATUS.md`.

ATLAS is a research and education product. It does not give investment advice or recommendations, and Academy completion is not a professional qualification.

## Requirements

| Item | Version | Check |
|---|---|---|
| Node.js | 20 or newer (tested on 24.16) | `node --version` |
| npm | bundled with Node.js | `npm --version` |
| Disk | ~2 GB (dependencies, builds, database) | |
| RAM | 4 GB free while seeding the default 120-company dataset | |
| Ports | 3000 (web) and 4000 (API) free on 127.0.0.1 | |

No Docker, WSL, PostgreSQL server or administrator rights are needed. The database is embedded (PGlite).

## Run it locally (one command)

```bash
npm install
```

```bash
node scripts/atlas.mjs start
```

On Windows you can also type `atlas start`. The first start creates `.env.local` with a random secret, builds the web app, seeds the synthetic database (about 7 minutes for 120 companies) and starts both servers.

Then open **http://localhost:3000** and sign in with a development account (`free@atlas.test`, `plus@atlas.test`, `pro@atlas.test`, or `admin@atlas.test` with two-step verification). The development password and admin TOTP secret are in `apps/api/src/seed.ts` and apply to this local, synthetic setup only.

| Command | What it does |
|---|---|
| `node scripts/atlas.mjs status` | Health of API and web |
| `node scripts/atlas.mjs stop` / `restart` | Graceful stop (flushes the database) / restart |
| `node scripts/atlas.mjs logs` | Recent logs |
| `node scripts/atlas.mjs backup` / `restore` | Back up or restore the local database |
| `node scripts/atlas.mjs verify-backup` | Recovery drill: restore the newest backup into a temporary folder, check it, start an API against it |
| `node scripts/atlas.mjs crypto status` / `tick` / `run <job…>` | Digital-assets data: health, run due jobs, run named jobs (ATLAS stopped) |

Health checks: http://127.0.0.1:4000/healthz (API) and http://localhost:3000/status (web).

Full guide, including troubleshooting: `docs/deployment/LOCAL_HOSTING.md`. Operations: `docs/RUNBOOK.md`.

## Development

```bash
npm run dev:api
```

```bash
npm run dev:web
```

| Task | Command |
|---|---|
| All unit, pipeline, policy, golden and API tests | `npm test` |
| Everything above plus real PostgreSQL 17 | `npm run test:all` |
| Real PostgreSQL 17 integration tests (embedded server, no Docker) | `npm run test:postgres` |
| Browser end-to-end tests (Microsoft Edge; ports 3000/4000 free) | `npm run test:e2e` |
| Type checking | `npm run typecheck` |
| Production build | `npm run build` |
| Secret scan | `npm run check:secrets` |
| AI evaluation suite | `npm run eval` |
| Render Academy videos (offline narration + Edge encoder; ~1–2 min each) | `npm run video:render [md-intro …]` |
| Check video playback in Edge (duration, audio, captions, frames) | `npm run video:verify` |
| Rebuild the dev database | move `apps/api/data` into `backups/`, then `npm run seed` |

Large synthetic universes: `SYNTHETIC_COMPANIES=500 npm run seed` builds on disk with bounded memory (see `docs/RUNBOOK.md`).

## Configuration

Copy `.env.example` to `.env.local` (git-ignored) and change what you need. With no `DATABASE_URL`, ATLAS uses the embedded database. To use the hosted Supabase PostgreSQL project, set `DATABASE_URL` to its session-pooler connection string and `DATABASE_SSL=require` (development) or `verify-full` with `DATABASE_CA_CERT` (production). Never commit `.env.local`.

## Repository map

| Path | Contents |
|---|---|
| `apps/api` | Fastify API, pipeline, calculations, Academy, migrations (`src/db/migrations`), tests |
| `apps/web` | Next.js web app |
| `packages/shared` | Formatting, content rules, plans, tested learning simulations |
| `e2e` | Playwright browser tests |
| `apps/api/media/academy-videos` | Rendered lesson videos, posters, captions, transcripts (served only through the API, behind the lesson gate) |
| `scripts/video` | Video scripts, renderer and playback check |
| `scripts` | Local hosting, seeding, fingerprints, test runners, secret scan |
| `docs` | Architecture, security, data rights, curriculum, runbook, limitations, execution ledger |

## Status and documentation

Start with `reports/ATLAS_FINAL_RELEASE_REPORT.md` and `docs/execution/ATLAS_RESUME_CHECKPOINT.md` (current), then `AUTOPILOT.md` and `docs/execution/MASTER_EXECUTION_STATE.md` (history). Session 13 reports are in `reports/`. Release readiness: `docs/execution/RELEASE_READINESS.md`. Known limitations: `docs/KNOWN_LIMITATIONS.md`.
