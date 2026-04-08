# EMOS 2.0 — MACRO GROUP PLANS, EXERCISE TOGGLES, TEMPLATES & EXCEL

Four features for the macro module:
1. Macrocycles for training groups (not just individual athletes)
2. Exercise visibility toggles in table and graph views
3. Percentage-based templates via Excel import, resolved to kg per athlete
4. Full macro export to Excel (enhance existing)

Work on a new branch: `feature/macro-groups-and-templates`
Run `npm run build` after each group. Commit each group separately.
Do not ask for confirmation.

---

## GROUP 0: CREATE BRANCH

```bash
git checkout main
git pull
git checkout -b feature/macro-groups-and-templates
```

---

# ════════════════════════════════════════════════
# PART A: MACROCYCLES FOR TRAINING GROUPS
# ════════════════════════════════════════════════

## GROUP 1: DATABASE — GROUP MACROCYCLE SUPPORT

Create: `supabase/migrations/20260407_macro_group_support.sql`

```sql
-- Allow macrocycles to belong to a group instead of an individual athlete
-- Exactly one of athlete_id or group_id must be set (not both, not neither)
ALTER TABLE macrocycles
  ADD COLUMN IF NOT EXISTS group_id uuid DEFAULT NULL
  REFERENCES training_groups(id) ON DELETE CASCADE;

-- Remove NOT NULL from athlete_id (it can now be null for group macros)
ALTER TABLE macrocycles ALTER COLUMN athlete_id DROP NOT NULL;

-- Ensure exactly one owner type
ALTER TABLE macrocycles
  ADD CONSTRAINT macrocycles_owner_check
  CHECK (
    (athlete_id IS NOT NULL AND group_id IS NULL)
    OR (athlete_id IS NULL AND group_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_macrocycles_group ON macrocycles(group_id);
```

---

## GROUP 2: UPDATE TYPES

File: src/lib/database.types.ts

MacroCycle:
```typescript
export interface MacroCycle {
  id: string;
  athlete_id: string | null;   // null for group macros
  group_id: string | null;     // null for individual macros
  name: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}
```

---

## GROUP 3: UPDATE useMacroCycles HOOK

File: src/hooks/useMacroCycles.ts

### Fetch — support both athlete and group
```typescript
const fetchMacrocycles = async (
  target: { type: 'athlete'; id: string } | { type: 'group'; id: string }
): Promise<void> => {
  const query = supabase.from('macrocycles').select('*');

  if (target.type === 'athlete') {
    query.eq('athlete_id', target.id);
  } else {
    query.eq('group_id', target.id);
  }

  const { data, error } = await query.order('start_date', { ascending: false });
  if (error) throw error;
  setMacrocycles(data ?? []);
};
```

### Create — support both
```typescript
const createMacrocycle = async (
  target: { type: 'athlete'; id: string } | { type: 'group'; id: string },
  name: string,
  startDate: string,
  endDate: string,
  ...
): Promise<void> => {
  const insertData = {
    name,
    start_date: startDate,
    end_date: endDate,
    owner_id: getOwnerId(),
    ...(target.type === 'athlete'
      ? { athlete_id: target.id, group_id: null }
      : { athlete_id: null, group_id: target.id }
    ),
  };
  // ... rest unchanged
};
```

### Actuals — for group macros, aggregate across all group members
```typescript
const fetchMacroActuals = async (
  target: { type: 'athlete'; id: string } | { type: 'group'; id: string },
  macroWeeks: MacroWeek[],
  trackedExercises: MacroTrackedExerciseWithExercise[],
): Promise<MacroActualsMap> => {
  if (target.type === 'athlete') {
    return fetchActualsForAthlete(target.id, macroWeeks, trackedExercises);
  }

  // Group: fetch members, aggregate actuals across all members
  const { data: members } = await supabase
    .from('group_members')
    .select('athlete_id')
    .eq('group_id', target.id)
    .is('left_at', null);

  if (!members?.length) return {};

  // For group actuals, use the AVERAGE across members
  // (alternative: show individual lines — but that's complex)
  const allActuals: MacroActualsMap[] = [];
  for (const m of members) {
    const a = await fetchActualsForAthlete(m.athlete_id, macroWeeks, trackedExercises);
    allActuals.push(a);
  }

  return averageActuals(allActuals, macroWeeks, trackedExercises);
};
```

