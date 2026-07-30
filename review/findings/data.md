# Data Review — EMOS
_Reviewer: emos-data-reviewer · Date: 2026-04-19_

## Summary
| Severity | Count |
|----------|-------|
| Critical |   3   |
| Major    |   8   |
| Minor    |   6   |
| Info     |   5   |

---

## Findings

### [DAT-001] `training_log_sessions` queried with `.eq('owner_id', ownerId)` but the column does not exist
**Severity:** Critical
**File:** `src/hooks/useCoachDashboardV2.ts:117`
**Issue:** `useCoachDashboardV2.loadDashboard` calls:
```ts
supabase.from('training_log_sessions')
  .select('...')
  .eq('owner_id', ownerId)
  .in('athlete_id', athleteIds)
```
`training_log_sessions` has no `owner_id` column — confirmed by `database.types.ts` (`TrainingLogSession` has no `owner_id` field) and no migration ever adds one. Supabase's JS client silently ignores an `.eq()` filter on a non-existent column, meaning the `owner_id` predicate is a no-op. Under a single-coach setup this is hidden, but it becomes a cross-coach data leak the moment a second coach is added. All `recentSessions` on the dashboard and all `attention` items computed from them would include other coaches' athletes' sessions.
**Recommendation:** Add `owner_id` to `training_log_sessions` (via migration, backfill, FK → `coach_profiles`, index) identically to the pattern used for `athletes` in `20260406_multi_coach_phase1.sql`. Filter via `.eq('owner_id', ownerId)` and update `TrainingLogSession` in `database.types.ts`.

---

### [DAT-002] Sentinel exercises INSERTed in components without `owner_id`
**Severity:** Critical
**File:** `src/components/planner/DayCard.tsx:188`, `src/components/planner/DayEditor.tsx:200`
**Issue:** Both `DayCard` and `DayEditor` create "sentinel" system exercises (VIDEO, IMAGE, REST, …) via a bare `supabase.from('exercises').insert({...})` with no `owner_id` field. Because `exercises.owner_id` is `NOT NULL` with a default of `'00000000-0000-0000-0000-000000000001'` the row is created but always assigned to the default coach, regardless of who is active. A non-default coach using these slash-commands will silently create exercises owned by the wrong coach and they will not appear in that coach's exercise list (`fetchExercises` filters by `getOwnerId()`).

Additionally, `DayCard.tsx:213` and `DayEditor.tsx:225` insert user-created exercises via `supabase.from('exercises').insert([exerciseData])` — the `exerciseData` comes from a form but the component does not merge `owner_id: getOwnerId()` before inserting. Same silent wrong-owner assignment.
**Recommendation:** Merge `owner_id: getOwnerId()` into every sentinel and quick-create exercise insert in both `DayCard` and `DayEditor`. Move sentinel creation into `useExercises.createExercise` (which already adds `owner_id`) so the hook is the single insertion path.

---

### [DAT-003] `macro_phases` and `macro_competitions` have no `owner_id` — no multi-tenancy isolation
**Severity:** Critical
**File:** `supabase/migrations/20260401000000_rebuild_macro_planning.sql`, `src/hooks/useMacroCycles.ts`
**Issue:** `macro_phases` and `macro_competitions` were created in the rebuild migration without an `owner_id` column, and no subsequent migration adds one. `MacroPhase` and `MacroCompetition` in `database.types.ts` confirm neither has `owner_id`. All phase/competition reads and writes in `useMacroCycles` (`fetchPhases`, `createPhase`, `updatePhase`, `deletePhase`, `fetchCompetitions`, etc.) operate purely on `macrocycle_id`, with no owner gate. While `macrocycles` itself is owner-scoped, the child tables are accessible to any code that knows a `macrocycle_id`, and the permissive RLS policies (`USING (true)`) on these tables mean any Supabase client can read or mutate any coach's phases and competitions.
**Recommendation:** Add `owner_id uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE` to both `macro_phases` and `macro_competitions`, backfill via join on `macrocycles.owner_id`, create indexes, and tighten RLS policies to `USING (owner_id = <session claim>)` or application-level enforcement via `getOwnerId()` filters.

---

