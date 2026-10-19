# ATLAS Academy curriculum

**Status:** product expansion beyond PRD LRN-01..04 (the PRD's four-lesson beginner path still exists at `/app/learn`). Tracked as EXP-ACAD in `REQUIREMENT_TRACEABILITY.md`.

All Academy content was drafted with AI assistance and is stored as **in review**. It is shown locally behind a "Draft, pending expert review" label (`ACADEMY_SHOW_DRAFTS`, on by default outside production; production refuses to start with it on). Nothing is published until a named reviewer completes the seven-point review below.

## Where the content lives

| Layer | Location |
|---|---|
| Authoring source (version-controlled) | `apps/api/src/modules/academy/curriculum.ts` |
| Database (what the app reads) | `acad.*` tables (migration `006_academy.sql`) |
| Loader | `syncCurriculum()` in `apps/api/src/modules/academy/service.ts`, run at every API start |

Editing rule: change the source file and restart. Changed courses, lessons and questions become a **new version**; the old version is retired, never edited. Learner records (diagnostic attempts, quiz attempts, lesson progress) pin the exact versions they used. A database trigger refuses in-place edits to question content once a question has left draft.

## Courses (version 1)

| # | Course | Audience | Modules | Lessons authored | Diagnostic bank |
|---|---|---|---|---|---|
| 1 | ATLAS: MARKET DECODER | Beginners | 5 | 14 lessons (42 quiz questions), 14 objectives | 12 |
| 2 | ATLAS: EQUITY DETECTIVE | Company analysis | 5 | 15 lessons (45), 13 objectives | 12 |
| 3 | ATLAS: SIGNAL ENGINEER | Testing ideas with data | 3 | 6 lessons (18), 4 objectives | 12 |
| 4 | ATLAS: MARKET ARCHITECT | Valuation, portfolio risk, validation | 3 | 6 lessons (18), 4 objectives | 12 |

Every module has at least two complete lessons (41 lessons, 123 quiz questions, 48 diagnostic questions). Coverage of the required topic lists: `docs/ACADEMY_COVERAGE.md`. Content source files: `apps/api/src/modules/academy/curriculum.ts` (module 1) and `content/{market-decoder,market-decoder-plumbing,equity-detective,equity-detective-context,signal-engineer,market-architect,capstones}.ts`. Integrity is enforced by `test/academy-content.test.ts` (seven stages, objectives taught and assessed, answer keys valid, no advice language in education mode).

## Placement diagnostic

- Five questions per attempt, drawn with a recorded seed. One question per distinct skill first, so five questions cover up to five prerequisites. Questions from the learner's last two attempts are avoided where the bank allows.
- Each question records: id, version, course, skill and prerequisite, difficulty (1–5), type (single choice, numeric with tolerance, multi-select), correct answer, explanation, common misconception, weight, criticality, references.
- Answers, explanations and misconceptions are never sent before submission (tested).
- Scoring (`scoreDiagnostic`, rules stored per course version):
  - **High:** weighted score ≥ 80% and no critical question missed → direct entry.
  - **Low:** two or more critical misses, or weighted score < 40% → suggest the preceding course or the prerequisite notes.
  - **Borderline:** everything else → suggest a short review, then retake or start.
- One ordinary mistake (4/5) is still "high"; nobody is blocked by one slip (tested).
- The learner can always start the course. Starting after a low result, or without the check, needs one explicit confirmation, and the choice is recorded as `learner_override` or `no_diagnostic`.
- Retakes: up to 3 per rolling 7 days. An unfinished attempt is resumed, not re-drawn, so learners can't fish for easier questions. Attempts expire after 30 minutes.
- Every result states: "Five questions give a rough readiness estimate, not a measure of competence."

## Lesson structure

Each lesson follows DISCOVER → OBSERVE → PREDICT → INVESTIGATE → DECIDE → EXPLAIN → REVIEW:

| Stage | Block | Notes |
|---|---|---|
| Discover | text | Original explanation |
| Observe | interactive lab or ATLAS task | 17 labs (order book, ownership, percent path, diversification, compounding, real return, index weighting, profit-to-cash, DuPont/ROCE, EV bridge, drawdown, overfitting, cost drag, DCF, 3D DCF sensitivity surface with accessible table fallback, two-asset risk, multiple testing) driven by tested simulations in `packages/shared/src/learning-sims*.ts`; or a guided task inside the real ATLAS screens |
| Predict | prediction | Learner commits before the reveal |
| Investigate | worked example | Numbers verified by the simulation tests |
| Decide | guided practice | Hint, then answer |
| Explain | reflection | Free text kept on the device; model answer shown after an attempt |
| Review | summary | Key points |

Then a graded quiz (3 questions per lesson so far) with explanations and misconceptions.

## Mastery model (transparent, to be validated in pilots)

- Per objective, an exponentially weighted estimate of recent correctness: `estimate ← estimate + 0.5 × (result − estimate)`, starting at 0.
- **Mastered** when estimate ≥ 0.8 with at least 3 graded answers. A later wrong answer can return the objective to "learning".
- Lesson **completion** ("worked through it and attempted the quiz") is recorded separately and never implies mastery.
- These parameters are guesses to be validated against delayed-retrieval accuracy in pilots (see "Learning-outcome measures").

## Spaced review

- Leitner boxes with intervals of 1, 3, 7, 16 and 35 days. Correct moves the objective up a box; wrong sends it back to box 1.
- At most 10 reviews a day. No notifications are sent, to avoid compulsive engagement loops.

## Seven-point publication review

A lesson can be published only by an admin (with two-step verification) who confirms all seven checks: **factual accuracy, calculation correctness, pedagogy, accessibility, copyright and asset rights, learning-objective alignment, technical functionality**, plus their name. A database constraint rejects a published lesson without a complete review record. Every publication is written to the append-only audit log (tested).

## Learning-outcome measures (from the database, separate from engagement events)

| Measure | Source |
|---|---|
| Diagnostic → later quiz improvement | `acad.diagnostic_attempts.result` vs `acad.quiz_attempts` per skill/objective |
| Delayed retrieval accuracy | `acad.quiz_attempts` where `kind='review'` |
| Critical misconception rate | outcomes where a `critical` question was missed |
| Progression | `acad.enrolments`, `acad.lesson_progress` |

Engagement analytics events (`academy_diagnostic_started/completed`, `academy_enrolled`, `academy_quiz_submitted`) carry no answer content.

## Not a qualification

Every course carries: "This record shows which learning objectives you practised and the assessments you completed in the ATLAS Academy. It is not a professional qualification, licence or certification, and it says nothing about future investment results."

## Capstones and completion records

- One capstone per course (`content/capstones.ts`), completed inside ATLAS: linked artefacts (notes, backtests, hypotheses) must belong to the learner. Four-criterion rubric, self-assessed; an admin can add an audited review.
- Completion record (`acad.completion_records`) only when: all lessons completed, ≥ 80% of objectives mastered, capstone submitted. It freezes what was assessed (lessons, each objective with its estimate, capstone status, content review status) and carries the not-a-qualification statement.

## Games (practice; scored on correctness only; no streaks, leaderboards or chance)

| Game | Course | Objective | Mechanic |
|---|---|---|---|
| Statement Surgeon | EQUITY DETECTIVE | ed-o1 | classify line items into statements / cash-flow activities |
| Build the Business | EQUITY DETECTIVE | ed-o3 | tune price and investment to hit EBIT margin and ROCE targets |
| Bias Trap | SIGNAL ENGINEER | se-o2 | name the bias in a backtest description |
| Market Replay | MARKET DECODER | md-o9 | judge headlines against synthetic session data |
| Evidence Challenge | MARKET ARCHITECT | ma-o4 | classify claims as fact, calculation, interpretation or unsupported |
| Valuation Lab | MARKET ARCHITECT | ma-o1 | reverse DCF: find the growth today's value implies |
| Portfolio Under Pressure | MARKET ARCHITECT | ma-o2 | weights meeting a return target and a stress-loss limit |

Every tune round is proven solvable by a brute-force test; classify answers are never sent before submission. Game scores do not affect mastery or completion.

## Still not built

- An admin editor for Academy content (content is edited in the source files; review and publication are in the admin API).
- Independent expert review of all content (required before any `published` status).
- Validation of the mastery parameters with real learners.
