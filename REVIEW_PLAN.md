# REVIEW_PLAN.md
**Branch:** `feature/review/2026-04-19`

---

## 1. Executive Summary

The EMOS codebase has a well-conceived architecture — the hook/service-layer pattern is established, the week-type token system is correctly designed, and recent commits show consistent discipline around Conventional Commits and component extraction. However, the API-first principle is systematically violated: direct `supabase.from` calls exist in at least 10 presentational components, and in several cases those component-level queries also contain owner-scoping bugs that create cross-coach data exposure in any multi-coach deployment. The EMOS design-system token layer exists and is correct in `tokens.css`, but the majority of legacy and coach-shell components still use raw Tailwind gray utilities, hardcoded hex values, sub-11px text, and `box-shadow` — the three most-used screens (Athletes, MacroCycles, ExerciseDetail) are all violating the system simultaneously.

**Total finding counts across all four reviewers:**

| Severity | UX | ENG | DOM | DAT | Total |
|----------|----|-----|-----|-----|-------|
| Critical |  2 |  10 |   5 |   3 |  **20** |
| Major    | 14 |   7 |   6 |   8 |  **35** |
| Minor    | 12 |   6 |   5 |   6 |  **29** |
| Info     |  5 |   4 |   4 |   5 |  **18** |
| **Total**| **33** | **27** | **20** | **22** | **102** |

**Three most urgent cross-cutting issues:**

1. **Direct `supabase.from` in presentational components + missing `owner_id` on inserts** (ENG-001/002/003/004/005/006/007/008, DAT-002): Components write to the DB without owner attribution, silently creating data owned by the wrong coach. The fix for the API-first violations and the fix for the missing `owner_id` are the same operation and must happen together.

2. **`training_log_sessions`, `macro_phases`, and `macro_competitions` lack `owner_id` — live cross-coach data leak** (DAT-001, DAT-003): In a multi-coach deployment the dashboard and macro phase data is completely unscoped, leaking sessions and phases across coaches. These are schema-level gaps that require migrations and are blocking multi-tenancy correctness today.

3. **`MacroTableV2` completely bypasses the coach-configured week-type system** (DOM-001): The macro table — the primary coach workflow screen — uses a hardcoded private `WEEK_TYPES` array and `WEEK_TYPE_COLORS` map instead of the `WeekTypeConfig[]` DB-driven system that the rest of the codebase uses correctly. Any coach-defined week types are invisible in the largest planning view.

---

## 2. Cross-Perspective Tensions

#### TENSION-1: API-first extraction vs. missing `owner_id` on sentinel inserts — which fix goes first?
**Findings involved:** ENG-001, ENG-002, DAT-002
**The conflict:** ENG-001/002 say to move `getOrCreateSentinel` and `handleNewExerciseSave` out of `DayCard`/`DayEditor` and into `useWeekPlans` / `useExercises`. DAT-002 says those same component-level inserts are missing `owner_id: getOwnerId()`, creating exercises owned by the wrong coach. If the extraction happens first but `owner_id` is not added to the hook, the bug migrates into the hook. If `owner_id` is patched in the component first and then extracted later, there is a transient correct state followed by a rewrite.
**Recommended resolution:** Fix both atomically in a single task. When extracting `getOrCreateSentinel` into `useExercises.createExercise` (which already adds `owner_id`), the bug is automatically resolved — do not patch the component inline first. Sequence: extraction task includes the `owner_id` fix; no separate patch step.

---

#### TENSION-2: `ExerciseLibrary.tsx` is a rewrite candidate AND has a live cross-coach destructive-mutation bug — does the rewrite absorb the bug fix?
**Findings involved:** ENG-016, DAT-009
**The conflict:** ENG-016 flags `ExerciseLibrary.tsx` (1,230 lines) as a rewrite candidate. DAT-009 identifies that `handleCatDelete` (lines 876–899) runs a category-rename `UPDATE` across all coaches' exercises because it lacks an `owner_id` filter — a live destructive cross-coach mutation. A full rewrite is Phase 2 work (consolidation). But the destructive mutation bug is a Phase 0 blocker.
**Recommended resolution:** Apply a targeted surgical fix to `handleCatDelete` immediately (add `.eq('owner_id', getOwnerId())` to both the SELECT and the UPDATE, remove the `as any` casts) without waiting for the rewrite. Then proceed with the full component rewrite in Phase 2. The surgical fix is at most 10 lines and does not conflict with the later rewrite.

---

#### TENSION-3: Analysis components have critical API-first violations but Analysis is out of scope for UI
**Findings involved:** ENG-009, ENG-011, ENG-012, ENG-013, DOM-005, DOM-009, DOM-010, DOM-011, DAT-008
**The conflict:** ENG-009 (critical) flags five analysis components independently querying exercises — the same verbatim query. ENG-011/012 flag hardcoded OWL ratio targets and weight classes in `useAnalysis.ts` and `BodyweightTrend.tsx`. DAT-008 flags unscoped `macro_weeks`/`macro_phases` reads in `useAnalysis.ts`. CLAUDE.md says Analysis module is out of scope — "hide UI only, keep code." The API-first violations in ENG-009 are architectural problems in code that will remain in the repo. The data-scoping gap in DAT-008 can corrupt analysis data cross-coach even in a hidden module if any internal call path reaches it.
**Recommended resolution:** The UI hide (UX-001) is Phase 0. Do NOT refactor the analysis hooks or components for API-first compliance or domain purity — that is deferred. However, DAT-008's missing owner scope in `useAnalysis.ts` MUST be patched even though the UI is hidden, because the hook could be called from non-analysis surfaces. Apply a targeted `.eq('owner_id', getOwnerId())` fix to `useAnalysis.ts:175–181` as part of Phase 0.

---

#### TENSION-4: `@ts-nocheck` on athlete-side components vs. scope boundary
**Findings involved:** ENG-010, UX-001
**The conflict:** UX-001 says to hide the Analysis and Training Log nav items. ENG-010 says `@ts-nocheck` is on all six athlete-facing components (`LogSetModal.tsx`, `CycleScreen.tsx`, `ProfileScreen.tsx`, `ProgressScreen.tsx`, `TodayScreen.tsx`, `WeekScreen.tsx`). These are athlete-side components — not Analysis or Training Log — so they are IN SCOPE per CLAUDE.md. The `@ts-nocheck` suppression affects in-scope code that remains in active use.
**Recommended resolution:** These are different file sets. UX-001 hides `/analysis` and `/training-log` nav and routes; ENG-010 addresses athlete-app TypeScript suppression. Neither blocks the other. The `@ts-nocheck` removal is Phase 1 work (regenerate types, remove pragma, fix errors). It is independent of the nav-hide task.

---

#### TENSION-5: `PlannerWeekOverview.tsx` is a rewrite candidate AND `useCoachDashboardV2` reads `training_log_sessions` without `owner_id` (DAT-001) — does the 913-line rewrite absorb the critical data bug?
**Findings involved:** ENG-014, DAT-001
**The conflict:** ENG-014 flags `PlannerWeekOverview.tsx` as a rewrite candidate. DAT-001's critical bug is in `useCoachDashboardV2.ts:117` — not in `PlannerWeekOverview` itself. These are different files. `PlannerWeekOverview` also calls Supabase directly, but `training_log_sessions` access is in the dashboard hook.
**Recommended resolution:** DAT-001 is a schema migration + hook fix, independent of the `PlannerWeekOverview` rewrite. Fix DAT-001 in Phase 0 (add `owner_id` column via migration, filter in `useCoachDashboardV2`). The `PlannerWeekOverview` rewrite is Phase 2. No sequencing dependency.

---

#### TENSION-6: `MacroCycles.tsx` is a rewrite candidate AND has a live `group_members` unscoped fetch AND `macro_phases`/`macro_competitions` lack `owner_id`
**Findings involved:** ENG-008, ENG-015, DAT-003, DAT-004
**The conflict:** ENG-015 marks `MacroCycles.tsx` (983 lines) as a rewrite candidate. ENG-008 identifies two direct Supabase violations inside it. DAT-003 identifies that `macro_phases` and `macro_competitions` tables have no `owner_id` (schema gap). DAT-004 identifies that `group_members` is fetched without owner scope in `useCoachDashboardV2` (not in MacroCycles itself). If the rewrite happens before the schema migration adding `owner_id` to `macro_phases`, the newly extracted hook methods will still write unscoped data.
**Recommended resolution:** Apply the `macro_phases`/`macro_competitions` schema migration (DAT-003) in Phase 0 before any MacroCycles rewrite work. DAT-004's `group_members` scoping fix is a one-line query change in `useCoachDashboardV2` — apply in Phase 0 independently. Then the MacroCycles rewrite proceeds in Phase 2 with a schema that is already correct.