### [DAT-004] `group_members` fetched without any owner scope in `useCoachDashboardV2`
**Severity:** Major
**File:** `src/hooks/useCoachDashboardV2.ts:89`
**Issue:**
```ts
supabase.from('group_members').select('group_id, athlete_id').is('left_at', null)
```
No `owner_id` filter and no `group_id` filter. `group_members` has no `owner_id` column, so this fetches every active group membership in the entire database. The result is then correlated against groups already scoped to `getOwnerId()`, which provides downstream mitigation, but the query itself reads cross-coach data unnecessarily and will produce incorrect athlete→group mappings in a multi-coach system if group IDs collide or are predictable.
**Recommendation:** Filter by group IDs already fetched for this coach: `.in('group_id', groups.map(g => g.id))` before the `.is('left_at', null)` filter. This is safe and requires no schema change.

---

### [DAT-005] N+1 query pattern in `useEvents.fetchEvents`, `fetchUpcomingEvents`, `fetchEventsByMonth`, `fetchEventsByDateRange`, and `fetchEventOverview`
**Severity:** Major
**File:** `src/hooks/useEvents.ts:26–97`, `src/hooks/useEvents.ts:195–229`
**Issue:** `fetchEvents` loops over every event and fires two Supabase queries per event (one for `event_athletes`, one for `athletes`). With N events this costs 2N+1 round trips. The same pattern is repeated identically in `fetchUpcomingEvents`, `fetchEventsByMonth`, and `fetchEventsByDateRange`. `fetchEventOverview` additionally fires one query per athlete inside a `Promise.all` (N athlete × 2 queries for attempts + videos).

For a typical 20-event calendar, `fetchEvents` sends 41 database round trips when it could send 3 (events, event_athletes, athletes with `.in()`).
**Recommendation:** Batch with Supabase's join syntax or multi-step fan-out: fetch all events → fetch all `event_athletes` where `event_id IN (...)` → fetch all athletes where `id IN (...)`. Reassemble in JS. For `fetchEventOverview`, use `Promise.all` keyed on a single `.in('event_id', [eventId])` on `event_attempts` and `event_videos`.

---

### [DAT-006] N+1 position-update loops in `reorderExercises`, `normalizePositions`, `normalizeSetLinePositions`, and `bulkReorderCategories`
**Severity:** Major
**File:** `src/hooks/useWeekPlans.ts:240–282`, `src/hooks/useWeekPlans.ts:314–320`, `src/hooks/useExercises.ts:215–222`
**Issue:** Position reordering loops fire one UPDATE per item:
```ts
// useWeekPlans.ts:240
for (let i = 0; i < orderedIds.length; i++) {
  await supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', orderedIds[i]);
}
```
A day with 8 exercises triggers 8 sequential UPDATE calls. `normalizePositions` runs on each side of a drag (called twice per move). `bulkReorderCategories` does the same. These are sequential (`await` inside loop), so they also block the UI for the full serial round-trip time.
**Recommendation:** Use `Promise.all` for parallelism as an immediate fix. Longer term, consider a Postgres function (`unnest` + `UPDATE FROM`) or batch-upsert to reduce to a single round trip.

---

### [DAT-007] `syncGroupPlanToAthletes` contains a deep sequential N+1 loop: one full write chain per athlete member
**Severity:** Major
**File:** `src/hooks/useWeekPlans.ts:762–904`
**Issue:** The sync function processes each group member in a `for...of` loop. For each member it:
1. Reads the athlete's existing week plan
2. Optionally inserts a new week plan
3. Reads active days metadata
4. Bulk-deletes group-sourced exercises
5. Reads individual overrides
6. For each group exercise, inserts a new exercise + set lines in a nested loop

For a group of 10 athletes with 20 planned exercises each, this is on the order of 100–200 sequential queries. There is also a nested loop for set-line insertion (`for (const ex of groupExercises)` → `supabase.from('planned_set_lines').insert(...)`) which fires one INSERT per exercise rather than batching all set lines.
**Recommendation:** Batch the set-line inserts per athlete (collect all new lines, then one `insert(allLines)`). Parallelize athlete processing where possible using `Promise.all` on read-only preflight queries. Consider a Postgres function for the full sync to reduce round trips to O(1).

---

