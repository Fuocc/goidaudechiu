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
- AI moves a booking to another branch: keep the therapist if they work at the new branch that day and are free; otherwise pick a free, on-shift therapist + free bed there (tour order, no buffer). Nobody free → blocked (`no_employee`), booking unchanged; "Vẫn lưu" with the confirm token saves it unassigned, like staff (spec #8, agreed 28/10). The bed is always re-picked for the new branch.
- Undo restores the previous state without an overlap question. Time, therapist, bed and branch go back through the booking engine: the old therapist is restored exactly (overlap accepted); the old bed is kept if free, otherwise another free bed is picked, so a bed is never double-booked (agreed 28/10). Undo of an AI create still deletes the rows it created.
- AI reassign (therapist off sick, moved branch): moves that therapist's `pending` / `confirmed` Bookings of the day and online holds to the chosen therapist if free, otherwise the first free on-shift therapist (tour order), keeping each start time. `arrived` and `completed` Bookings keep their therapist (history / treatment in progress; staff change those by hand). Nobody free → that Booking stays and is reported (agreed 28/10).

### Group rules (agreed 23/10)

Words as in `GLOSSARY.md`: **Booking** = one guest, **Group** = Bookings of guests booked together, **Contact** = the person the Group is booked under. Decision record: `docs/adr/0001-group-moves-share-one-start-time.md`.

| Change | Scope |
|---|---|
| Date / start time, branch, service, notes + internal note, status (check-in, cancel, completed…), Contact | Group-wide ("Cả nhóm" or "Chỉ khách này") |
| Therapist, a guest's own name | Always this guest only |

- **Who picks the scope:** every change states it (one guest / whole Group); the backend never guesses.
  - Staff: asked "Cả nhóm / Chỉ khách này" whenever a group-wide field changes; **Cả nhóm is the default button**. Changing only per-guest fields → no question.
  - AI: whole Group unless the command singles out one guest. If it does but doesn't say which (all guests carry "Miss Mia"), the AI asks, listing therapist / time / service.
    - AI tools (`update_booking`, `check_in_booking`, `delete_booking`; agreed 28/10): "one guest" on a Booking whose name matches another active guest in the Group → nothing is saved, the tool returns every guest (therapist / time / service). The AI resends with the chosen guest's id and `guest_confirmed: true` (also when the user replied to that guest's card). A missing scope counts as `group`, also for the confirm token.
    - AI `update_booking` takes only: date, start time, service, branch, therapist (this guest), notes, scope. Anything else from the model is dropped. One Booking (+ its Group) per call. Several services per Booking: later, its own ticket.
- **Times:** "Cả nhóm" → every guest gets the **same new start time**, each keeps their own service length. Date-only change → each keeps their own start time. "Chỉ khách này" → the others don't move. Check-in → "now" for whoever is checked in.
- **Drag or edit that changes therapist and time together:** therapist applies to this guest only; the question is only about the time.
- **All-or-nothing:** one "Vẫn lưu?" lists every guest's conflicts; confirming saves all, otherwise nothing is saved.
- **Notes always replace** with the full new text. The AI is shown the current note, must send the complete updated note, and its reply shows before → after. "Cả nhóm" writes the same text to every guest.
- **Branch change (every Source, one guest or Group):** keep the therapist if they work at the new branch that day and are free; otherwise pick a free on-shift therapist there; nobody free → "Vẫn lưu?" (saves unassigned). Bed always re-picked. A therapist chosen in the edit applies to this guest only and must work at the new branch (otherwise refused); leaving it empty auto-picks (agreed 24/10).
- **Contact (agreed 24/10):** "Cả nhóm" fixing the Contact's phone / email / habits only updates the Contact's profile; guests who have their own name keep it. Picking another Contact or renaming it with "Cả nhóm" links every guest to it again, including those with their own name. "Chỉ khách này" + a name change gives that guest their own name (unlinked from the Contact; the profile is unchanged); "Chỉ khách này" + a phone / email / habits change is refused (those belong to the whole Group).
- **Membership:** a Booking never leaves its Group. Cancelled guests stay in it but are skipped by later Group changes. Group size = number of non-cancelled Bookings.
- **Cancel** = `status: cancelled` (no hard delete) for staff and AI, with the same scope question. Only expired holds are deleted. "Cả nhóm" cancel skips guests who already arrived or completed (agreed 24/10), including the guest it was started from, and says who was skipped (agreed 26/10); they don't count toward asking the question either. Nothing left to cancel → refused. A customer with any Booking (cancelled included) can't be deleted: their history is kept.
- **Leaving cancelled** (staff, e.g. cancel pressed by mistake; agreed 24/10): a cancelled Booking can be set to confirmed / pending / completed, with the same scope question (asked only if other guests in the Group are cancelled too; Cả nhóm = every cancelled guest). Each goes back to their own time and therapist through the booking engine, all-or-nothing, one "Vẫn lưu?" (bed re-picked if taken). No Last booking time check. `arrived` only comes from check-in.
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
| 3 | [x] #12 Staff group-wide fields (26/10; Contact rule + chosen-therapist rule added to "Group rules"; AI branch change still its own logic, moves to #15) · [x] #13 Cancel as status (26/10; cancel + status with scope, leaving cancelled through the engine, Cả nhóm skips arrived / completed; no status buttons yet, they come with §7) · [x] #14 Check-in scope + Late arrival grace (24/10; real-app check, AI confirm-token scope fix + its guard test, and the AI guest list when the guest is unclear carried to #15) | #12, #13: #10 done · #14: #10 and #11 done |
| 4 | [x] #15 AI update_booking through the module (28/10; allow-list, notes replace before → after, one token per Group, guest list when unclear for update / check-in / cancel, check-in token on normalised scope; real-app check incl. #14's; multi-service per Booking left for its own ticket) | #12 and #11 done |
| 5 | [x] #16 Undo + AI reassign through the module (28/10; Undo restores through the booking engine — old therapist exact, bed re-picked if taken, never asks; reassign skips arrived / completed; real-app check of AI Group move / cancel + Undo) | #15 and #13 done |

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
- [x] Cancel = `status: cancelled` (no more hard delete) — #13, 26/10
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

---

## Evidence (tested 19/10/2026 on CN 1)
- Two parallel creates for Duyên 16:00 → **both saved, same therapist and bed**
- Requested Bằng while busy → silently given to Duyên
- Late check-in 12:15 → 13:15 overlapped Chị Vân 13:30 with no warning
- AI correctly refused to double-book Duyên 16:00
