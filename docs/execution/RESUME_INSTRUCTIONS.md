# Resume instructions

## 1. Environment facts (verified 18 Oct 2026)

- Windows 11, Node 24, npm, git. **No Python, no WSL, Docker engine not running.** This is why the stack is TypeScript end to end (ADR-008).
- The database for development and tests is PGlite (PostgreSQL 16.4 compiled to WASM). Data lives in `./data/pglite` (git-ignored). Production uses `DATABASE_URL` against managed PostgreSQL 16.

## 2. Safe resume steps

```bash
git status
git log --oneline -15
npm install
npm test
```

1. If `npm test` fails, fix the failure before starting new work and record it in the session log.
2. Read `docs/execution/MASTER_TASK_LEDGER.md`; pick the first task marked `in progress`, else the highest-priority `not started` task whose dependencies are complete.
3. Before any migration: migrations are forward-only and checksummed (`apps/api/src/db/migrate.ts`). Never edit an applied migration; add a new numbered file.
4. The development database can always be rebuilt: delete `./data/pglite` and run `npm run seed` (deterministic synthetic data; takes a few minutes).
5. Long-running processes started by a previous session (API, web, worker) are not persistent; restart them with the commands in `README.md`.

## 3. Unavoidable manual step for automatic continuation

The coding agent cannot restart itself after a provider quota resets. To continue, start a new agent session in this folder and say: "Resume ATLAS from AUTOPILOT.md". No scheduler is configured to re-invoke the agent automatically because no documented, supported mechanism for that exists in this environment that respects provider limits (see `docs/execution/BLOCKERS.md`, B-AUTO-01).