---

#### TENSION-7: `DOM-001` (MacroTableV2 hardcoded week types) vs. `ENG-015` (MacroCycles rewrite) — does the domain fix happen in the component or in the rewrite?
**Findings involved:** DOM-001, ENG-015
**The conflict:** DOM-001 is a Critical domain finding: `MacroTableV2` maintains its own hardcoded `WEEK_TYPES` array, bypassing the DB-driven `WeekTypeConfig[]` system. ENG-015 flags the parent container `MacroCycles.tsx` for a full rewrite. `MacroTableV2.tsx` itself is not flagged for rewrite — it is a sub-component. If the rewrite restructures how `MacroTableV2` receives its props, patching it in isolation now might need to be redone.
**Recommended resolution:** Fix DOM-001 directly in `MacroTableV2.tsx` now (Phase 1): remove the private arrays, accept `weekTypes: WeekTypeConfig[]` as a prop (same pattern as `MacroPhaseBlock`), delegate to `getWeekTypeColor()` from `weekUtils`. The parent rewrite in Phase 2 will pass the prop through from `useMacroCycles` — this is additive, not conflicting. Patch first, rewrite later.

---

#### TENSION-8: `kValue.ts` name-matching (DOM-003) vs. `exercises.lift_slot` schema addition (DOM-003 recommendation) — schema change required but engineering has not flagged it
**Findings involved:** DOM-003, ENG-013, DAT-016
**The conflict:** DOM-003 recommends adding a `lift_slot` enum (`'snatch' | 'clean_and_jerk' | null`) to the `exercises` table to replace name-matching. ENG-013 makes the identical recommendation independently. DAT-016 notes that `exercises.category` is already a free string with no FK, and adding a structured `lift_slot` would be a migration. Neither ENG nor DAT flags this as a data-loss risk today — it is a silent wrong-result risk (K-value returns null for non-OWL-named exercises).
**Recommended resolution:** The schema addition is Phase 1 (it blocks the domain fix). Create a migration adding `lift_slot text CHECK (lift_slot IN ('snatch','clean_and_jerk','front_squat','back_squat','snatch_pull','clean_pull')) NULL` to `exercises`, expose it in `ExerciseFormModal`, and update `kValue.ts` and all four name-matching sites (DOM-003, ENG-013, DOM-010, DOM-013) to use `lift_slot` as primary with name-matching as fallback. This is a single coordinated schema + code change.

---

#### TENSION-9: `EventAttempts` schema (DOM-004) is hardcoded OWL two-lift / three-attempt — fixing it requires a large schema migration that is also a rewrite of `EventAttemptsModal`
**Findings involved:** DOM-004
**The conflict:** DOM-004 recommends replacing the 12-column `EventAttempts` table with a flexible `event_attempt_entries (event_id, athlete_id, exercise_id, attempt_number, planned_kg, actual_kg)`. This is the most expensive schema change in the report. It requires a migration, backfill, deletion of the old table, and a full rewrite of `EventAttemptsModal`. The event management UI is in scope (it is part of planning, not Analysis/Training Log). However, the current schema is functional for OWL coaches using standard competition structure.
**Recommended resolution:** Defer DOM-004 to Phase 3 or beyond — require an explicit user decision before starting. The migration is breaking and the modal is a full rewrite. Document it in Section 5 (Deferred Items) with the prerequisite decision. Do not patch the 12-column schema incrementally; the only valid fix is the flexible table.

---

#### TENSION-10: `useCoachDashboardV2` selects wrong column names (DAT-017) — silent display failure that overlaps with `useCoachDashboardV2` rewrite candidate status
**Findings involved:** DAT-017, ENG-021
**The conflict:** DAT-017 is a silent display bug: `total_reps`/`total_sets`/`highest_load`/`avg_load` are selected but the actual columns are `summary_total_reps` etc., so the dashboard shows 0 for all athlete weekly progress. ENG-021 flags `useCoachDashboardV2.ts` for `as any` casts but does not flag it as a rewrite candidate. The column-name fix is a one-liner but is in the same file that also has DAT-001 (critical missing `owner_id`), DAT-004 (unscoped group_members), and ENG-021 (`as any` casts).
**Recommended resolution:** Fix all four bugs in `useCoachDashboardV2.ts` in a single coordinated Phase 0/1 task rather than piecemeal. DAT-001 requires a migration; once the column exists, fix the filter and the column names (DAT-017) and the group_members scoping (DAT-004) in the same PR. ENG-021's type fixes follow in Phase 2.

---

#### TENSION-11: `DOM-007` (MacroCycles defaults to hardcoded `'Medium'` week type) — the fix requires knowing the coach's current week types, which are loaded asynchronously
**Findings involved:** DOM-007, DOM-001, ENG-015
**The conflict:** DOM-007 says seed new macro weeks with `GeneralSettings.week_types[0].abbreviation` instead of the literal `'Medium'`. This means `MacroCycles.tsx:222,440` must have access to the loaded `GeneralSettings` at the point of cycle creation. `MacroCycles.tsx` already calls `useMacroCycles` — does it also have settings? If not, it is an additional hook call on an already 983-line component.
**Recommended resolution:** Fix DOM-007 as part of the Phase 2 MacroCycles rewrite. The extracted `MacroCycleSelector` sub-component can receive `weekTypes` as a prop from the parent, which calls `useSettings`. Do not add another `useSettings` call to the monolithic 983-line component now. If blocking (a coach with no `'Medium'` week type cannot save a new cycle), escalate to Phase 1 with a targeted addition of `useSettings` to the component's top-level state.

---

#### TENSION-12: `DAT-016` (`exercises.category` is a free string with no FK) conflicts with `DOM-006` (`CATEGORIES` constant in `constants.ts`) — both point to the same root cause but require different fixes
**Findings involved:** DAT-016, DOM-006
**The conflict:** DAT-016 recommends migrating `exercises.category` to a `category_id uuid FK`. DOM-006 recommends deleting `CATEGORIES` from `constants.ts` and making the bulk import dynamic. These are the same root cause — category as a denormalized string — but DAT-016's fix (FK migration) is a breaking schema change while DOM-006's fix (delete the constant, use the `categories` table) is a code-only change.
**Recommended resolution:** Apply DOM-006's code fix first (Phase 1 — delete the constant, dynamic hint row). Flag DAT-016 as a longer-term schema migration that requires a user decision (renaming categories will be a two-step: update `categories.name` then bulk-update `exercises.category`). The FK migration is deferred until the category rename use case is validated as a user need.

---

#### TENSION-13: `ENG-009` (analysis components issue verbatim exercise query 5 times) vs. ENG-025 (Zustand adoption partially complete — exercise list should move to global store)
**Findings involved:** ENG-009, ENG-025
**The conflict:** ENG-009 says the five analysis components each independently query exercises. The fix could be: (a) pass exercises as props from `AnalysisPage`, or (b) route them through the `exerciseStore` Zustand slice. ENG-025 says exercise list should move to the global store (Phase 2 architecture). Since Analysis UI is hidden (UX-001), fixing ENG-009 now is low value if Analysis components are not rendered. But the Zustand migration is broader and will eventually cover these components.
**Recommended resolution:** Do not fix ENG-009 in isolation. When ENG-025's Zustand exercise-store migration happens (Phase 2), the analysis components will pick up the store automatically. Since the Analysis UI is hidden, ENG-009 carries no runtime cost. Defer ENG-009 explicitly to Phase 2, absorbing it into the Zustand migration task.

---

## 3. Prioritised Implementation Plan

---

### Phase 0 — Immediate Blockers

*Scope violations that are live and reachable, and data-loss / broken-query risk that silently corrupts production data today.*

---