---

## GROUP 4: MACRO UI — GROUP SELECTOR

File: src/components/macro/MacroCycles.tsx

Currently the macro page requires `selectedAthlete`. Extend it to
work with either `selectedAthlete` OR `selectedGroup`.

### Mode detection
```typescript
const { selectedAthlete } = useAthleteStore();
const { selectedGroup } = useAthleteStore(); // groups stored in same store

const macroTarget = selectedGroup
  ? { type: 'group' as const, id: selectedGroup.id }
  : selectedAthlete
  ? { type: 'athlete' as const, id: selectedAthlete.id }
  : null;
```

### When viewing a group macro:
- Show group name + member count in the header
- Show member avatar row below
- Graph view shows aggregated data (average of members)
- Table view shows the PLANNED targets (same for all members)
- An "Individual view" dropdown lets the coach switch to see
  one specific athlete's actuals against the group targets

### When creating a new macro:
- If a group is selected, create a group macro
- If an athlete is selected, create an individual macro
- Show a badge: "Group macro" or "Individual macro"

---

# ════════════════════════════════════════════════
# PART B: EXERCISE VISIBILITY TOGGLES
# ════════════════════════════════════════════════

## GROUP 5: EXERCISE TOGGLE IN TABLE VIEW

File: src/components/macro/MacroTable.tsx

### Problem
When a macro has 8+ tracked exercises, the table is very wide and
hard to read. Coaches need to toggle exercises on/off to compare
specific combinations.

### Add toggle chips above the table

```tsx
<div className="flex flex-wrap gap-1.5 mb-3">
  {trackedExercises.map(te => {
    const visible = visibleExercises.has(te.id);
    return (
      <button
        key={te.id}
        onClick={() => toggleExercise(te.id)}
        className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors
          ${visible
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : 'bg-gray-50 text-gray-400 border-gray-200 line-through'
          }`}
      >
        {te.exercise.exercise_code || te.exercise.name}
      </button>
    );
  })}
  <button
    onClick={() => setVisibleExercises(new Set(trackedExercises.map(t => t.id)))}
    className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-600"
  >
    Show all
  </button>
</div>
```

### State management
```typescript
const [visibleExercises, setVisibleExercises] = useState<Set<string>>(
  () => new Set(trackedExercises.map(t => t.id)) // all visible by default
);

const toggleExercise = (teId: string) => {
  setVisibleExercises(prev => {
    const next = new Set(prev);
    if (next.has(teId)) next.delete(teId);
    else next.add(teId);
    return next;
  });
};
```

### Filter the table columns
When rendering exercise columns, only show exercises in visibleExercises:
```typescript
const displayedExercises = trackedExercises.filter(te => visibleExercises.has(te.id));
```

Use `displayedExercises` instead of `trackedExercises` for column rendering.
Keep the full `trackedExercises` for data fetching and saves.

---

## GROUP 6: EXERCISE TOGGLE IN GRAPH VIEW

File: src/components/macro/MacroGraphView.tsx
File: src/components/macro/MacroDraggableChart.tsx

### Share the same toggle state
Pass `visibleExercises` and `toggleExercise` from the parent
MacroCycles component down to both MacroTable and MacroGraphView.

### In MacroGraphView
Filter which exercise lines are drawn:
```typescript
const displayedExercises = trackedExercises.filter(te => visibleExercises.has(te.id));
```

Pass `displayedExercises` to MacroDraggableChart instead of full list.

### In MacroDraggableChart
Only render Line elements for exercises in the filtered list.
Hidden exercises should NOT appear in tooltips, legends, or Y-axis
scaling calculations.

### Exercise legend with toggles
Show the exercise toggle chips above the graphs too (same component).
Toggling in the table view should also toggle in the graph view
(shared state).

---

## GROUP 7: LIFT TO PARENT

File: src/components/macro/MacroCycles.tsx

Move `visibleExercises` state to MacroCycles (the parent) so both
MacroTable and MacroGraphView share it:

```typescript
const [visibleExercises, setVisibleExercises] = useState<Set<string>>(new Set());

