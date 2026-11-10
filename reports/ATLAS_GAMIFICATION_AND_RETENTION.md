# ATLAS gamification and retention

Session 12, 30 Oct 2026. The design is in [docs/GAMIFICATION.md](../docs/GAMIFICATION.md) (engine `learn-engine-2`).

Status words used here: **completed**, **tested**, **failed**, **blocked**, **requires your action**.

## Principles (unchanged)

- XP is derived on the server from authoritative records. No endpoint accepts XP, levels or badges from the browser.
- An action earns once per (user, kind, reference). Research awards are capped at 3 per kind per day.
- Nothing rewards trading, risk-taking, being right about a prediction, page views or time spent in the app.
- Missing days never removes XP, levels or achievements.

## What exists

| Element | Where | Status |
|---|---|---|
| XP and levels (50·n·(n−1)) | Academy → My progress | Completed, tested (prior sessions) |
| Ranks (Explorer → Research Architect). Each needs the XP level **and** mastered objectives **and** specific research practices | My progress | Completed, tested |
| 26 achievements with progress and evidence (e.g. *Correlation Explorer*: three rolling-correlation studies) | My progress | Completed, tested |
| Daily and weekly missions, weekly learning-day goal, timezone-aware | My progress | Completed, tested |
| Skill map | My progress | Completed |
| Readiness checks, quizzes, spaced review, games, capstones | Academy | Completed, tested |

## Changes in this session

| Change | Detail | Status |
|---|---|---|
| **Optional streaks** | Settings → "Show learning streaks". When it is off, streaks disappear from My progress, the Academy home and the Home learning panel, and My progress says where to turn them back on. Your XP, levels and achievements are unaffected | Completed. Preference validation tested (API); the screens were checked in the QA crawl |
| **The relationship explorer earns research XP** | A comparison with at least 12 shared periods records a `correlation_study` (10 XP, once per pair, frequency and window, at most 3 a day). It counts towards *Correlation Explorer* and the *Quantitative Researcher* rank | Completed, tested (recorded once on repeat) |
| **Learning panel on Home** | Shows level, XP, the streak (if shown) and the next recommended Academy step | Completed |
| **Release notices for followed series** | Follow any macro or commodity series. You get one in-app notice per newer observation, never for the backlog. You can turn notices off; while they are off, the marker still advances, so turning them on does not replay old releases | Completed, tested |
| **Weekly summary** | Opt-in, in-app, at most once every 7 days. It covers which followed series have new data, plus the week's learning steps, XP and research activities | Completed, tested |

## Not done, and why

| Item | Decision |
|---|---|
| Community (comments, leaderboards, sharing) | **Deferred**. It needs moderation, abuse handling and a compliance review for investment-related user content. Leaderboards would also reward volume over understanding, which contradicts the principles above |
| Push or email notifications for releases | Not built. Notices are in-app only. Email briefings remain under Account |
| New missions | Not added. The existing daily and weekly missions already count research work, including explorer studies |

## Retention levers, in order of expected value

1. Follows plus release notices: a reason to come back that is tied to real new data.
2. "What changed" on Home: one look shows what moved and what was published.
3. The weekly summary (opt-in).
4. The Academy next step and XP: progress that cannot be gamed by clicking.

---

## Session 13 note (5 Nov 2026)

There were no changes to gamification in this session.
- **Tests:** the learning-engine suite still passes as part of `npm test` (counts in the final release report).
- **Walkthrough:** it shows My progress (XP, level, missions, achievements, skill map) and the Settings switch that hides streaks.
- **Deferred:** community and leaderboards stay deferred, for the reasons above.
