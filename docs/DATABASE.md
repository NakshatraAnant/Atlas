# Database architecture, migrations and recovery

## Supported engines

| Engine | Use | Status |
|---|---|---|
| **PGlite** (PostgreSQL 16 in WASM), `./data/pglite` | Local installation (default) and the test suite | Primary; used by `node scripts/atlas.mjs start` |
| **PostgreSQL 17** via node-postgres (`DATABASE_URL`) | Hosted/production target (Supabase project or any PostgreSQL) | Verified by `npm run test:postgres` (embedded PostgreSQL 17 server, throwaway, loopback only): all migrations from empty, idempotent re-run, identical schema fingerprint, type normalisation, RLS, rollback, a full seed, and concurrency/idempotency of crypto, equity, research and learning write paths |

PGlite is single-process: the API and a CLI command (seed, pipeline, `atlas crypto …`) cannot open `./data` at the same time; the launcher refuses when the API is running. PostgreSQL has no such limit.

## Migrations

Forward-only, checksummed SQL files in `apps/api/src/db/migrations` (`001`–`011`), applied automatically at start-up inside a transaction each (`migrate.ts`). An applied file that changes is a hard error. There are no down-migrations: recovery from a failed upgrade is by restoring the backup taken before it (`atlas update` backs up first).

- `npm test` runs migrations against PGlite in every test file; `rls.test.ts` checks RLS on every table in every ATLAS schema (`ref, market, fund, disc, calc, bt, ai, app, ops, acad, crypto, equity, research`).
- `npm run test:postgres` applies all migrations to an empty PostgreSQL 17 database and compares `fingerprint.sql` with PGlite.
- Upgrade from an earlier real database: verified by `atlas verify-backup` on a backup taken at migration 010, which applied 011 to the restored copy and started the API (23 Oct 2026).

Conventions: money and prices `numeric` (equity `numeric(20,6)`), timestamps `timestamptz` (UTC), trading dates `date`, natural-key uniqueness for idempotent upserts, `ON CONFLICT` for retries, one transaction per batch write.

## Backup and restore

```bash
node scripts/atlas.mjs backup
```
Stops the API if running, writes `backups/atlas-backup-<time>.tar.gz` and a `.json` manifest with SHA-256, then restarts.

```bash
node scripts/atlas.mjs verify-backup
```
Recovery drill on the newest backup (or a named one): checksum, archive layout, extraction into `.atlas/verify-*` (never `./data`), integrity checks (`apps/api/src/cli/verify-backup.ts`: counts, OHLC validity, duplicates, pending migrations applied to the copy), API start on port 4100 against the copy and `/readyz`; the copy is deleted afterwards.

```bash
node scripts/atlas.mjs restore backups/<file>.tar.gz
```
Verifies the checksum, moves the current `./data` aside to `data.before-restore-*` (not deleted), extracts the backup. Add `--start` to start ATLAS afterwards.

Backups are git-ignored and stay on this machine. They contain the local database, including user accounts and notes: do not share them.
