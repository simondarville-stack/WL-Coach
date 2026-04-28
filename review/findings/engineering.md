# Engineering Review — EMOS
_Reviewer: emos-engineering-reviewer · Date: 2026-04-19_

## Summary

| Severity | Count |
|----------|-------|
| Critical |  10   |
| Major    |   7   |
| Minor    |   6   |
| Info     |   4   |

---

## Findings

---

### [ENG-001] `supabase.from` directly in DayCard (presentational component)
**Severity:** Critical  
**File:** `src/components/planner/DayCard.tsx:188`, `:213`, `:241`  
**Issue:** `DayCard` is a presentational planner card component that owns three `supabase.from` calls: two `exercises.insert` calls (inside `getOrCreateSentinel` and `handleNewExerciseSave`) and one `planned_exercises.update` (inside `handleReorder`). This violates the API-first principle — DB mutations belong in a service hook such as `useWeekPlans`.  
**Recommendation:** Move `getOrCreateSentinel`, `handleNewExerciseSave`, and reorder position-update logic into `useWeekPlans` or `useExercises`. Expose them as callback props or hook returns, as is already done for `addExerciseToDay`.

---

### [ENG-002] `supabase.from` directly in DayEditor — verbatim duplication of DayCard logic
**Severity:** Critical  
**File:** `src/components/planner/DayEditor.tsx:200`, `:225`, `:242`  
**Issue:** `DayEditor` duplicates the exact same `getOrCreateSentinel` and `handleNewExerciseSave` DB logic as `DayCard` (verbatim copy confirmed by diff). Additionally it reorders via an inline sequential `await supabase.from('planned_exercises').update` loop. Two non-negotiable violations: direct DB access in a component, and the duplication violates single source of truth.  
**Recommendation:** Extract both sentinel creation and reorder mutation into `useWeekPlans`. Delete the duplicate implementations in both `DayCard` and `DayEditor`.

---

### [ENG-003] `supabase.from` in `ExerciseDetail` — 6 calls across 4 tables inside a component
**Severity:** Critical  
**File:** `src/components/planner/ExerciseDetail.tsx:142`, `:146`, `:149`, `:168`, `:224`, `:236`  
**Issue:** `ExerciseDetail` makes six separate `supabase.from` calls spanning four tables (`macro_tracked_exercises`, `macro_weeks`, `macro_targets`, `planned_exercises`) plus Supabase Storage. The Soll-target loading (`loadSollTarget`), combo-day fetching (`loadComboOtherDays` runs a sequential for-loop querying `planned_exercise_combo_members` per row — an N+1 query pattern), and field saves (`saveSettingsField`, `handleClose` flush) are full domain operations executed inside a presentational component. `useWeekPlans` already owns `planned_exercises` mutations; these bypass it entirely.  
**Recommendation:** Add `loadSollTarget(macroId, exerciseId, weekNumber)` to `useMacroCycles` and `savePlannedExerciseField(id, field, value)` to `useWeekPlans`. Move media upload to `useMediaUpload`. Pass results and callbacks as props.

---

### [ENG-004] `supabase.from` in `PRTrackingPanel` — bypasses existing hooks
**Severity:** Critical  
**File:** `src/components/planner/PRTrackingPanel.tsx:65-77`, `:152`, `:168`  
**Issue:** `PRTrackingPanel` owns its complete data fetch (`exercises`, `athlete_pr_history`) and both insert and delete mutations against `athlete_pr_history`. A `useAthletes` hook (with PR mutation operations) and a `useExercises` hook already exist in `src/hooks/`. These are bypassed entirely.  
**Recommendation:** Move all three Supabase interactions into `useAthletes` (for PR history CRUD) and `useExercises` (for exercise list). The panel should receive data and callbacks as props.

---

### [ENG-005] `supabase.from` in `BodyweightPopup` — full CRUD in a presentational component
**Severity:** Critical  
**File:** `src/components/BodyweightPopup.tsx:50`, `:105`, `:116`, `:124`  
**Issue:** `BodyweightPopup` handles full CRUD for `bodyweight_entries` (SELECT, UPSERT x2, DELETE) internally. `useAthletes` already exists; bodyweight CRUD logically belongs there or in a dedicated `useBodyweight` hook.  
**Recommendation:** Extract all four calls into a `useBodyweight(athleteId)` hook exposing `entries`, `upsert`, and `remove`. Pass results and callbacks as props to the popup.

