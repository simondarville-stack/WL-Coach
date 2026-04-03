# WEEKLY PLANNER — COMPLETE REBUILD

## GOAL
Delete the existing weekly planner module and rebuild it from scratch. This is the most important feature of the app. The new planner must be purpose-built for Olympic weightlifting coaching while following object-oriented design principles that give the user a sandbox feeling — simple by default, powerful when needed.

---

## DESIGN PHILOSOPHY

### Product identity
WinWota is a **specialized tool for Olympic weightlifting coaches**. Every design decision should reflect OWL coaching workflows: exercises are prescribed in load/reps/sets notation, combos (complexes) are fundamental, load distribution across a week matters as much as individual prescriptions, and coaches think in terms of volume, intensity, and stress.

### Engineering principles
Apply object-oriented design thinking to the UI architecture:
- **Encapsulation**: each exercise item is a self-contained unit with its own state, grid, and summary. It doesn't need external context to be understood.
- **Polymorphism**: regular exercises and combo exercises use the same interface (same grid, same card layout, same interactions). A combo is just an exercise item whose reps field shows `2+1` instead of `3`.
- **Composition over inheritance**: the day editor composes exercise items. The week view composes day columns. The macro validation composes week data. Each layer adds context without modifying the layer below.
- **Open/closed principle**: the system is open for extension (new unit types, new summary metrics, new slash commands) without modifying existing components.

### Progressive complexity
The system should scale with the coach's skill level:
- **Simple mode**: add exercises, click grid cells to set load/reps/sets. Stacked notation displays automatically. Done.
- **Intermediate mode**: use the day editor to see full day flow, reorder exercises, see cumulative summaries, check macro targets.
- **Advanced mode**: use exercise detail for SOLL/IST graphs, other-day comparisons, variation notes, unit overrides. Toggle additional metrics like Stress.

The UI should never force complexity — advanced features are discoverable but not in the way.

---

## CONTEXT — PROJECT OVERVIEW

**Stack**: React 18 + TypeScript + Vite + Tailwind CSS + Supabase + Recharts
**Supabase**: All data operations use the existing `supabase` client from `src/lib/supabase.ts`
**Supabase migration constraint**: `CREATE POLICY IF NOT EXISTS` is NOT supported. Always use `DO $$ BEGIN DROP POLICY IF EXISTS ... ON ...; CREATE POLICY ... ON ...; END $$;`
**Auth pattern**: Anonymous Supabase auth. All RLS policies allow anon access.
**Navigation**: Sidebar (`Sidebar.tsx`) + page routing via `currentPage` in `App.tsx`. The planner page is `'planner'`.
**Athlete context**: Receives `selectedAthlete` and `onAthleteChange` props from `App.tsx`.

---

## FILES TO DELETE

Remove these files entirely:
- `src/components/WeeklyPlanner.tsx`
- `src/components/DayColumn.tsx`
- `src/components/PrescriptionModal.tsx`
- `src/components/PrescriptionDisplay.tsx`
- `src/components/GridPrescriptionEditor.tsx`
- `src/components/SetLineEditor.tsx`
- `src/components/ComboCard.tsx`
- `src/components/ComboEditorModal.tsx`
- `src/components/ComboCreatorModal.tsx`
- `src/components/LoadDistributionPanel.tsx`
- `src/components/MacroValidation.tsx`
- `src/components/CopyWeekModal.tsx`
- `src/components/PrintWeek.tsx`

Keep these files (still used):
- `src/components/PlanSelector.tsx`
- `src/components/MediaInputModal.tsx`
- `src/lib/prescriptionParser.ts`
- `src/lib/constants.ts`
- `src/lib/dateUtils.ts`

---

## DATA MODEL

### Keep existing tables (no schema changes)
- `week_plans`, `planned_exercises`, `planned_set_lines`, `planned_combos`, `planned_combo_items`, `planned_combo_set_lines`, `exercises`, `athlete_prs`

### Modify: `planned_exercises` — add variation note
```sql
ALTER TABLE planned_exercises ADD COLUMN IF NOT EXISTS variation_note text DEFAULT NULL;
```

### Modify: `general_settings` — add metric toggles
```sql
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS visible_summary_metrics text[] DEFAULT '{sets,reps,tonnage,hi,avg}',
  ADD COLUMN IF NOT EXISTS show_stress_metric boolean DEFAULT false;
```

