# Next actions

Ordered. Take the first unchecked item whose dependencies are met.

## Done in session 3
- [x] Supabase project, deny-by-default RLS, schema parity (migrations 001–006)
- [x] Academy schema, engine, API, curriculum for 4 courses (diagnostic banks), MARKET DECODER module 1, web pages, labs
- [x] Required docs set

## For the agent

1. [ ] **Make the pipeline calculation stage memory-bounded** so the 120-company seed and daily catch-up stop crashing PGlite. Reproduce with `SYNTHETIC_COMPANIES=120 npm run seed` (crash after `macro_calendar`); chunk the adjustment/metrics/market calc per security or date window; add a regression test that seeds a larger universe; then exercise a daily catch-up with background jobs on.
2. [ ] Financial golden-test suite as a reported artefact (case count, pass/fail, tolerance, severity), including DCF/scenario/sensitivity once built.
3. [ ] MARKET DECODER modules 2–4 (risk and return, money over time, reading the market), each with a lab; then EQUITY DETECTIVE module 1 linked to real company-research screens.
4. [ ] First games on the shared engine: Statement Surgeon, Valuation Lab (deterministic rules, learning objective per game).
5. [ ] Completion records and capstone rubric for MARKET DECODER.
6. [ ] Admin UI for the Academy review queue (API exists).
7. [ ] CSV/XLSX upload with column mapping, validation and provenance.
8. [ ] Browser e2e tests (Playwright) for the research and Academy journeys; axe accessibility checks.
9. [ ] When B-SB-01 is resolved: `npm run migrate` against Supabase (expect no-op), seed, run the real-PostgreSQL suite against a separate empty database.

## For you (unblock external items; see BLOCKERS.md)

- B-GH-01: create GitHub repo `project-atlas` and push (one command once you're signed in).
- B-SB-01: copy the Supabase session-pooler connection string into `.env.local`.
- B-PG-01 (optional): install WSL so Docker can run a local PostgreSQL for the driver tests.
- Content: name a subject-matter reviewer for Academy lessons.
