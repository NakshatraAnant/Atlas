# ATLAS autopilot — read this first when resuming

This file is the entry point for any agent or engineer resuming work on ATLAS.

## Where things are

| What | Where |
|---|---|
| Task ledger (status of every task) | `docs/execution/MASTER_TASK_LEDGER.md` |
| Session log (what happened, when) | `docs/execution/SESSION_LOG.md` |
| How to resume safely | `docs/execution/RESUME_INSTRUCTIONS.md` |
| Genuine external blockers | `docs/execution/BLOCKERS.md` |
| Evidence for completed acceptance criteria | `docs/execution/ACCEPTANCE_EVIDENCE.md` |
| Baseline audit of the starting state | `docs/execution/BASELINE_AUDIT.md` |
| Requirements traceability | `docs/requirements/requirements-matrix.md` (generated from `docs/requirements/registry.json`) |
| Decisions (ADRs) | `docs/decisions/decision-log.md` |
| Source documents (read-only originals) | `C:\Users\anant\Downloads\ATLAS_*.docx` and the HTML prototype; inventory in `docs/requirements/document-inventory.md` |

## Resume procedure (short form)

1. `git status` and `git log --oneline -15` on branch `feat/atlas-mvp`.
2. Read the last entry of `docs/execution/SESSION_LOG.md` and the first `in progress` row of the ledger.
3. `npm install` then `npm test` — do not trust earlier "passed" claims until the tests rerun.
4. Continue the highest-priority unfinished task. Update the ledger and session log as you go.

Full procedure: `docs/execution/RESUME_INSTRUCTIONS.md`.

## Ground rules that must survive every session

- Synthetic data is for development only; production refuses it (`assertProductionSafe`, `ALLOW_SYNTHETIC_DATA`).
- Legal-gated feature flags cannot be enabled without approver, date and document reference (DB constraint + API).
- Never mark a requirement complete without a test or other recorded evidence.
- No real charges, no real customer data, no external communications.