#### [TASK-001] Hide Analysis and Training Log nav and routes
**Source findings:** UX-001
**Effort:** XS
**What to do:** In `src/components/Sidebar.tsx`, remove the two entries from the `sections` array: `{ path: '/analysis', label: 'Analysis', icon: LineChart }` (line 43) and `{ path: '/training-log', label: 'Training log', icon: ClipboardList }` (line 52). In `src/App.tsx`, wrap the `<Route path="/analysis" ...>` (line 161) and `<Route path="/training-log" ...>` (line 160) with a `{false && ...}` guard or replace with a redirect to `/` — do not delete the component imports or files.
**Acceptance criteria:** Navigating to `/analysis` and `/training-log` in the browser is not possible via the sidebar. Direct URL access returns a blank page or redirects to dashboard. All Analysis and Training Log source files remain on disk.

---

#### [TASK-002] Add `owner_id` to `training_log_sessions` — migration + hook fix
**Source findings:** DAT-001
**Effort:** M
**What to do:** Write `supabase/migrations/20260419000001_add_owner_id_to_training_log_sessions.sql`. Add `owner_id uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE` with a backfill from `athletes.owner_id` via `athlete_id`, create an index, update RLS to `USING (owner_id = auth.uid())` or application-level enforcement. Update `TrainingLogSession` interface in `src/lib/database.types.ts` to add `owner_id: string`. In `src/hooks/useCoachDashboardV2.ts:117`, add `.eq('owner_id', getOwnerId())` to the `training_log_sessions` query.
**Acceptance criteria:** TypeScript compiles without error on `TrainingLogSession`. The dashboard query in `useCoachDashboardV2` filters by `owner_id`. A second coach added to the system does not see sessions from the first coach's athletes on their dashboard.

---

#### [TASK-003] Add `owner_id` to `macro_phases` and `macro_competitions` — migration
**Source findings:** DAT-003
**Effort:** M
**What to do:** Write `supabase/migrations/20260419000002_add_owner_id_to_macro_phases_competitions.sql`. Add `owner_id uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE` to both `macro_phases` and `macro_competitions`. Backfill via join on `macrocycles.owner_id`. Add indexes. Tighten RLS. Update `MacroPhase` and `MacroCompetition` interfaces in `database.types.ts`. In `useMacroCycles`, add `.eq('owner_id', getOwnerId())` to `fetchPhases`, `fetchCompetitions`, and all write operations on these tables.
**Acceptance criteria:** Both interfaces include `owner_id`. All reads/writes in `useMacroCycles` are owner-scoped. Migration applies cleanly against the existing schema.

---

#### [TASK-004] Fix `ExerciseLibrary.handleCatDelete` cross-coach destructive mutation
**Source findings:** DAT-009, ENG-016
**Effort:** XS
**What to do:** In `src/components/exercise-library/ExerciseLibrary.tsx:876–899`, add `.eq('owner_id', getOwnerId())` to both the `exercises` SELECT (line ~876) and the `exercises` UPDATE (line ~895) within `handleCatDelete`. Remove `as any` casts and use `Tables<'exercises'>` from `database.types.ts`.
**Acceptance criteria:** `handleCatDelete` only reads and updates exercises belonging to the current coach. TypeScript accepts the query without `as any`. Deleting a category does not affect other coaches' exercises.

---

#### [TASK-005] Fix `useCoachDashboardV2` — wrong column names, unscoped `group_members`, and `macro_weeks`/`macro_phases` queries
**Source findings:** DAT-001 (partial — schema-dependent part in TASK-002), DAT-004, DAT-008, DAT-017
**Effort:** S
**What to do:** In `src/hooks/useCoachDashboardV2.ts`:
- Line 129: Replace `total_reps, total_sets, highest_load, avg_load` with `summary_total_reps, summary_total_sets, summary_highest_load, summary_avg_load`.
- Line 89: Change the `group_members` query to add `.in('group_id', groups.map(g => g.id))` before the `.is('left_at', null)` filter.
- `useAnalysis.ts:175–181`: Add owner scope to `macro_weeks` query — restructure to filter `macro_weeks` by `macrocycle_id IN` (a sub-select of `macrocycles` scoped to `getOwnerId()`).
**Acceptance criteria:** Dashboard displays non-zero reps/sets for athletes who have planned exercises. `group_members` query only returns rows for the current coach's groups. TypeScript compiles cleanly.

---

#### [TASK-006] Add `owner_id` to sentinel and quick-create exercise inserts in `DayCard` and `DayEditor`
**Source findings:** DAT-002, ENG-001, ENG-002
**Effort:** S
**What to do:** This is the surgical Phase 0 fix prior to the full extraction in Phase 1. In `src/components/planner/DayCard.tsx:188, 213` and `src/components/planner/DayEditor.tsx:200, 225`, merge `owner_id: getOwnerId()` into every `exercises.insert` payload. Verify that `useExercises.createExercise` already does this (so the Phase 1 extraction will inherit the fix). Do not extract to hook yet — that is TASK-012.
**Acceptance criteria:** Every exercise inserted via sentinel slash-commands or the quick-create field is owned by `getOwnerId()`. The exercises appear in the current coach's exercise list.

---

### Phase 1 — Critical Architecture

*API-first violations, hardcoded domain blockers, systematic design-system violations requiring structural changes.*

---

#### [TASK-007] Regenerate `database.types.ts` and remove `@ts-nocheck` from athlete components
**Source findings:** ENG-010, DAT-011, DAT-020, DAT-021
**Effort:** M
**What to do:** Run `supabase gen types typescript --local > src/lib/database.types.ts`. Add the `categories` table to `database.types.ts` manually if the generator does not pick it up (DAT-021). Add `owner_id: string` to `MacroCycle` (DAT-011). Remove the local `Category` interface from `src/hooks/useExercises.ts` and import from the central types file. Then remove `// @ts-nocheck` from `src/athlete/components/LogSetModal.tsx`, `CycleScreen.tsx`, `ProfileScreen.tsx`, `ProgressScreen.tsx`, `TodayScreen.tsx`, `WeekScreen.tsx` one file at a time. Fix every type error revealed — do not substitute `as any`.
**Acceptance criteria:** `tsc --noEmit` passes with zero errors. No `@ts-nocheck` pragmas remain. `categories` has a typed table entry. `MacroCycle.owner_id` is typed.

---

#### [TASK-008] Extract `DayCard` and `DayEditor` DB logic into hooks (API-first)
**Source findings:** ENG-001, ENG-002, ENG-026
**Effort:** M
**What to do:** Move `getOrCreateSentinel`, `handleNewExerciseSave`, and reorder position-update logic from `src/components/planner/DayCard.tsx:188,213,241` and `src/components/planner/DayEditor.tsx:200,225,242` into `useWeekPlans` and `useExercises`. Extract the three pure helpers (`getSentinelType`, `getYouTubeThumbnail`, `getOrCreateSentinel`) into `src/components/planner/plannerUtils.ts`. Delete duplicate implementations from both components. Expose mutations as callback props.
**Acceptance criteria:** Neither `DayCard.tsx` nor `DayEditor.tsx` imports `supabase` directly. `plannerUtils.ts` exists. No code duplication between the two components. Sentinel creation inherits `owner_id` from `useExercises.createExercise`.

---

#### [TASK-009] Extract `ExerciseDetail` DB logic into hooks (API-first)
**Source findings:** ENG-003, ENG-018, ENG-019
**Effort:** M
**What to do:** In `src/components/planner/ExerciseDetail.tsx`:
- Move `loadSollTarget` into `useMacroCycles` as `loadSollTarget(macroId, exerciseId, weekNumber)`.
- Move `savePlannedExerciseField` into `useWeekPlans`.
- Move media upload to a `useMediaUpload` hook.
- Fix the `useEffect` at line 134 by wrapping loaders with `useCallback` including all deps, and add `AbortController` cleanup.
- Fix the N+1 combo-day loop — replace with a single `.in('combo_id', memberIds)` query.
**Acceptance criteria:** `ExerciseDetail.tsx` makes no direct `supabase.from` calls. `useEffect` has complete dependency arrays. No `as any` casts (ENG-020 also resolved).

---

#### [TASK-010] Extract `PRTrackingPanel` DB logic into hooks (API-first)
**Source findings:** ENG-004, ENG-019
**Effort:** S
**What to do:** Move all three Supabase interactions from `src/components/planner/PRTrackingPanel.tsx:65–77, 152, 168` into `useAthletes` (PR history CRUD) and `useExercises` (exercise list fetch). Add `AbortController` cleanup to the panel's async load. Pass data and callbacks as props.
**Acceptance criteria:** `PRTrackingPanel.tsx` makes no direct `supabase.from` calls. Data arrives via props from the parent which calls the hooks.

