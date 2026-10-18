# Next actions

Ordered. Take the first unchecked item whose dependencies are met.

## For the agent

1. [ ] **A-001 Academy schema** (migration 006): courses, course_versions, modules, lessons, objectives, prerequisites, question bank (questions + versions + options + correctness + explanation + misconception + criticality + weight), diagnostic attempts (pinned question versions), enrolments, objective mastery, review schedule. RLS covered automatically by the rls test.
2. [ ] **A-002 Placement diagnostics engine** (pure TS, unit-tested): draw 5 questions per course from the bank without repeating the previous attempt's set where the bank allows; score with weights and criticality; return high / borderline / low readiness with reasons; never expose correct answers before submission.
3. [ ] **A-003 Academy API**: list courses, start diagnostic, submit diagnostic, result with explanation, enrol, lesson progress, quiz submit with mastery update, due reviews. Integration tests including cross-user isolation.
4. [ ] **A-004 Seed four courses** (MARKET DECODER, EQUITY DETECTIVE, SIGNAL ENGINEER, MARKET ARCHITECT) with ≥10 diagnostic questions each, editable through the curriculum tables (no hard-coded copy in UI).
5. [ ] **A-005 Web**: Academy home → course → diagnostic → result → enrol → lesson → quiz → review queue.
6. [ ] Financial golden-test suite as a separate, reported suite (cases, pass/fail, tolerance).
7. [ ] Provider evaluation scorecard (`docs/DATA_RIGHTS_AND_PROVIDERS.md`).
8. [ ] Remaining required docs (`docs/ARCHITECTURE.md`, `SECURITY_AND_PRIVACY.md`, `TESTING_AND_ACCEPTANCE.md`, `RUNBOOK.md`, `KNOWN_LIMITATIONS.md`, `REQUIREMENT_TRACEABILITY.md`).
9. [ ] Re-verify local startup (`node scripts/atlas.mjs start`) and the web build.

## For you (unblock external items; see BLOCKERS.md)

- B-GH-01: create GitHub repo `project-atlas` and push (one command once you're signed in).
- B-SB-01: copy the Supabase session-pooler connection string into `.env.local`.
- B-PG-01 (optional): install WSL so Docker can run a local PostgreSQL for the driver tests.
