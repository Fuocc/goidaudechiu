# Roadmap: Dashboard booking & team communication

Goal: staff manage bookings and communicate easily, and the backend never double-books.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. Update this file as work lands.

---

## Booking rules (agreed)

| Who books | Buffer time | Shifts / beds | Overlap allowed? |
|---|---|---|---|
| Online customer (website) | ✅ yes (setting) | ✅ (bed always required) | ❌ never |
| AI assistant | ❌ no | ✅ (bed always required) | ❌ by default · ✅ after staff confirm in chat (setting) |
| Staff / admin (create, edit, drag, check-in) | ❌ no | warn only (same confirmation) | ✅ after a confirmation (setting) |

- Online and AI bookings always need a free bed: if no bed is free (or the branch has no active beds), the booking is refused.
- Buffer is added **after** the existing booking (current behaviour), as one global setting.
- Buffer setting `buffer_time`: 0 = no buffer; not set = 0.
- Staff overlap needs a simple confirmation ("Vẫn lưu"), no reason required. Confirmation can be turned on/off in Settings (`confirm_staff_overlap`, on when not set).
- Staff "warn only" = the same "Vẫn lưu" confirmation, listing every reason: therapist busy, therapist off shift, no free bed.
- Moving a booking (staff or AI): it keeps its bed if that bed is free at the new time; otherwise it silently gets another free bed. Only when no bed is free → warning.
- Confirmation turned off in Settings → staff (and the AI for staff) skip **all** warnings: overlap, off shift, no bed, nobody free (saved unassigned). Online bookings are never affected.
- Staff create with no therapist chosen and nobody free → warn; "Vẫn lưu" saves it **unassigned** (shown in a "Chưa xếp NV" column).
- AI overlap (create, move, edit, late check-in): the AI refuses and asks "Vẫn lưu?" in chat. Saving needs a one-time server token tied to that exact change (valid 5 min), so the model can't skip the question. Logged-in staff only. If confirmation is turned off in Settings, the AI saves like the calendar does.
- AI moves a booking to another branch: keep the therapist if they work at the new branch that day and are free; otherwise pick a free, on-shift therapist + free bed there (tour order, no buffer). Nobody free → refuse, booking unchanged. The bed is always re-picked for the new branch.
- Undo restores the previous state without an overlap question.

### Group rules (agreed 23/10)

Words as in `GLOSSARY.md`: **Booking** = one guest, **Group** = Bookings of guests booked together, **Contact** = the person the Group is booked under. Decision record: `docs/adr/0001-group-moves-share-one-start-time.md`.

| Change | Scope |
|---|---|
| Date / start time, branch, service, notes + internal note, status (check-in, cancel, completed…), Contact | Group-wide ("Cả nhóm" or "Chỉ khách này") |
| Therapist, a guest's own name | Always this guest only |

- **Who picks the scope:** every change states it (one guest / whole Group); the backend never guesses.
  - Staff: asked "Cả nhóm / Chỉ khách này" whenever a group-wide field changes; **Cả nhóm is the default button**. Changing only per-guest fields → no question.
  - AI: whole Group unless the command singles out one guest. If it does but doesn't say which (all guests carry "Miss Mia"), the AI asks, listing therapist / time / service.
- **Times:** "Cả nhóm" → every guest gets the **same new start time**, each keeps their own service length. Date-only change → each keeps their own start time. "Chỉ khách này" → the others don't move. Check-in → "now" for whoever is checked in.
- **Drag or edit that changes therapist and time together:** therapist applies to this guest only; the question is only about the time.
- **All-or-nothing:** one "Vẫn lưu?" lists every guest's conflicts; confirming saves all, otherwise nothing is saved.
- **Notes always replace** with the full new text. The AI is shown the current note, must send the complete updated note, and its reply shows before → after. "Cả nhóm" writes the same text to every guest.
- **Branch change (every Source, one guest or Group):** keep the therapist if they work at the new branch that day and are free; otherwise pick a free on-shift therapist there; nobody free → "Vẫn lưu?" (saves unassigned). Bed always re-picked. A therapist chosen in the edit applies to this guest only and must work at the new branch (otherwise refused); leaving it empty auto-picks (agreed 24/10).
- **Contact (agreed 24/10):** "Cả nhóm" fixing the Contact's phone / email / habits only updates the Contact's profile; guests who have their own name keep it. Picking another Contact or renaming it with "Cả nhóm" links every guest to it again, including those with their own name. "Chỉ khách này" + a name change gives that guest their own name (unlinked from the Contact; the profile is unchanged); "Chỉ khách này" + a phone / email / habits change is refused (those belong to the whole Group).
- **Membership:** a Booking never leaves its Group. Cancelled guests stay in it but are skipped by later Group changes. Group size = number of non-cancelled Bookings.
- **Cancel** = `status: cancelled` (no hard delete) for staff and AI, with the same scope question. Only expired holds are deleted.
- **Undo** of a Group change restores every Booking it touched, in one step.

### Time limits (agreed 23/10)

