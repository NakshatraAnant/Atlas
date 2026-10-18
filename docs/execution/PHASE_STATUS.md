# Phase status

| Phase | Scope | Status | Evidence / gap |
|---|---|---|---|
| 0 | Inspect, baseline | done | Session 1 audit; session 3 re-baseline: 148 API + 27 shared tests green before changes |
| 1 | GitHub + Supabase | partial | Supabase project created, migrations 001–005 applied, parity proven. GitHub blocked (B-GH-01). App→Supabase connection blocked on password (B-SB-01). |
| 2 | Data foundations (registry, rights, synthetic, provenance) | done for MVP scope | rights + registry tests; synthetic vendor; ingestion checks. Gap: user CSV/XLSX upload with column mapping not built. |
| 3 | Deterministic financial engine | done (MVP metrics) | calc.test.ts; gap: separate golden-test report with case counts and tolerances; DCF / scenario / sensitivity not built |
| 4 | One vertical research workflow | done | company research → evidence → notes/watchlists → AI question (api.test.ts) |
| 5 | Academy foundation (4 courses, diagnostics, mastery, reviews) | **next** | Only a 4-lesson beginner path exists (`modules/content`) |
| 6 | Expand learning + research (games, labs, more strategies) | not started | |
| 7 | Visual quality, motion, 3D, a11y | not started | |
| 8 | End-to-end validation | not started | No browser e2e tests yet |
| 9 | Delivery docs | partial | Execution ledger in place; required docs list in NEXT_ACTIONS |
