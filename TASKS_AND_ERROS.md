# EMOS — Open Tasks & Backlog

> Last verified against the codebase: **2026-06-14** (running build 0.11.1).
> Items confirmed shipped were removed in this pass: interval rep-structure
> boxes, planner set/rep click responsiveness, and the activity feed
> (PRs + clickable events). The three items below are what genuinely remains.

---

## 1. Plan-mode day cards: stable labels with a "—" placeholder

**Problem.** In the Weekly Planner (Plan mode), the per-day card metric strip
hides a metric whenever its value is `0` or empty, so as a coach edits — or
right after a week is pasted — values visibly *appear and disappear*. This
reads as flicker/instability and makes it hard to scan a day at a glance,
because the same row shows a different set of metrics from one moment to the
next.

**Desired behaviour.** Always render the metrics the coach has enabled in
settings, in a fixed order, and show **"—"** when a given metric has no value
yet — never add/remove the metric itself. The card layout should stay visually
constant; only the values change. This mirrors the behaviour already shipped in
the Training **Log** view, which recomputes/falls back instead of blanking out.

**Current state.**
- Paste-week itself is correct — values are carried into the new week
  (`useWeekPlans.ts` `buildExerciseSnapshot` → `insertExerciseSnapshot`).
- The flicker is purely a *display* issue: `MetricStrip.tsx` filters out
  empty/zero metrics (`.filter(item => item.value !== '—' && item.value !== '0')`),
  used by the planner day card (`DayCard.tsx`).

**Acceptance criteria.**
- Enabled metrics always render on the day card, in a stable order, regardless
  of value.
- A metric with no/zero value shows "—" rather than vanishing.
- No change to how values are computed or stored — display only.
- Behaviour matches the Log view's placeholder model for consistency.

---

## 2. Coach-defined per-unit evaluations / rotations (e.g. Easy / Medium / Hard)

**Problem.** Coaches can classify *weeks* (week types like High / Medium / Low,
already configurable), but there is no way to tag an individual **training unit
/ day** with a coach-defined evaluation or rotation label. Many coaches think
in per-session intensity ("today is a Hard unit, tomorrow Easy") and want to
plan and read that at the unit level.

**Desired behaviour.** Let the coach define their **own** set of unit
evaluation/rotation labels — not a hardcoded enum — exactly the way week types
work today. A coach should be able to:
- Create a named scale with custom entries (e.g. Easy / Medium / Hard, or
  Technique / Volume / Intensity, or A / B / C), each with a label, short
  abbreviation, and colour.
- Assign one of those entries to a training unit/day when configuring it.
- See the assigned tag on the day card and in print output.

This must follow the **coach-flexibility-over-hardcoding** principle: the
scale's entries are runtime-configurable, never baked into components.

**Current state.**
- Week-level types exist and are a good template to follow:
  `GeneralSettings.tsx` (week-type CRUD) + `general_settings.week_types`,
  applied to `MacroWeek.week_type`.
- Nothing equivalent at the unit/day level: `WeekPlan` carries `day_labels`,
  `day_display_order`, `day_schedule` — but no evaluation/intensity field, and
  `DayConfigModal.tsx` has no UI to pick one.

**Likely scope.**
- A new coach-defined "unit evaluations" config (mirror the week-types editor).
- A per-day value to store the chosen entry (needs a schema/migration — gated;
  surface it for approval, don't apply silently).
- UI to assign it in `DayConfigModal`, plus display on the day card and print.

**Acceptance criteria.**
- Coach can create/edit/delete their own unit-evaluation entries in settings.
- Coach can assign an entry to any unit; it persists and round-trips.
- The tag shows on the day card and carries into print.
- Group-plan sync keeps the assignment consistent.

---

## 3. Make the main dashboard athlete-centric (interactive photo cards)

**Problem.** The main coach dashboard presents athletes in a dense table with
initials-only avatars. The vision is a more interactive, athlete-first surface —
cards with each athlete's **face/photo**, scannable and selectable like picking
a player from a squad.

**Desired behaviour.** On the main dashboard, present athletes as a grid of
photo cards (face front-and-centre), each clickable to drill into that athlete.
Keep the information density EMOS expects — the card should still surface the
key at-a-glance status (e.g. trained/compliance/readiness signal), just in a
more visual, interactive form than a table row. A toggle between card and table
view is acceptable if density-sensitive coaches want the table back.

**Current state.**
- The building block already exists: `AthleteCardPicker.tsx` renders an
  interactive photo-card grid (uses `photo_url`, falls back to an icon) and is
  used in the planner, macro, and analysis flows.
- The DB already has `athletes.photo_url`.
- The main dashboard (`CoachDashboardV2` → `StatusBoard`) still uses an HTML
  table; its `Avatar` (`dashboard-v2/atoms.tsx`) renders initials only, never
  the photo.

**Likely scope.**
- Bring photo rendering + a card layout to the dashboard's athlete list
  (reuse/extend `AthleteCardPicker` or give `StatusBoard` a card mode).
- Decide which status signals belong on the card face vs. on hover/expand.

**Acceptance criteria.**
- Dashboard shows athletes as photo cards with their face when a `photo_url`
  exists (graceful fallback otherwise).
- Cards are clickable and lead to that athlete's detail/log.
- Key status remains visible without losing scannability (optional table toggle).
