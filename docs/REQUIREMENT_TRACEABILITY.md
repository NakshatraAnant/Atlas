# Requirement traceability

Source of truth for MVP scope: the ATLAS PRD (`C:\Users\anant\Downloads\ATLAS_Product_Requirements_Document.docx`, not in git). IDs below are the PRD's requirement families as cited in code and tests. Status uses only automated evidence that ran in session 4 (19 Oct 2026), unless marked otherwise.

| PRD family | Area | Status | Evidence |
|---|---|---|---|
| ACC-01..08 | Accounts, verification, lockout, reset, TOTP, consent, export/delete | implemented, tested | api.test.ts "accounts and authentication" |
| BIL-01..10 | Plans, sandbox checkout, webhooks, GST invoices, dunning, refunds, entitlements | implemented on sandbox, tested; real gateway blocked (B-PAY-01) | api.test.ts "billing" |
| CMP-01..14 | Company search, profiles, statements with provenance, plan limits | implemented, tested | api.test.ts "company research and evidence" |
| MKT-01..11, HOM | Market breadth, sectors, regimes, briefing with number checks; Home "worth investigating" (HOM-03) and "what changed" panels | implemented, tested | api.test.ts, pipeline.test.ts, investigate.test.ts, e2e research.spec |
| SCR-01..06 | Screener | implemented, tested | api.test.ts "screener" |
| BKT-01..13 | Backtests: templates, rule builder (BKT-02), costs, liquidity limits (BKT-05), warnings, PIT, reproducibility hash, PDF | implemented, tested | api.test.ts "Quant Research Lab", rule-builder.test.ts, pipeline.test.ts BKT-09, e2e |
| AIA-01..13 | AI assistant: tools, claim checker, policy, quotas, eval | implemented (deterministic provider), tested; eval 580 cases pass the release gate | api.test.ts "AI research assistant", ai-policy-regression.test.ts, `npm run eval` |
| WSR-01..06, ALR | Watchlists, notes, workspaces, hypotheses, alerts | implemented, tested | api.test.ts "watchlists, notes, workspaces and alerts" |
| LRN-01..04 | Beginner learning path | implemented | content routes; `/app/learn` |
| MTH-01..06, SUP-01..05 | Methodology, sources, corrections, help, support, grievances, status | implemented, tested | api.test.ts "transparency, support and analytics" |
| ANL-01..04 | Analytics schema, consent, dashboards | implemented, tested (schema + consent) | api.test.ts |
| ADM-01..08 | Admin console API, masked PII, audit log, flags with legal gate, content management with review and publish (ADM-06) | implemented, tested (API; admin UI is partial) | api.test.ts "user isolation", cms.test.ts |
| CPL-03/06/07 | Legal gates, licence registry, field-level rights | implemented, tested | api.test.ts, rights code |
| NFR-01..12 | Security headers, rate limits, privacy, backup/restore, performance, a11y, browsers, availability, unit cost | partial: security, privacy and local backup/restore are implemented; availability, scalability and unit cost need a production deployment; a11y not audited | SECURITY_AND_PRIVACY.md, KNOWN_LIMITATIONS.md, `scripts/atlas.mjs backup/restore` |

## Product expansion (beyond the PRD; tracked separately)

| ID | Expansion | Status | Evidence |
|---|---|---|---|
| EXP-SB | Supabase hosted PostgreSQL with deny-by-default RLS | schema applied + verified; app connection blocked (B-SB-01) | rls.test.ts, fingerprint parity |
| EXP-ACAD-1 | Academy: 4 courses, versioned curriculum in DB | implemented, tested; content in review | academy.test.ts |
| EXP-ACAD-2 | 5-question placement diagnostics with transparent readiness | implemented, tested | academy-engine.test.ts, academy.test.ts |
| EXP-ACAD-3 | Lesson loop (7 stages), 17 interactive labs | implemented for 29 lessons across 4 courses; content in review | academy-content.test.ts, learning-sims tests, e2e academy.spec |
| EXP-ACAD-4 | Mastery separate from completion; spaced review | implemented, tested | academy tests |
| EXP-ACAD-5 | Seven-point content review + audited publication | implemented, tested | academy.test.ts |
| EXP-ACAD-6 | Games (7), capstones (4), completion records, 3D DCF surface with table fallback | implemented, tested | academy-extra.test.ts, e2e academy.spec |
| EXP-FIN-1 | DCF, scenario and sensitivity analysis | Academy labs and Valuation Lab game only (illustrative inputs); research tool for real companies not built (legal-gated flag) | learning-sims tests, golden.test.ts DCF cases |
| EXP-DATA-1 | CSV/XLSX upload, column mapping, extraction review | CSV price upload with mapping, validation, provenance and per-user isolation implemented and tested; XLSX and document extraction not built | datasets.test.ts |
| EXP-QA-1 | Financial golden-set report; browser e2e; a11y automation | golden set (59) and e2e (8 + restart) done; a11y automation not built | golden.test.ts, `npm run test:e2e` |
| EXP-SCALE-1 | Embedded engine handles 120–600 companies; daily catch-up | implemented, tested | pipeline-batching.test.ts, catchup.test.ts, seed runs in TEST_RESULTS.md |

## Per-ID citation audit (session 4)

The PRD lists 140 requirement IDs. A search of source and tests for each ID found: **74** cited in at least one test, **48** cited in source only, and **25** not cited by ID. Being cited is not proof of implementation, and not being cited is not proof of absence. The 25 uncited IDs were checked by behaviour:

| ID | Requirement | Finding |
|---|---|---|
| AIA-02, AIA-09, BKT-11, MTH-03, SCR-02, CMP-03 | Journey steps (save answer, read results, sign up, save screen, switch basis) | Behaviour exists: notes/watchlist from answers, run results page, sign-up with age and terms, `app.saved_screens`, consolidated/standalone switch in `companies/[id]/tabs.tsx` |
| AIA-04 | Three layers of truth labelled | Implemented: answer items typed observed / calculated / interpretation / possible_explanation; eval checks causal labelling |
| AIA-07 | Uncertainty and missing data stated | Implemented: uncertainty section; missing values stated with the reason (ADR-019) |
| BKT-05 | Liquidity limits | Implemented: `LiquidityRule` in `backtest/engine.ts` (minimum ADV and position cap) |
| CPL-04 | Marketing copy review | Process requirement; content checker enforces no-advice language. Human review not done |
| HOM-07 | Learning progress on Home | Implemented on the Home page for users with progress |
| HOM-08 | No unexplained composite score | Satisfied by design: Home shows no composite score |
| LRN-02 | Metric definitions link to lessons | Implemented: metric definitions carry `lesson`; the assistant and methodology link to it |
| LRN-03 | Progress saved per user | Implemented: `app.learning_progress`, `acad.lesson_progress` |
| MTH-02, MTH-04 | Data sources page; backtest methodology | Implemented: `/methodology/[page]` incl. backtests; sources and freshness |
| SUP-05 | Status page | Implemented: `/status` page and status API |
| NFR-01..05, 07, 10, 12 | Non-functional | See the NFR row above: partial, mostly needing a production deployment to measure |
