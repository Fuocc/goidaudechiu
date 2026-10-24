# Dashboard design system

Decisions agreed with the owner on 24/10/2026. Applies to `dashboard/` on desktop and mobile; the public `frontend/` site is out of scope.

**Status:** agreed, not yet built. D1 settled the look: **keep today's dashboard look** (see "D1 verdict" below). Components are approved from a visual prototype first (ROADMAP §10 D2). Once built, the staff-only `/styleguide` page is the owner's reference. This file holds the rules for whoever writes the code.

## Goals (in order)

1. **Maintenance:** one token set and shared primitives replace about 7,600 lines of one-off CSS.
2. **Mobile quality:** real mobile patterns, not a squeezed desktop.
3. **Consistency:** every screen uses the same spacing, type, colour and components.

This is a tidy-up, not a redesign. The tokens record what the dashboard already looks like.

## D1 verdict (24/10)

The owner compared today's dashboard with two variants on the real app: subtle buttons with a teal accent, and with a warm black accent, both using Lato for body text. **Today's look won.** Results:

- Colours, buttons and fonts stay as they are today.
- **No accent theme picker for now.** All the presets were turned down. Teal stays as a single `--accent` token, so a picker can be added later by changing that one value.
- **Lato is rejected:** its Vietnamese accents look bad. Any future font must handle Vietnamese well; Be Vietnam Pro is the one to try.

## Decisions

| Area | Decision |
|---|---|
| Foundation | Plain CSS custom properties in `src/styles/variables.css`. **Chakra UI and `next-themes` are removed.** |
| Look | Today's dashboard, recorded as tokens. Nothing is redesigned. |
| Neutrals | Today's warm greys (`#F4F2F0` for hover and button fill, `#1C1A17` for text, `#878580` / `#A8A29E` for muted text and icons). The ~340 one-off greys are merged into one warm scale built from these values. Changes should be invisible; any merge you can actually see goes to the owner first. |
| Accent | Teal `#25836B` as one `--accent` token, used where it is today: active nav icon (desktop and mobile), ticked boxes, switches, notification filter, AI chat. No user theme picker for now. |
| Buttons | Today's style: a subtle light-grey (`#F4F2F0`) fill or border with dark text, turning dark on hover. The strong action (Save) is solid `#1C1A17`. |
| Status colours | Success, warning, error and info stay fixed and separate from the accent. |
| Dark mode | Not now. Tokens are named by role, so dark mode can be added later as `[data-theme="dark"]`. |
| Breakpoints | Mobile `≤ 767px`, tablet `768–1023px`, desktop `≥ 1024px`. Tablet uses the desktop layout with a collapsible sidebar. Remove the `400px` one-off. |
| Desktop layout | Stays as it is (sidebar, page structure, navigation). |
| Fonts | **Bricolage Grotesque for all text**, as today. It handles Vietnamese well. The stray `'Inter'` declarations on `select`, `textarea` and toasts point at a font that is never loaded (so they fall back to the system font); they move to Bricolage. That is a small visible change, so check it in D2. |
| Icons | `@phosphor-icons/react` only. Weight `regular` by default, `fill` for active or selected states. Size and weight are set once through `IconContext`. Replaces `react-icons` and hand-written `<svg>`. |
| Date picker | `react-day-picker`, styled only with tokens. |
| Tooltip | Our own primitive (replaces Chakra's). |
| Third-party UI | React-Toastify takes the tokens first, Clerk (`appearance` variables) second. |
| Accessibility | WCAG AA contrast for text, a visible focus ring on everything interactive, tap targets of at least 44 px on mobile. |

### Inconsistencies today, to settle in D2

These are visible in the current look and are decided at the primitives review, not silently "fixed":

- The "now" line in the calendar is black, while other "current" markers are teal.
- The dot on "Hôm nay" is amber `#e6a02a`, the only amber in the dashboard.
- Your messages in the AI chat use a darker teal (`#055c5b`) than the rest (`#25836B`).
- `.btn-primary` (transparent with a border) and `.btn-create` (filled) are two "subtle" button styles.
- The page background is a neutral `#f7f7f7`, not one of the warm greys.

## Token rules

- Name tokens by **role**, never by value: `--color-bg`, `--color-surface`, `--color-hover`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-heading`, `--accent`, `--focus-ring`. Not `--gray-200` or `--teal`.
- The raw warm grey scale (`--warm-50 … --warm-900`) is used **only inside `variables.css`** to define role tokens.
- Spacing, radius, shadow, font size, motion duration, z-index and icon size are tokens too.
- Delete the leftover public-site variables (`--_colours---*`, `--ivory-white`, `--pure-white`, `--midnight-black`) once nothing uses them.

## Primitives

These live in `src/components/ui/` and are styled only with tokens, in today's look. The final list is settled at the D2 primitives review:

Button, IconButton, Field (input / select / textarea), Card, Badge / Chip, Modal / Sheet, Tooltip, DatePicker, Skeleton, a list that is a table on desktop and cards on mobile, EmptyState, Toast styling.

### "Premium" bar (tooltip, date picker and all overlays)

- 120–180 ms fade and scale, turned off when the device's reduce-motion setting is on
- Soft layered shadow and an arrow on tooltips
- Smart placement that never goes off screen
- Full keyboard support: arrows, Enter, Esc, and focus returns to where it came from
- Visible focus ring
- Vietnamese month and weekday names, with the week starting on Monday
- Looks consistent with the rest of the UI. No library default styling left visible.

## Mobile

Most common staff tasks on mobile, in order: check today's or upcoming bookings → check a guest in → create a booking → move a booking → AI chat.

Problems to fix, in order: modals (cramped) → bookings calendar → forms and pickers → lists and tables.

New mobile patterns (sheets, mobile calendar, forms) are designed together with ROADMAP §7 "Mobile front desk redesign".

## Enforcement

A dashboard guard test (`node --test`) fails when any of these appear outside `variables.css`:

- raw colours: hex, `rgb()`, `hsl()`
- font sizes in `px`
- hard-coded colours in JSX `style={{}}`

Files not yet moved over are on an allowlist, and the list may only shrink. When a page is moved over, its allowlist entry is deleted in the same change.

## How UI changes are approved

- **Restyling an existing screen** with approved tokens and primitives follows the normal change process (Research → Agree tests → Plan → Approval → Execute → Re-test).
- **Any new component, layout or mobile pattern:** first build a prototype of the proposal and ask the owner: *"approve this, or will you design your own in Figma?"* No code before the owner answers.
- **Prototypes run on the real app where possible** (a dev-only switcher on the real pages), not as standalone mock-ups. The owner judges designs against the real dashboard, and a separate mock drifted too far from it in D1.
- After each page is moved over, check it by hand at mobile (375px), tablet (768px) and desktop (1280px+) widths.