- **Last booking time** = latest start. For now it is the branch's per-weekday `close`; later its own per-branch, per-weekday setting.
- Branch with no hours set for that day → **08:00–20:00** everywhere (same as the dashboard default; agreed 24/10). A day marked closed keeps today's behaviour (no online slots, no extra reason).
- The limit applies only where a start is set (create, move, branch / date change). Re-placing a Booking at its own start (therapist change, longer service, AI reassign) doesn't ask again. Check-in uses Last booking time + Late arrival grace instead (reason `late_check_in`, checked against the rounded check-in time).
- **Late arrival grace** (global setting `late_arrival_grace`, default 15 min when unset or invalid, 0 = no grace, check-in only; edited in Settings): a guest booked at the Last booking time can be checked in up to that many minutes later without a warning. A day marked closed adds no reason.
- Start after Last booking time (or check-in later than the grace): online refused; staff "Vẫn lưu?" reason; AI blocked + confirm token.
- **Closing time** (future setting): fixed time → a treatment ending after it is refused online and gets a "Vẫn lưu?" reason for staff / AI; "after last service" (YOi, and every branch until the setting exists) → no check.
- A treatment never crosses midnight (hard refusal). Therapist shifts must still cover the whole treatment.

---

## 0. Housekeeping
- [ ] Delete the discontinued "Ý 4 tay" services (`Ý 4 tay - Đỉnh cao dễ chịu`, `Ý 4 tay - Gấp đôi dễ chịu`)
- [ ] Remove `TEST ·` bookings on 19/10 when no longer needed

## 1. Booking guard (P0): no double booking from AI / online
- [x] Tests written first — `cd backend && npm run test:guard` ([integration/bookingGuard.spec.js](backend/integration/bookingGuard.spec.js)). Baseline 19/10: **8 pass / 13 fail**. Tests are the spec: don't edit them to make code pass; change this file first if a rule changes.
- [x] One shared booking engine used by staff, web, AI, holds, check-in
- [x] Apply rules per source (table above)
- [x] Atomic write: lock branch/day, re-check, then write (Postgres function)
- [x] AI create checks shift hours + beds, returns `blocked` reason
- [x] AI update re-checks conflicts when the service/duration changes
- [x] AI branch change no longer leaves a booking without a therapist
- [x] Expired temporary holds stop blocking slots (today they linger until the next hold request triggers cleanup)
- [x] New tests for the 19/10 decisions (AI branch change, AI confirm token, setting off, buffer 0, unassigned save, off-shift / bed warnings, no-bed branch, expired hold, AI late check-in) — approved 19/10. Baseline 19/10 with them: **38 tests · 11 pass / 27 fail**
- [x] AI overlap confirmation via one-time server token + prompt asks "Vẫn lưu?"
- [x] SQL migration ([backend/sql/2026-10-19_booking_guard.sql](backend/sql/2026-10-19_booking_guard.sql)) — dry run + applied 19/10; backend can call `booking_guard_write`, anon key is denied
- **Done when:** `npm run test:guard` is all green — ✅ 19/10: **39/39 pass** (3 runs in a row), unit tests 38/38; checked in the real dashboard + AI chat

## 1b. Booking change module + Group scope (P0) — spec #8
Rules: "Group rules" and "Time limits" above. One fresh session per ticket (`/implement <n>`), owner approval before code.

| Wave | Tickets (same wave = can run in parallel) | Starts when |
|---|---|---|
| 1 | [x] #9 Prefactor: Booking change module + staff edit of a single Booking (23/10; the 3 check-in guard tests still need a run between 10:30 and 20:00, tracked in #10) | now |
| 2 | [x] #10 Staff move a Group (Cả nhóm / Chỉ khách này) (24/10; check-in guard tests from #9 ran and passed) · [x] #11 Start-time limits (24/10; Last booking time = `close`, midnight refused, fallback 08:00–20:00) | #9 done |
| 3 | [x] #12 Staff group-wide fields (26/10; Contact rule + chosen-therapist rule added to "Group rules"; AI branch change still its own logic, moves to #15) · [ ] #13 Cancel as status · [x] #14 Check-in scope + Late arrival grace (24/10; real-app check, AI confirm-token scope fix + its guard test, and the AI guest list when the guest is unclear carried to #15) | #12, #13: #10 done · #14: #10 and #11 done |
| 4 | [ ] #15 AI update_booking through the module (+ pending from #14, see the issue comment) | #12 and #11 done |
| 5 | [ ] #16 Undo + AI reassign through the module | #15 and #13 done |

Running tickets in parallel:
- **Never run `npm run test:guard` in two sessions at once.** Every guard test wipes all `TEST-GUARD · ` data in the one shared Supabase, so parallel runs delete each other's fixtures. Code in parallel; take turns running the guard suite.
- Parallel tickets touch the same files (staff booking routes, Bookings page, AI tools): give each its own branch or worktree off `dev` and merge one at a time, re-running all tests after each merge.

