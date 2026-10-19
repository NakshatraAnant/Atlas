# Known limitations

Honest list of what ATLAS cannot do or has not verified, as of 19 Oct 2026 (end of session 4).

## Data
- All market and company data is synthetic. No real Indian market data is licensed or ingested (B-DATA-01).
- User CSV upload (price series) works with column mapping, validation and provenance (`/app/research/datasets`). XLSX and document (PDF) extraction are not built.
- Point-in-time fundamentals exist for the synthetic data; real point-in-time history would depend on the provider.

## Infrastructure
- **Embedded database (PGlite) memory ceiling: fixed** (ADR-018). Seeds of 40, 120 and 602 companies complete, and the daily catch-up is covered by tests. Limits that remain:
  - A 500-company seed takes about 97 minutes (disk mode, peak RSS about 960 MB, database 1.7 GB). That size is for stress testing; the default is 120.
  - PGlite is single-process. The API and a CLI command (seed, eval) cannot open the same data directory at the same time.
- GitHub repository not created; code is committed locally only (B-GH-01).
- The Supabase schema is applied and matches local (migrations 001–008, identical fingerprint), but the app has not connected to Supabase because it needs the database password (B-SB-01). The node-postgres driver path is tested against a real local PostgreSQL 17 (`npm run test:postgres`), not against Supabase itself.
- No Docker route (no WSL on the dev machine). Production deployment is not part of this build.

## Financial engine
- A research DCF, scenario and sensitivity tool for real companies is not built: the `valuation_scenario_tool` flag stays legal-gated. DCF exists only as Academy labs and the Valuation Lab game, on illustrative inputs.
- The financial golden set has 59 hand-checked cases (`apps/api/test/golden/cases.ts`). It is not an exhaustive audit of every metric and edge case.

## AI
- Deterministic composer only; no LLM key configured (B-AI-01). The model-written narrative path is covered by the claim checker but has not been evaluated with a live model.
- The evaluation suite (`npm run eval`) covers 580 generated cases. It does not replace human review of answer quality.

## Academy
- Four courses, 29 lessons, 87 quiz questions, 48 diagnostic questions, 7 games and 4 capstones are authored. The full 14-module plan in `ACADEMY_CURRICULUM.md` has at least two lessons per module, not complete module depth.
- All Academy content is AI-drafted and **unreviewed**. It is shown locally behind a "Draft, pending expert review" label, and production refuses to serve it. Nothing is presented as expert-approved.
- Mastery parameters (α = 0.5, threshold 0.8, 3 answers) are unvalidated guesses.
- Capstone rubrics are self-assessed; admin review exists in the API only.
- No admin editor for Academy content; content is edited in source files.
- Reflection answers are kept on the device, not saved.

## Testing
- The browser e2e suite (Playwright, 8 journeys plus a restart-persistence check) runs on the installed Microsoft Edge. Other browsers were not tested.
- No automated accessibility audit (axe). Coverage is semantic markup, keyboard focus, reduced-motion support and a table fallback for the 3D lab.
- No independent penetration test (B-SEC-01).
- `npm audit --omit=dev` reports 2 advisories, from the postcss that Next 15 pins for build-time CSS processing of first-party styles. They are not reachable with ATLAS inputs; the fix is upgrading to Next 16 (see SECURITY_AND_PRIVACY.md). Development-only test tooling has further advisories that are not shipped.
