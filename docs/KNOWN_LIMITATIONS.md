# Known limitations

Honest list of what ATLAS cannot do or has not verified, as of 19 Oct 2026.

## Data
- All data is synthetic. No real Indian market data is licensed or ingested.
- No CSV/XLSX upload, column mapping or document extraction yet.
- Point-in-time fundamentals exist for synthetic data; real point-in-time history would depend on the provider.

## Infrastructure
- **Embedded database memory ceiling (open):** PGlite (WASM) crashes with "memory access out of bounds" (a) when seeding 120 synthetic companies, in the calculation stage right after the history load (the session-2 seed log stops at the same step), and (b) when an older 268 MB database ran a daily catch-up cycle with background jobs on. After a crash every query fails until the API restarts. Mitigation: default universe reduced to 40 companies (ADR-017), which seeds in 155 s and served the full Academy journey; the daily cycle at 40 companies has **not** yet been exercised. The proper fix is to make the calculation stage memory-bounded (chunked per security/date).
- GitHub repository not created; code is local only (B-GH-01).
- Supabase schema is applied, but the app has not connected to it, because the database password is needed (B-SB-01). The node-postgres path is untested (B-PG-01).
- No Docker route (no WSL on the dev machine).

## Financial engine
- DCF, scenario and sensitivity tools are not built (there is a legal-gated `valuation_scenario_tool` flag).
- No separate golden-test report with case counts and tolerances yet; calculations are covered by unit tests (calc.test.ts).

## AI
- Deterministic composer only; no LLM key configured. The eval suite exists (`npm run eval`).

## Academy
- Only MARKET DECODER module 1 (3 lessons) is authored; other modules show "in preparation".
- All Academy content is AI-drafted and **unreviewed**; shown as draft locally, and production refuses to serve it.
- Mastery parameters (α = 0.5, threshold 0.8, 3 answers) are unvalidated guesses.
- No games, capstones, completion records, 3D scenes or admin content editor yet.
- Reflection answers are not saved (by design for now).

## Testing
- No browser end-to-end test suite; UI verified manually in session 3.
- No accessibility audit beyond semantic markup, keyboard focus and reduced-motion support.