---

### [ENG-006] `supabase.from` in `Athletes.tsx` — component-level mutation after hook call
**Severity:** Critical  
**File:** `src/components/Athletes.tsx:511`  
**Issue:** After calling the hook-provided `createAthlete`, `Athletes.tsx` directly executes `supabase.from('bodyweight_entries').upsert` for the initial bodyweight. This splits the athlete-creation side-effect across the component and the hook, making the operation non-atomic.  
**Recommendation:** Add an optional `initialBodyweight` parameter to `createAthlete` in `useAthletes` so the upsert is colocated and atomic within the hook.

---

### [ENG-007] `supabase.from` in `MacroAnnualWheel` — canvas component fetching its own data
**Severity:** Critical  
**File:** `src/components/macro/MacroAnnualWheel.tsx:210`, `:211`, `:237-258`  
**Issue:** The annual-wheel canvas component owns two `useEffect`-based data fetches: phases/competitions for all macrocycles (lines 210-211), and a three-step calendar-event join (`group_members -> event_athletes -> events`, lines 237-258). This is a pure visualisation component; it should receive all data as props.  
**Recommendation:** Move both fetches into `useMacroCycles` and `useEvents`. Pass `phases`, `competitions`, and `calendarEvents` as props to the wheel.

---

### [ENG-008] `supabase.from` in `MacroCycles.tsx` — bypasses existing hooks
**Severity:** Critical  
**File:** `src/components/macro/MacroCycles.tsx:149-154`, `:444-452`  
**Issue:** Two separate violations. (1) A `group_members` fetch runs in a `useEffect` directly in the component (line 149) despite `useTrainingGroups` hook existing. (2) An extend/trim operation on `macro_weeks` is executed inline inside `handleEditCycle` (lines 444-452) rather than through `useMacroCycles`.  
**Recommendation:** (1) Use `useTrainingGroups` to expose group member data. (2) Add `extendCycle` and `trimCycle` methods to `useMacroCycles`.

---

### [ENG-009] `supabase.from` in analysis preset components — same query duplicated 5 times
**Severity:** Critical  
**File:** `src/components/analysis/IntensityZones.tsx:39`, `src/components/analysis/LiftRatios.tsx:54`, `src/components/analysis/PivotBuilder.tsx:105`, `src/components/analysis/presets/CompetitionLiftTrends.tsx:22`, `src/components/analysis/presets/SquatToLiftTransfer.tsx:17`, `src/components/analysis/presets/BodyweightTrend.tsx:30`  
**Issue:** Five analysis/chart components independently issue `supabase.from('exercises').select('id, name').eq('owner_id', getOwnerId())` — the same query, verbatim, in five separate files. This violates single source of truth. `BodyweightTrend` additionally queries `supabase.from('athletes').select('weight_class')` for data already available at the call site. `useExercises` and `useAthletes` hooks exist and are bypassed.  
**Recommendation:** The parent `AnalysisPage` (or a `useAnalysisExercises` hook) should fetch exercises once and pass them as props. Pass `athlete.weight_class` as a prop to `BodyweightTrend` from the existing athlete object at the call site.

---

### [ENG-010] `@ts-nocheck` on all six athlete-side components — entire sub-app escapes TypeScript strict mode
**Severity:** Critical  
**File:** `src/athlete/components/LogSetModal.tsx:1`, `CycleScreen.tsx:1`, `ProfileScreen.tsx:1`, `ProgressScreen.tsx:1`, `TodayScreen.tsx:1`, `WeekScreen.tsx:1`  
**Issue:** All six athlete-facing components suppress the TypeScript compiler with `// @ts-nocheck`. The project enforces `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true` in `tsconfig.app.json` — all bypassed for the entire athlete app. Root cause: `LogSetModal.tsx` uses `as any` casts on every Supabase insert and return value, indicating the generated DB types are out of sync with the actual schema.  
**Recommendation:** Run `supabase gen types typescript` to regenerate `database.types.ts`. Remove `@ts-nocheck` one file at a time and fix the type errors revealed. Do not substitute `as any` for proper typing.

---