// Initialize when trackedExercises load
useEffect(() => {
  setVisibleExercises(new Set(trackedExercises.map(t => t.id)));
}, [trackedExercises.length]);
```

Pass to children:
```tsx
<MacroTable
  visibleExercises={visibleExercises}
  onToggleExercise={toggleExercise}
  onShowAllExercises={() => setVisibleExercises(new Set(trackedExercises.map(t => t.id)))}
  ...
/>
```

Create a shared ExerciseToggleBar component:
```tsx
// src/components/macro/ExerciseToggleBar.tsx
interface ExerciseToggleBarProps {
  exercises: MacroTrackedExerciseWithExercise[];
  visible: Set<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
}
```

Use it in both MacroTable and MacroGraphView.

---

# ════════════════════════════════════════════════
# PART C: TEMPLATES
# ════════════════════════════════════════════════

## GROUP 8: TEMPLATE CONCEPT

A template is a macrocycle written in PERCENTAGES that can be applied
to any athlete. The workflow:

1. Coach builds a template in Excel (or exports an existing macro as template)
2. Template uses exercise codes and percentage-based targets
3. Coach imports template → creates a new macro for an athlete/group
4. System resolves % to kg using athlete PRs

### Template Excel format
Same structure as the existing export, but with additions:

```
Sheet: "Template Info"
  Template name: Smolov Base Mesocycle
  Duration: 4 weeks
  Unit: percentage
  Exercises: Sn, C&J, BSq, FSq

Sheet: "Phase 1 - Loading" (weeks 1-3)
  Wk | Type    | Label       | Total Reps | Sn          | BSq
     |         |             |            | Reps | Max%  | Reps | Max%
  1  | volume  | High volume | 136        | 36   | 85    | 100  | 85
  2  | volume  | High volume | 136        | 36   | 87    | 100  | 87
  3  | volume  | Peak        | 136        | 36   | 90    | 100  | 90

Sheet: "Phase 2 - Deload" (week 4)
  4  | deload  | Recovery    | 39         | 9    | 70    | 30   | 65
```

Key difference from regular export: target_max and target_avg
columns contain PERCENTAGE values (0-100), not absolute kg.

---

## GROUP 9: EXPORT AS TEMPLATE

File: src/components/macro/MacroExcelIO.tsx

Add an "Export as template" button alongside the existing "Export Excel":

```tsx
<button onClick={handleExportTemplate}>
  Export as template (%)
</button>
```

### Logic
Same as existing export, but:
1. Add a "Template Info" sheet with metadata
2. If the macro's targets are in kg, convert to % using the athlete's
   PRs for each tracked exercise:
   ```
   percentage = (absolute_kg / athlete_PR_for_exercise) * 100
   ```
3. If the athlete has no PR for an exercise, leave as absolute
   and flag with a comment in the cell
4. Round percentages to nearest integer

The template file is a regular .xlsx that can be edited in Excel.

---

## GROUP 10: IMPORT TEMPLATE

File: src/components/macro/MacroExcelIO.tsx

Add an "Import template" button:

```tsx
<button onClick={() => templateFileInputRef.current?.click()}>
  Import template
