# Working on this repo

## Change process (required for every change)

**Research → Agree tests → Plan → Approval → Execute → Re-test**

1. **Research**
   - Read the code involved and the rules in `ROADMAP.md`.
   - Ask the owner specific questions until the intended behaviour is 100% clear (e.g. "when the AI changes a booking's branch, what should happen?").
   - Don't guess business rules. If a rule is new or changed, update `ROADMAP.md` first.
2. **Agree tests**
   - List the seams (public interfaces to test at) and the behaviours each test will check, with what each one catches.
   - For a one-off fix, write the single failing test and show it fails for the right reason: the behaviour is missing, not a typo or a missing file.
   - Never edit a test to make code pass. If a rule changes, update `ROADMAP.md` first, then the test.
3. **Plan**
   - Name the files to change, how each one changes, and which tests cover it.
   - List the decisions the owner still has to make, each with a recommendation.
   - Say how the change will be checked in the real app.
4. **Approval**
   - Stop and wait for the owner's explicit approval of the seams, test list and plan.
   - Don't start writing code before approval.
   - After approval, build one slice at a time: a failing test (shown failing for the right reason), then the code that passes it.
5. **Execute**
   - Implement the plan exactly.
   - If something new comes up that changes the plan, stop and ask before going ahead.
6. **Re-test**
   - Run every related test suite and the dashboard build.
   - Check the change in the real app.
   - Report the results honestly, including anything skipped or not checked.
   - Tick the item in `ROADMAP.md` when it's done, and close the GitHub issue (or reference it with `Closes #n` in the PR).

Small fixes such as a style or wording tweak can have a short plan, but they still go through approval before code is written.

## Tests

| What | Command | Notes |
|---|---|---|
| Backend unit | `cd backend && npm test` | Engine, tokens, holds |
| Booking guard (integration) | `cd backend && npm run test:guard` | Runs against the Supabase in `backend/.env` (production, not live yet). Check-in tests only run between 10:30 and 20:00 Vietnam time. |
| Dashboard unit | `cd dashboard && npm test` | Pure logic only (`*.test.js`, no JSX) |
| Dashboard build | `cd dashboard && npx vite build` | |

- Test bookings created by hand must start with `TEST · ` and be deleted afterwards.
- Database changes go into a SQL file in `backend/sql/`. The owner runs it in Supabase. It must be transactional and include a rollback.

## Git

- Work on `dev`. `main` only changes by merging a pull request.
- Commit or push only when the owner asks. Commit messages are in English, in the format `feat(scope): …` or `fix(scope): …`.
- This applies inside skills too: `/implement` and `/implement-spec` stop before committing and report what is ready.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `Fuocc/goidaudechiu`, used through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