---

#### [TASK-011] Extract `BodyweightPopup` DB logic into `useBodyweight` hook (API-first)
**Source findings:** ENG-005
**Effort:** S
**What to do:** Create `src/hooks/useBodyweight.ts` exposing `entries`, `upsert(entry)`, and `remove(id)`. Move the four `supabase.from('bodyweight_entries')` calls (SELECT, UPSERT×2, DELETE) from `src/components/BodyweightPopup.tsx:50,105,116,124` into this hook. Pass results and callbacks as props to the popup.
**Acceptance criteria:** `useBodyweight.ts` exists. `BodyweightPopup.tsx` makes no direct Supabase calls. Bodyweight CRUD works end-to-end.

---

#### [TASK-012] Fix `Athletes.tsx` non-atomic bodyweight upsert (API-first)
**Source findings:** ENG-006
**Effort:** XS
**What to do:** In `src/hooks/useAthletes.ts`, add an optional `initialBodyweight?: number` parameter to `createAthlete`. When provided, execute the `bodyweight_entries.upsert` inside the hook immediately after the athlete insert. Remove the direct `supabase.from('bodyweight_entries').upsert` call from `src/components/Athletes.tsx:511`.
**Acceptance criteria:** `Athletes.tsx` has no direct Supabase calls for bodyweight. Athlete creation with an initial bodyweight is atomic in the hook.

---

#### [TASK-013] Extract `MacroAnnualWheel` data fetching into hooks (API-first)
**Source findings:** ENG-007, ENG-019
**Effort:** S
**What to do:** Move the two `useEffect`-based data fetches from `src/components/macro/MacroAnnualWheel.tsx:210–258` into `useMacroCycles` (phases, competitions) and `useEvents` (calendar events with athlete join). Pass `phases`, `competitions`, and `calendarEvents` as props to the wheel component. Add `AbortController` cleanup.
**Acceptance criteria:** `MacroAnnualWheel.tsx` is a pure rendering component with no `supabase.from` calls. Props drive all data.

---

#### [TASK-014] Fix `MacroCycles.tsx` direct Supabase calls (API-first, pre-rewrite patch)
**Source findings:** ENG-008
**Effort:** S
**What to do:** In `src/components/macro/MacroCycles.tsx`: (1) Replace the inline `group_members` fetch (lines 149–154) with `useTrainingGroups`. (2) Add `extendCycle(cycleId, newEndDate)` and `trimCycle(cycleId, newEndDate)` methods to `useMacroCycles` and call them from `handleEditCycle` (lines 444–452) instead of inline `supabase.from('macro_weeks')`.
**Acceptance criteria:** `MacroCycles.tsx` does not call `supabase.from` directly for these two use-cases. Group member data comes from `useTrainingGroups`.

---

#### [TASK-015] Fix `CoachProfileModal` default settings — move to hook (API-first + single source of truth)
**Source findings:** ENG-017
**Effort:** XS
**What to do:** In `src/hooks/useCoachProfiles.ts` (or `useSettings`), add a `createDefaultSettings(ownerId)` function that inserts the `general_settings` row with the five defaults. Call it from `createCoach` or expose it for the modal to call. Remove the direct `supabase.from('general_settings').insert` block at `src/components/CoachProfileModal.tsx:35–41`.
**Acceptance criteria:** `CoachProfileModal.tsx` makes no direct Supabase calls. Default settings creation is colocated with `createCoach`.

---

#### [TASK-016] Fix `MacroTableV2` hardcoded week types (coach-flexibility)
**Source findings:** DOM-001
**Effort:** S
**What to do:** In `src/components/macro/MacroTableV2.tsx:47–66`: Remove `WEEK_TYPE_COLORS`, `WEEK_TYPES`, `getWeekTypeAbbr`, and `getWeekTypeColor`. Add a `weekTypes: WeekTypeConfig[]` prop. Replace all usages with `getWeekTypeColor(abbreviation, weekTypes)` from `weekUtils.ts` (the same pattern used by `MacroPhaseBlock`). Update `cycleWeekType()` to iterate over the injected array.
**Acceptance criteria:** `MacroTableV2` has no hardcoded week-type arrays. A coach who adds a custom week type in settings sees it correctly in the macro table with the correct color.

---

#### [TASK-017] Fix `PlannerControlPanel` week-type badge (coach-flexibility)
**Source findings:** DOM-002
**Effort:** XS
**What to do:** In `src/components/planner/PlannerControlPanel.tsx:46–57`, remove `weekTypeBadgeColor` switch statement. Add `weekTypes: WeekTypeConfig[]` prop. Compute badge background/text by looking up `WeekTypeConfig.color` for the current `weekType` string and deriving a lightened background (or use `color + '1A'` for a 10% opacity bg). Pass `weekTypes` from the parent planner.
**Acceptance criteria:** The week badge in the planner control panel renders the coach-configured color for any custom week type, not grey.

---

#### [TASK-018] Fix `kValue.ts` and all name-matching sites — add `lift_slot` to exercises schema
**Source findings:** DOM-003, ENG-013, DOM-010, DOM-013
**Effort:** L
**What to do:**
1. Write `supabase/migrations/20260419000003_add_lift_slot_to_exercises.sql` — add `lift_slot text CHECK (lift_slot IN ('snatch','clean_and_jerk','front_squat','back_squat','snatch_pull','clean_pull')) NULL` to `exercises` table.
2. Update `Exercise` interface in `database.types.ts` to include `lift_slot: string | null`.
3. In `src/lib/kValue.ts:35–49`, replace category name-matching with `lift_slot` primary check; keep category-name heuristic as a fallback when `lift_slot` is null.
4. In `src/components/analysis/presets/CompetitionLiftTrends.tsx`, `SquatToLiftTransfer.tsx`, `src/components/analysis/LiftRatios.tsx`, and `src/hooks/useAnalysis.ts:526–531` — replace name-matching with `lift_slot` (note: Analysis UI is hidden so these are code-only fixes).
5. Consolidate `abbreviateExercise` (`PlannerControlPanel.tsx:35–43`) and `CATEGORY_ABBREVIATIONS` (`PrintWeekCompact.tsx:53–73`) into a single utility that checks `exercise.exercise_code` first then falls back to initials (DOM-012, DOM-013).
6. Add `lift_slot` field to `ExerciseFormModal` so coaches can designate slots.
**Acceptance criteria:** `kValue.ts` returns a correct total for exercises with non-OWL category names when `lift_slot` is set. No name-matching duplications remain. Migration applies cleanly.

---

#### [TASK-019] Fix hardcoded `'Medium'` default week type in `MacroCycles`
**Source findings:** DOM-007
**Effort:** XS
**What to do:** In `src/components/macro/MacroCycles.tsx:222, 440`, replace `week_type: 'Medium' as WeekType` with `week_type: (settings?.week_types?.[0]?.abbreviation ?? '') as WeekType`. Ensure `useSettings` is already called in the component (it is, per ENG-014/015 review of the file). If `useSettings` is not yet called in this component, add the hook call.
**Acceptance criteria:** When a coach with no `'Medium'` week type creates or extends a macrocycle, the new weeks default to their first configured week type, not `'Medium'`.

---

#### [TASK-020] Fix `CoachProfileModal` and `useAnalysis` — remove hardcoded OWL defaults from configurable domain
**Source findings:** ENG-011, ENG-012, DOM-005, DOM-009
**Effort:** M
**What to do:**
- `src/hooks/useAnalysis.ts:550–555`: Move lift-ratio targets into `general_settings` (add fields `lift_ratio_targets: jsonb | null`). Until configured, use the current values as fallback constants. Pass them as parameters to `fetchLiftRatios`.
- `src/hooks/useAnalysis.ts:470–474`: Make intensity zone boundaries configurable from `general_settings` (add `intensity_zones: jsonb | null`). Until configured, use current values as fallback.
- `src/lib/analysisInsights.ts:15, 47`: Read `compliance_warning_threshold` and `low_intensity_zone_max_pct` from settings rather than hardcoded 85/50 values.
- Note: Analysis UI is hidden — these are code changes only, tested via unit tests or by temporarily un-hiding Analysis. Create a migration for the new `general_settings` columns.
**Acceptance criteria:** No magic number thresholds remain in `useAnalysis.ts` or `analysisInsights.ts`. A `general_settings` row with null values falls back to the current defaults.

