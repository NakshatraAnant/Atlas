# Requirement traceability

Source of truth for MVP scope: the ATLAS PRD (`C:\Users\anant\Downloads\ATLAS_Product_Requirements_Document.docx`, not in git). IDs below are the PRD's requirement families as cited in code and tests. Status uses only automated evidence that ran in session 3, unless marked otherwise.

| PRD family | Area | Status | Evidence |
|---|---|---|---|
| ACC-01..08 | Accounts, verification, lockout, reset, TOTP, consent, export/delete | implemented, tested | api.test.ts "accounts and authentication" |
| BIL-01..10 | Plans, sandbox checkout, webhooks, GST invoices, dunning, refunds, entitlements | implemented on sandbox, tested; real gateway blocked (B-PAY-01) | api.test.ts "billing" |
| CMP-01..14 | Company search, profiles, statements with provenance, plan limits | implemented, tested | api.test.ts "company research and evidence" |
| MKT-01..11, HOM | Market breadth, sectors, regimes, briefing with number checks | implemented, tested | api.test.ts, pipeline.test.ts |
| SCR-01..06 | Screener | implemented, tested | api.test.ts "screener" |
| BKT-01..13 | Backtests: templates, costs, warnings, PIT, reproducibility hash, PDF | implemented, tested | api.test.ts "Quant Research Lab", pipeline.test.ts BKT-09 |
| AIA-01..13 | AI assistant: tools, claim checker, policy, quotas, eval | implemented (deterministic provider), tested | api.test.ts "AI research assistant", `npm run eval` |
| WSR-01..06, ALR | Watchlists, notes, workspaces, hypotheses, alerts | implemented, tested | api.test.ts "watchlists, notes, workspaces and alerts" |
| LRN-01..04 | Beginner learning path | implemented | content routes; `/app/learn` |
| MTH-01..06, SUP-01..05 | Methodology, sources, corrections, help, support, grievances, status | implemented, tested | api.test.ts "transparency, support and analytics" |
| ANL-01..04 | Analytics schema, consent, dashboards | implemented, tested (schema + consent) | api.test.ts |
| ADM-01..08 | Admin console, masked PII, audit log, flags with legal gate | implemented, tested | api.test.ts "user isolation" |
| CPL-03/06/07 | Legal gates, licence registry, field-level rights | implemented, tested | api.test.ts, rights code |
| NFR | Security headers, rate limits, performance, a11y | partial | see SECURITY_AND_PRIVACY.md, KNOWN_LIMITATIONS.md |

## Product expansion (beyond the PRD; tracked separately)

| ID | Expansion | Status | Evidence |
|---|---|---|---|
| EXP-SB | Supabase hosted PostgreSQL with deny-by-default RLS | schema applied + verified; app connection blocked (B-SB-01) | rls.test.ts, fingerprint parity |
| EXP-ACAD-1 | Academy: 4 courses, versioned curriculum in DB | implemented, tested; content in review | academy.test.ts |
| EXP-ACAD-2 | 5-question placement diagnostics with transparent readiness | implemented, tested | academy-engine.test.ts, academy.test.ts |
| EXP-ACAD-3 | Lesson loop (7 stages), 3 interactive labs | MARKET DECODER module 1 only | learning-sims.test.ts, UI |
| EXP-ACAD-4 | Mastery separate from completion; spaced review | implemented, tested | academy tests |
| EXP-ACAD-5 | Seven-point content review + audited publication | implemented, tested | academy.test.ts |
| EXP-ACAD-6 | Games (7 concepts), capstones, completion records, 3D | not started | — |
| EXP-FIN-1 | DCF, scenario and sensitivity analysis | not started | — |
| EXP-DATA-1 | CSV/XLSX upload, column mapping, extraction review | not started | — |
| EXP-QA-1 | Financial golden-set report; browser e2e; a11y automation | not started | — |
