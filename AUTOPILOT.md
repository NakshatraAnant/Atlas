# ATLAS autopilot — read this first when resuming

This file is the entry point for any agent or engineer resuming work on ATLAS.

## Where things are

| What | Where |
|---|---|
| **Session 9 status (start here)** | `docs/execution/ATLAS_MASTER_EXECUTION_STATUS.md`, `docs/execution/ATLAS_RESUME_CHECKPOINT.md` |
| **Digital Assets (session 8)** | `docs/IMPLEMENTATION_STATUS.md`, `docs/crypto/SOURCE_CAPABILITY_MATRIX.md` |
| **Current state (start here)** | `docs/execution/RECOVERY_2026-10-22.md`, then `docs/execution/MASTER_EXECUTION_STATE.md` |
| Next actions | `docs/execution/NEXT_ACTIONS.md` |
| Phase status | `docs/execution/PHASE_STATUS.md` |
| Test results (only runs that happened) | `docs/execution/TEST_RESULTS.md` |
| Genuine external blockers | `docs/execution/BLOCKERS.md` |
| Decisions (ADRs) | `docs/execution/DECISION_LOG.md` |
| Session log | `docs/execution/SESSION_LOG.md` |
| How to resume safely | `docs/execution/RESUME_INSTRUCTIONS.md` |
| Older task ledger (sessions 1–2; superseded) | `docs/execution/MASTER_TASK_LEDGER.md` |
| Source documents (read-only originals, not in git) | `C:\Users\anant\Downloads\ATLAS_*.docx` and the HTML prototype |

## Resume procedure (short form)

1. `git status` and `git log --oneline -15` on branch `feat/atlas-mvp`.
2. Read `docs/execution/MASTER_EXECUTION_STATE.md` and `docs/execution/NEXT_ACTIONS.md`.
3. `npm install` then `npm test` — do not trust earlier "passed" claims until the tests rerun.
4. Continue the highest-priority unfinished task. Update the ledger and session log as you go.

Full procedure: `docs/execution/RESUME_INSTRUCTIONS.md`.

## Ground rules that must survive every session

- Synthetic data is for development only; production refuses it (`assertProductionSafe`, `ALLOW_SYNTHETIC_DATA`).
- Legal-gated feature flags cannot be enabled without approver, date and document reference (DB constraint + API).
- Never mark a requirement complete without a test or other recorded evidence.
- No real charges, no real customer data, no external communications.