---

#### [TASK-021] Fix `CATEGORIES` constant and bulk import fallback (single source of truth)
**Source findings:** DOM-006
**Effort:** XS
**What to do:** Delete `export const CATEGORIES` from `src/lib/constants.ts`. In `src/components/ExerciseBulkImportModal.tsx`, replace the static `'Snatch'` fallback with a dynamic load from `useExercises.categories`. Update the hint row to show the coach's actual category names.
**Acceptance criteria:** `CATEGORIES` is not exported from `constants.ts`. Bulk import uses only the coach's DB-defined categories.

---

#### [TASK-022] Fix app shell and sidebar hardcoded colors — migrate to EMOS tokens
**Source findings:** UX-006, UX-012, UX-013, UX-026, UX-027
**Effort:** M
**What to do:** Migrate these files to use EMOS `var(--color-*)` tokens:
- `src/App.tsx:105, 135, 144`: Replace `bg-slate-50`, `bg-white`, `border-gray-200`, and the arbitrary shadow with token-based inline styles.
- `src/components/Sidebar.tsx:87,93,112,126,204,250`: Replace all Tailwind gray utilities with `var(--color-*)` tokens in inline styles or a dedicated CSS class.
- `src/index.css:9`: Change `html { background-color: #f8fafc }` to `html { background-color: var(--color-bg-page); }`.
- `src/index.css:29,30`: Replace selection colors with new tokens `--color-selection-bg` and `--color-selection-text` in `tokens.css`.
**Acceptance criteria:** The app shell and sidebar render identically in light mode. Zero `bg-white`, `bg-gray-*`, `border-gray-*`, `text-gray-*` Tailwind utilities remain in these files.

---

#### [TASK-023] Remove all `box-shadow` from cards, modals, and containers
**Source findings:** UX-007, UX-012, UX-014, UX-029
**Effort:** M
**What to do:** Remove `box-shadow` / Tailwind `shadow-xl` / `shadow-2xl` / arbitrary shadow utilities from:
- `src/components/ModalShell.tsx:11` — replace with `border: 0.5px solid var(--color-border-primary)`.
- All modals: `Athletes.tsx:61`, `ExerciseBulkImportModal.tsx:193,210`, `ExerciseFormModal.tsx:24`, `MediaInputModal.tsx:75`, `MacroEditModal.tsx:75`, `MacroCreateModal.tsx:64`, `MacroPhaseModal.tsx:84`, `ComboCreatorModal.tsx:106`, `CopyWeekModal.tsx:149`.
- `ExerciseDetailPanel.tsx:146`, `ExerciseLibrary.tsx:692,1180`.
- `Athletes.tsx:61`, `BodyweightPopup.tsx:133`, `EventDetailModal.tsx:50`, `EventFormModal.tsx:83`, `TrainingGroups.tsx:245,292,337`.
- `MacroExcelIO.tsx:812,912`.
- Floating tools (`Calculator.tsx:142`, `RepMaxCalculator.tsx:150`, `CalendarTool.tsx:164`) may retain a single subtle shadow per UX-007 guidance.
**Acceptance criteria:** No `shadow-xl`, `shadow-2xl`, or `boxShadow` properties on non-floating-tool card/container elements. All modals use a `0.5px solid` border for visual separation.

---

#### [TASK-024] Fix systematic font-weight violations (600/700 → 500) across coach UI
**Source findings:** UX-003, UX-004, UX-005
**Effort:** M
**What to do:**
- `ExerciseDetailPanel.tsx:72,161,462,572,649,665,704,723`: Replace `fontWeight: 600`/`700` with `fontWeight: 500`.
- `PRTrackingPanel.tsx:207,236,240,244`: Same.
- `WeeklyPlanner.tsx:692`: `fontWeight: 600` → `fontWeight: 500`.
- `tokens.css:376`: `.pgrid-btn { font-weight: 600 }` → `font-weight: 500`.
- All instances of `font-bold` and `font-semibold` in: `Athletes.tsx`, `CoachDashboard.tsx:196`, `dashboard-v2/StatsBar.tsx:87`, `ReadinessHeatmap.tsx:56`, `BodyweightPanel.tsx:43`, `AthleteGrid.tsx:139`, `DashboardV2.tsx:62`, `MacroTableV2.tsx:417`, `PlanningPRPanel.tsx:78`, `MacroCycles.tsx:788,814`: replace with `font-medium`.
- `Sidebar.tsx:100,104` wordmark: either replace with SVG logo or use `font-medium` with `var(--font-sans)`. Document the decision in a comment.
- Consider adding an ESLint rule or Tailwind safelist to flag `font-bold`/`font-semibold`.
**Acceptance criteria:** Zero occurrences of `fontWeight: 600`, `fontWeight: 700`, `font-bold`, `font-semibold` in non-print coach-UI files. `tokens.css` `.pgrid-btn` uses `font-weight: 500`.

---

#### [TASK-025] Fix sub-11px font sizes across coach UI
**Source findings:** UX-002, UX-016, UX-025
**Effort:** M
**What to do:** Replace all sub-11px font sizes with `var(--text-caption)` (11px):
- `ExerciseDetailPanel.tsx:229,293,294,296,703,729`: `fontSize: 8`/`fontSize: 9` → 11.
- `MacroDraggableChart.tsx:491,507`: `fontSize: 8` → 11.
- `MacroCycles.tsx:773`: `text-[8px]` → `text-[11px]` or `style={{ fontSize: 'var(--text-caption)' }}`.
- `Athletes.tsx:253–258,301,311,457,479`: `text-[9px]` → `var(--text-caption)`.
- All `text-[10px]` occurrences: `AthleteSelector.tsx:51,71,98`, `CoachDashboard.tsx:195,253,529`, `ExerciseToggleBar.tsx:52,66,76,93`, `MacroDraggableChart.tsx:337,358,370,388,396`, `MacroDistributionChart.tsx:290,294,298,304,324,342`, `DayConfigModal.tsx:204,207,213,227`, `Sidebar.tsx:113,155,206` → `var(--text-caption)`.
- `MacroDistributionChart.tsx:156,157,178,179,199,200,223,224`: `font: { size: 9 }` → `font: { size: 11 }`.
- `BodyweightPopup.tsx:317,318`: `text-[10px]` → `var(--text-caption)`, add `padding: '4px 8px'`.
**Acceptance criteria:** No font size below 11px in any coach-UI file. `tsc --noEmit` still passes.

---

### Phase 2 — Consolidation

*Deduplication, service-layer extraction, token migration for remaining components, performance fixes.*

---

#### [TASK-026] Fix N+1 query in `useEvents` — batch event-athlete-athlete joins
**Source findings:** DAT-005
**Effort:** M
**What to do:** Rewrite `src/hooks/useEvents.ts:26–97,195–229` to batch fetch: (1) all events, (2) all `event_athletes` where `event_id IN (...)`, (3) all athletes where `id IN (...)`. Reassemble in JS. Apply the same fix to `fetchUpcomingEvents`, `fetchEventsByMonth`, `fetchEventsByDateRange`. For `fetchEventOverview`, use a single `.in('event_id', [eventId])` on `event_attempts` and `event_videos` with `Promise.all`.
**Acceptance criteria:** `fetchEvents` with 20 events sends 3 queries instead of 41. No `for` loop over individual events issuing per-event queries.

---

#### [TASK-027] Fix N+1 position-update loops in `useWeekPlans` and `useExercises`
**Source findings:** DAT-006
**Effort:** S
**What to do:** In `src/hooks/useWeekPlans.ts:240–282, 314–320` and `src/hooks/useExercises.ts:215–222`, replace sequential `await` loops with `Promise.all` as an immediate fix. Longer term, implement a Postgres function or batch-upsert to reduce to a single round trip.
**Acceptance criteria:** Reordering 8 exercises fires 8 parallel UPDATEs (or 1 RPC) rather than 8 sequential ones. UI does not block for serial round-trip time during drag-and-drop.

---

