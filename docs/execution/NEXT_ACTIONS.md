# Next actions

Ordered. Take the first unchecked item whose dependencies are met.

## Done in session 4
- [x] Memory-bounded pipeline (ADR-018); 40 / 120 / 602-company seeds; daily catch-up tests
- [x] Financial golden set; Playwright e2e; real-PostgreSQL suite without Docker
- [x] All four Academy courses, games, capstones, completion records, 3D lab
- [x] Rule builder, worth-investigating, CMS, CSV datasets
- [x] AI evaluation passes the release gate (580 cases)
- [x] Release readiness and docs

## For the agent (next session)

1. [ ] When B-SB-01 is resolved: `npm run migrate` against Supabase (expect a no-op), then seed and smoke-test the app against it. Run `npm run test:postgres` against a separate empty database, never the app database.
2. [x] Upgrade Next 15 → 16 to clear the postcss advisories (done 19 Oct 2026: next 16.4.2; typecheck, build, tests and e2e pass; production audit 0).
3. [ ] Automated accessibility checks (axe-core in the Playwright suite) and contrast verification.
4. [ ] XLSX upload and fundamentals (not only prices) in user datasets.
5. [ ] Admin UI for the Academy review queue and CMS (the API exists).
6. [ ] Evaluate the assistant with a live model once B-AI-01 is resolved (`AI_PROVIDER=anthropic`, `npm run eval`).
7. [ ] Load tests for backtests and the daily cycle.

## Digital Assets follow-ups (session 8)
8. [ ] Make the md-intro video e2e test robust under load (it stalled once at currentTime 0 while other jobs ran; passes alone).
9. [ ] Run `npm run test:postgres` to verify migration 010 on real PostgreSQL.
10. [ ] Optional free CoinGecko Demo key in `.env.local` (your account) for faster, larger reference history refreshes.
11. [ ] Solana on-chain coverage; transaction detail view; active-address metrics from a source with documented methodology.

## For you (unblock external items; see BLOCKERS.md)

- B-GH-01: create the GitHub repo and push (commands in BLOCKERS.md).
- B-SB-01: put the Supabase session-pooler connection string into `.env.local`.
- Content: name a subject-matter reviewer for Academy lessons.