### [ENG-011] Hardcoded OWL lift-ratio targets in `useAnalysis.ts` — not coach-configurable
**Severity:** Major  
**File:** `src/hooks/useAnalysis.ts:550-555`  
**Issue:** Six ratio thresholds are hardcoded magic numbers: `addRatio('Snatch / C&J', snatch, cj, 80, 85)`, `addRatio('Snatch / Back squat', snatch, bsq, 65, 70)`, etc. While this is in a hook (not a component), hardcoded domain values violate coach-flexibility. Different federations and coaching philosophies use different benchmark ranges with no way to configure them without a code change.  
**Recommendation:** Move ratio targets into `general_settings` or a coach-configurable table. Pass them as parameters to `fetchLiftRatios`. Default values can remain as fallback constants.

---

### [ENG-012] Hardcoded OWL weight classes and intensity zone targets in analysis components
**Severity:** Major  
**File:** `src/components/analysis/presets/BodyweightTrend.tsx:9`, `src/components/analysis/IntensityZones.tsx:18-22`  
**Issue:** `const WEIGHT_CLASSES = [49, 55, 59, 64, 71, 76, 81, 87, 96, 102, 109]` is the 2018 IWF weight class schedule, hard-coded in a presentational component. The `OWL_TARGETS` object in `IntensityZones.tsx` defines three training-phase intensity distributions with fixed percentage breakdowns — hardcoded with no coach configurability.  
**Recommendation:** Weight classes should come from a federation config or the athlete's registered `weight_class`. `OWL_TARGETS` belongs in `general_settings` or a coach-configurable config table.

---

### [ENG-013] Exercise name-sniffing for competition lifts — fragile logic duplicated across 4 files
**Severity:** Major  
**File:** `src/components/analysis/presets/CompetitionLiftTrends.tsx:27-28`, `src/components/analysis/presets/SquatToLiftTransfer.tsx:20-22`, `src/components/analysis/LiftRatios.tsx:62`, `src/hooks/useAnalysis.ts:526-531`  
**Issue:** Competition lift detection uses case-insensitive substring matching on exercise names (`.includes('snatch')`, `.includes('clean') && .includes('jerk')`, `.includes('back squat')`) duplicated verbatim across four files. A coach naming their snatch "SN" or using a non-English language will silently break all ratio and trend analyses.  
**Recommendation:** Exercises already have `is_competition_lift: boolean`. Add a `lift_type` enum (`snatch | clean_and_jerk | front_squat | back_squat | snatch_pull | clean_pull | other`) to the `exercises` table. Query by `lift_type` instead of name substring. Expose `lift_type` in `ExerciseForm`.

---

### [ENG-014] `PlannerWeekOverview` — 913-line component with 8 direct Supabase calls and inline business logic
**Severity:** Major  
**File:** `src/components/planner/PlannerWeekOverview.tsx`  
**Issue:** At 913 lines, this component contains a 6-phase sequential data loading function that directly queries `week_plans`, `planned_exercises`, `training_log_sessions`, `macrocycles`, `macro_phases`, `macro_weeks`, `general_settings`, plus a delegated `fetchMacroPhaseBarEvents`. It manages 15+ state variables and encodes business logic (macro-week target mapping, compliance calculation, phase-block construction) entirely within the component body. **Flagged as rewrite candidate.**  
**Recommendation:** Extract data loading into a dedicated `usePlannerWeekOverview(targetId, targetGroupId, rangeStart, rangeEnd)` hook. Move phase-block construction into `src/lib/macroPhaseBarData.ts` where related logic already lives.

---

### [ENG-015] `MacroCycles.tsx` — 983-line god component with 9 `useEffect` hooks
**Severity:** Major  
**File:** `src/components/macro/MacroCycles.tsx`  
**Issue:** 983 lines, 9 `useEffect` calls, `useMacroCycles` hook consumption mixed with direct `supabase.from` calls (see ENG-008), group member management, cycle CRUD, phase/competition management, Excel export, and chart rendering all in one component. The TODO comments at lines 1-2 acknowledge the problem. **Flagged as rewrite candidate.**  
**Recommendation:** Split into: `MacroCycleSelector` (cycle list + create/edit), `MacroCycleDetail` (week table + phase editor), `MacroCycleCharts` (graph/distribution views). Move group member fetch to `useTrainingGroups`.