### Write migration
Create `supabase/migrations/20260403000000_planner_rebuild.sql` with the above. Use `DO $$ BEGIN DROP POLICY IF EXISTS ...; CREATE POLICY ...; END $$;` for any RLS.

### Update `database.types.ts`
- Add `variation_note: string | null` to `PlannedExercise`
- Add `visible_summary_metrics: string[]` and `show_stress_metric: boolean` to `GeneralSettings`

---

## NAVIGATION MODEL — THREE-LEVEL DRILL-DOWN

The planner uses a **three-level drill-down** navigation. Each level replaces the content area. Breadcrumbs at the top allow navigation back to any parent level.

```
Level 1: WEEK OVERVIEW
  ↓ click a day card
Level 2: DAY EDITOR
  ↓ click gear icon (⚙) on an exercise
Level 3: EXERCISE DETAIL
```

Breadcrumb examples:
- Level 1: `Week 14–20 Mar` (no breadcrumb needed, this is the root)
- Level 2: `Week 14–20 Mar › Monday`
- Level 3: `Week 14–20 Mar › Monday › Snatch`

Navigation state is managed in `WeeklyPlanner.tsx`:
```typescript
type PlannerView =
  | { level: 'week' }
  | { level: 'day'; dayIndex: number }
  | { level: 'exercise'; dayIndex: number; exerciseId: string; isCombo: boolean };
```

Clicking a breadcrumb navigates back to that level. The close button (✕) on the day editor or exercise detail navigates back one level.

**Important**: these are NOT modals or overlays. Each level fully replaces the content area below the header and breadcrumbs. Modals are only used for actions (creating combos, copying weeks, etc.), not for view transitions.

---

## COMPONENT ARCHITECTURE

```
src/components/planner/
  WeeklyPlanner.tsx          — Main page: week nav, view state, data loading, breadcrumbs
  WeekOverview.tsx           — Level 1: day cards grid + week summary
  DayCard.tsx                — Compact day card with stacked notation (read-only)
  DayEditor.tsx              — Level 2: full day editing with inline grids
  ExerciseItem.tsx           — Unified exercise row (regular + combo, compact + editor modes)
  PrescriptionGrid.tsx       — Unified grid input (stacked load/reps/sets cells)
  ExerciseDetail.tsx         — Level 3: SOLL/IST, other days, settings
  SollIstChart.tsx           — SOLL vs IST Recharts graph
  ExerciseSearch.tsx         — Slash command search input
  WeekSummary.tsx            — Summary bar (sets, reps, tonnage, stress) + category breakdown
  LoadDistribution.tsx       — Load distribution bar charts
  CopyWeekModal.tsx          — Copy/paste week modal
  PrintWeek.tsx              — Print view
  ComboCreatorModal.tsx      — Create new combo modal
```

Update `App.tsx` to import from `src/components/planner/WeeklyPlanner.tsx`.

---

## FEATURE SPECIFICATIONS

### F1. Main Shell (`WeeklyPlanner.tsx`)

Manages week selection, athlete selection, data loading, view state, and breadcrumbs.

**Layout**:
```
┌─────────────────────────────────────────────────┐
│ Header: ← 14 Mar – 20 Mar 2025 →    [toolbar]  │
│ Breadcrumb: Week 14–20 Mar › Monday             │
├─────────────────────────────────────────────────┤
│                                                 │
│  Content area (switches based on view level)    │
│                                                 │
└─────────────────────────────────────────────────┘
```

The header and breadcrumb are always visible. Content renders `WeekOverview`, `DayEditor`, or `ExerciseDetail` based on view state.

Data loading happens at this level. All child components receive data as props and call back to refresh.

### F2. Week Overview — Level 1 (`WeekOverview.tsx`)

Shows all training days at a glance. The coach assesses rhythm and balance here.

**Layout**:
1. **Macro bar**: week type badge, macro name, week number, phase name, total reps target
2. **Week summary** (`WeekSummary.tsx`): metric cards for Sets, Reps, Tonnage, Stress (each toggleable). Expandable category breakdown.
3. **Day cards grid**: responsive grid of `DayCard` components

### F3. Day Card — Compact View (`DayCard.tsx`)