</button>
```

### Template import workflow

1. **Parse the template file** — same parser as regular import,
   but detect the "Template Info" sheet to determine it's a template

2. **Show a resolution dialog with editable PRs:**
   ```
   ┌──────────────────────────────────────────────────────────┐
   │ Import template: Smolov Base Mesocycle                   │
   │                                                          │
   │ Apply to: [Ida Mørck            ▾]                      │
   │                                                          │
   │ ── Exercise mapping ──────────────────────────────────── │
   │                                                          │
   │   Template "Sn"  → [Snatch              ▾]              │
   │   Template "BSq" → [Back Squat          ▾]              │
   │   Template "FSq" → [Front Squat         ▾]              │
   │                                                          │
   │ ── Reference PRs for resolution ─────────────────────── │
   │   These values are used to calculate kg from %.          │
   │   Defaults come from the athlete's PR table.             │
   │   Edit to plan from a TARGET PR (goal) instead.          │
   │                                                          │
   │   Exercise       Current PR    Planning PR    Max in plan │
   │   ─────────────────────────────────────────────────────── │
   │   Snatch           79 kg      [ 82 ] kg      85% → 70   │
   │   Back Squat       160 kg     [ 170 ] kg     90% → 153  │
   │   Front Squat      — (no PR)  [ 135 ] kg     85% → 115  │
   │                                                          │
   │   Derived exercises (auto-resolved):                     │
   │   Power Snatch        → uses Snatch PR (82)              │
   │   Hang Snatch         → uses Snatch PR (82)              │
   │   Clean Pull          → uses Clean & Jerk PR (105)       │
   │                                                          │
   │ ── Preview ──────────────────────────────────────────── │
   │                                                          │
   │   Wk 1: Sn Max 85% → 70 kg · BSq Max 90% → 153 kg     │
   │   Wk 2: Sn Max 87% → 71 kg · BSq Max 92% → 156 kg     │
   │   Wk 3: Sn Max 90% → 74 kg · BSq Max 95% → 162 kg     │
   │   Wk 4: Sn Max 70% → 57 kg · BSq Max 65% → 111 kg     │
   │                                                          │
   │ [Cancel]          [Import as %]    [Import as kg]        │
   └──────────────────────────────────────────────────────────┘
   ```

   **The "Planning PR" column is the key innovation.**

   For each exercise that appears in the template:
   - "Current PR" = read-only, fetched from athlete_prs table
   - "Planning PR" = editable input, defaults to Current PR
   - "Max in plan" = live preview: highest % in template × Planning PR
   - If Current PR is null, the field is empty with a red border
     and "Required" hint — the coach MUST enter a value

   For derived exercises (pr_reference_exercise_id set):
   - They inherit from their parent exercise's Planning PR
   - Shown in a "Derived exercises" section below, non-editable
   - Example: Power Snatch → uses Snatch Planning PR

   **The Planning PR values are NOT saved back to athlete_prs.**
   They are only used for this specific resolution. The athlete's
   actual PR table stays unchanged. This is critical — the coach
   might plan from a goal PR (82 kg) while the athlete's current
   best is still 79 kg.

   However, offer an optional checkbox at the bottom:
   ```
   ☐ Also update athlete's PR table with these planning values
   ```
   When checked, the planning PRs are written to athlete_prs
   after the import completes. Useful when the coach has updated
   information about the athlete's capabilities.

   **Live preview updates as the coach edits PRs.** When the coach
   changes "Snatch Planning PR" from 79 to 82, the entire preview
   column recalculates instantly. This is the "planning backwards"
   workflow — the coach adjusts the target PR until the kg values
   in the preview look right for the athlete.

3. **Exercise mapping** — the template uses exercise codes. The
   import dialog matches template codes to the coach's exercise
   library. Auto-match by code, with dropdown fallback for
   unmatched exercises.

4. **Two import modes:**
   - "Import as %" — creates macro with percentage targets (useful
     for group macros where each athlete has different PRs, or when
     the coach wants to keep the template flexible)
   - "Import as kg" — resolves percentages to absolute kg using
     the Planning PRs entered above

5. **Create the macro:**
   - Create macrocycle for the target athlete/group
   - Create macro weeks from template weeks
   - Create phases from template sheets
   - Create tracked exercises from mapped exercises
   - Insert targets (either % or resolved kg using Planning PRs)

### For GROUP imports (not individual athlete)
When importing a template onto a training group:
- The PR resolution panel shows a dropdown per exercise:
  "Use whose PRs? [Group average ▾] / [Athlete A] / [Athlete B]"
- Or skip PR resolution entirely and import as % (most common for groups)
- The coach can later resolve % → kg per individual athlete from
  the weekly planner using the "Calculate kg" button (from the
  metrics & groups prompt)

### PR resolution logic
```typescript
/**
 * Resolve a percentage target to absolute kg using planning PRs.
 * 
 * @param percentage - the % value from the template (e.g., 85)
 * @param exerciseId - the exercise being resolved
 * @param planningPRs - coach-edited PR values (may differ from athlete_prs)
 * @param prReferences - exercise_id → reference_exercise_id
 * @returns resolved kg value, or null if no PR available
 */
