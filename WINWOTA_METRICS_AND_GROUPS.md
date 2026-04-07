# WINWOTA 2.0 — STREAMLINED METRICS + GROUP PLANS

Two major features in one prompt:
A) Rename "hi" → "max", standardize metric presentation everywhere,
   add K-value as a new metric
B) Group plans that auto-apply to athletes, with PR-based percentage
   resolution and exercise PR reference chains

Work on a new branch: `feature/metrics-and-group-plans`
Run `npm run build` after each group. Commit each group separately.
Do not ask for confirmation.

---

## GROUP 0: CREATE BRANCH

```bash
git checkout main
git pull
git checkout -b feature/metrics-and-group-plans
```

---

# ════════════════════════════════════════════════
# PART A: STREAMLINED METRICS
# ════════════════════════════════════════════════

## GROUP 1: DATABASE — RENAME hi → max + ADD K-VALUE SUPPORT

Create: `supabase/migrations/20260406_metrics_rename_and_k_value.sql`

```sql
-- 1. Rename macro_targets columns: hi → max, ave → avg
ALTER TABLE macro_targets RENAME COLUMN target_hi TO target_max;
ALTER TABLE macro_targets RENAME COLUMN target_ave TO target_avg;
ALTER TABLE macro_targets RENAME COLUMN target_rhi TO target_reps_at_max;
ALTER TABLE macro_targets RENAME COLUMN target_shi TO target_sets_at_max;

-- 2. Add competition_total to athletes (for K-value calculation)
-- This is the best Snatch + best C&J used as the K denominator.
-- NULL = auto-derive from athlete_prs on competition lifts.
ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS competition_total numeric(6,2) DEFAULT NULL;

-- 3. Add PR reference to exercises
-- When set, this exercise derives its percentage from another exercise's PR.
-- e.g., Power Snatch references Snatch — so 80% Power Snatch = 80% of Snatch PR.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS pr_reference_exercise_id uuid DEFAULT NULL
  REFERENCES exercises(id) ON DELETE SET NULL;

-- 4. Add track_pr toggle to exercises
-- When false, this exercise is excluded from the PR table entirely.
-- Useful for accessories (sit-ups, carries, etc.) where PRs are irrelevant.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS track_pr boolean DEFAULT true;
```

---

## GROUP 2: UPDATE TYPES

File: src/lib/database.types.ts

### Athlete
Add:
```typescript
competition_total: number | null;  // manual override for K-value denominator
```

### Exercise
Add:
```typescript
pr_reference_exercise_id: string | null;  // derives % from this exercise's PR
track_pr: boolean;                         // false = excluded from PR table
```

### MacroTarget
Rename fields:
```typescript
// OLD → NEW
target_hi → target_max
target_ave → target_avg
target_rhi → target_reps_at_max
target_shi → target_sets_at_max
```

