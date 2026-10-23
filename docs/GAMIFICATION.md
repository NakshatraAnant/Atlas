# ATLAS progress: XP, ranks, missions, achievements, skill map

Implemented in `apps/api/src/modules/academy/learning.ts` (engine version `learn-engine-2`), shown at **Academy → My progress**. Tests: `apps/api/test/learning-engine.test.ts`, `apps/api/test/research.test.ts` ("research progress"), PostgreSQL concurrency test in `postgres.integration.test.ts`.

## Principles

- XP is **derived on the server** from authoritative records (lesson progress, quiz attempts, mastery, games, capstones, completion records, and `research.activity`). There is no endpoint that accepts XP, levels, ranks or achievements from the client.
- One award per (user, kind, reference): `acad.learning_events` primary key; research activity has the same uniqueness in `research.activity`. Retries and concurrent requests cannot double-award (tested on PostgreSQL).
- Research awards are capped at **3 per kind per local day**; repeating an action more often earns nothing.
- Nothing rewards trading, risk-taking, profitable predictions, page views or time in the app. Hypothesis reviews earn the same whether the thesis was right or wrong.

## Research XP (from `research.activity`, written only after the work is done and validated)

| Kind | XP | Qualifies when |
|---|---|---|
| research_note | 10 | a note of ≥ 80 characters |
| hypothesis_recorded | 15 | thesis, evidence for, evidence against (≥ 20 chars each) and a future review date; thesis and date frozen afterwards |
| hypothesis_reviewed | 25 | outcome and lessons (≥ 20 chars) at least one day after recording |
| journal_reflection | 15 | expected, observed and missed (≥ 20 chars each) |
| benchmark_comparison | 10 | a workbench run with a benchmark (once per instrument set) |
| correlation_study | 10 | a rolling-correlation result with data (once per pair and window) |
| walkforward_backtest | 20 | a completed walk-forward run (once per instrument and windows) |
| report_created | 30 | a generated report |
| portfolio_risk_review | 10 | a portfolio analysis (once per portfolio and range) |
| data_issue_investigated | 20 | a finding the integrity check confirms (gap, deviation, flagged move, revision) |
| scenario_tested | 10 | a stress scenario (once per parameter set) |

Learning XP is unchanged from `learn-engine-1` (lessons 20, perfect quiz 10, mastery 30, etc.).

## Ranks (XP level AND competence)

| Rank | Level | Objectives mastered | Practices |
|---|---|---|---|
| Explorer | 1 | 0 | — |
| Market Student | 2 | 1 | — |
| Research Apprentice | 3 | 3 | research note |
| Data Analyst | 4 | 6 | benchmark comparison, data issue |
| Quantitative Researcher | 5 | 10 | walk-forward, correlation study |
| Senior Analyst | 6 | 16 | hypothesis reviewed, portfolio risk review |
| Research Architect | 7 | 24 | report, stress scenario |

Levels: total XP for level n = 50·n·(n−1).

## Missions and streaks

- Daily learning mission (existing) now also counts documented research (hypotheses, reviews, journal, benchmark comparisons, walk-forward, reports, data findings).
- A research mission of the day rotates deterministically by local date (auditable).
- Weekly research goal: two documented research activities (display only).
- Streaks count learning or research days in the learner's chosen timezone; one rest day a week; missed days never remove XP. No notifications push streaks.

## Achievements added

First Research Note, Data Detective, Source Verification Expert (3 findings), Benchmark Builder, Correlation Explorer (3 studies), Backtest Auditor, Risk Analyst (risk review + scenario), Thesis Reviewer, First Completed Research Report, On-Chain Explorer (oe-o1 and oe-o2 mastered), Fundamentals Investigator (ed-o2 and ed-o3 mastered). Each stores when and why it was unlocked.

## Skill map

Nine areas (financial foundations, accounting and statements, equity analysis, crypto fundamentals, market microstructure, quantitative methods, portfolio risk, data literacy, research communication) combine objective mastery with applied practices; objectives with low recent accuracy are listed as "needs practice". Course completion is not a professional qualification.

## Not implemented (deliberately)

Leaderboards: no opt-in community exists, and ATLAS does not invent participants. Retention analytics for many users: ATLAS is a single-user local install; personal progress is shown instead.
