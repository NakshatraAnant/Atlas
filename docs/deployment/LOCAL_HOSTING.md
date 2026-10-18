# Running ATLAS on your own computer

ATLAS runs entirely on this computer: an API server, a web server and an embedded PostgreSQL
database (PGlite) stored in the project's `data/` folder. Nothing is exposed to your network —
both servers listen on `127.0.0.1` only. No external accounts are needed: email goes to a local
outbox, payments use a built-in sandbox, and the AI assistant uses the deterministic composer.

The data is **synthetic** (fictional companies with an `XXS…` ISIN prefix). It exists so that every
feature can be used locally. It must never be presented as real market data.

## Requirements

| Item | Requirement | Check |
|---|---|---|
| Node.js | 20 or newer (tested on 24.16) | `node --version` |
| npm | comes with Node.js | `npm --version` |
| Disk | about 1.5 GB (dependencies, build, database) | |
| Memory | 2 GB free while seeding; about 600 MB when running | |
| `tar` | built into Windows 10+, macOS and Linux (used by backup/restore) | `tar --version` |
| Ports | 3000 (web) and 4000 (API) free on 127.0.0.1 | |

Docker is **not** required. A Docker Compose route is not provided because it could not be
built or tested on the development machine; the Node route below is the verified one.

## First run

From the project folder:

```bash
npm install
```

```bash
node scripts/atlas.mjs start
```

On Windows you can type `atlas start` (via `atlas.cmd`); on macOS or Linux, `./atlas start`.

The first start:

1. creates `.env.local` with a random `APP_SECRET` (git-ignored; never commit it),
2. builds the web app if it is not built,
3. creates the database in `data/pglite` and loads the synthetic dataset — **this happens once and
   takes several minutes** (progress in `.atlas/logs/seed.log`),
4. starts the API and the web server and waits until both pass health checks.

Then open **http://localhost:3000**.

### Development accounts

| Email | Plan | Notes |
|---|---|---|
| `free@atlas.test` | Free | |
| `plus@atlas.test` | Plus | |
| `pro@atlas.test` | Pro Research | |
| `admin@atlas.test` | Admin | needs a TOTP code: the secret is `DEV_ADMIN_TOTP_SECRET` in `apps/api/src/seed.ts` |

The shared development password is `DEV_PASSWORD` in `apps/api/src/seed.ts`. These accounts
exist only in local and test databases. You can also sign up with any address: the verification
email appears under **Admin → Email outbox** (or in the `app.email_outbox` table).

## Everyday commands

All commands run from the project folder. `node scripts/atlas.mjs <command>` works on every
platform; `atlas <command>` (Windows) and `./atlas <command>` (macOS, Linux) are shortcuts.

| Command | What it does |
|---|---|
| `start` | Starts ATLAS (seeds the database only if it does not exist yet). |
| `stop` | Stops the web server, then asks the API to shut down cleanly (it flushes the database to disk). Forces it only after 30 s. |
| `restart` | `stop` then `start`. |
| `status` | Shows whether each process is running and healthy. Exit code 0 = healthy, 2 = partly running, 3 = stopped. |
| `logs [api\|web\|seed] [--follow] [--lines=N]` | Prints the last lines of a log; `--follow` keeps watching. |
| `backup` | Stops ATLAS if running, writes `backups/atlas-backup-<time>.tar.gz` and a `.json` manifest with a SHA-256 checksum, then starts it again. |
| `restore [file] [--start]` | Lists backups, or restores one: checks the checksum, moves the current `data/` aside to `data.before-restore-<time>/` (it is **not** deleted), and unpacks the backup. |
| `update` | Backs up, runs `npm install` and the full build, and restarts if it was running. Database migrations apply automatically at start and are forward-only. Pull new code yourself first (for example `git pull`). |
| `test` | Runs the automated test suites (`npm test`). |
| `seed` | Creates and seeds the database when none exists. It refuses if a database already exists. |

## Where things are

| Path | Contents | Safe to delete? |
|---|---|---|
| `data/pglite/` | The database | **No** — this is your data. Back it up first. |
| `data/objects/` | Stored files (briefing snapshots, exports, backtest series, invoice PDFs) | **No** |
| `backups/` | Backup archives and manifests | Only backups you no longer need |
| `data.before-restore-*/` | Previous data kept by `restore` | Yes, once you are happy with the restore |
| `.atlas/logs/` | `api.log`, `web.log`, `seed.log` | Yes (when stopped) |
| `.atlas/run/` | Process IDs and the stop signal | Yes (when stopped) |
| `.env.local` | Local settings and `APP_SECRET` | Deleting it signs everyone out (new secret) |

None of the commands ever delete `data/` or a backup. To start again from an empty database,
run `backup`, `stop`, rename `data` yourself, then `start`.

## Settings

Put overrides in `.env.local` (one `KEY=value` per line). Useful ones:

| Key | Default | Purpose |
|---|---|---|
| `WEB_PORT` | 3000 | Web port. Rebuild after changing ports: the web server proxies to the API using the port fixed at build time (`npm run build -w @atlas/web`). |
| `API_PORT` | 4000 | API port (same rebuild note). |
| `LOG_LEVEL` | info | `debug`, `info`, `warn`, `error` or `silent`. |
| `AI_PROVIDER` | deterministic | Set `anthropic` with `ANTHROPIC_API_KEY` to use a language model. Language-model text is only shown after a passing evaluation run is recorded for that model and prompt version (release gate AIA-13). |
| `DATABASE_URL` | empty | Point at your own PostgreSQL 16+ instead of the embedded database. Back it up with `pg_dump`; `backup` and `restore` handle the embedded database only. |
| `SYNTHETIC_COMPANIES` | 40 | Size of the synthetic universe (applies to a new database only; keep the same value for the API). 120 exceeded the embedded engine's memory during seeding in session 3. |

`NODE_ENV=production` is refused by the local script: production needs real data licences, a
managed database, a real email provider and a payment gateway (see
`docs/deployment/PRODUCTION_DEPLOYMENT_GUIDE.md`).

## Network exposure

- The API binds to `127.0.0.1:4000` and the web server to `127.0.0.1:3000`. Other devices on your
  network cannot reach them. Do not change the bind address unless you add authentication in
  front and understand the risk.
- There is no database port at all: PGlite runs inside the API process.
- The admin console is part of the web app, needs an admin account **and** a TOTP code, and every
  admin write is recorded in the hash-chained audit log.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 3000 … already in use` | Stop the other program, or set `WEB_PORT` in `.env.local` and rebuild. |
| `Dependency … is not installed` | Run `npm install`. |
| `API exited during startup` | `node scripts/atlas.mjs logs api`. A message about the database being locked usually means another ATLAS API process is still running: run `stop`, then check Task Manager or `ps` for `src/server.ts`. |
| The page loads but shows “ATLAS could not be reached” | The API stopped: run `status`, then `logs api`. |
| Seeding failed | Read `.atlas/logs/seed.log`. The partial database is left in place for inspection; rename `data` and run `start` to try again. |
| The computer crashed while ATLAS was running | Run `start`. If the database will not open, `restore` the latest backup. |

## Verification record

The commands above were run on Windows 11 (Node 24.16.0). The results are in
`docs/execution/ACCEPTANCE_EVIDENCE.md` under “Local hosting”.
