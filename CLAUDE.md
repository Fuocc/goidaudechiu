# Working on this repo

## Change process (required for every change)

**Research → Create tests → Plan → Approval → Execute → Re-test**

1. **Research**
   - Read the code involved and the rules in `ROADMAP.md`.
   - Ask the owner specific questions until the intended behaviour is 100% clear (e.g. "when the AI changes a booking's branch, what should happen?").
   - Don't guess business rules. If a rule is new or changed, update `ROADMAP.md` first.
2. **Create tests**
   - Write tests that describe the agreed behaviour before writing the code.
   - Run them and show they fail for the right reason: the behaviour is missing, not a typo or a missing file.
   - Never edit a test to make code pass. If a rule changes, update `ROADMAP.md` first, then the test.
3. **Plan**
   - Name the files to change, how each one changes, and which tests cover it.
   - List the decisions the owner still has to make, each with a recommendation.
   - Say how the change will be checked in the real app.
4. **Approval**
   - Stop and wait for the owner's explicit approval of the tests and the plan.
   - Don't start writing code before approval.
5. **Execute**
   - Implement the plan exactly.
   - If something new comes up that changes the plan, stop and ask before going ahead.
6. **Re-test**
   - Run every related test suite and the dashboard build.
   - Check the change in the real app.
   - Report the results honestly, including anything skipped or not checked.
   - Tick the item in `ROADMAP.md` when it's done.

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
- Commit or push only when the owner asks. Commit messages are in Vietnamese, in the format `feat(scope): …` or `fix(scope): …`.