#### [TASK-028] Optimize `syncGroupPlanToAthletes` — batch set-line inserts
**Source findings:** DAT-007
**Effort:** M
**What to do:** In `src/hooks/useWeekPlans.ts:762–904`, collect all new `planned_set_lines` for each athlete and batch-insert them in a single `supabase.from('planned_set_lines').insert(allLines)` call instead of one per exercise. Parallelize read-only preflight queries with `Promise.all` where there are no write dependencies. Consider a Postgres RPC for the full sync if batching is insufficient.
**Acceptance criteria:** Group plan sync for 10 athletes with 20 exercises sends fewer than 50 queries (down from ~200). No nested sequential loops for set-line inserts.

---

#### [TASK-029] Rewrite `PlannerWeekOverview.tsx` — extract hook and lib function
**Source findings:** ENG-014, DAT-018
**Effort:** XL
**What to do:** Extract a dedicated `usePlannerWeekOverview(targetId, targetGroupId, rangeStart, rangeEnd)` hook in `src/hooks/`. Move the 6-phase sequential load into this hook. Move phase-block construction into `src/lib/macroPhaseBarData.ts` alongside related logic. Eliminate the waterfall in `fetchMacroTargetForExercise` (DAT-018) by using an RPC or a denormalized view for the 5-join lookup. The component becomes a thin rendering shell receiving data and callbacks as props.
**Acceptance criteria:** `PlannerWeekOverview.tsx` is under 250 lines. All Supabase calls are in the hook. `fetchMacroTargetForExercise` resolves in 1 query instead of 5.

---

#### [TASK-030] Rewrite `MacroCycles.tsx` — split into three sub-components
**Source findings:** ENG-015, ENG-008, DOM-007, DOM-016
**Effort:** XL
**What to do:** Split `src/components/macro/MacroCycles.tsx` (983 lines) into:
- `MacroCycleSelector` — cycle list, create/edit.
- `MacroCycleDetail` — week table + phase editor (receives `weekTypes` from `useSettings` to fix DOM-007).
- `MacroCycleCharts` — graph and distribution views.
All three consume data from `useMacroCycles`, `useTrainingGroups`, `useSettings`. No direct `supabase.from` calls. Nine `useEffect` hooks refactored to derived state or hook-managed data.
**Acceptance criteria:** `MacroCycles.tsx` is removed or becomes a thin shell under 100 lines. No direct Supabase calls in any macro sub-component. New week defaults to `weekTypes[0].abbreviation`.

---

#### [TASK-031] Rewrite `ExerciseLibrary.tsx` — split into sub-components with clean hook boundary
**Source findings:** ENG-016, DAT-009 (surgical fix already in TASK-004)
**Effort:** XL
**What to do:** Split `src/components/exercise-library/ExerciseLibrary.tsx` (1,230 lines) into:
- `ExerciseListPanel` — list, search, filter.
- `ExerciseCategoryNav` — category tree, create/rename/delete.
- `ExerciseDetailPanel` (already exists as a separate file).
Move the `deleteCategory` reassign-then-delete sequence into `useExercises.deleteCategory`. Remove `as any` casts throughout using properly typed `Tables<'exercises'>`.
**Acceptance criteria:** No sub-component exceeds 400 lines. `useExercises.deleteCategory` owns the reassign-then-delete sequence. Zero `as any` casts in exercise library code.

---

#### [TASK-032] Migrate `MacroAnnualWheel.tsx` — already data-extracted (TASK-013), now split rendering
**Source findings:** ENG-007
**Effort:** L
**What to do:** After TASK-013 removes data fetching, `MacroAnnualWheel.tsx` (847 lines) still contains complex canvas rendering logic. Split the event-resolution layer from the geometry/canvas drawing layer into separate functions in `src/lib/annualWheelRenderer.ts`. The component becomes an orchestration shell.
**Acceptance criteria:** `MacroAnnualWheel.tsx` under 300 lines. Canvas geometry in a separate utility file. No Supabase calls.

---

#### [TASK-033] Migrate Zustand exercise and athlete stores — resolve ENG-009 via store
**Source findings:** ENG-009, ENG-025
**Effort:** L
**What to do:** Per the Phase 2 architecture plan, migrate the exercise list and athlete list to their respective Zustand global store slices (`exerciseStore.ts`, `athleteStore.ts`). Update the five analysis components (now hidden but in-code) and all other consumers to read from the store. This eliminates the 5 separate `supabase.from('exercises').select` calls.
**Acceptance criteria:** Exercise list is fetched once per session and stored in `exerciseStore`. No component issues an independent exercise-list fetch. `useExercises` hook reads from store and refreshes on demand.

---

#### [TASK-034] Token migration — remaining hardcoded colors, hex values, and borders
**Source findings:** UX-006 (remaining after TASK-022), UX-008, UX-009, UX-010, UX-011, UX-017, UX-018, UX-019, UX-020, UX-021, UX-023, UX-024, UX-028
**Effort:** L
**What to do:** Systematic sweep of remaining token violations:
- All `1px solid` borders in `WeekSummary.tsx:12–19,106,165`, `WeeklyPlanner.tsx:767,819`, `MacroPhaseBlock.tsx:151`, `MacroDraggableChart.tsx:463`, `tokens.css:390,406,419,440`, `AthleteCardPicker.tsx:147`, `AthletePRs.tsx`, `calendar/*`, `Sidebar.tsx` → change to `0.5px solid`.
- Hardcoded hex values: `WeekSummary.tsx:18` `#7C3AED` → `var(--color-purple-600)`, `WeeklyPlanner.tsx:692` `#3730a3` → token, `AthleteGrid.tsx:119,120` → `var(--color-bg-tertiary)` / `var(--color-text-tertiary)`, `BodyweightPopup.tsx:223,225,231` → `var(--color-accent)` / `var(--color-amber-200)`.
- `text-[12px]` / `fontSize: 12` → 11 or 13 per context: `Athletes.tsx:309`, `MacroTableV2.tsx:417`, `ExerciseHistoryChart.tsx:194`, `SollIstChart.tsx:106,113`.
- `ExerciseDetailPanel.tsx:571,648`: `fontSize: 30`/`24` → `var(--text-display)` (22px) or introduce `--text-hero` token in `tokens.css`; remove `fontWeight: 700`.
- Chart axis hex colors `#9ca3af`/`#4b5563`: `BodyweightPopup.tsx:202,207`, `MacroDraggableChart.tsx:443,453` → `var(--color-text-tertiary)`.
- `rgba` inline colors in `DayEditor.tsx:273`, `ExerciseSearch.tsx:150`, `ComboCreatorModal.tsx:222,250`, `MacroDistributionChart.tsx:157,179,200,224` → EMOS tokens.
- `MacroDraggableChart.tsx:462–464` tooltip: `fontSize: 10` → `var(--text-caption)`, `border: '1px solid #e5e7eb'` → `0.5px solid var(--color-border-secondary)`, remove `boxShadow`.
- `AthleteCardPicker.tsx:147`, `AthletePRs.tsx` — full token migration.
- Dashboard V2 headings in `ActivityFeed.tsx`, `AthleteGrid.tsx`, `StatsBar.tsx`, `DashboardV2.tsx`.
**Acceptance criteria:** Zero hardcoded hex colors (outside exercise-palette use), zero `1px solid` on non-interactive cards, zero below-scale font sizes, in all coach-UI files. All `tokens.css` PrescriptionGrid classes use `0.5px`.

---

#### [TASK-035] Fix `useEffect` async cleanup and missing dependencies
**Source findings:** ENG-018, ENG-019
**Effort:** S
**What to do:** Audit all async `useEffect` hooks in `ExerciseDetail.tsx:134–138`, `MacroAnnualWheel.tsx:231–262` (already addressed by TASK-013 extraction), `PRTrackingPanel.tsx:90` (addressed by TASK-010). Add `AbortController` / `isMounted` ref guards to any remaining async effects. Fix missing dependency arrays.
**Acceptance criteria:** No `useEffect` with async operations lacks cleanup. ESLint `react-hooks/exhaustive-deps` reports no violations.

---

#### [TASK-036] Fix `as any` casts in `useCoachDashboardV2`, `MacroDistributionChart`, `MacroDraggableChart`
**Source findings:** ENG-021, ENG-022, DAT-020
**Effort:** S
**What to do:** In `useCoachDashboardV2.ts:182,193,322`: Define typed interfaces `MacroWeekJoin`, `MacroCycleWithRelations`, `EventWithAthletes`. Replace `as any` with proper types or Supabase `QueryResult<typeof query>` pattern. In `MacroDistributionChart.tsx:176,260` and `MacroDraggableChart.tsx:263`: import `TooltipItem` from `chart.js` and typed Recharts bar props. Fix `updateExercise` in `useExercises` to accept `is_archived` without `as any` cast.
**Acceptance criteria:** Zero `as any` casts in these three files. `tsc --noEmit` passes.