Read-only card representing one training day.

**Contents**:
- Header: day name + day totals (S, R)
- Exercise list with compact stacked notation:
  - Color stripe + exercise name + variation note
  - Inline stacked notation: each prescription column shown as a small load/reps fraction with sets
  - Combo badge for combos
  - Italic text for free text items
- Rest days: "Rest day" in muted italic

**Interactions**:
- **Click the day card** → navigate to Level 2 (DayEditor)
- **Click a specific exercise row** → navigate to Level 3 (ExerciseDetail), bypassing Level 2
- **Drag exercises between cards** → move exercise to another day
- **Drag card headers** → reorder days

### F4. Day Editor — Level 2 (`DayEditor.tsx`)

Primary editing interface. Builds prescriptions for one training day.

**Layout**:
- Header: day name + date + day totals (S | R | T | Stress) + close button (✕ → back to Level 1)
- Exercise list: `ExerciseItem` components in editor mode
- Exercises are draggable to reorder
- Search input at bottom (slash commands via `ExerciseSearch`)
- Running totals update live

**Each exercise row in editor mode**:
- Drag handle (⋮⋮)
- Exercise name + variation note (italic) + unit badge (kg/% /RPE)
- Summary: `S 6 R 12 Hi 85 Avg 77`
- Macro target (if exists): `| Macro: R 30 Hi 85/2/2 Avg 78`
  - Format: `Hi 85/2/2` = 85kg highest / 2 reps at highest / 2 sets at highest
- Gear icon (⚙) → navigate to Level 3
- For combos: sub-label with component exercises and colored dots
- Inline `PrescriptionGrid` — where the coach clicks to build prescriptions
- Notes row (if notes exist)

### F5. Exercise Detail — Level 3 (`ExerciseDetail.tsx`)

Detailed view for one exercise. Analysis and advanced settings.

**Header**: exercise name + variation note + close button (✕ → back to Level 2)

**Tabs**:

**Tab 1: SOLL / IST** (only if macrocycle covers this week)
- `SollIstChart.tsx` — Recharts LineChart:
  - Blue SOLL dots/line: macro targets across all weeks
  - Green IST dots/line: actual performed from planned_exercises
  - Phase background bands (colored vertical strips)
  - "Now" marker at current week
  - Toggle Hi vs Avg views
- Week comparison table:
  ```
  SOLL: R 30  Avg 78  Hi 85/2/2
  IST:  R 12  Avg 77  Hi 85/1/2
  ```

**Tab 2: Text input**
- Textarea with `prescription_raw`
- Parse and apply button
- Fallback for power users

**Tab 3: Other days**
- This exercise on other days this week:
  ```
  Wednesday:  70x3, 80x2x3  (S4 R9)
  Friday:     not yet planned
  ```

**Tab 4: Settings**
- Unit selector dropdown
- Variation note text input
- Exercise notes textarea
- For combos: combo name, reps notation, component list

### F6. Unified Exercise Item (`ExerciseItem.tsx`)

Renders BOTH regular exercises and combos with the same interface.

**Two modes**:
- `compact` (in DayCard): color stripe + name + variation + stacked notation preview. Click → Level 3.
- `editor` (in DayEditor): full row with drag handle, stats, macro target, gear icon, inline grid, notes.

**Type handling**:
- Regular exercise: data from `planned_exercises`, prescription from `prescription_raw`
- Combo: data from `planned_combos` + `planned_combo_set_lines`, reps as `2+1` tuples
- Same `PrescriptionGrid` component for both

### F7. Prescription Grid (`PrescriptionGrid.tsx`)

Core input component. Stacked load/reps/sets columns.

**Column layout**:
```
┌─────┐
│ 85  │ ← load
│─────│ ← divider
│  1  │ ← reps (or "2+1" for combos)
└─────┘2 ← sets (right of fraction, vertically centered)
```

**Sets display**:
- Sets = 1 → hidden, ghost `1` on hover
- Sets > 1 → shown right of fraction, slightly smaller/lighter weight
- Sets area ALWAYS present and clickable

**Interaction — same for ALL numbers**:
- Left-click → increment (load by `grid_load_increment`, reps/sets by `grid_click_increment`)
- Right-click (prevent context menu) → decrement (min 0 for load, min 1 for reps/sets)
- Ctrl+click → direct input mode (input field, Enter/blur commits, Escape cancels)
- Delete/Backspace → remove column