---

### [ENG-016] `ExerciseLibrary.tsx` — 1,230-line component with compound inline DB mutations
**Severity:** Major  
**File:** `src/components/exercise-library/ExerciseLibrary.tsx:881-899`  
**Issue:** At 1,230 lines, the largest file in the codebase. The category delete handler (lines 881-899) runs three sequential DB operations (`categories.insert` -> `exercises.update` -> `categories.delete`) that should be atomic and belong in `useExercises.deleteCategory`. Also uses `as any` casts on both the insert result and the update payload. **Flagged as rewrite candidate.**  
**Recommendation:** Move the "reassign-then-delete" category logic into `useExercises.deleteCategory`. Split the component into `ExerciseListPanel`, `ExerciseCategoryNav`, and the existing `ExerciseDetailPanel`.

---

### [ENG-017] `CoachProfileModal` — direct settings insert with hardcoded defaults bypasses `useSettings`
**Severity:** Major  
**File:** `src/components/CoachProfileModal.tsx:35-41`  
**Issue:** After `createCoach()`, the modal directly inserts a `general_settings` row with five hardcoded default values (`raw_enabled: true`, `raw_average_days: 7`, `grid_load_increment: 5`, `grid_click_increment: 1`). The `useSettings` hook exists for settings management. These defaults are a second source of truth; any future change requires edits in multiple places.  
**Recommendation:** Move default-settings creation into `createCoach` within `useCoachProfiles`, or expose a `createDefaultSettings(ownerId)` function from `useSettings`.

---

### [ENG-018] `useEffect` missing dependency declarations — stale closure risk in `ExerciseDetail`
**Severity:** Minor  
**File:** `src/components/planner/ExerciseDetail.tsx:134-138`  
**Issue:** The `useEffect` at line 134 calls `loadSollTarget`, `loadOtherDays`, and `loadComboOtherDays` without listing them in the dep array (only `macroContext?.macroId` and `plannedExercise?.id` are listed). These functions close over `macroContext`, `plannedExercise`, `members`, and `settings`. React Hooks ESLint rules would flag missing dependencies. A stale closure can cause fetches to run against outdated prop values.  
**Recommendation:** Wrap the loaders with `useCallback` including all deps, or inline them directly in the effect.

---

### [ENG-019] Async `useEffect` fetches without cleanup — unmounted component state-update risk
**Severity:** Minor  
**File:** `src/components/planner/ExerciseDetail.tsx:134-138`, `src/components/macro/MacroAnnualWheel.tsx:231-262`, `src/components/planner/PRTrackingPanel.tsx:90`  
**Issue:** Multiple `useEffect` hooks fire async functions with no cancellation mechanism. If a component unmounts while a fetch is in flight, state setters execute on an unmounted component, producing React warnings and potential memory leaks.  
**Recommendation:** Use an `AbortController` or an `isMounted` ref guard inside async loaders. With Supabase: create an `AbortController`, pass its `signal` to the query via `.abortSignal()`, and call `abort()` in the cleanup function.

---

### [ENG-020] `ExerciseDetailPanel` — `as any` casts on typed Supabase query results
**Severity:** Minor  
**File:** `src/components/exercise-library/ExerciseDetailPanel.tsx:381`, `:382`, `:402`  
**Issue:** `.filter((r: any) =>`, `.map((r: any) =>`, and `as any[]` are applied to results of queries whose return types are defined in `database.types.ts`. TypeScript strict mode is enforced project-wide; these spot-casts defeat it locally.  
**Recommendation:** Type the query results explicitly using `Tables<'athlete_prs'>` and `Tables<'planned_exercises'>` from `database.types.ts`.

---

### [ENG-021] `useCoachDashboardV2` — `as any` for Supabase join return shapes
**Severity:** Minor  
**File:** `src/hooks/useCoachDashboardV2.ts:182`, `:193`, `:322`  
**Issue:** Three `as any` casts in a hook: `mw.map((w: any) =>`, `phases.find((p: any) =>`, and `((ev as any).event_athletes || []).map(...)`. These arise because Supabase PostgREST join results are not automatically narrowed. This is a `.ts` file with no `@ts-nocheck` cover, so these are real violations in strict mode.  
**Recommendation:** Define typed interfaces for join result shapes (e.g. `MacroWithJoins`, `EventWithAthletes`) or use Supabase's `QueryResult<typeof query>` pattern to narrow returned join types.