function resolvePercentage(
  percentage: number,
  exerciseId: string,
  planningPRs: Map<string, number>,      // exercise_id → planning PR (kg)
  prReferences: Map<string, string>,      // exercise_id → reference_exercise_id
): number | null {
  // Follow PR reference chain (one level max)
  const refId = prReferences.get(exerciseId) ?? exerciseId;
  const pr = planningPRs.get(refId);
  if (!pr) return null;
  return Math.round(pr * percentage / 100);
}

/**
 * Build the initial planning PRs map from athlete's current PRs.
 * The coach can then edit these values in the resolution dialog.
 */
async function loadPlanningPRDefaults(
  athleteId: string,
  exerciseIds: string[],
): Promise<Map<string, number>> {
  const { data: prs } = await supabase
    .from('athlete_prs')
    .select('exercise_id, pr_value_kg')
    .eq('athlete_id', athleteId)
    .in('exercise_id', exerciseIds);

  const map = new Map<string, number>();
  (prs || []).forEach(pr => {
    if (pr.pr_value_kg) map.set(pr.exercise_id, pr.pr_value_kg);
  });
  return map;
}
```

### Planning PR component

Create: src/components/macro/PlanningPRPanel.tsx

```tsx
interface PlanningPRPanelProps {
  exercises: Array<{
    id: string;
    name: string;
    exerciseCode: string | null;
    currentPR: number | null;         // from athlete_prs (read-only)
    prReferenceId: string | null;     // derives from another exercise
  }>;
  planningPRs: Map<string, number>;   // editable values
  onUpdatePR: (exerciseId: string, value: number) => void;
  maxPercentages: Map<string, number>; // highest % in template per exercise
}
```

This component renders the "Reference PRs for resolution" section
of the import dialog. It:
- Groups exercises into "direct PR" and "derived" sections
- Shows Current PR (read-only), Planning PR (editable input),
  and a live "Max in plan" preview column
- Updates the preview instantly on each keystroke
- Highlights exercises with no PR (red border, "Required" text)
- Shows derived exercises in a subtle sub-section with "→ uses [parent] PR"
```

---

## GROUP 11: TEMPLATE LIBRARY (SIMPLE)

For now, templates are just .xlsx files the coach manages locally.
No in-app template library yet. The workflow is:

1. Coach creates a macro (manually or from Excel)
2. "Export as template" → saves .xlsx
3. Later, "Import template" → .xlsx → new macro for different athlete

Future: an in-app template gallery where coaches can save and browse
their templates. Not in this build.

---

# ════════════════════════════════════════════════
# PART D: ENHANCED EXCEL EXPORT
# ════════════════════════════════════════════════

## GROUP 12: FULL MACRO EXPORT IMPROVEMENTS

File: src/components/macro/MacroExcelIO.tsx

### Current issues
The existing export works but is basic. Improve it:

### 12a. Add a summary sheet
Add a "Summary" sheet at the beginning of the workbook:

```
Macrocycle: Smolov Base Mesocycle
Athlete: Ida Mørck
Weight class: W64
Start: 2026-03-30
End: 2026-04-26
Duration: 4 weeks

Phase overview:
  Loading (weeks 1-3): volume, competition prep
  Deload (week 4): recovery

Weekly totals:
  Wk 1: 136 reps, Max 145kg, Avg 85kg, T 11,560kg, K 41%
  Wk 2: 136 reps, Max 150kg, Avg 89kg, T 12,104kg, K 42%
  ...
```

### 12b. Add actuals alongside targets
For each exercise in each week, add columns for actual data
(if available):

```
         | Sn (Target) | Sn (Actual) |
         | Reps | Max   | Reps | Max  |
  Wk 1   | 36   | 85    | 34   | 82   |
```

This gives the coach a complete planned-vs-performed view in Excel.

### 12c. Styling
Use xlsx-style or SheetJS Pro features (if available) for:
- Bold headers
- Phase color bands
- Freeze first row + first column
- Column auto-width

If SheetJS doesn't support styling in the free version, add
conditional formatting instructions as comments or a legend row.

### 12d. Include daily plan (optional sheet)
Add an optional "Weekly Plans" sheet that includes the actual
exercise prescriptions per day per week. This makes the export
a complete training document:

```
Sheet: "Week 1 Plans"
  Day 1 (Monday):
    Snatch: 60x3, 70x2, 80x2x3, 85x2x2
    C&J: 80x2, 90x2x3
  Day 2 (Wednesday):
    Back Squat: 100x5, 110x4x4
    ...
```

This requires fetching week_plans and planned_exercises for the
macro's date range. Only include if the data exists.

---

## GROUP 13: EXPORT BUTTON PLACEMENT

File: src/components/macro/MacroCycles.tsx

The export/import buttons should be in the macro toolbar:

```
[📊 Table] [📈 Graph] [···]   [↓ Export Excel] [↓ Export Template %] [↑ Import] [↑ Import Template]
```

Group the buttons logically:
- View toggles: Table / Graph
- Export: "Export Excel" (full with actuals) | "Export as template (%)"
- Import: "Import Excel" (absolute) | "Import template (%)"

---

# ════════════════════════════════════════════════
# TESTING
# ════════════════════════════════════════════════

## GROUP 14: TESTING

### Group macro
1. Select a training group with 2+ athletes
2. Navigate to Macro Cycles → create new macro
3. Verify it creates with `group_id` set, `athlete_id` null
4. Add tracked exercises, set targets
5. Graph view shows aggregated actuals from group members
6. Table view shows planned targets
7. "Individual view" dropdown shows per-athlete actuals

### Exercise toggles
8. Open a macro with 4+ tracked exercises
9. Toggle chips appear above the table
10. Click an exercise chip → it grays out with line-through
11. Column disappears from the table
12. Switch to graph view → line disappears from charts
13. Toggle back on → column/line reappears
14. "Show all" → everything visible
15. Toggle state is SHARED between table and graph views

### Template export
16. Open an existing individual macro with targets
17. Click "Export as template (%)"
18. Open the .xlsx → verify percentages (not absolute kg)
19. Verify "Template Info" sheet with metadata

### Template import with PR editing
20. Click "Import template" → select the exported template
21. Resolution dialog shows exercise mapping (auto-matched)
22. Below mapping: "Reference PRs for resolution" panel appears
23. Each exercise shows Current PR (read-only) and Planning PR (editable)
24. Default Planning PR = Current PR from athlete_prs
25. Change Snatch Planning PR from 79 → 82 (planning for a new target)
26. Preview column updates live: "Max 85% → 70 kg" recalculates instantly
27. Derived exercises (Power Snatch → Snatch) update automatically
28. Exercise with no PR shows empty field with red border — enter a value
29. Click "Import as kg" → macro created with kg values based on Planning PRs
30. Verify: Snatch targets resolved from 82 (planning PR), not 79 (current PR)
31. The athlete's PR table still shows 79 (unchanged)

### Template import — update PRs checkbox
32. Import another template, check "Also update athlete's PR table"
33. After import, verify athlete_prs updated with the planning values
34. PR table now shows the new values

### Template import — plan backwards workflow
35. Coach wants Ida to total 190 (Sn 85 + CJ 105)
36. Import a percentage template
37. Set Snatch Planning PR = 85, C&J Planning PR = 105
38. Preview shows all weeks with kg values derived from goal PRs
39. Coach adjusts until the preview looks right
40. Import as kg → macro reflects the backwards-planned values

### Template on group
41. Import a template onto a training group
42. PR panel shows "Import as % (skip PR resolution)" by default
43. Coach can optionally select an athlete to preview resolution
44. Import as % → group macro created with percentage targets
45. Individual athletes resolve later via "Calculate kg" button

### Full Excel export
32. Export a macro with actuals
33. Verify summary sheet with totals
34. Verify target + actual columns side by side
35. Verify daily plans sheet (if data exists)

### Edge cases
46. Group macro with member who has no PRs → actuals show 0
47. Template with exercises not in coach's library → mapping dropdown
48. Export empty macro (no targets) → valid but empty sheets
49. Import template, athlete missing all PRs → all fields red, "Import as %" still works
50. Toggle all exercises off → table shows just week info (no exercise columns)
51. Planning PR set to 0 → validation error, blocks import as kg
52. Planning PR lower than current PR → allowed (coach might plan conservatively)
53. Circular PR reference in exercise library → blocked, shows warning
54. No console errors throughout

Fix any issues found during testing.
