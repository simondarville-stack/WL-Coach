# EMOS 2.0 — CODEBASE REVIEW & CLEANUP

Full codebase audit: remove dead code, fix type safety, clean up
imports, verify consistency, and document the architecture.

Work on a new branch: `chore/codebase-cleanup`
Run `npm run build` after each group — it MUST compile.
Run `npx tsc --noEmit` after each group — it MUST pass.
Commit each group separately. Do not ask for confirmation.

---

## GROUP 0: CREATE BRANCH

```bash
git checkout main
git pull
git checkout -b chore/codebase-cleanup
```

---

## GROUP 1: DELETE DEAD FILES

The following files are NEVER imported by any active code path.
They are remnants from the old pre-planner architecture (ChatGPT era)
and the backup file from the planner rebuild.

**Verify each file is truly unused before deleting** — search for its
component/function name across the entire `src/` directory. If the
ONLY references are from other files in this dead list, it's safe.

Delete these files:
```
src/components/WeeklyPlanner backup.tsx    (780 lines — old backup)
src/components/WeeklyPlanner.tsx           (496 lines — old planner, replaced by planner/WeeklyPlanner.tsx)
src/components/AthleteLog.tsx              (790 lines — old training log, replaced by training-log/)
src/components/DayColumn.tsx               (885 lines — old day editor, only used by backup)
src/components/CopyWeekModal.tsx.bak       (backup file)
src/components/WeeklyPlannerHeader.tsx     (only used by backup)
src/components/WeeklySummaryPanel.tsx      (105 lines — only used by backup)
```

Check these before deleting — they may have ONE active import:
```
src/components/PrescriptionModal.tsx       — check if anything besides DayColumn imports it
src/components/ComboCard.tsx               — check if anything besides DayColumn imports it
src/components/ComboEditorModal.tsx         — check if anything besides DayColumn imports it
src/components/AthleteProgramme.tsx         — check if anything besides a comment references it
```

If these are confirmed unused, delete them too.

After deleting, run `npm run build`. If it fails, a live component was
importing something from a deleted file. Restore that file and remove
it from the dead list.

**Expected savings: ~4,000+ lines of dead code removed.**

---

## GROUP 2: CLEAN UP PlanSelector

File: src/components/PlanSelector.tsx

The new planner (src/components/planner/WeeklyPlanner.tsx) imports
`type { PlanSelection }` from PlanSelector but does NOT render the
`<PlanSelector>` component.

Move the `PlanSelection` type to `src/lib/database.types.ts` or
a shared types file. Then check if PlanSelector.tsx itself is still
imported anywhere as a COMPONENT (not just the type). If not, delete
PlanSelector.tsx.

---

## GROUP 3: ELIMINATE `any` TYPES

Find every `: any` annotation in the codebase:
```bash
grep -rn ": any\b" src/ --include="*.tsx" --include="*.ts"
```

For EACH occurrence:
1. Determine the correct type
2. Replace `any` with the proper type
3. If the correct type is genuinely unknown and complex,
   use `unknown` with type guards instead of `any`

Common patterns to fix:
- `catch (err: any)` → `catch (err: unknown)` with `if (err instanceof Error)`
- `(data as any).field` → proper interface or type assertion
- Function params typed as `any` → create proper interface
- State typed as `any` → infer from usage

---

## GROUP 4: REMOVE console.log STATEMENTS

Find all console statements:
```bash
grep -rn "console\.\(log\|warn\|error\|debug\|info\)" src/ --include="*.tsx" --include="*.ts"
```

Rules:
- `console.error` in catch blocks: KEEP (useful for debugging production issues)
- `console.log` for debugging: REMOVE
- `console.warn` for deprecation/unusual paths: KEEP if meaningful, REMOVE if debugging
- `console.debug`: REMOVE

---

## GROUP 5: CLEAN UP IMPORTS

For every file in `src/components/` and `src/hooks/`:

1. Remove unused imports (variables/types imported but never referenced)
2. Sort imports into groups:
   - React / third-party libraries
   - Internal components
   - Hooks
   - Types
   - Utils / constants
3. Remove duplicate imports
4. Fix relative path depth — if a component is importing from
   `../../lib/` when `../lib/` would work, simplify

Use the TypeScript compiler to detect unused imports:
```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1 | head -50
```

Fix every warning. If a parameter is intentionally unused (e.g., in a
callback signature), prefix it with underscore: `_event`.

---

## GROUP 6: TYPE CONSISTENCY AUDIT

