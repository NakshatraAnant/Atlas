# Phase status

_Updated 19 Oct 2026, end of session 4._

| Phase | Scope | Status | Evidence / gap |
|---|---|---|---|
| 0 | Inspect, baseline | done | Session 4 re-baseline before changes |
| 1 | GitHub + Supabase | partial | Supabase: migrations 001–008 applied, parity proven, deny-by-default RLS. GitHub blocked (B-GH-01). App→Supabase connection blocked on the password (B-SB-01). |
| 2 | Data foundations | done for the synthetic MVP | rights, registry, synthetic vendor, ingestion checks, CSV price upload (datasets.test.ts). Gap: XLSX/PDF extraction; licensed data (B-DATA-01). |
| 3 | Deterministic financial engine | done (MVP metrics) | calc.test.ts, golden set 59/59. Gap: research DCF tool for real companies (legal-gated). |
| 4 | Research workflows | done | api.test.ts, investigate/rule-builder/cms tests, e2e research journey |
| 5 | Academy foundation | done | academy-engine, academy, academy-content tests |
| 6 | Expand learning + research | done | 4 courses / 29 lessons / 17 labs / 7 games / 4 capstones; rule builder; datasets |
| 7 | Visual quality, motion, 3D, a11y | partial | 3D DCF surface with table fallback, reduced motion, keyboard focus. Gap: automated a11y audit. |
| 8 | End-to-end validation | done locally | e2e 8/8 + restart; test:postgres 8/8; eval gate pass; launcher first-run (TEST_RESULTS.md) |
| 9 | Delivery docs | done | execution ledger, RELEASE_READINESS, README, runbook, limitations, traceability |
