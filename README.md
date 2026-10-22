# ATLAS

Research workspace and learning academy for Indian equities and digital assets: an evidence-linked market briefing, company research with provenance on every figure, screener, an AI research assistant that never invents numbers, a Quant Research Lab for reproducible backtests, watchlists and notes, and the four-course ATLAS Academy.

**Indian equity data in this repository is synthetic** (fictional companies, ISINs starting `XXS`): licensed Indian market data is not available (`docs/DATA_RIGHTS_AND_PROVIDERS.md`), and production mode refuses to start with synthetic data.

**ATLAS Digital Assets uses real data** from free public sources (CoinGecko, Binance, Coinbase Exchange, DefiLlama, public Ethereum and Bitcoin endpoints, official release feeds), stored locally with source, timestamp and validation status. It never mixes synthetic and real data, and never fills gaps with invented values. Sources, limits and terms: `docs/crypto/SOURCE_CAPABILITY_MATRIX.md`. Status: `docs/IMPLEMENTATION_STATUS.md`.

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

Start with `AUTOPILOT.md` and `docs/execution/MASTER_EXECUTION_STATE.md`. Release readiness: `docs/execution/RELEASE_READINESS.md`. Known limitations: `docs/KNOWN_LIMITATIONS.md`.