---

### [ENG-022] Chart callback `any` parameters in `MacroDistributionChart` and `MacroDraggableChart`
**Severity:** Minor  
**File:** `src/components/macro/MacroDistributionChart.tsx:176`, `:260`, `src/components/macro/MacroDraggableChart.tsx:263`  
**Issue:** Chart.js tooltip callbacks use `(c: any)` and Recharts custom shape factories use `(props: any)`. Both libraries export proper generic types (`TooltipItem<'bar'>` from `chart.js`; typed bar props from `recharts`).  
**Recommendation:** Import `TooltipItem` from `chart.js` and the appropriate Recharts shape type to replace the `any` parameters.

---

### [ENG-023] Untracked lock file and stray design docs in repo root
**Severity:** Info  
**File:** git status (untracked)  
**Issue:** The working tree contains 11+ untracked `.md` files (e.g. `EMOS_ANNUAL_WHEEL_WIRE.md`, `EMOS_MACRO_REDESIGN.md`) accumulating at the repo root alongside `smolov_base_template.xlsx` and its Office lock file `~$smolov_base_template.xlsx`. Lock files should never be committed.  
**Recommendation:** Add `~$*` to `.gitignore`. Move design/prompt `.md` files to a `docs/emos/` directory to keep the repo root clean.

---

### [ENG-024] Git history — Conventional Commits compliance is strong, one scope omission
**Severity:** Info  
**File:** git history (last 20 commits)  
**Issue:** All 20 commits follow `type(scope): description` with lower-case subjects correctly. One observation: `chore: add EMOS prompt docs and scripts to repo` lacks a scope where other commits use scopes (e.g. `chore(docs):`). Not a violation, an observation.  
**Recommendation:** Consider adding `commitlint` as a pre-commit hook to enforce compliance as the team grows.

---

### [ENG-025] `zustand` installed but adoption is partial — redundant fetches likely
**Severity:** Info  
**File:** `package.json`, `src/store/`  
**Issue:** Four Zustand store files exist (`athleteStore.ts`, `coachStore.ts`, `exerciseStore.ts`, `weekStore.ts`), but the majority of data-fetching still uses independent `useXxx` hook instances with no global caching. The `exercises` list is fetched independently by at least five components (see ENG-009), each mounting its own Supabase query with no deduplication.  
**Recommendation:** Per the architecture plan (Phase 2), prioritise migrating the exercise list and athlete list to global store slices. This will also resolve the single-source-of-truth violations in ENG-009.

---

### [ENG-026] `DayCard` / `DayEditor` — three helper functions duplicated verbatim
**Severity:** Info  
**File:** `src/components/planner/DayCard.tsx:47-58`, `:177-193`; `src/components/planner/DayEditor.tsx:54-65`, `:189-205`  
**Issue:** `getSentinelType`, `getYouTubeThumbnail`, and `getOrCreateSentinel` are copied verbatim between `DayCard` and `DayEditor` (confirmed by diff). A bug fix in one will not propagate to the other.  
**Recommendation:** Extract pure helpers into `src/components/planner/plannerUtils.ts` and import from both components. Once `getOrCreateSentinel` is moved to a hook (ENG-001/002), it will be removed from both components entirely.

---

## Rewrite Candidates

The following components have a high debris-to-logic ratio or have grown beyond a maintainable size. Refactoring them into smaller, single-responsibility components backed by proper hooks should be treated as tech-debt tasks before further feature work compounds the problem.

| Component | Lines | Primary Issues |
|---|---|---|
| `src/components/planner/PlannerWeekOverview.tsx` | 913 | 8+ direct Supabase calls, 15+ state vars, all business logic inlined |
| `src/components/macro/MacroCycles.tsx` | 983 | 9 useEffects, direct Supabase calls, mixed view/data/chart concerns |
| `src/components/exercise-library/ExerciseLibrary.tsx` | 1230 | Largest file; compound mutations inlined; acknowledged by TODO comments |
| `src/components/macro/MacroAnnualWheel.tsx` | 847 | Canvas rendering + multi-table data fetching + event resolution in one file |