### Database types (src/lib/database.types.ts)
1. Verify every interface matches the actual Supabase table schema
2. Check that nullable columns are marked with `| null`
3. Check that optional fields use `| null` not `?:` (Supabase always
   returns the field, just as null)
4. Verify `DefaultUnit` type includes all valid values used in the code

### Hook return types
Check that every hook explicitly types its return value or that
TypeScript can infer it correctly. No implicit `any` returns.

### Component props
Every component with more than 2 props should have a named interface
(not inline). Check for:
- Props interfaces that don't match actual usage
- Optional props that are always passed (make required)
- Required props that are sometimes undefined (make optional with `?`)

---

## GROUP 7: CONSISTENT ERROR HANDLING

Review every Supabase query in every hook:

### Pattern to enforce
```typescript
// CORRECT:
const { data, error } = await supabase.from('table').select('*');
if (error) throw error;
return data ?? [];

// WRONG:
const { data } = await supabase.from('table').select('*');
return data || [];  // silently swallows errors
```

Check every hook file:
- useAthletes.ts
- useExercises.ts
- useWeekPlans.ts
- useMacroCycles.ts
- useEvents.ts
- useTrainingGroups.ts
- useSettings.ts
- useCoachDashboard.ts
- useAnalysis.ts
- useTrainingLog.ts
- useCombos.ts
- useCoachProfiles.ts
- useMediaUpload.ts

For each Supabase call:
1. Is `error` checked?
2. Is `error` thrown or handled (not swallowed)?
3. Is `data` properly null-checked?

---

## GROUP 8: CONSISTENT NAMING

### File naming
- Components: PascalCase (ComponentName.tsx) ✓
- Hooks: camelCase (useHookName.ts) ✓
- Utils: camelCase (utilName.ts) ✓
- Check for any violations and rename

### Variable naming
- State variables: camelCase
- Constants: UPPER_SNAKE_CASE for true constants, camelCase for config
- Boolean variables: should start with is/has/should/can
- Handlers: should start with handle/on
- Check for inconsistencies and fix

### Interface naming
- Props interfaces: ComponentNameProps
- State interfaces: ComponentNameState (if separate from props)
- Data interfaces: PascalCase matching the concept
- Check for unnamed inline prop types on components

---

## GROUP 9: HOOK DEPENDENCY ARRAYS

Review every `useEffect` and `useCallback` in the codebase for
correct dependency arrays.

Common bugs to look for:
1. Missing dependencies (stale closures)
2. Over-specified dependencies (unnecessary re-runs)
3. Object/array dependencies causing infinite loops
4. Functions in dependency arrays that aren't memoized

For each `useEffect`:
- If it has `// eslint-disable-next-line` on the deps array,
  determine if the disable is valid or masking a bug
- If deps array is `[]` but uses external values, fix it

Check particularly:
- src/components/planner/WeeklyPlanner.tsx (complex state)
- src/components/planner/PrescriptionGrid.tsx (save callbacks)
- src/components/planner/ExerciseDetail.tsx (data fetching)
- src/hooks/useWeekPlans.ts (data loading)

---

## GROUP 10: REMOVE DUPLICATE LOGIC

Look for logic that's duplicated across multiple files:

### Date utilities
Check for date formatting/parsing functions that exist in multiple files:
- `toLocalISO()` — is this defined in more than one file?
- `getMonday()` / `getMondayISO()` — same logic in multiple hooks?
- `addWeeks()` — duplicated?

If duplicated, consolidate into `src/lib/dateUtils.ts` and import
from there.

### Prescription parsing
Is prescription parsing called directly in components that should
be using the grid instead? Check for inline parsing that could be
replaced with a call to the parser utility.

### Summary calculations
Is tonnage/sets/reps calculated in multiple places? Should all go
through one utility function.

---

## GROUP 11: COMPONENT SIZE REVIEW

Files over 500 lines should be reviewed for extraction opportunities:

```
885 src/components/DayColumn.tsx            ← deleted in Group 1
822 src/components/training-log/SessionView.tsx
819 src/components/planner/PrintWeekCompact.tsx
790 src/components/AthleteLog.tsx            ← deleted in Group 1
765 src/components/CoachDashboard.tsx
745 src/components/planner/WeeklyPlanner.tsx
732 src/hooks/useWeekPlans.ts
661 src/components/macro/MacroCycles.tsx
643 src/hooks/useMacroCycles.ts
599 src/hooks/useAnalysis.ts
596 src/components/planner/ExerciseDetail.tsx
```