### [DAT-008] `fetchWeeklyAggregates` queries `macro_weeks` and `macro_phases` without any owner filter
**Severity:** Major
**File:** `src/lib/analysisInsights.ts` (imports from `src/hooks/useAnalysis.ts`), `src/hooks/useAnalysis.ts:175–181`
**Issue:**
```ts
supabase.from('macro_weeks').select('...').gte('week_start', startDate).lte('week_start', endDate)
supabase.from('macro_phases').select('id, name, color, macrocycle_id')
```
Neither query filters by owner. The macro_weeks result is then joined to week_plans (which are owner-scoped), but the unfiltered fetch may return weeks from other coaches' macrocycles, potentially matching on `week_start` and `phase_id` and polluting weekly aggregates with wrong phase metadata. In a multi-coach environment this silently corrupts analysis data.
**Recommendation:** Add `.eq('owner_id', getOwnerId())` via a join: filter `macro_weeks` by `macrocycle_id IN (SELECT id FROM macrocycles WHERE owner_id = ?)`, or restructure the query to only load macro weeks belonging to macrocycles that are already scoped to the coach.

---

### [DAT-009] `ExerciseLibrary.handleCatDelete` reads and mutates exercises without `owner_id` filter
**Severity:** Major
**File:** `src/components/exercise-library/ExerciseLibrary.tsx:876–899`
**Issue:**
```ts
const { data: allAffected } = await supabase
  .from('exercises')
  .select('id')
  .eq('category', cat.name as any);  // no owner_id filter

await supabase.from('exercises')
  .update({ category: 'Unspecified' } as any)
  .in('id', allAffected.map((e: any) => e.id));  // updates ALL coaches' exercises
```
`cat.name` is a string category value, not a category ID. Any exercise across all coaches with a matching category name will be reassigned to 'Unspecified'. This is a cross-coach destructive mutation.
**Recommendation:** Add `.eq('owner_id', getOwnerId())` to the exercises query. Also, the `as any` cast on `cat.name` indicates that `category` is typed as a plain `string` in `Exercise`, and the generated types should be used rather than bypassed.

---

### [DAT-010] `useTrainingLog.fetchWeekData` reads `week_plans` without `owner_id` filter
**Severity:** Major
**File:** `src/hooks/useTrainingLog.ts:27–31`
**Issue:**
```ts
supabase.from('week_plans').select('*')
  .eq('athlete_id', athleteId)
  .eq('week_start', weekStartISO)
  .maybeSingle();
```
No `.eq('owner_id', getOwnerId())` filter. In a multi-coach setup, if two coaches share an athlete (possible via `athlete_id` if the athlete profile is accidentally duplicated or cross-references), this would return the wrong coach's plan. More practically, the read opens the door to returning a week plan belonging to a different owner if `athlete_id` values are known.
**Recommendation:** Add `.eq('owner_id', getOwnerId())` consistently. The training log is an athlete-facing view, so owner scoping is critical.

---

### [DAT-011] `MacroCycle` schema missing `owner_id` in `database.types.ts` but it exists in the DB
**Severity:** Minor
**File:** `src/lib/database.types.ts:185–194`
**Issue:** `MacroCycle` interface does not declare `owner_id`:
```ts
export interface MacroCycle {
  id: string;
  athlete_id: string | null;
  group_id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}
```
The `owner_id` column was added to the `macrocycles` DB table by `20260406_multi_coach_phase1.sql`, but the TypeScript type was never updated. `useMacroCycles.fetchMacrocycles` queries with `.eq('owner_id', getOwnerId())` — this query works at runtime but produces a TypeScript type error if type-checking is strict, and the returned data cannot be typed correctly (callers cannot access `.owner_id` on a `MacroCycle` safely).
**Recommendation:** Add `owner_id: string;` to `MacroCycle` and to the `Database['public']['Tables']['macrocycles']` section.

---

### [DAT-012] `BodyweightEntry` has no `owner_id` — isolation is by `athlete_id` only
**Severity:** Minor
**File:** `src/lib/database.types.ts:42–48`
**Issue:** `BodyweightEntry` has no `owner_id`. Access control relies entirely on knowing a valid `athlete_id`. The `Athletes.tsx:511` component inserts bodyweight entries without any coach-ownership token:
```ts
supabase.from('bodyweight_entries').upsert({
  athlete_id: newAthlete.id,
  date: ...,
  weight_kg: data.bodyweight,
});
```
`BodyweightPopup.tsx` deletes by `id` only (no owner check). If an `athlete_id` is guessable or exposed, any client can read/modify body weight history with no further gate. Additionally, `useCoachDashboardV2` queries `bodyweight_entries` filtered only by `athleteIds` (which are already owner-scoped athletes), providing runtime mitigation, but the table itself has no RLS-level owner constraint.
**Recommendation:** Consider adding `owner_id` to `bodyweight_entries` for defense in depth, or ensure RLS policies restrict access by joining through `athletes.owner_id`. Document the intended isolation model.

