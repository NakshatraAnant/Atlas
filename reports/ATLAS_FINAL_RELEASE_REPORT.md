# ATLAS final release report

Session 13, 11 Nov 2026. Branch `feat/atlas-mvp`. Every count below comes from a run on this date; nothing is carried over from earlier sessions.

## Test results (11 Nov 2026)

| Suite | Command | Result |
|---|---|---|
| Shared library | `npm test` (workspace `@atlas/shared`) | **125 passed**, 0 failed |
| API (unit and integration, embedded PGlite) | `npm test` (workspace `@atlas/api`) | **520 passed**, 0 failed, 13 skipped (the PostgreSQL suite, which runs separately below) |
| Web | `npm test` (workspace `@atlas/web`) | **5 passed**, 0 failed |
| PostgreSQL 17 (embedded server) | `npm run test:postgres` | **13 passed**, 0 failed |
| End-to-end (Playwright, Microsoft Edge) | `npm run test:e2e` | **24 passed**, 0 failed (6.2 min) |
| Typecheck | `npm run typecheck` | Passed |
| Production build | `npm run build` | Passed |
| Secret scan | `npm run check:secrets` | Passed |
| Dependency audit | `npm audit --omit=dev` | 1 high (zod, mitigated: see Security). fast-uri and fastify fixed today |
| QA crawl | `scripts/qa/crawl.mts` | 37 pages, **0 findings**, desktop (1366) and mobile (390): no console errors, failed requests, empty pages or overflow |
| Course videos | `scripts/video/verify.mts` | 9 of 9 decode, with audio and captions; the 8 existing files are byte-identical to before |
| Walkthrough video | see `artifacts/ATLAS_RECORDING_NOTES.md` | 345.5 s, 1280×720, H.264/AAC, narration throughout, 18/18 scenes, 0 console errors |

**Total automated tests passed: 687** (125 + 520 + 5 + 13 + 24). Skipped tests are not counted as passes.

## What changed in this release (session 13)

Sixteen defects were fixed, each with a regression test or a recorded check ([bug report](ATLAS_BUG_AND_REGRESSION_REPORT.md)). The most important:

1. **Availability.** A scheduler query blocked the API every 30 s (9.6 s → 12 ms).
   - Home's endpoints were batched: a parallel Home load went from 4.9 s to 2.4 s.
   - A single oversized request could freeze the API for 18 s. It is now refused in under 5 s.
2. **Data integrity.** Index pages used a stale adjusted series: NIFTY 50 showed 22 Oct while Home showed 4 Nov.
3. **Honesty and usability.**
   - Signed out, the nav showed demo sections on a real-data install.
   - Ctrl+K failed with Caps Lock on.
   - Home showed commodity values without units.
   - A session-12 record claimed a video that did not exist.

**New this session:**
- A first-run welcome on Home.
- One interactive chart model on every real-data page.
- The ninth course video (COMMODITY MARKETS DECODER).
- The narrated product walkthrough.
- A complete set of audit, coverage, licensing, UX, security, gamification and tracker reports.

## Readiness verdicts

| Question | Verdict | Why |
|---|---|---|
| **Development-ready** (can the team keep building on it?) | **Yes** | Clean typecheck and build; 663 automated tests plus end-to-end; documented runbook, checkpoint and tracker; all work committed |
| **Locally production-quality** (a single user running it on this machine) | **Yes, with two caveats** | Real data with provenance and freshness on every figure; no known open defect in customer flows; backups and a restore drill. Caveats: (1) after a Windows restart, ATLAS must be started again (`node scripts/atlas.mjs start`); (2) the embedded database serves one query at a time, so a busy machine slows pages (now 2.4 s for a full Home load) |
| **Private beta** (a few invited users, free) | **Not yet** | (1) Hosting: the embedded database and local launcher are single-user; it needs server PostgreSQL (the schema already passes against PostgreSQL 17), a process manager and monitoring. (2) Data terms: CoinGecko Demo and EODHD free are personal or non-commercial plans; even a free beta for others needs the providers' consent or paid plans. (3) Academy content is AI-drafted and in review |
| **Public commercial launch** | **No** | Everything above, plus: no licence permits paid redistribution of any connected source; Indian shares and fundamentals need a licensed feed; payments and email are sandbox or outbox only; no penetration test; legal review of disclaimers pending; zod 4 migration |

ATLAS is not bug-free. These verdicts rest on the tests and checks listed above. Untested paths can still hold defects.

## What a launch needs (decisions for you; nothing was purchased or accepted)

1. **Data licences:** Indian shares and fundamentals (NSE Data & Analytics, or a paid EODHD plan with the Indian exchange add-on); a commercial crypto plan (for example CoinGecko paid); a per-series check of FRED third-party copyright. See the [licensing register](ATLAS_PROVIDER_AND_LICENSING_REGISTER.md).
2. **Hosting:** managed PostgreSQL (`DATABASE_URL`), a process manager, TLS, monitoring and off-site backups.
3. **Content:** expert review of the Academy (nine courses, nine videos).
4. **Commerce:** a real payment gateway and an email transport; legal review.
5. **Engineering:** the zod 4 migration; a penetration test; an optional Windows logon task so ATLAS starts after a reboot.