### PlannedExercise — rename summary field
The database column `summary_highest_load` stays as-is (no DB rename
needed — it's already descriptive). But in the UI layer, always label
it "Max" not "Hi".

---

## GROUP 3: DEFINE STANDARD METRIC ORDER

Create: src/lib/metrics.ts

This file defines the canonical metric list, order, labels, and
calculation functions used EVERYWHERE summaries appear.

```typescript
export type MetricKey = 'reps' | 'sets' | 'max' | 'avg' | 'tonnage' | 'k';

export interface MetricDefinition {
  key: MetricKey;
  label: string;          // "Reps", "Sets", "Max", "Avg", "Tonnage", "K"
  shortLabel: string;     // "R", "S", "Max", "Avg", "T", "K"
  unit: string;           // "", "", "kg", "kg", "kg", "%"
  description: string;
  defaultVisible: boolean;
}

export const METRICS: MetricDefinition[] = [
  {
    key: 'reps',
    label: 'Reps',
    shortLabel: 'R',
    unit: '',
    description: 'Total repetitions',
    defaultVisible: true,
  },
  {
    key: 'sets',
    label: 'Sets',
    shortLabel: 'S',
    unit: '',
    description: 'Total sets',
    defaultVisible: true,
  },
  {
    key: 'max',
    label: 'Max',
    shortLabel: 'Max',
    unit: 'kg',
    description: 'Highest load used',
    defaultVisible: true,
  },
  {
    key: 'avg',
    label: 'Avg',
    shortLabel: 'Avg',
    unit: 'kg',
    description: 'Average load (weighted by reps)',
    defaultVisible: false,
  },
  {
    key: 'tonnage',
    label: 'Tonnage',
    shortLabel: 'T',
    unit: 'kg',
    description: 'Total volume (load × reps summed)',
    defaultVisible: true,
  },
  {
    key: 'k',
    label: 'K',
    shortLabel: 'K',
    unit: '%',
    description: 'Average intensity / competition total (optimal: 38-42%)',
    defaultVisible: false,
  },
];

export const METRIC_ORDER: MetricKey[] = ['reps', 'sets', 'max', 'avg', 'tonnage', 'k'];

export const DEFAULT_VISIBLE_METRICS: MetricKey[] = ['reps', 'sets', 'max', 'tonnage'];

export interface ComputedMetrics {
  reps: number;
  sets: number;
  max: number;         // highest load
  avg: number;         // weighted average intensity (AAI)
  tonnage: number;     // total volume in kg
  k: number | null;    // avg / competition_total, null if no total set
}

/**
 * Compute all metrics from planned exercises.
 */
export function computeMetrics(
  exercises: Array<{
    summary_total_sets: number | null;
    summary_total_reps: number | null;
    summary_highest_load: number | null;
    summary_avg_load: number | null;
    counts_towards_totals?: boolean;
  }>,
  competitionTotal: number | null,
): ComputedMetrics {
  let reps = 0, sets = 0, max = 0, tonnage = 0;
  let weightedLoadSum = 0;

  for (const ex of exercises) {
    if (ex.counts_towards_totals === false) continue;
    const s = ex.summary_total_sets ?? 0;
    const r = ex.summary_total_reps ?? 0;
    const hi = ex.summary_highest_load ?? 0;
    const avg = ex.summary_avg_load ?? 0;

    sets += s;
    reps += r;
    if (hi > max) max = hi;
    tonnage += avg * r;  // tonnage = sum of (avg_load × reps) per exercise
    weightedLoadSum += avg * r;
  }

  const avg = reps > 0 ? Math.round(weightedLoadSum / reps) : 0;
  const k = (competitionTotal && competitionTotal > 0 && avg > 0)
    ? Math.round((avg / competitionTotal) * 100) / 100
    : null;

  return {
    reps,
    sets,
    max: Math.round(max),
    avg,
    tonnage: Math.round(tonnage),
    k,
  };
}

/**
 * Format a metric value for display.
 */
export function formatMetricValue(key: MetricKey, value: number | null): string {
  if (value === null || value === undefined) return '—';
  switch (key) {
    case 'reps':
    case 'sets':
      return String(value);
    case 'max':
    case 'avg':
      return `${value}`;
    case 'tonnage':
      return value >= 1000 ? `${(value / 1000).toFixed(1)}t` : `${value}`;
    case 'k':
      return `${(value * 100).toFixed(0)}%`;
    default:
      return String(value);
  }
}
```

---

## GROUP 4: K-VALUE — AUTO-DERIVE COMPETITION TOTAL

Create: src/lib/kValue.ts (or add to metrics.ts)

```typescript
import { supabase } from './supabase';

/**
 * Get the competition total for an athlete.
 * If athlete.competition_total is set (manual override), use that.
 * Otherwise, auto-derive from PRs on competition lifts:
 *   total = best Snatch PR + best C&J PR
 */
export async function getCompetitionTotal(athleteId: string): Promise<number | null> {
  // 1. Check manual override
  const { data: athlete } = await supabase
    .from('athletes')
    .select('competition_total')
    .eq('id', athleteId)
    .single();

  if (athlete?.competition_total) return athlete.competition_total;

  // 2. Auto-derive from PRs on competition lifts
  const { data: prs } = await supabase
    .from('athlete_prs')
    .select('pr_value_kg, exercise:exercises!inner(id, is_competition_lift, category)')
    .eq('athlete_id', athleteId);

  if (!prs?.length) return null;

  // Find best snatch and best C&J
  let bestSnatch = 0;
  let bestCJ = 0;

  for (const pr of prs) {
    const ex = pr.exercise as any;
    if (!ex?.is_competition_lift) continue;
    const val = pr.pr_value_kg ?? 0;
    const cat = (ex.category || '').toLowerCase();

    if (cat.includes('snatch') && !cat.includes('pull') && !cat.includes('power')) {
      bestSnatch = Math.max(bestSnatch, val);
    } else if (
      cat.includes('clean') && cat.includes('jerk') ||
      cat === 'clean & jerk' ||
      cat === 'clean and jerk'
    ) {
      bestCJ = Math.max(bestCJ, val);
    }
  }

  if (bestSnatch === 0 || bestCJ === 0) return null;
  return bestSnatch + bestCJ;
}
```

Note: this auto-derive logic depends on `is_competition_lift` and
`category` fields on exercises. The categories "Snatch" and
"Clean & Jerk" (or similar) must be correctly set on the competition
lifts. If the coach's exercise categories use different naming, the
manual `competition_total` override on the athlete handles it.

---

## GROUP 5: RENAME "hi" → "max" EVERYWHERE

### Search and replace across the entire codebase:

**Database field references (in Supabase queries):**
- `target_hi` → `target_max`
- `target_ave` → `target_avg`
- `target_rhi` → `target_reps_at_max`
- `target_shi` → `target_sets_at_max`

**TypeScript interfaces (already done in Group 2):**
- Already renamed in database.types.ts

**Component display labels:**
- Any UI text showing "Hi" or "hi" in the context of load metrics
  → change to "Max"
- Example: `view === 'hi'` → `view === 'max'`
- Example: `soll_hi` → `soll_max`
- Example: `ist_hi` → `ist_max`

**Files to update (search each for "hi" in metric context):**
```
src/components/planner/SollIstChart.tsx         — soll_hi, ist_hi, view toggle
src/components/planner/ExerciseDetail.tsx        — hi, hiReps
src/components/planner/ExerciseHistoryChart.tsx   — plan_hi, perf_hi, soll_hi
src/components/planner/PrintWeekCompact.tsx       — MHG header label
src/components/planner/PrintWeek.tsx              — any "hi" labels
src/components/planner/WeekSummary.tsx            — metric display
src/components/planner/DayCard.tsx                — metric display
src/components/planner/PlannerControlPanel.tsx    — metric display
src/components/macro/MacroTable.tsx               — column headers
src/components/macro/MacroEditModal.tsx           — field names
src/hooks/useAnalysis.ts                          — field references
src/hooks/useMacroCycles.ts                       — field references
```

Be careful NOT to rename:
- HTML/CSS classes containing "hi" (e.g., `min-h-`)
- Variable names where "hi" means something else
- Only rename where "hi" means "highest load"

---

## GROUP 6: STANDARDIZE METRIC DISPLAY — SINGLE COMPONENT

Create: src/components/ui/MetricStrip.tsx

A reusable component that displays metrics in the standard order.
Used in DayCard headers, WeekSummary, PlannerControlPanel, print views,
and anywhere else metrics appear.

```tsx
import { METRICS, type MetricKey, type ComputedMetrics, formatMetricValue } from '../../lib/metrics';

interface MetricStripProps {
  metrics: ComputedMetrics;
  visibleMetrics: MetricKey[];
  size?: 'sm' | 'md' | 'lg';      // sm = day card, md = week strip, lg = panel
  showLabels?: boolean;             // true = "R 136", false = just "136"
  separator?: string;               // "·" or "|" or nothing
  className?: string;
}

export function MetricStrip({
  metrics,
  visibleMetrics,
  size = 'md',
  showLabels = true,
  separator = '·',
  className = '',
}: MetricStripProps) {
  const textSize = size === 'sm' ? 'text-[10px]' : size === 'lg' ? 'text-sm' : 'text-xs';
  const valueWeight = 'font-medium';

  const items = METRICS
    .filter(m => visibleMetrics.includes(m.key))
    .map(m => ({
      key: m.key,
      label: showLabels ? m.shortLabel : '',
      value: formatMetricValue(m.key, metrics[m.key]),
    }))
    .filter(item => item.value !== '—' && item.value !== '0');

  if (items.length === 0) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 ${textSize} ${className}`}>
      {items.map((item, i) => (
        <span key={item.key}>
          {i > 0 && separator && (
            <span className="text-gray-300 mx-0.5">{separator}</span>
          )}
          {item.label && <span className="text-gray-400">{item.label} </span>}
          <span className={`text-gray-700 ${valueWeight}`}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}
```

---

## GROUP 7: REPLACE ALL INLINE METRIC DISPLAYS

Replace every place that manually renders S/R/tonnage with MetricStrip.

### DayCard header
File: src/components/planner/DayCard.tsx

Replace:
```tsx
<span className="text-gray-400">S <span className="...">{daySets}</span></span>
<span className="text-gray-400">R <span className="...">{dayReps}</span></span>
```

With:
```tsx
<MetricStrip
  metrics={computeMetrics(exercises, competitionTotal)}
  visibleMetrics={visibleMetrics}
  size="sm"
  showLabels={true}
/>
```

Pass `visibleMetrics` from settings and `competitionTotal` from athlete.

### WeekSummary
File: src/components/planner/WeekSummary.tsx

Replace the manual metrics rendering with MetricStrip using size="md".

### PlannerControlPanel
File: src/components/planner/PlannerControlPanel.tsx

Replace the manual metrics section with MetricStrip using size="md".

### Print views
Files: PrintWeekCompact.tsx, PrintWeek.tsx

Use the same metric labels and order. For compact print:
```
WH  →  R  (reps)
MHG →  Avg (average)
BW  →  Max (maximum)
```

Actually, keep the IAT column headers as WH/MHG/BW for compact print
since that's the established IAT convention. But add "R / Avg / Max"
as a subtitle in the column header for clarity.

---

## GROUP 8: UPDATE SETTINGS — METRIC TOGGLES

File: src/components/GeneralSettings.tsx

Replace the current metrics toggle section with the full list:

```
Summary metrics (drag to reorder)
┌──────────────────────────────────┐
│ ☑ Reps          Total reps       │
│ ☑ Sets          Total sets       │
│ ☑ Max           Highest load     │
│ ☐ Avg           Average load     │
│ ☑ Tonnage       Total volume     │
│ ☐ K             Avg / comp total │
└──────────────────────────────────┘
```

Each metric has a checkbox. The order is fixed (METRIC_ORDER constant).
Save as `visible_summary_metrics: MetricKey[]` in general_settings.

Remove the separate `show_stress_metric` toggle — merge stress into
the metrics list if it's still used, or deprecate it.

---

## GROUP 9: MACRO TABLE — USE RENAMED COLUMNS

File: src/components/macro/MacroTable.tsx
File: src/components/macro/MacroEditModal.tsx
File: src/hooks/useMacroCycles.ts

Update all references to the old column names:
- `target_hi` → `target_max`
- `target_ave` → `target_avg`
- `target_rhi` → `target_reps_at_max`
- `target_shi` → `target_sets_at_max`

In the macro table header, display:
```
Reps | Max | Sets@Max | Reps@Max | Avg
```
Instead of:
```
Reps | Hi | SHI | RHI | Ave
```

---

## GROUP 10: SOLLIST CHART — USE RENAMED FIELDS

File: src/components/planner/SollIstChart.tsx
File: src/components/planner/ExerciseHistoryChart.tsx

Rename internal variables:
- `soll_hi` → `soll_max`
- `ist_hi` → `ist_max`
- `soll_avg` stays as `soll_avg`
- `ist_avg` stays as `ist_avg`
- View toggle labels: "Hi" → "Max"

---

# ════════════════════════════════════════════════
# PART B: GROUP PLANS
# ════════════════════════════════════════════════

## GROUP 11: EXERCISE — PR REFERENCE + TRACK_PR

File: src/components/ExerciseForm.tsx or ExerciseFormModal.tsx

### PR reference dropdown
Add a field to the exercise form:

```
PR reference:  [None (use own PR)] ▾
```

Dropdown shows all exercises in the library (filtered to the same
owner_id). When set, this exercise's percentage prescriptions resolve
against the referenced exercise's PR instead of its own.

Example: "Power Snatch" references "Snatch". When the plan says
"Power Snatch at 80%", it means 80% of the athlete's Snatch PR.

The PR reference exercise must have `track_pr = true`.
Circular references are blocked (A → B → A).

### Track PR toggle
Add a toggle:

```
☑ Track PR for this exercise
```

When unchecked:
- Exercise does not appear in the PR table / PR input forms
- No PR row is created for this exercise
- Percentage prescriptions still work IF pr_reference_exercise_id is set

Default: true for competition lifts and squats, true for new exercises.

### UI in exercise list
Show a small icon or badge next to exercises that reference another
exercise's PR: "Power Snatch → Snatch"

---

## GROUP 12: ATHLETE PR TABLE — RESPECT TRACK_PR AND REFERENCES

File: src/components/AthletePRs.tsx

### Filter out exercises where track_pr = false
These exercises should NOT appear in the PR table at all.

### Filter out exercises that have a pr_reference_exercise_id
If Power Snatch references Snatch, Power Snatch does NOT get its own
row in the PR table. The athlete only enters their Snatch PR.
The system uses that PR when resolving Power Snatch percentages.

### Show which exercises derive from each PR
Under each PR row, show derived exercises in small text:

```
Snatch              82 kg    (2026-03-15)
  └ Power Snatch, Snatch from blocks, Hang snatch

Clean & Jerk        105 kg   (2026-03-20)
  └ Power clean, Clean pull, Jerk from rack
```

This helps the coach see the full impact of updating a PR.

---

## GROUP 13: GROUP PLAN — AUTO-APPLY TO ATHLETES

File: src/hooks/useWeekPlans.ts

### Current behavior
Group plans exist as `week_plans` with `is_group_plan = true` and
`group_id` set. They are separate from individual athlete plans.

### New behavior
When a group plan is saved (exercises added/modified), automatically
create/update a LINKED individual plan for each active member of the
group, MERGING group exercises with any individual additions.

**Data model changes:**

Add to the migration file in Group 1:
```sql
-- Link individual plans back to their source group plan
ALTER TABLE week_plans
  ADD COLUMN IF NOT EXISTS source_group_plan_id uuid DEFAULT NULL
  REFERENCES week_plans(id) ON DELETE SET NULL;

-- Track origin of each exercise in an individual plan
-- 'group' = synced from group plan (will be replaced on next sync)
-- 'individual' = added by coach for this specific athlete (preserved on sync)
-- NULL = legacy, treated as 'individual'
ALTER TABLE planned_exercises
  ADD COLUMN IF NOT EXISTS source text DEFAULT NULL
  CHECK (source IN ('group', 'individual'));
```

Update database.types.ts:
- WeekPlan: add `source_group_plan_id: string | null`
- PlannedExercise: add `source: 'group' | 'individual' | null`

### Merge logic — the critical algorithm

When group plan changes, for each athlete in the group:

```typescript
async function syncGroupPlanToAthlete(
  athleteId: string,
  weekStart: string,
  groupPlanId: string,
  groupExercises: PlannedExercise[],
): Promise<void> {
  // 1. Find or create the athlete's individual plan for this week
  let { data: athletePlan } = await supabase
    .from('week_plans')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .eq('source_group_plan_id', groupPlanId)
    .maybeSingle();

  if (!athletePlan) {
    const { data } = await supabase
      .from('week_plans')
      .insert({
        athlete_id: athleteId,
        week_start: weekStart,
        source_group_plan_id: groupPlanId,
        is_group_plan: false,
        owner_id: getOwnerId(),
        active_days: groupExercises.map(e => e.day_index).filter((v, i, a) => a.indexOf(v) === i),
      })
      .select('id')
      .single();
    athletePlan = data;
  }

  // 2. Delete ONLY group-sourced exercises (source = 'group')
  //    Individual exercises (source = 'individual' or NULL) stay untouched
  await supabase
    .from('planned_exercises')
    .delete()
    .eq('weekplan_id', athletePlan.id)
    .eq('source', 'group');

  // 3. Get remaining individual exercises to check for conflicts
  const { data: individualExercises } = await supabase
    .from('planned_exercises')
    .select('exercise_id, day_index')
    .eq('weekplan_id', athletePlan.id);

  const individualKeys = new Set(
    (individualExercises || []).map(e => `${e.exercise_id}_${e.day_index}`)
  );

  // 4. Insert group exercises, skipping any that conflict with
  //    individual overrides (same exercise + same day = coach override)
  const toInsert = groupExercises
    .filter(ge => !individualKeys.has(`${ge.exercise_id}_${ge.day_index}`))
    .map(ge => ({
      weekplan_id: athletePlan!.id,
      day_index: ge.day_index,
      exercise_id: ge.exercise_id,
      position: ge.position,
      notes: ge.notes,
      unit: ge.unit,
      prescription_raw: ge.prescription_raw,
      summary_total_sets: ge.summary_total_sets,
      summary_total_reps: ge.summary_total_reps,
      summary_highest_load: ge.summary_highest_load,
      summary_avg_load: ge.summary_avg_load,
      variation_note: ge.variation_note,
      is_combo: ge.is_combo,
      combo_notation: ge.combo_notation,
      combo_color: ge.combo_color,
      source: 'group',  // ← tagged as group-sourced
    }));

  if (toInsert.length > 0) {
    await supabase.from('planned_exercises').insert(toInsert);
    // Also copy planned_set_lines for each group exercise
    // (need to map old planned_exercise_id → new planned_exercise_id)
  }
}
```

### What happens in each scenario

**Coach adds individual exercise, then group plan changes:**
- Individual exercise: source='individual' → KEPT
- Old group exercises: source='group' → DELETED
- New group exercises: inserted as source='group'
- Result: athlete has updated group exercises + their individual additions

**Coach modifies a group-sourced exercise for one athlete:**
- When a coach edits a planned_exercise where source='group',
  change its source to 'individual' BEFORE saving the edit.
  This promotes it to an override.
- Next group sync: the override stays (skipped by conflict check),
  and no duplicate group version is inserted (same exercise_id + day_index).

```typescript
// In savePrescription or saveNotes, add:
async function promoteToIndividual(plannedExId: string): Promise<void> {
  await supabase
    .from('planned_exercises')
    .update({ source: 'individual' })
    .eq('id', plannedExId)
    .eq('source', 'group');
}
// Call this before any edit to a group-sourced exercise:
if (exercise.source === 'group') {
  await promoteToIndividual(exercise.id);
}
```

**Coach removes an athlete from the group:**
- The athlete's individual plan stays (source_group_plan_id preserved)
- No more syncs happen for that athlete
- Coach can "unlink" the plan to make it fully independent

**Coach deletes the group plan:**
- Individual plans keep their data (ON DELETE SET NULL on the FK)
- source_group_plan_id becomes NULL
- Group-sourced exercises remain but are no longer managed

### Sync trigger
Call the sync function:
- After saving exercises in a group plan (batch — not per keystroke)
- After adding a new member to the group
- NOT after removing a member (their plan stays)
- A manual "Sync now" button in the group plan UI
```

---

## GROUP 14: PR-BASED PERCENTAGE RESOLUTION

### The "Calculate kg" button

When viewing an individual athlete's plan that was synced from a group
plan (unit = percentage), show a button:

```
[🔢 Calculate kg from PRs]
```

When clicked:
1. Fetch the athlete's PRs for all exercises in the plan
2. For exercises with `pr_reference_exercise_id`, use the referenced
   exercise's PR instead
3. Convert each percentage prescription to absolute kg:
   ```
   80% of Snatch (PR: 82kg) → 65.6 → round to 66 kg
   ```
4. Create a NEW version of the plan with:
   - `unit: 'absolute_kg'` on each exercise
   - Prescription values in kg (rounded to nearest 0.5 or 1 kg)
   - A note indicating the source: "Resolved from group plan at 82kg Sn PR"
5. The original percentage plan stays linked — the coach can re-resolve
   if PRs change

### Rounding rules
- Loads round to nearest 1 kg by default
- If the exercise uses fine increments (technique work), round to 0.5
- The coach can set a rounding preference in settings (1, 0.5, or 2.5 kg)

### Display in planner
When viewing a percentage plan for a specific athlete:
- Show the percentage value as the primary number
- Below in small text, show the resolved kg: "80% → 66 kg"
- This requires knowing the athlete's PR for the exercise

```tsx
// In the grid cell:
<div className="text-center">
  <div className="text-xs font-medium">80%</div>
  <div className="text-[8px] text-gray-400">66 kg</div>
</div>
```

---

## GROUP 15: GROUP PLAN UI ENHANCEMENTS

File: src/components/planner/WeeklyPlanner.tsx

### When viewing a group plan:
- Show a banner: "Group plan — [Group name] · [N] athletes"
- Show member avatars/initials in a row
- A "Sync to athletes" button (manual trigger for sync)
- Badge on each day card: "Group plan"

### When viewing an individual plan linked to a group:
- Show a subtle banner: "Linked to group plan: [Group name]"
- "Calculate kg" button prominent
- "Unlink from group" option (removes source_group_plan_id,
  changes all source='group' to source='individual',
  makes the plan fully independent)

### Exercise source badges in individual plans
Each exercise in a linked individual plan shows its origin:

- `source = 'group'`: small "Group" badge in muted gray — these will
  be replaced on next sync
- `source = 'individual'`: small "Individual" badge in blue — these
  are preserved on sync
- Exercises originally from group but edited by coach: show
  "Override" badge in amber — the coach changed the group prescription
  for this specific athlete

When the coach clicks to edit a group-sourced exercise, show a
confirmation toast: "This will override the group prescription for
this athlete. The group plan won't update this exercise anymore."

### Changes made to the individual plan show as "overrides"
  (not synced back to the group)

---

## GROUP 16: ATHLETE PROFILE — COMPETITION TOTAL

File: src/components/Athletes.tsx or wherever athlete edit form lives

Add a field to the athlete profile:

```
Competition total:  [auto-derived: 187 kg] or [manual: _____ kg]

  ☐ Override (enter manually instead of deriving from PRs)
  Current: Snatch 82 + C&J 105 = 187 kg
```

When unchecked (default), the total is auto-derived from the athlete's
best Snatch PR + best C&J PR (using exercises where
`is_competition_lift = true`).

When checked, the coach enters a specific number (e.g., their last
competition result).

This total is used for K-value calculation everywhere.

---

## GROUP 17: TESTING

### Metrics renaming
1. Open macro table → column headers say "Max" not "Hi"
2. Open macro edit → field labels say "Max", "Avg"
3. Open exercise detail → SollIst chart toggle says "Max" / "Avg"
4. Open week summary → shows metrics in order: R, S, Max, T
5. Open day card headers → same order
6. No instance of "Hi" or "hi" in any metric label anywhere

### K-value
7. Set up athlete with Snatch PR 82 + C&J PR 105 = total 187
8. Enable K in settings (visible_summary_metrics)
9. Week summary shows K value (should be AAI / 187)
10. Verify K = 38-42% range makes sense for a moderate training week
11. Override competition_total on athlete → K recalculates

### Metric toggling
12. Open Settings → disable "Sets" and "Max"
13. Week summary only shows: R, T (and K if enabled)
14. Day cards only show: R, T
15. Re-enable → they come back

### PR reference
16. Create "Power Snatch" with pr_reference = "Snatch"
17. Create "Hang Snatch" with pr_reference = "Snatch"
18. Open PR table → Power Snatch and Hang Snatch NOT shown
19. Snatch row shows "→ Power Snatch, Hang Snatch" below
20. Set track_pr = false on "KB Swings" → disappears from PR table

### Group plan sync
21. Create a training group with 2 athletes (Athlete A and B)
22. Create a group plan for this week (percentage unit)
23. Add exercises: Snatch 70-80% x 3, Back Squat 75-85% x 5
24. Save → individual plans appear for both athletes
25. Open athlete A's plan → shows both exercises with "Group" badges
26. Click "Calculate kg" → shows absolute kg based on athlete A's PRs
27. Open athlete B's plan → different kg values (different PRs)

### Group sync — individual additions preserved
28. On athlete A's individual plan, add "Pull Ups 3x10" (individual exercise)
29. Athlete A now has: Snatch (group), Back Squat (group), Pull Ups (individual)
30. Go back to group plan → change Snatch from 70-80% to 75-85%
31. Save group plan → sync triggers
32. Open athlete A → Snatch updated to 75-85% (group), Back Squat unchanged (group),
    Pull Ups still there (individual) — NOT deleted
33. Open athlete B → Snatch updated, Back Squat unchanged, NO Pull Ups (correct)

### Group sync — individual overrides preserved
34. On athlete A's plan, edit the group-sourced Snatch (change to 72%)
35. Confirmation toast appears: "This will override the group prescription"
36. Snatch badge changes from "Group" to "Override" (amber)
37. Go back to group plan → change Snatch again to 80%
38. Save → sync triggers
39. Open athlete A → Snatch is STILL 72% (override preserved), not 80%
40. Open athlete B → Snatch is 80% (updated normally)

### Group sync — new exercises added
41. Add "Jerk 85% x 2" to the group plan
42. Save → sync
43. Athlete A: gets Jerk (group) + keeps Snatch override + keeps Pull Ups
44. Athlete B: gets Jerk (group) + updated Snatch (group)

### Unlink
45. On athlete A, click "Unlink from group"
46. All exercises become source='individual'
47. Future group plan changes have no effect on athlete A
48. Athlete B still linked and syncing

### Edge cases
49. Athlete with no PRs → "Calculate kg" shows warning "Missing PR for Snatch"
50. Exercise with pr_reference to itself → blocked (circular reference)
51. Remove athlete from group → their synced plan stays (orphaned but usable,
    no more syncs, source_group_plan_id preserved)
52. Delete group plan → individual plans keep data (ON DELETE SET NULL),
    all exercises remain, source_group_plan_id becomes null
53. K-value with no competition total → shows "—" not NaN
54. Add member to group with existing group plan → sync creates their plan immediately
55. Group plan with combo exercises → combos sync correctly including members
56. No console errors throughout

Fix any issues found during testing.