## 2. Settings
- [x] "Buffer for online bookings" (minutes, global): field exists — fix default 15 → 0 (UI + `availability.js`), clarify it's online only
- [x] "Ask before saving overlapping staff bookings" (on/off)

## 3. Overlap warnings & visibility for staff (P0)
- [x] Keep the requested therapist; warn if busy instead of silently reassigning
- [x] Check-in warns when the new time overlaps the therapist's next booking
- [x] "Vẫn lưu" dialog on create + check-in (reuse the edit dialog), listing every reason — *in P0 phase*
- [x] Bookings without a therapist are visible (own "Chưa xếp NV" column) — *in P0 phase*
- [x] Calendar shows overlapping bookings side by side (6px gap; `overlapLayout.js`, dashboard `npm test`)
- [ ] Status visible in card's popup details (confirmed / arrived / late / completed)

## 4. Booking history (P1)
- [ ] Cancel = `status: cancelled` (no more hard delete)
- [ ] Store `source` (web / ai / staff), `created_by`, `updated_by`
- [ ] `booking_events` table with before/after for each change
- [ ] "Lịch sử" tab in booking detail

## 5. Team notifications (P1): staff ↔ staff ↔ admin
- [ ] Per-user read/unread
- [ ] Notify on move, cancel, check-in, staff overlap, AI change, with source label
- [ ] Staff handoff note field (separate from `internal_note`)
- [ ] Admin view of all overlaps/overrides

## 6. AI assistant (P1–P2)
- [ ] Follows the branch/date currently on screen
- [ ] Preview + confirm before move / cancel / group changes
- [ ] Shared AI action log visible to admin

## 7. Mobile front desk redesign (P1, owner-led)
Requirements from testing:
- [ ] Therapist shown on every card
- [ ] Arrived guests stay visible
- [ ] Now / Next / Late grouping
- [ ] Visible actions: Khách đến, Dời, Hủy, Hoàn thành
- [ ] Overlaps visible; touch-friendly calendar
- [ ] Clear status on every card

## 8. Shifts that mean something (P2)
- [ ] Replace auto 09:00–22:00 every day with shift templates
- [ ] Align shifts with branch opening hours

## 9. Performance (P2)
- [ ] Remove duplicate API calls on load (~5 s, 20+ requests today)
- [ ] One bootstrap request for branches/services/settings

## 10. Design system (P1) — spec #17, decisions in [docs/design-system.md](docs/design-system.md)
Agreed 24/10. This is a tidy-up that keeps today's look, not a redesign. Done: colours + accent prototype (24/10, verdict: **keep today's look**, no theme picker, Lato rejected for Vietnamese, Bricolage for all text). The tickets are sub-issues of #17, with native "blocked by" links on GitHub. One fresh session per ticket, with the owner's approval before code. The two prototypes (#19, #27) close only on the owner's verdict.

| Wave | Tickets (same wave = can run in parallel) | Starts when |
|---|---|---|
| 1 | [ ] #18 Tracer: tokens, style check (`npm run test:styles`), `/styleguide`, Employees moved over · [ ] #19 Prototype: shared components in today's look | now |
| 2 | [ ] #20 Core components + Phosphor · [ ] #21 Tooltip · [ ] #23 Modal (desktop) · [ ] #24 Toast styling · [ ] #27 Prototype: mobile patterns (with §7) | #20, #21, #23: #18 and #19 done · #24: #18 done · #27: #19 done |
| 3 | [ ] #22 DatePicker, then remove Chakra + `next-themes` · [ ] #25 Services, Branches, Settings · [ ] #26 Customers, Schedules · [ ] #28 Sidebar, layout, breakpoints · [ ] #29 UserSettings, ShareLink, sign-in · [ ] #30 AI chat panel · [ ] #31 Bookings toolbar + list | #22: #21 · #25, #26: #20 and #23 · #28, #30: #20 and #27 · #29: #20 · #31: #20 and #21 |
| 4 | [ ] #32 Bookings calendar + modals, with the mobile patterns | #22, #23, #27 and #31 done |
| 5 | [ ] #33 Contract: remove old variables and icon packages, empty the allowlist | all of the above done |

- **Done when:** the style check's allowlist is empty, Chakra and `react-icons` are gone from the dashboard's dependencies, and every page has been checked at 375 / 768 / 1280px.
- ~~Accent theme picker~~ dropped 24/10. One `--accent` token keeps it easy to add later.
- Page tickets touch shared components: if a page needs a component changed, change it in its own slice first and re-check `/styleguide`.
- Parallel tickets in wave 3 touch shared styles: give each its own branch or worktree off `dev` and merge one at a time, re-running `npm run test:styles` and the build after each merge.

---

## Evidence (tested 19/10/2026 on CN 1)
- Two parallel creates for Duyên 16:00 → **both saved, same therapist and bed**
- Requested Bằng while busy → silently given to Duyên
- Late check-in 12:15 → 13:15 overlapped Chị Vân 13:30 with no warning
- AI correctly refused to double-book Duyên 16:00
