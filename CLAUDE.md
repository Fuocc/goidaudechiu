# YOi Spa booking system

Booking system for a spa with several branches: an online booking site for customers, a staff dashboard (calendar, check-in, settings), and an AI assistant that staff chat with to create or move bookings. The core rule: **the backend never double-books**.

## Layout

| Folder | What | Stack |
|---|---|---|
| `backend/` | REST API under `/api/*` (`server.js`, `routes/`, `lib/`) | Node + Express, Supabase (Postgres), Clerk auth, Gemini for the AI assistant |
| `dashboard/` | Staff dashboard | React 19 + Vite + Chakra UI, Clerk |
| `frontend/` | Public website + booking page | Static HTML/JS on Netlify; `/api/*` is proxied to the backend on Render (`netlify.toml`) |
| `backend/sql/` | Database migrations, run by hand in Supabase | SQL |

Run locally: `npm run dev --prefix backend` (port 3000) and `npm run dev --prefix dashboard` (port 5173). Each app reads its own `.env`; copy from `.env.example`.

## Rules that are easy to break

- **Every booking placement goes through `backend/lib/bookingEngine.js`.** Creating or moving a booking (time, therapist, bed, branch) from any source (web, hold, staff, check-in, AI) uses the engine, which writes through the SQL function `booking_guard_write` (lock the day, re-check, write in one transaction). Never write those fields with a direct `supabase.from('bookings')` insert or update.
- **Booking rules per source** (buffer, beds, overlap, confirmation) are in `ROADMAP.md` › "Booking rules". Don't guess them.
- **`backend/.env` points at the production Supabase** (not live yet, but real data). Test bookings created by hand start with `TEST · ` and are deleted afterwards.
- **Database changes** go into a new SQL file in `backend/sql/` named `YYYY-MM-DD_<topic>.sql`. It must be transactional and include a rollback. The owner runs it in Supabase; never run it yourself.
- **Language:** UI text and code comments are in Vietnamese; keep new ones in Vietnamese.
- **`ROADMAP.md` is local only** (`*.md` is git-ignored, except `CLAUDE.md`, `GLOSSARY.md` and `docs/**`). If it's missing, ask the owner for the rules instead of guessing.

## Change process (required for every change)

**Research → Agree tests → Plan → Approval → Execute → Re-test**

1. **Research**: read the code involved and the rules in `ROADMAP.md`. Ask the owner specific questions until the intended behaviour is 100% clear (e.g. "when the AI changes a booking's branch, what should happen?"). If a rule is new or changed, update `ROADMAP.md` first.
2. **Agree tests**: list the seams (public interfaces to test at) and the behaviours each test will check, with what each one catches. For a one-off fix, write the single failing test and show it fails for the right reason: the behaviour is missing, not a typo or a missing file.
3. **Plan**: name the files to change, how each one changes, and which tests cover it. List the decisions the owner still has to make, each with a recommendation. Say how the change will be checked in the real app.
4. **Approval**: stop and wait for the owner's explicit approval of the seams, test list and plan. No code before approval, even for small fixes (their plan can be short).
5. **Execute**: build one slice at a time: a failing test, shown failing for the right reason, then the code that passes it. If something new comes up that changes the plan, stop and ask.
6. **Re-test**: run every related test suite and the dashboard build, and check the change in the real app. Report results honestly, including anything skipped. Tick the item in `ROADMAP.md` and close the GitHub issue (or put `Closes #n` in the PR).

**Never edit a test to make code pass.** If a rule changes, update `ROADMAP.md` first, then the test.

## Tests

| What | Command | Notes |
|---|---|---|
| Backend unit | `cd backend && npm test` | `lib/*.test.js`: engine, tokens, holds, check-in |
| Booking guard (integration) | `cd backend && npm run test:guard` | `integration/bookingGuard.spec.js`, against the Supabase in `backend/.env`. Check-in tests only run between 10:30 and 20:00 Vietnam time. |
| Dashboard unit | `cd dashboard && npm test` | Pure logic only (`src/**/*.test.js`, no JSX) |
| Dashboard build | `cd dashboard && npm run build` | Must pass before any dashboard change is done |

## Git

- Work on `dev`. `main` only changes by merging a pull request.
- Commit or push only when the owner asks, including inside skills: `/implement` and `/implement-spec` stop before committing and report what is ready.
- Commit messages are in English, in the format `feat(scope): …` or `fix(scope): …`.

## Agent skills

- **Issue tracker**: GitHub Issues on `Fuocc/goidaudechiu`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Triage labels**: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- **Domain docs**: single-context, `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