---

#### [TASK-037] Fix `PhaseType` closed union — open to free string
**Source findings:** DOM-008
**Effort:** XS
**What to do:** In `src/lib/database.types.ts:22`, change `PhaseType` from `'preparatory' | 'strength' | 'competition' | 'transition' | 'custom'` to `string`. In `MacroPhaseModal`, retain the four preset options in `PHASE_TYPE_OPTIONS` as suggestions but allow free-text entry. Write a migration if `phase_type` has a DB-level enum/check constraint — if it does, change to `text`.
**Acceptance criteria:** A coach can enter any phase type string. The preset options remain available as suggestions in the modal.

---

#### [TASK-038] Fix `fetchMacroValidationData` missing owner scope in embedded filter
**Source findings:** DAT-019
**Effort:** XS
**What to do:** In `src/hooks/useMacroCycles.ts:460–507`, add `.eq('macrocycles.owner_id', getOwnerId())` to the embedded filter on the `macro_weeks` query, or restructure to fetch the macrocycle ID first and then query `macro_weeks` by `macrocycle_id`.
**Acceptance criteria:** `fetchMacroValidationData` only returns macro weeks belonging to the current coach's macrocycles.

---

#### [TASK-039] Fix `useTrainingLog.fetchWeekData` missing owner scope
**Source findings:** DAT-010
**Effort:** XS
**What to do:** In `src/hooks/useTrainingLog.ts:27–31`, add `.eq('owner_id', getOwnerId())` to the `week_plans` query.
**Acceptance criteria:** Training log fetches only week plans belonging to the current coach.

---

#### [TASK-040] Fix migration naming convention and space in filename
**Source findings:** DAT-015, ENG-023
**Effort:** XS
**What to do:** Rename `supabase/migrations/20260330100000 add video image exercises.sql` to `20260330100000_add_video_image_exercises.sql` (replace space with underscore). Add `~$*` to `.gitignore`. Move the 11 `EMOS_*.md` design doc files from repo root to a `docs/emos/` directory. All future migrations must use `YYYYMMDDHHMMSS_` format.
**Acceptance criteria:** No space in any migration filename. `~$*` in `.gitignore`. Repo root contains no `EMOS_*.md` files.

---

### Phase 3 — Polish

*Minor UX, isolated debt, info-level observations, missing entries.*

---

#### [TASK-041] Fix sidebar nav tap target height and transition tokens
**Source findings:** UX-015, UX-022
**Effort:** XS
**What to do:** `Sidebar.tsx:175`: Change expanded nav items from `py-1.5` to `py-2.5` (36px effective height). Collapsed icon-only items to `py-2.5` with explicit `w-10` for a 40×40 touch area. In `DayCard.tsx:286,306,324`, `CopyWeekModal.tsx:193,210`, `PlannerControlPanel.tsx:114,752,779`, `Sidebar.tsx:172,214`: replace literal `'0.1s'`/`'0.15s'`/`100ms`/`150ms` with `var(--transition-fast)` / `var(--transition-base)`.
**Acceptance criteria:** Sidebar nav items have ≥36px tap target. All transition durations reference token variables.

---

#### [TASK-042] Fix `MacroDraggableChart` tooltip and `MacroDistributionChart` axis sizes (remaining from TASK-034 if split)
**Source findings:** UX-024, UX-025
**Effort:** XS
**What to do:** If not already resolved in TASK-034: `MacroDraggableChart.tsx:462–464` tooltip — `fontSize: 'var(--text-caption)'`, `border: '0.5px solid var(--color-border-secondary)'`, remove `boxShadow`. `MacroDistributionChart.tsx:156,157,178,179,199,200,223,224` — `font: { size: 11 }`.
**Acceptance criteria:** No sub-11px font sizes or shadow violations in chart tooltips.

---

#### [TASK-043] Fix `BodyweightPopup` tap target and recharts axis colors
**Source findings:** UX-030, UX-017
**Effort:** XS
**What to do:** `BodyweightPopup.tsx:317,318`: Add `padding: '4px 8px'`, `fontSize: 'var(--text-caption)'` to confirm buttons. `BodyweightPopup.tsx:202,207`: Replace `#9ca3af`/`#4b5563` axis tick colors with `var(--color-text-tertiary)`.
**Acceptance criteria:** Delete confirmation buttons are at least 36px tall. Axis tick colors use token.

---

#### [TASK-044] Fix `MacroCycle` `database.types.ts` interface — add `owner_id`
**Source findings:** DAT-011
**Effort:** XS
**What to do:** If not already resolved in TASK-007, add `owner_id: string` to `MacroCycle` interface and `Database['public']['Tables']['macrocycles']` in `src/lib/database.types.ts`.
**Acceptance criteria:** `MacroCycle.owner_id` is typed. Callers can access `.owner_id` without a cast.

---

#### [TASK-045] Add `categories` to `database.types.ts` — remove local re-declaration
**Source findings:** DAT-021
**Effort:** XS
**What to do:** If not already resolved in TASK-007, add a `Category` row interface and `Database['public']['Tables']['categories']` section to `database.types.ts`. Remove the local `Category` interface from `src/hooks/useExercises.ts` and import from the central types.
**Acceptance criteria:** `supabase.from('categories')` is fully typed. No local `Category` interface in `useExercises.ts`.

---

#### [TASK-046] Add `commitlint` pre-commit hook
**Source findings:** ENG-024
**Effort:** XS
**What to do:** Install `commitlint` and `@commitlint/config-conventional`. Add a `commitlint` configuration file. Wire it to `husky` (if already in use) or add a simple `commit-msg` hook in `.husky/commit-msg`. Enforce `type(scope): description` with lowercase.
**Acceptance criteria:** A commit message without a scope or with uppercase type is rejected by the pre-commit hook.

---

#### [TASK-047] `macroPhaseBarData.resolveWeekType` — show `?` badge for unknown week types
**Source findings:** DOM-018
**Effort:** XS
**What to do:** In `src/lib/macroPhaseBarData.ts:41–58`, when `resolveWeekType` returns `{ abbr: '', name: '' }`, add a `warning: true` flag to the result. In the consuming component, render a `?` badge or a warning color on cells with `warning: true` so coaches can identify stale week type references.
**Acceptance criteria:** A macro week referencing a deleted or renamed week type renders a visible `?` indicator rather than an empty cell.

---

#### [TASK-048] Investigate and document `BodyweightEntry`, `AthletePR`, and `ExerciseComboTemplate` isolation models
**Source findings:** DAT-012, DAT-013, DAT-014
**Effort:** S
**What to do:** For each table, decide: (a) add `owner_id` for defense in depth, or (b) document that isolation via `athlete_id` (already owner-scoped) is sufficient. If (a): write a migration and update the interfaces. If (b): add a comment in the relevant hook file stating the isolation model. For `ExerciseComboTemplate`: decide whether templates are intentionally global or per-coach; if per-coach, add `owner_id`.
**Acceptance criteria:** A written decision exists (in code comment or CLAUDE.md) for each table. If `owner_id` is added, a migration exists and the interface is updated.

---

#### [TASK-049] Add `--color-selection-bg` and `--color-selection-text` tokens; fix `index.css` selection
**Source findings:** UX-009, UX-027
**Effort:** XS
**What to do:** Add `--color-selection-bg` and `--color-selection-text` to `src/styles/tokens.css`. Update `src/index.css:29,30` to use these variables.
**Acceptance criteria:** Text selection color uses EMOS tokens and responds to theme changes.

---

#### [TASK-050] `PrintWeek` — document intentional `font-bold`/`font-semibold` exception or migrate
**Source findings:** UX-004
**Effort:** XS
**What to do:** In `src/components/planner/PrintWeek.tsx`, either: (a) add a comment `/* print-only: heavier weights intentional for readability in hard-copy output */` above each `font-bold`/`font-semibold`, or (b) migrate to `font-medium` if the print output is acceptable. Verify on a real print preview.
**Acceptance criteria:** `PrintWeek.tsx` either has documented intentional exceptions or uses only 400/500 weights.

