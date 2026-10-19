# Blockers

Only genuine external blockers. Each has the smallest action that unblocks it.

| ID | Blocker | Impact | Smallest unblocking action (owner: you) | Status |
|---|---|---|---|---|
| B-GH-01 | No GitHub access in the agent environment: no GitHub connector, no `gh` CLI, no git remote or credentials. | Code is committed locally only (branch `feat/atlas-mvp`). Nothing is pushed. | Either (a) create an empty private repo `project-atlas` on github.com and tell the agent its URL, then run `git push -u origin feat/atlas-mvp` once in a terminal where you are signed in to GitHub; or (b) enable a GitHub connector for the session. | open |
| B-SB-01 | The Supabase database password is not visible to the agent (it is generated at project creation and only shown in the dashboard). | The app cannot connect to Supabase yet; schema is applied but data is not seeded. | Supabase dashboard → project `project-atlas` → Connect → "Session pooler" → copy the URI, put it in `.env.local` as `DATABASE_URL` (never commit), set `DATABASE_SSL=require` (dev) or download the CA cert and use `verify-full`. Then `npm run seed`. | open |
| B-PG-01 | Docker Desktop cannot start (no WSL). | Resolved in session 4 without Docker: `npm run test:postgres` runs the 8 node-postgres tests against a local PostgreSQL 17 (embedded-postgres). `npm test` still skips them when no `TEST_DATABASE_URL` is set; the skips are not counted as passes. | None needed. | resolved |
| B-AI-01 | No LLM API key. | AI assistant runs on the deterministic composer only (works offline; this is by design for local use). | Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env.local` when you want model-written answers. | open (not blocking) |
| B-DATA-01 | No licensed Indian market data. | All market data is synthetic. | Provider evaluation and contract; see `docs/DATA_RIGHTS_AND_PROVIDERS.md`. | open |
| B-AUTH-01 | No Google OAuth client. | Google sign-in disabled; email + password + TOTP works. | Create OAuth client in Google Cloud console. | open (not blocking) |
| B-PAY-01 / B-GST-01 | No Razorpay account; invoice template not approved by a CA. | Billing runs on built-in sandbox only. | Business decision; legal/tax review. | open (not blocking) |
| B-SEC-01 | No independent penetration test. | Required before public launch. | Commission a test. | open |
| B-AUTO-01 | The agent cannot restart itself after a usage limit. | Work resumes only when a new session starts. | Start a new session and say "Resume ATLAS from AUTOPILOT.md". | accepted |
