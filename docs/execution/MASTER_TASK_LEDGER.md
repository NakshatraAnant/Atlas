# Master task ledger (sessions 1–2, superseded)

> **Superseded on 19 Oct 2026.** Status columns below were not kept up to date after session 1: most rows marked `not started` were built and are covered by tests (see `MASTER_EXECUTION_STATE.md`). Kept for history only.

Status values: `not started` · `in progress` · `blocked` · `completed` · `deferred`. Priorities P0 (launch-critical) to P3.
Evidence must point to a test, command output or artefact. Updated by every session.

| Task ID | Phase | Requirement IDs | Description | Deps | Pri | Status | Files changed | Tests | Evidence | Blocker | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T-000 | 0 | all | Read six source documents; verify PRD copies identical | — | P0 | completed | docs/requirements/document-inventory.md | — | md5 of both PRD .docx files equal (6e342f03…) | — | — |
| T-001 | 0 | — | Baseline audit of repository and environment | — | P0 | completed | docs/execution/BASELINE_AUDIT.md | — | Folder empty; no Python/WSL/Docker engine | — | — |
| T-010 | 1 | NFR-* | Monorepo, TypeScript, test runner, git branch | T-001 | P0 | completed | package.json, tsconfig.base.json | shared: 27 tests | `npm test -w @atlas/shared` | — | — |
| T-011 | 1 | Blueprint §6 | Schema v1 + forward-only checksummed migrations | T-010 | P0 | completed | apps/api/src/db/* | migrate test | 128 tables created in 0.45 s on PGlite | — | — |
| T-012 | 1 | CPL-06/07 | Dataset/licence registry and field-level rights | T-011 | P0 | completed | modules/ref/* | rights tests | see tests | — | — |
| T-020 | 3 | DAT, CMP-01 | Synthetic vendor (dev only, labelled, XXS ISINs) | T-011 | P0 | completed | pipeline/synthetic/* | generator tests | deterministic world, 1.7 s | Licensed data not available (B-DATA-01) | — |
| T-021 | 3 | Blueprint §5.1–5.3 | Ingestion: raw store, checksum dedupe, quality checks, quarantine | T-020 | P0 | completed | pipeline/ingest.ts, handlers/* | pipeline tests | history load + daily cycles | — | — |
| T-022 | 3 | Blueprint §5.4–5.6, BKT-09 | Corporate-action adjustment, PIT fundamentals, security_daily | T-021 | P0 | completed | pipeline/calc/* | calc tests | — | — | — |
| T-023 | 3 | MKT-02/03/04/07 | Breadth, sectors, volatility, regimes | T-022 | P0 | completed | pipeline/calc/market.ts | calc tests | — | — | — |
| T-024 | 3 | CMP-05/06, MTH-01 | Metric definitions + ratio library + metric_values | T-022 | P0 | completed | modules/calc/*, pipeline/calc/metrics.ts | ratio tests | — | — | — |
| T-025 | 3 | MKT-08/11 | Post-close briefing with number checks and holds | T-023 | P0 | completed | modules/market/briefing.ts | briefing tests | — | — | — |
| T-026 | 4 | ALR-01/03 | Material-change alerts, dedupe, cap, digest | T-021 | P1 | completed | modules/alerts/* | alert tests | — | — | — |
| T-030 | 2 | ACC-01..08 | Auth, sessions, verification, reset, TOTP, consent | T-011 | P0 | in progress | modules/auth/* | — | — | Google OAuth client (B-AUTH-01) | Implement and test |
| T-031 | 2 | BIL-10, ADM-07/08 | Entitlements, usage counters, feature flags, audit log | T-030 | P0 | not started | — | — | — | — | — |
| T-040 | 3 | CMP-01..14 | Company research API | T-024 | P0 | not started | — | — | — | — | — |
| T-041 | 4 | SCR-01..06 | Screener API | T-024 | P0 | not started | — | — | — | — | — |
| T-042 | 4 | BKT-01..13 | Backtest engine, templates, costs, warnings, reproducibility | T-022 | P0 | not started | — | — | — | — | — |
| T-043 | 4 | AIA-01..13 | AI assistant: gateway, tools, claim checker, policy, eval suite | T-024 | P0 | not started | — | — | — | LLM key absent (B-AI-01) | — |
| T-044 | 4 | WSR-01..06 | Watchlists, notes, workspaces, history, hypotheses | T-030 | P0 | not started | — | — | — | — | — |
| T-045 | 4 | LRN-01..04 | Learning Centre | T-030 | P2 | not started | — | — | — | — | — |
| T-046 | 4 | MTH-01..06, SUP-01..05 | Methodology, help centre, support, grievances, status | T-030 | P0 | not started | — | — | — | — | — |
| T-050 | 5 | BIL-01..09 | Billing: plans, sandbox gateway, webhooks, GST invoices, dunning, refunds | T-031 | P0 | not started | — | — | — | Razorpay account, CA approval (B-PAY-01, B-GST-01) | — |
| T-051 | 5 | ANL-01..04 | Analytics events, WAR/activation dashboards, experiments | T-030 | P0 | not started | — | — | — | — | — |
| T-052 | 5 | ADM-01..08 | Admin console API | T-031 | P0 | not started | — | — | — | — | — |
| T-060 | 2–5 | J1–J12 | Web application (Next.js) | T-040.. | P0 | not started | — | — | — | — | — |
| T-070 | 6 | NFR-01..12 | Hardening: security headers, rate limits, perf, a11y, e2e | all | P0 | not started | — | — | — | Pen test (B-SEC-01) | — |
| T-080 | 8 | — | Release docs, runbooks, final acceptance audit | all | P0 | not started | — | — | — | — | — |