---

### [DAT-013] `AthletePR` / `AthletePRHistory` inserts in `useAthletes` and `useTrainingLog` lack `owner_id`
**Severity:** Minor
**File:** `src/hooks/useAthletes.ts:128`, `src/hooks/useTrainingLog.ts:501–517`
**Issue:** Neither `AthletePR` nor `AthletePRHistory` carry `owner_id`. Isolation is by `athlete_id`. `useTrainingLog.checkAndRecordPR` queries `athlete_prs` with only `.eq('athlete_id', athleteId)` — no owner scope. Given that athlete PRs are keyed to athletes (which are owner-scoped), the runtime exposure is limited but a cross-coach access gap exists at the table level.
**Recommendation:** Same as DAT-012: document the isolation model or add `owner_id` with consistent indexing.

---

### [DAT-014] `ExerciseComboTemplate` has no `owner_id` — templates are globally shared across all coaches
**Severity:** Minor
**File:** `src/lib/database.types.ts:409–416`
**Issue:** `ExerciseComboTemplate` (and `ExerciseComboTemplatePart`) have no `owner_id`. This means combo templates are effectively global. When a coach creates a template, it is visible to all coaches. No query in the codebase filters templates by owner.
**Recommendation:** Decide whether templates are intentionally global. If per-coach, add `owner_id`. If shared, document the intent and ensure `deleteCategory`/`deleteExercise` flows cannot corrupt shared templates.

---

### [DAT-015] Migration naming convention broken after 2026-04-03 — no HHMMSS suffix
**Severity:** Minor
**File:** `supabase/migrations/20260403_calendar_rebuild.sql` … `20260409_macro_week_targets.sql`
**Issue:** Supabase's migration runner orders files lexicographically. The first 46 migrations use `YYYYMMDDHHMMSS_` (14-digit timestamp prefix), but from `20260403_calendar_rebuild.sql` onward, 17 migrations use only `YYYYMMDD_` (8-digit). This still sorts correctly today, but two migrations on the same calendar day are ambiguous (`20260403_calendar_rebuild.sql` and `20260403_training_log_v2.sql` have no time ordering). One file has a space in the name: `20260330100000 add video image exercises.sql` — a space rather than underscore — which can break shell scripts and some CI runners.
**Recommendation:** Adopt a consistent `YYYYMMDDHHMMSS_` format for all new migrations. Rename `20260330100000 add video image exercises.sql` to `20260330100000_add_video_image_exercises.sql`.

---

### [DAT-016] `Exercise.category` is a plain `string` — no foreign key to the `categories` table
**Severity:** Minor
**File:** `src/lib/database.types.ts:12`, `src/lib/database.types.ts:77`
**Issue:** `Category` is typed as `type Category = string`. The `exercises` table stores category as a free-text name string. There is a `categories` table (used by `useExercises.fetchCategories`) but `exercises.category` is not a FK to it — it stores the category *name*, not its *id*. This means:
- Renaming a category does not cascade to exercises (exercises retain the old string name).
- Deleting a category requires a manual exercise-category re-assignment (currently done in `handleCatDelete` with bulk updates, but with a cross-owner bug as noted in DAT-009).
- Exercises can hold arbitrary category strings that reference no existing category, causing "unknown category" display bugs.
**Recommendation:** Migrate `exercises.category` to `exercises.category_id uuid REFERENCES categories(id)`. Until then, document the invariant clearly and ensure all category mutation paths also update exercises consistently.

---

### [DAT-017] `useCoachDashboardV2` selects non-existent columns `total_reps`, `total_sets`, `highest_load`, `avg_load` from `planned_exercises`
**Severity:** Info
**File:** `src/hooks/useCoachDashboardV2.ts:129`
**Issue:**
```ts
supabase.from('planned_exercises')
  .select('weekplan_id, total_reps, total_sets, highest_load, avg_load')
```
The `PlannedExercise` interface in `database.types.ts` names these `summary_total_sets`, `summary_total_reps`, `summary_highest_load`, `summary_avg_load`. The columns selected (`total_reps`, `total_sets`, etc.) do not exist — Supabase returns `null` for missing columns in `select`, so the dashboard silently shows 0 reps / 0 tonnage for all athletes' current-week progress. This is a silent data display failure, not a data-loss risk.
**Recommendation:** Fix the column names to `summary_total_reps`, `summary_total_sets`, `summary_highest_load`, `summary_avg_load`.

