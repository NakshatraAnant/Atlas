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
| 1 | ATLAS: MARKET DECODER | Beginners | 4 | Module 1: 3 lessons, 9 quiz questions | 12 |
| 2 | ATLAS: EQUITY DETECTIVE | Company analysis | 4 | none yet | 12 |
| 3 | ATLAS: SIGNAL ENGINEER | Testing ideas with data | 3 | none yet | 12 |
| 4 | ATLAS: MARKET ARCHITECT | Valuation, portfolio risk, validation | 3 | none yet | 12 |

Modules without lessons are shown as "Lessons in preparation". Phase 6 adds lessons in dependency order once the lesson engine has been validated with learners.

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
| Observe | interactive lab | `ownership_split`, `order_book`, `percent_path`; logic in `packages/shared/src/learning-sims.ts` (tested), with a text alternative |
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

## Not built yet (tracked in NEXT_ACTIONS)

Lessons for modules 2+ and courses 2–4; games (Statement Surgeon, Valuation Lab, Market Replay, Bias Trap, Portfolio Under Pressure, Evidence Challenge, Build the Business); capstones and rubrics; completion records; 3D scenes; admin editing UI (content is edited in the source file today); question-level publication.