**"+" button**: adds column with smart defaults (load = prev + increment, reps = prev, sets = 1). Auto-focuses load for direct input.

**Combos**: reps cell shows tuple `2+1`. Left/right click increments first part. Ctrl+click opens input for full tuple.

### F8. Exercise Search (`ExerciseSearch.tsx`)

Slash commands: `/combo`, `/text`, `/video`, `/image`. Data-driven `SLASH_COMMANDS` array.
Regular search filters by name/code, excludes `category = '— System'`.

### F9. Week Summary (`WeekSummary.tsx`)

Metric cards: Sets, Reps (with macro target), Tonnage, Stress. Each toggleable via settings.
Category breakdown (expandable): grouped by exercise category.
Macro bar: week type badge, phase, target reps.
Stress formula: `sum(reps × (load/PR)²)`. Comment: `// TODO: refine stress formula`.

### F10. Load Distribution (`LoadDistribution.tsx`)

Three Recharts bar charts: Load/day, Reps/day, Stress/day. XAxis: `interval={0}`, `angle={-35}`, `textAnchor="end"`, `height={50}`.

### F11–F13. Copy/Paste, Print, Combo Creator

Port from existing implementations. See current code for logic. Key: CopyWeekModal stores source by weekplan ID, not athlete filter.

### F14. Settings Integration

In `GeneralSettings.tsx`, add **"Weekly planner display"** section:
- Visible summary metrics: checkboxes for Sets, Reps, Tonnage, Hi, Avg, Stress
- Show stress metric: toggle
- Grid load increment + click increment (already exist)

---

## SUMMARY CALCULATIONS

### Weekly totals (excluding combo-linked exercises to avoid double-counting)
- **Sets**: sum of all sets
- **Reps**: sum of (sets × reps) per exercise + (sets × sum(reps_tuple)) per combo set line
- **Tonnage**: sum of (load × sets × reps) for kg-based
- **Hi**: max load
- **Avg**: total tonnage / total reps for kg-based
- **Stress**: sum of (reps × (load/PR)²) for exercises with PRs

### Macro target display
- `Hi 85/2/2` = highest load / reps at highest / sets at highest
- `R 30` = total reps target
- `Avg 78` = average weight target

---

## IMPLEMENTATION ORDER

1. Migration + types
2. WeeklyPlanner.tsx (shell, nav state, breadcrumbs, data loading)
3. PrescriptionGrid.tsx (grid component — test in isolation)
4. ExerciseItem.tsx (unified row, compact + editor modes)
5. DayCard.tsx (compact day card)
6. WeekOverview.tsx (day grid + summary)
7. DayEditor.tsx (full editing with inline grids)
8. ExerciseSearch.tsx (slash commands)
9. ExerciseDetail.tsx (tabbed view)
10. SollIstChart.tsx (SOLL/IST graph)
11. WeekSummary.tsx (metrics + categories)
12. LoadDistribution.tsx (charts)
13. CopyWeekModal.tsx (port)
14. ComboCreatorModal.tsx (port)
15. PrintWeek.tsx (port)
16. GeneralSettings.tsx (metric toggles)
17. App.tsx (import path)
18. Cleanup + `npx tsc --noEmit`

---

## CRITICAL REMINDERS

- **Supabase RLS**: `DO $$ BEGIN DROP POLICY IF EXISTS ...; CREATE POLICY ...; END $$;`
- **System exercises**: filter `category = '— System'` from search
- **Combo double-counting**: don't count combo-linked exercises in regular totals
- **Grid consistency**: load, reps, AND sets all use left/right/ctrl-click. No exceptions.
- **Sets ghost**: when sets=1, area still clickable, ghost `1` on hover
- **Stacked notation default**: text input only as fallback in exercise detail
- **Three-level navigation**: Week → Day → Exercise. Full content replacement, not modals.
- **File size**: each component under 400 lines
- **Save on interaction**: grid saves on each click, debounce if needed
- **Variation note**: `planned_exercises.variation_note`, italic display, short descriptor
- **Macro Hi format**: `85/2/2` = load/reps/sets at highest
- **Port carefully**: study existing drag/drop, position normalization, combo loading before rewriting