---

## 4. Rewrite Candidates

#### `src/components/planner/PlannerWeekOverview.tsx`
**Flagged by:** ENG-014 (rewrite candidate)
**Current problems:**
- 913 lines; single component owns 8+ direct Supabase calls
- 15+ state variables managed inline
- 6-phase sequential data loading function with business logic (macro-week target mapping, compliance calculation, phase-block construction) entirely inside the component body
- Data waterfall: `fetchMacroTargetForExercise` chains 5 sequential `.maybeSingle()` queries per exercise (DAT-018)
**Recommended replacement shape:** A thin rendering component backed by `usePlannerWeekOverview(targetId, targetGroupId, rangeStart, rangeEnd)` hook. Phase-block construction moved to `src/lib/macroPhaseBarData.ts`. `fetchMacroTargetForExercise` replaced by a Postgres RPC or denormalized view.
**Phase:** Phase 2 (TASK-029)

---

#### `src/components/macro/MacroCycles.tsx`
**Flagged by:** ENG-015 (rewrite candidate), ENG-008, DOM-007
**Current problems:**
- 983 lines; 9 `useEffect` hooks
- `useMacroCycles` hook consumption mixed with direct `supabase.from` calls (ENG-008)
- Group member management, cycle CRUD, phase/competition management, Excel export, and chart rendering all co-located
- Hardcodes `'Medium'` as default week type (DOM-007)
- TODO comments at lines 1–2 acknowledge the problem
**Recommended replacement shape:** Three sub-components — `MacroCycleSelector`, `MacroCycleDetail`, `MacroCycleCharts` — all consuming `useMacroCycles`, `useTrainingGroups`, `useSettings`. No direct Supabase calls.
**Phase:** Phase 2 (TASK-030)

---

#### `src/components/exercise-library/ExerciseLibrary.tsx`
**Flagged by:** ENG-016 (rewrite candidate), DAT-009
**Current problems:**
- 1,230 lines — largest file in the codebase
- Category delete handler (lines 881–899) runs 3 sequential DB operations inline without owner scope (live cross-coach destructive bug — surgical fix in TASK-004)
- `as any` casts on insert/update results
- Acknowledged via TODO comments
**Recommended replacement shape:** `ExerciseListPanel`, `ExerciseCategoryNav`, `ExerciseDetailPanel` (already exists). `deleteCategory` reassign-then-delete sequence in `useExercises.deleteCategory`.
**Phase:** Phase 2 (TASK-031)

---

#### `src/components/macro/MacroAnnualWheel.tsx`
**Flagged by:** ENG-007 (rewrite candidate)
**Current problems:**
- 847 lines combining canvas rendering + multi-table data fetching + event resolution
- Two `useEffect`-based data fetches inside a pure visualisation component
- Three-step calendar-event join executed inline (lines 237–258)
- Async effects with no cleanup/cancellation
**Recommended replacement shape:** Data fetching extracted to `useMacroCycles` and `useEvents` (TASK-013). Canvas geometry split into `src/lib/annualWheelRenderer.ts`. Component becomes an orchestration shell under 300 lines.
**Phase:** Phase 2 — data extraction in Phase 1 (TASK-013), rendering split in Phase 2 (TASK-032)

---

## 5. Deferred Items

**DOM-004 / DAT-004 (partial): `EventAttempts` schema hardcodes two-lift / three-attempt OWL structure**
- **Why deferred:** Replacing the 12-column `EventAttempts` table with a flexible `event_attempt_entries (event_id, athlete_id, exercise_id, attempt_number, planned_kg, actual_kg)` is a breaking schema migration requiring backfill, deletion of the old table, and a full rewrite of `EventAttemptsModal`. The current schema is functional for all OWL coaches using standard IWF competition structure.
- **Decision needed:** Explicit user decision to proceed. Prerequisite: confirm whether non-OWL (Crossfit, Masters-only C&J, etc.) use cases are in scope for the product. If yes, this becomes Phase 1 work. If no, document the OWL-only constraint in CLAUDE.md.

---

**DOM-009 / DOM-005 / ENG-011: Intensity zone boundaries and `analysisInsights` thresholds hardcoded**
- **Why deferred:** CLAUDE.md designates the Analysis module as out-of-scope for the current work stream. `useAnalysis.ts` intensity zones (DOM-009) and `analysisInsights.ts` thresholds (DOM-005) are purely consumed by Analysis UI. TASK-020 addresses the configurable settings schema; the Analysis-facing wiring is deferred.
- **Decision needed:** When the Analysis module is un-hidden and brought into scope, complete TASK-020 and wire the settings values into `IntensityZones.tsx` and `analysisInsights.ts`.

---

**DOM-010 / ENG-009: Analysis components — name-matching for lift ratios, duplicated exercise queries**
- **Why deferred:** Analysis module is out of scope per CLAUDE.md. `useAnalysis.ts:fetchLiftRatios` name-matching (DOM-010) and the five duplicated exercise queries (ENG-009) are in Analysis-only code paths. TASK-018's `lift_slot` schema addition will make the code-only fix straightforward when Analysis is un-hidden. TASK-033's Zustand migration will eliminate the duplicate queries.
- **Decision needed:** Un-hiding Analysis module brings these into scope automatically.

---

**DOM-011: `BodyweightTrend` hardcodes IWF men's weight classes**
- **Why deferred:** `BodyweightTrend.tsx` is in the Analysis module (out of scope). The `WEIGHT_CLASSES` array is a presentational artifact only; it does not affect data storage.
- **Decision needed:** When Analysis is un-hidden, replace with a coach-configurable weight class list from settings seeded from a federation preset.

---

**DOM-014: `SessionView.getDefaultRestSeconds` — hardcoded OWL rest times via name-matching**
- **Why deferred:** `SessionView.tsx` is in the Training Log module (out of scope per CLAUDE.md).
- **Decision needed:** When Training Log is brought into scope, add `default_rest_seconds: number | null` to the `exercises` schema and wire it through `SessionView`.

---

**DOM-015: `metrics.ts` K-value description encodes 38–42% optimal range**
- **Why deferred:** While `metrics.ts` is in `src/lib/` (not Analysis-specific), the description string is display-only and has no effect on calculations or coach workflows. No user-facing decision is affected by the number being hardcoded.
- **Decision needed:** When `k_value_target_min`/`k_value_target_max` configurable settings are desired by the user, add them to `general_settings` and wire into the metric description.

---

**DAT-016: `exercises.category` is a free string with no FK to `categories` table**
- **Why deferred:** Migrating `exercises.category` to a `category_id uuid FK` requires a breaking schema migration and a backfill of all existing exercise rows. The DOM-006 code fix (TASK-021) addresses the most immediate single-source-of-truth violation without requiring the schema change. The rename-cascade use case needs validation.
- **Decision needed:** User confirmation that category rename should cascade to all exercises automatically (as opposed to the current manual bulk-update approach).

---

**DOM-016: Phase preset logic hardcodes names, colors, and week ratios**
- **Why deferred:** Domain reviewer assessed this as acceptable UX pattern ("starter preset" that is immediately editable). Coaches can freely rename/recolor after creation.
- **Decision needed:** If user wants coach-defined named presets, add a `macro_presets` table in a future iteration.

---

**DAT-012/DAT-013: `BodyweightEntry` and `AthletePR` lack `owner_id`**
- **Why deferred:** These tables isolate by `athlete_id`, and athletes are owner-scoped. The cross-coach exposure requires knowledge of an `athlete_id` UUID, which is not publicly enumerable. TASK-048 requires a written decision before implementation.
- **Decision needed:** User or security audit decision on whether defense-in-depth `owner_id` columns are required on these secondary tables.

---

**DAT-014: `ExerciseComboTemplate` — no `owner_id`, templates may be intentionally global**
- **Why deferred:** The intent (global shared templates vs. per-coach) is undocumented. Implementing either requires a decision.
- **Decision needed:** Decide whether combo templates are intentionally global (document in CLAUDE.md) or per-coach (add `owner_id` via migration).

---

**ENG-012 (partial): `BodyweightTrend.tsx` hardcodes IWF weight classes**
- **Why deferred:** In the Analysis module (out of scope). Same as DOM-011.
- **Decision needed:** Analysis module un-hiding.
