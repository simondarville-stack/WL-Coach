# WinWota 2.0 Architecture

## Stack
React 18, TypeScript, Vite, Tailwind CSS, Supabase (PostgreSQL + Storage), Recharts, Zustand, React Router

## Directory structure
```
src/
  components/          — UI components
    planner/           — Weekly planner subsystem (WeeklyPlanner, DayCard, DayEditor, PrescriptionGrid, ExerciseDetail, Print*)
    training-log/      — Athlete training log (SessionView, SessionHistory, CoachSessionView)
    analysis/          — Analysis & charting (PivotBuilder, PlannedVsPerformed, QuickAnalyses + presets/)
    macro/             — Macro cycle planner (MacroCycles, MacroDraggableChart, MacroTable)
    calendar/          — Competition calendar (CompetitionCalendar, EventFormModal)
    ui/                — Shared UI primitives (Spinner)
  hooks/               — Data hooks (Supabase queries + local state)
  store/               — Zustand stores (selected athlete/coach, exercise cache)
  lib/                 — Utilities, types, constants
    database.types.ts  — All TypeScript interfaces + Database type for Supabase client
    prescriptionParser.ts — Parses/formats prescription strings (e.g. "80-90%x3x4")
    dateUtils.ts       — Date helpers (toLocalISO, addWeeks, getMondayOfWeek, formatters)
    weekUtils.ts       — Week calculation helpers (getMondayOfWeekISO, getCurrentAndNextWeekStart)
    calculations.ts    — Rep/tonnage/load calculations
    ownerContext.ts    — getOwnerId() — returns current coach's owner UUID for RLS filtering
```

## Data flow
```
[Component] → [Hook] → [Supabase] → [PostgreSQL]
                ↓
          [Zustand Store] (selectedAthlete, selectedCoach, exercises)
```

## Authentication model
Multi-coach: each coach has an `owner_id` (UUID from Supabase auth). All owned data
is RLS-filtered by `owner_id = auth.uid()`. `getOwnerId()` reads the active owner
from `coachStore` (supports coach-switching without re-login).

## Root tables (owner_id scoped)
`athletes`, `exercises`, `week_plans`, `macrocycles`, `events`, `training_groups`, `general_settings`

## Child tables (FK-scoped, no owner_id needed)
```
planned_exercises → planned_set_lines
macrocycles → macro_weeks → macro_phases
macrocycles → macro_tracked_exercises → macro_targets
training_log_sessions → training_log_exercises → training_log_sets
athletes → athlete_prs, bodyweight_entries
events → event_athletes, event_attempts, event_videos
training_groups → group_members
```

## Key patterns

**prescription_raw** — Human-readable string stored on `planned_exercises` (e.g. "80-90%x3x4").
Parsed into `planned_set_lines` (structured) on save. Summary fields (`summary_total_sets`,
`summary_total_reps`, `summary_highest_load`, `summary_avg_load`) are denormalized onto
`planned_exercises` for fast list rendering.

**Interval loads** — `planned_set_lines.load_max` stores the upper bound for interval
prescriptions (e.g. "80-90%" → load_value=80, load_max=90). NULL means fixed load.

**day_index** — Abstract slot number (0–6), not a calendar weekday. `day_schedule` on
`week_plans` optionally maps day_index → { weekday, time }.

**is_combo** — When true, `planned_exercises` is a combo exercise. Its members are in
`planned_exercise_combo_members`. Set lines and prescription parsing use the combo format.

**owner_id filtering** — Every Supabase query on owned tables calls `.eq('owner_id', getOwnerId())`.
System exercises (category = '— System') are filtered out in athlete-facing views.
