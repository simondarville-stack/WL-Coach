# EMOS — Display Conventions (specification)

Status: **binding specification**, not guidance. These are product decisions,
not style preferences: getting one wrong is a bug, not a taste difference.

This sheet exists because these rules kept getting re-decided from scratch by
whoever touched a surface next. If a new surface renders a prescription, a
number, a date or a time, it follows this file. When a history doc or an older
component disagrees, **this file wins** — fix the component.

---

## 1. Prescriptions — Stacked Notation is the only display format

**Rule.** Every read-only, coach-facing rendering of a prescription uses
**Stacked Load Notation**: load above, reps below a divider, sets to the right.

```
  85      100     ← load
 ───     ───      ← divider
   3       1      ← reps
      ×3          ← sets, to the right, ONLY when sets > 1
```

**The canonical component is `src/components/planner/StackedNotation.tsx`.**
Its props are `{ raw, unit, isCombo }` — the same three values every planned
row already carries. It returns `null` for a null `raw`, so it is safe to drop
in unconditionally. There is a sibling `LoggedStackedNotation` for logged sets.

**Never** render a prescription as inline `load×reps×sets` text
(`"80×3×5"`, `"100×1 · 85×3"`). That form is for **input and storage**
(`prescription_raw`), never for display. If you find yourself calling
`parsePrescription` and then `join('·')`, you are re-implementing
`StackedNotation` incorrectly — use the component.

This applies to *every* surface, including the easily-forgotten ones:

- day cards and the week grid
- the exercise detail view
- **clipboard item previews** (exercise, training unit, parked week)
- **programme-template previews**
- macro target cells and the Fieldcoach read-only macro
- print / PDF output

Exceptions, and only these:
- **Editing.** A prescription grid cell in edit mode shows the raw text,
  because that is what the coach is typing.
- **Excel export.** A spreadsheet cell is a string; there is no stacked visual.
- **Deliberately terse chips** where a single number is the whole point (a top
  set, a `Max` metric). These render one value, not a prescription.

**Parsing lives in one place too:** `src/lib/prescriptionParser.ts`. Do not fork
it. Input grammar: `load × reps` implies `sets = 1`; `load × reps × sets` sets
them explicitly; comma-separated segments are allowed (`80×3, 85×2×3`); combos
carry `+`-tuple reps (`80×1+2×3`). Soft-load signs `≥ ≈ ≤`, and rep/set/load
ranges, are part of the grammar and `StackedNotation` renders all of them.

**When `sets = 1`, never render the sets indicator.** Not `×1`, not a blank
column that reserves the space.

---

## 2. Numbers

- **Comma decimals**, German/Danish locale style: `117,5` — never `117.5`.
  This holds in tables, chips, tooltips, previews and ghost/preview cells.
- Never print a raw JavaScript number into user-facing text; format it.
- Tabular numbers (`fontVariantNumeric: 'tabular-nums'`) wherever figures stack
  in a column, so digits align.
- **Units are explicit where they can vary.** A macro column carries
  `target_unit` (kg / % / free text); a planned row carries `unit`. Never
  assume kilograms because a number looks like one.
- Percentages round on a **0,5 grid**; kilograms round on the coach's own load
  step (default 2,5). A 2,5 grid is a barbell fact and must not be applied to a
  percentage ramp.

---

## 3. Dates, times, weeks — European, always

- **Dates are day-first**: `DD/MM/YYYY` or `DD/MM`. Never US month-first.
- **Times are 24-hour**: `16:00`. Never `4:00 PM`.
- **Weeks start Monday.** Weekday index 0 = Monday … 6 = Sunday.
- Format through `src/lib/dateUtils.ts` (`formatDateShort` → `DD/MM`, etc.).
  Do not hand-write a formatter.

This applies to new date pickers, presets, parsing and axis labels too.

---

## 4. Identity: slots vs weekdays

`planned_exercises.day_index` is a **slot number** — the identity of a training
unit *within* a week plan. It is **not** a weekday, and it is **not bounded by
7**: adding and removing units allocates `max + 1`, so a week legitimately
holds slot 14.

A unit's weekday comes from `week_plans.day_schedule[slot].weekday` and exists
only when the week is calendar-mapped. Any grid that lays units out by weekday
must resolve through `day_schedule`; any code that iterates `0..6` over slots is
wrong and will silently drop units.

---

## 5. Colour that carries meaning is data, not chrome

Never "tidy" these into neutral tokens: phase and week-type colours, chart and
SVG series colours, heat/value shading, `type="color"` values, competition-type
badges, exercise category shades. Neutral chrome uses the tokens in
`src/styles/tokens.css`.

Tailwind footgun, since it fails silently: for `border` / `ring` / `outline` /
`divide` colours from a CSS variable you **must** write
`border-[color:var(--token)]`. Bare `border-[var(--token)]` parses as a length.

---

## 6. Density

EMOS is an expert tool. Prefer compact tables, tight spacing and inline editing
over modals, wizards and whitespace. A chip that appears on *every* row carries
no signal — prefer chips for actionable, non-obvious information and a `title`
tooltip for terse jargon.