---

### [DAT-018] `fetchMacroTargetForExercise` chains 5 sequential `.maybeSingle()` queries (waterfall)
**Severity:** Info
**File:** `src/hooks/useMacroCycles.ts:398–448`
**Issue:** The function issues 5 sequential Supabase calls: `week_plans` → `macrocycles` → `macro_weeks` → `macro_tracked_exercises` → `macro_targets`. Each awaits the previous before issuing the next. This is a data-waterfall; total latency is 5 × round-trip time. It is called from `ExerciseDetail.tsx:loadSollTarget` on every exercise detail panel open.
**Recommendation:** Denormalize the lookup using a Postgres view or RPC that performs the 5-way join in a single query. Alternatively, pass the already-loaded macro context down as props (macro week ID and tracked exercise IDs are already available in the planner context).

---

### [DAT-019] `fetchMacroValidationData` uses a complex cross-table filter that may return stale data
**Severity:** Info
**File:** `src/hooks/useMacroCycles.ts:460–507`
**Issue:** The query:
```ts
supabase.from('macro_weeks')
  .select(`id, macrocycle_id, week_start, macrocycles!inner(athlete_id, start_date, end_date)`)
  .eq('macrocycles.athlete_id', athleteId)
```
Uses a PostgREST embedded filter on a joined table. PostgREST applies this as a `WHERE` on the join, not an inner filter, so the semantics depend on the PostgREST version. Additionally, there is no `owner_id` scope on the `macrocycles` join, so macro weeks from other coaches' macrocycles may match if `athlete_id` values are shared.
**Recommendation:** Add `.eq('macrocycles.owner_id', getOwnerId())` to the embedded filter, or restructure to fetch the macrocycle ID first and then query `macro_weeks` by `macrocycle_id`.

---

### [DAT-020] `as any` casts on Supabase results bypass generated types in `athlete/` and `hooks/`
**Severity:** Info
**File:** `src/athlete/components/LogSetModal.tsx:136,141,162,167,182,198`, `src/hooks/useCoachDashboardV2.ts:180,191–195`, `src/components/exercise-library/ExerciseLibrary.tsx:775,842,879,890,895`
**Issue:** Multiple files cast Supabase query results as `as any` to work around type mismatches. `LogSetModal.tsx` is annotated `// @ts-nocheck`, disabling all type checking for the entire file. `useCoachDashboardV2.ts` casts embedded relation results (`macro_weeks`, `macro_phases`) as `any` because the select string `'*, macro_weeks(*), macro_phases(*)'` returns a runtime structure that is not reflected in the static `MacroCycle` type. `ExerciseLibrary.tsx` casts `is_archived: true` as `any` to work around the `updateExercise` parameter type.

These bypasses mean that if Supabase column names change (e.g., DAT-017's wrong column names would not be caught at compile time), the failures are invisible until runtime.
**Recommendation:** Fix the underlying type mismatches rather than casting:
- Add `owner_id` and embedded relation types to `MacroCycle` (extends `MacroCycle` with `{ macro_weeks: MacroWeek[]; macro_phases: MacroPhase[] }` for the dashboard query result).
- Fix `updateExercise` parameter type to accept `is_archived`.
- Remove `// @ts-nocheck` from `LogSetModal.tsx` and add proper types.

---

### [DAT-021] `categories` table is not in `database.types.ts` at all
**Severity:** Info
**File:** `src/lib/database.types.ts`, `src/hooks/useExercises.ts:7–13`
**Issue:** The `categories` table exists in the database (created by `20260212135324_create_categories_table.sql`) and is actively used by `useExercises`, but it is entirely absent from `database.types.ts` — no `Category` row interface and no `Database['public']['Tables']['categories']` entry. The `Category` type in `useExercises.ts` is declared locally in the hook rather than imported from the central types file:
```ts
// useExercises.ts
export interface Category {
  id: string;
  name: string;
  display_order: number;
  color: string;
  created_at: string;
}
```
This means `supabase.from('categories')` calls are completely untyped — Supabase returns `any[]` and all column names are unvalidated.
**Recommendation:** Add `categories` to `database.types.ts` with a proper `Category` row interface and `Database['public']['Tables']['categories']` section. Remove the local re-declaration from `useExercises.ts`.