For each remaining large file:
1. Can any sub-sections be extracted into their own component/hook?
2. Are there inline utility functions that belong in a shared util?
3. Does the file mix concerns (data fetching + rendering + business logic)?

DO NOT refactor these files now — just add a comment at the top:
```typescript
// TODO: Consider extracting [specific section] into [ComponentName]
```

This is a breadcrumb trail for future sessions, not an action item now.
Large refactors risk breaking things; the cleanup pass should be safe.

---

## GROUP 12: CSS / TAILWIND CONSISTENCY

### Check for inconsistencies
- Mixed spacing: some using `p-4` others `p-6` for same context
- Mixed border radius: `rounded-lg` vs `rounded-xl` vs `rounded-md`
- Mixed text sizes for same hierarchy level
- Hardcoded colors vs Tailwind classes
- Inline styles that could be Tailwind classes

### Fix patterns
- Card containers: standardize on `rounded-lg border border-gray-200`
- Modals: standardize on one backdrop + container pattern
- Section headers: standardize on one typography size/weight
- Buttons: check for inconsistent hover/active states

DO NOT restyle the entire app — just fix clear inconsistencies where
two identical UI elements use different classes.

---

## GROUP 13: SUPABASE MIGRATION FILE AUDIT

Review all files in `supabase/migrations/`:

1. Are they in chronological order?
2. Do any create tables/columns that no longer exist in the code?
3. Are there conflicting migrations (one creates, another drops)?
4. Do any use `CREATE POLICY IF NOT EXISTS` (unsupported — should use
   the `DO $$ BEGIN DROP POLICY IF EXISTS ...; CREATE POLICY ...; END $$;` pattern)?

Create a summary comment file if issues are found:
`supabase/MIGRATION_NOTES.md` listing any warnings.

---

## GROUP 14: BUILD & TYPE CHECK

Run the full verification:

```bash
# TypeScript check — must pass clean
npx tsc --noEmit

# Build — must succeed
npm run build

# Check bundle size
ls -la dist/assets/*.js | awk '{print $5/1024 "KB", $9}'
```

If any errors exist from the cleanup, fix them now.

Report:
- Number of files deleted
- Lines of code removed
- Number of `any` types eliminated
- Number of console statements removed
- Number of import cleanups
- Any issues found but NOT fixed (documented as TODOs)
- Final bundle size

---

## GROUP 15: ARCHITECTURE DOCUMENTATION

Create: `docs/ARCHITECTURE.md`

Write a concise architecture document covering:

```markdown
# EMOS Architecture

## Stack
React 18, TypeScript, Vite, Tailwind CSS, Supabase, Recharts

## Directory structure
src/
  components/          — UI components
    planner/           — Weekly planner subsystem
    training-log/      — Athlete training log
    analysis/          — Analysis/charting module
    macro/             — Macro cycle planner
    calendar/          — Competition calendar
    ui/                — Shared UI primitives
  hooks/               — Data hooks (Supabase queries)
  store/               — Zustand stores
  lib/                 — Utilities, types, constants

## Data flow
[Component] → [Hook] → [Supabase] → [Database]
                ↓
           [Zustand Store] (selected athlete, coach)

## Root tables (owner_id scoped)
athletes, exercises, week_plans, macrocycles,
events, training_groups, general_settings

## Child tables (FK-scoped, no owner_id needed)
planned_exercises → planned_set_lines
macrocycles → macro_weeks → macro_phases
training_log_sessions → training_log_exercises
athletes → athlete_prs, bodyweight_entries

## Key patterns
- owner_id filtering via getOwnerId()
- prescription_raw (text) + planned_set_lines (structured)
- summary fields on planned_exercises (denormalized for performance)
- day_index = abstract slot, not calendar weekday
- day_schedule = optional weekday+time mapping
```

Keep it under 100 lines. This is a map, not a novel.

---

## GROUP 16: FINAL VERIFICATION

Open Chrome at http://localhost:5173 and do a quick smoke test:

1. Navigate to every page — no crashes
2. Planner: select athlete, verify exercises load
3. Add an exercise, edit the grid, close, reopen — persists
4. Print: both modes render
5. Analysis: select a chart preset — renders
6. Macro cycles: page loads
7. Calendar: page loads
8. Settings: page loads, settings save
9. Roster: athletes visible
10. Exercise library: exercises visible
11. Training log: page loads
12. Dashboard: loads without errors
13. Console: no errors (warnings about React dev mode are OK)

If anything broke from the cleanup, fix it immediately.

Push the branch when done.
