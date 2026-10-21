# Non-real data inventory

Audit of 21 Oct 2026. It answers: where does every non-real financial value in ATLAS come from, who sees it, and how is it kept apart from real data? There is no real data in ATLAS yet (see `DATA_RIGHTS_AND_PROVIDERS.md`).

## Method

- Searched all app code (`apps/web`, `apps/api/src`, `packages/shared/src`) for `Math.random`: **none**. No value anywhere in the product is randomly generated at request time.
- Searched UI code for hard-coded financial literals (₹ amounts, percentages, `<Value v={…}>`).
- Traced every dataset in `ref.sources` to its producer.

## Inventory

| Source | What it produces | Consumers | Purpose | Isolation / labelling | Status |
|---|---|---|---|---|---|
| `apps/api/src/pipeline/synthetic/*` (deterministic, seeded `rng.ts`) | Fictional companies, securities, EOD prices, index levels, corporate actions, fundamentals, shareholding, announcements, insider trades, audit events, calendar | Every research screen, briefing, screener, Quant Lab, assistant | Run the full product locally without licensed data | Stored with `is_synthetic = true`; ISINs start `XX`, which is not a valid country code, so they can never collide with real ISINs. Every source row is `dev_only`. The UI shows a "Synthetic development data" badge, and Data health states "synthetic development data only". **Production refuses to start** with synthetic data (`assertProductionSafe`). | Kept, clearly labelled, until a licensed feed replaces it via `VendorAdapter` |
| `apps/api/test/fixture.ts` → `test/.fixture/*.tar.gz` | A smaller deterministic synthetic database | Unit, API and e2e tests only | Fast, reproducible tests | Never loaded by the running app; the e2e harness uses its own data directory | Kept (test-only) |
| `apps/api/test/golden/cases.ts` | Hand-calculated inputs and outputs | `golden.test.ts` | Calculation correctness | Test-only | Kept |
| `packages/shared/src/learning-sims*.ts` | Lesson simulations (order book, compounding, DCF, drawdown…) | Academy labs and games | Teaching | Labelled as illustrative inside each lab | Kept (educational simulation) |
| Academy lesson text (`apps/api/src/modules/academy/**`) | Worked examples with hypothetical numbers | Lessons, quizzes | Teaching | Marked "(hypothetical)" or uses the synthetic companies; never presented as real records | Kept |
| `apps/web/app/page.tsx` (landing) | One example figure ("18.4% operating margin") | Public landing page | Shows how evidence links work | **Changed 21 Oct:** now labelled "Illustrative figure, not a real company" | Fixed |
| `apps/web/app/pricing`, billing sandbox | Plan prices | Pricing and billing | Product pricing, not market data | n/a | Not financial market data |

## Failure behaviour

When data is missing or a source fails, ATLAS shows that state ("not available", "n/m", "Stale — last updated …", "could not be reached"). It never substitutes another value. There is no code path that falls back from a real source to synthetic data: the synthetic vendor is the configured source, not a fallback. Missing financial values stay null and never become zero (ADR-019, tested).
