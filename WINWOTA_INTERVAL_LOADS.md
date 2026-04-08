# EMOS 2.0 — INTERVAL PRESCRIPTION TYPE

Add interval load prescriptions: a set line can have a lower and upper
bound instead of a single fixed load. This is NOT a new unit type —
it's a property of individual set lines. This means intervals work with
both kg and percentage units, and can be mixed with fixed loads in the
same exercise (e.g., fixed warm-up sets, interval working sets).

Work on the current branch. Run `npm run build` after each group.
Commit each group separately. Do not ask for confirmation.

---

## GROUP 1: DATABASE MIGRATION (create file only)

Create: `supabase/migrations/20260406_interval_loads.sql`

```sql
-- Add load_max column to planned_set_lines
-- When NULL: fixed load (current behavior, load_value is the exact weight)
-- When set: interval load (load_value = min, load_max = max)
ALTER TABLE planned_set_lines
  ADD COLUMN IF NOT EXISTS load_max decimal DEFAULT NULL;

-- Constraint: if load_max is set, it must be >= load_value
ALTER TABLE planned_set_lines
  ADD CONSTRAINT interval_range_valid
  CHECK (load_max IS NULL OR load_max >= load_value);
```

Tell the user to run this migration before continuing.

---

## GROUP 2: UPDATE TYPES

File: src/lib/database.types.ts

Add `load_max` to PlannedSetLine:
```typescript
export interface PlannedSetLine {
  id: string;
  planned_exercise_id: string;
  sets: number;
  reps: number;
  reps_text: string | null;
  load_value: number;
  load_max: number | null;   // ← NEW: null = fixed, number = interval upper bound
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## GROUP 3: EXTEND PRESCRIPTION PARSER

File: src/lib/prescriptionParser.ts

### 3a. Extend ParsedSetLine

```typescript
export interface ParsedSetLine {
  sets: number;
  reps: number;
  load: number;
  loadMax: number | null;  // ← NEW: null = fixed, number = interval upper bound
}
```

### 3b. Update parseSegment to detect intervals

The interval format is "MIN-MAX" in the load position:
```
"80-90x3x4"  →  { load: 80, loadMax: 90, reps: 3, sets: 4 }
"80x3x4"     →  { load: 80, loadMax: null, reps: 3, sets: 4 }
```

Update `parseSegment`:
```typescript
function parseSegment(segment: string): ParsedSetLine | null {
  const parts = segment.split('x');
  if (parts.length < 2) return null;

  // Parse load — check for interval "min-max"
  const loadStr = parts[0];
  let load: number;
  let loadMax: number | null = null;

  // Interval detection: contains "-" but not at position 0 (not negative number)
  const dashIdx = loadStr.indexOf('-', 1);  // start search at 1 to skip negative sign
  if (dashIdx !== -1) {
    const minStr = loadStr.slice(0, dashIdx);
    const maxStr = loadStr.slice(dashIdx + 1);
    load = parseFloat(minStr);
    loadMax = parseFloat(maxStr);
    if (isNaN(load) || isNaN(loadMax) || loadMax < load) return null;
  } else {
    load = parseFloat(loadStr);
    if (isNaN(load)) return null;
  }

  if (parts.length === 2) {
    const reps = parseInt(parts[1], 10);
    if (reps > 0 && load >= 0) {
      return { sets: 1, reps, load, loadMax };
    }
  } else if (parts.length === 3) {
    const reps = parseInt(parts[1], 10);
    const sets = parseInt(parts[2], 10);
    if (sets > 0 && reps > 0 && load >= 0) {
      return { sets, reps, load, loadMax };
    }
  }

  return null;
}
```

### 3c. Update formatPrescription

```typescript
export function formatPrescription(lines: ParsedSetLine[], unit: string | null): string {
  if (lines.length === 0) return '';
  const unitSymbol = unit === 'percentage' ? '%' : '';

  return lines
    .map(line => {
      const loadStr = line.loadMax !== null && line.loadMax !== undefined
        ? `${line.load}-${line.loadMax}${unitSymbol}`
        : `${line.load}${unitSymbol}`;

      if (line.sets === 1) {
        return `${loadStr}×${line.reps}`;
      } else {
        return `${loadStr}×${line.reps}×${line.sets}`;
      }
    })
    .join(', ');
}
```

### 3d. Update ParsedComboSetLine + parseComboPrescription

Add `loadMax: number | null` to `ParsedComboSetLine`.

In `parseComboPrescription`, detect intervals in the load part the
same way: check for "-" not at position 0.

```typescript
export interface ParsedComboSetLine {
  sets: number;
  repsText: string;
  totalReps: number;
  load: number;
  loadMax: number | null;   // ← NEW
  loadText?: string;
}
```

In the parsing loop, after extracting `loadStr`:
```typescript
const dashIdx = loadStr.indexOf('-', 1);
let load: number;
let loadMax: number | null = null;
let loadIsNumeric: boolean;

if (dashIdx !== -1) {
  const minStr = loadStr.slice(0, dashIdx);
  const maxStr = loadStr.slice(dashIdx + 1);
  load = parseFloat(minStr);
  loadMax = parseFloat(maxStr);
  loadIsNumeric = !isNaN(load) && !isNaN(loadMax);
} else {
  load = parseFloat(loadStr);
  loadIsNumeric = !isNaN(load);
  loadMax = null;
}
```

Update `formatComboPrescription` similarly to show "80-90" for intervals.

### 3e. Update columnsToSetLines

In PrescriptionGrid.tsx:
```typescript
function columnsToSetLines(cols: GridColumn[]): ParsedSetLine[] {
  return cols.map(col => ({
    load: col.load,
    loadMax: col.loadMax ?? null,
    reps: col.reps,
    sets: col.sets,
  }));
}
```

---

## GROUP 4: EXTEND GRID COLUMN

File: src/components/planner/PrescriptionGrid.tsx

### 4a. Add loadMax to GridColumn

```typescript
interface GridColumn {
  id: string;
  load: number;
  loadMax: number | null;    // ← NEW: null = fixed, number = interval upper bound
  loadText: string;
  reps: number;
  repsText: string;
  sets: number;
}
```

### 4b. Update parseToColumns

When creating GridColumn from parsed data, populate loadMax:
```typescript
// In the regular (non-combo) branch:
const lines = parsePrescription(raw);
return lines.map(line => ({
  id: nextId(),
  load: line.load,
  loadMax: line.loadMax ?? null,
  loadText: line.loadMax != null ? `${line.load}-${line.loadMax}` : String(line.load),
  reps: line.reps,
  repsText: String(line.reps),
  sets: line.sets,
}));

// In the combo branch:
const lines = parseComboPrescription(raw);
return lines.map(line => ({
  id: nextId(),
  load: line.load,
  loadMax: line.loadMax ?? null,
  loadText: line.loadMax != null
    ? `${line.load}-${line.loadMax}`
    : (line.loadText ?? String(line.load)),
  reps: line.totalReps,
  repsText: line.repsText,
  sets: line.sets,
}));
```

### 4c. Update handleCellClick for load field

The load cell needs to handle intervals. When the column is an interval:
- Left-click on LEFT half of the cell → increment `load` (min) by 1
- Left-click on RIGHT half → increment `loadMax` (max) by 1
- Right-click on LEFT half → decrement `load` by 1
- Right-click on RIGHT half → decrement `loadMax` by 1
- Ctrl+click → open edit modal with two fields

Detect which half was clicked using the click position relative to
the cell's bounding rect:

```typescript
if (field === 'load') {
  if (isFreeTextReps) {
    setEditing({ colId, field: 'load', value: col.loadText });
    return;
  }

  if (col.loadMax !== null) {
    // INTERVAL column — determine which half was clicked
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const isRightHalf = clickX > rect.width / 2;
    const isRight = e.button === 2;
    const delta = isRight ? -1 : 1;

    if (isRightHalf) {
      const nextMax = Math.max(col.load, (col.loadMax || 0) + delta);
      updateColumn(colId, {
        loadMax: nextMax,
        loadText: `${col.load}-${nextMax}`,
      });
    } else {
      const nextMin = Math.max(0, col.load + delta);
      const adjustedMax = Math.max(nextMin, col.loadMax || nextMin);
      updateColumn(colId, {
        load: nextMin,
        loadMax: adjustedMax,
        loadText: `${nextMin}-${adjustedMax}`,
      });
    }
  } else {
    // FIXED column — existing behavior
    const isRight = e.button === 2;
    const delta = isRight ? -1 : 1;
    const next = Math.max(0, col.load + delta);
    updateColumn(colId, { load: next, loadMax: null, loadText: String(next) });
  }
}
```

### 4d. Update Ctrl+click edit for intervals

When Ctrl+clicking a load cell on an interval column, show the current
value as "80-90" in the editing input. On commit:

```typescript
if (editing.field === 'load') {
  const text = editing.value.trim();

  // Check if it's an interval (contains "-" not at start)
  const dashIdx = text.indexOf('-', 1);
  if (dashIdx !== -1) {
    const minVal = parseFloat(text.slice(0, dashIdx));
    const maxVal = parseFloat(text.slice(dashIdx + 1));
    if (!isNaN(minVal) && !isNaN(maxVal) && maxVal >= minVal) {
      updateColumn(editing.colId, {
        load: minVal,
        loadMax: maxVal,
        loadText: `${minVal}-${maxVal}`,
      });
    }
  } else {
    // Fixed load
    const val = Math.max(0, parseFloat(text) || 0);
    updateColumn(editing.colId, {
      load: val,
      loadMax: null,
      loadText: String(val),
    });
  }
}
```

This means: if a coach types "80-90" in the edit field, it becomes an
interval. If they type "80", it becomes a fixed load. Intervals can be
created or removed by direct input — no separate mode toggle needed.

### 4e. Update handleAddColumn

When adding a new column, inherit the interval status from the last column:

```typescript
function handleAddColumn() {
  if (disabled) return;
  const last = columns[columns.length - 1];

  let newLoad: number;
  let newLoadMax: number | null = null;
  let newLoadText: string;

  if (last?.loadMax !== null && last?.loadMax !== undefined) {
    // Last column was interval → new column is also interval with +increment
    newLoad = last.load + loadIncrement;
    newLoadMax = last.loadMax + loadIncrement;
    newLoadText = `${newLoad}-${newLoadMax}`;
  } else if (isFreeTextReps) {
    newLoad = last?.load ?? 0;
    newLoadMax = null;
    newLoadText = last?.loadText ?? '';
  } else {
    newLoad = last ? last.load + loadIncrement : loadIncrement;
    newLoadMax = null;
    newLoadText = String(newLoad);
  }

  const defaultRepsText = isCombo
    ? (last?.repsText ?? defaultRepsTextForCombo(comboPartCount))
    : String(last?.reps ?? 1);

  const newCol: GridColumn = {
    id: nextId(),
    load: newLoad,
    loadMax: newLoadMax,
    loadText: newLoadText,
    reps: last ? last.reps : 1,
    repsText: defaultRepsText,
    sets: 1,
  };
  const next = [...columns, newCol];
  setColumns(next);
  save(next);
}
```

---

## GROUP 5: UPDATE GRID RENDERING

File: src/components/planner/PrescriptionGrid.tsx

### 5a. Load cell display

Update the load cell rendering to show intervals:

```tsx
{/* Load cell */}
<div
  className={`... ${col.loadMax !== null ? 'cursor-col-resize' : 'cursor-pointer'}`}
  onClick={(e) => handleCellClick(e, col.id, 'load')}
  onContextMenu={(e) => handleCellClick(e, col.id, 'load')}
>
  {editing?.colId === col.id && editing?.field === 'load' ? (
    <input ref={inputRef} value={editing.value} ... />
  ) : (
    <span className="select-none">
      {col.loadMax !== null ? (
        // Interval display: "80 - 90" with a subtle separator
        <>
          <span className="text-gray-700">{col.load}</span>
          <span className="text-gray-400 mx-0.5">-</span>
          <span className="text-gray-700">{col.loadMax}</span>
        </>
      ) : (
        // Fixed load display (existing)
        <span>{col.loadText}{unit === 'percentage' ? '%' : ''}</span>
      )}
    </span>
  )}
</div>
```

### 5b. Visual distinction for interval columns

Give interval cells a subtle visual cue so the coach can tell at a
glance which columns are intervals vs fixed:

```tsx
// On the load cell container
className={`... ${col.loadMax !== null ? 'bg-blue-50/30 border-blue-100' : ''}`}
```

A very faint blue tint behind interval cells. Not distracting, but
distinguishable if you look for it.

---

## GROUP 6: UPDATE SAVE LOGIC — SUMMARY CALCULATION

File: src/hooks/useWeekPlans.ts

In `savePrescription`, update the summary calculation to handle intervals:

### For regular (non-combo) exercises:
```typescript
const parsed = parsePrescription(prescription);
if (parsed.length > 0) {
  const lines = parsed.map((line, idx) => ({
    planned_exercise_id: plannedExId,
    sets: line.sets,
    reps: line.reps,
    load_value: line.load,
    load_max: line.loadMax ?? null,   // ← NEW: save interval upper bound
    position: idx + 1,
  }));
  await supabase.from('planned_set_lines').insert(lines);

  const totalSets = parsed.reduce((sum, l) => sum + l.sets, 0);
  const totalReps = parsed.reduce((sum, l) => sum + l.sets * l.reps, 0);

  // For intervals, use max bound as highest load
  const highestLoad = Math.max(...parsed.map(l => l.loadMax ?? l.load));

  // For tonnage/avg calculation, use midpoint of interval
  const effectiveLoad = (l: ParsedSetLine) =>
    l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load;
  const weightedSum = parsed.reduce(
    (sum, l) => sum + effectiveLoad(l) * l.sets * l.reps, 0
  );
  const avgLoad = totalReps > 0 ? weightedSum / totalReps : null;

  await supabase.from('planned_exercises').update({
    prescription_raw: prescription,
    unit,
    summary_total_sets: totalSets,
    summary_total_reps: totalReps,
    summary_highest_load: highestLoad,
    summary_avg_load: avgLoad,
  }).eq('id', plannedExId);
}
```

### For combo exercises:
Same logic — use midpoint for avg, max bound for highest:
```typescript
const effectiveLoad = (l: ParsedComboSetLine) =>
  l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load;
const highestLoad = Math.max(...parsed.map(l => l.loadMax ?? l.load));
const weightedSum = parsed.reduce(
  (sum, l) => sum + effectiveLoad(l) * l.sets * l.totalReps, 0
);
```

### Also update the insert lines for combos:
```typescript
const lines = parsed.map((line, idx) => ({
  planned_exercise_id: plannedExId,
  sets: line.sets,
  reps: line.totalReps,
  reps_text: line.repsText,
  load_value: line.load,
  load_max: line.loadMax ?? null,  // ← NEW
  position: idx + 1,
}));
```

---

## GROUP 7: UPDATE DAY CARD PREVIEW

File: src/components/planner/DayCard.tsx

The stacked notation in day cards should show intervals:

In whatever function renders the load row for each column:
```
Fixed:     80
Interval:  80-90
```

If the DayCard uses `parsePrescription` to render the grid preview,
intervals will automatically show as "80-90" in the load row because
`ParsedSetLine.load` and `.loadMax` are both available. Just ensure
the rendering code checks for loadMax:

```tsx
{line.loadMax != null ? `${line.load}-${line.loadMax}` : `${line.load}`}
```

---

## GROUP 8: UPDATE COMPACT PRINT

File: src/components/planner/PrintWeekCompact.tsx

In the compact print layout, intervals should display as "80-90" in
the load row. Update `buildGridCells`:

```typescript
function buildGridCells(prescriptionRaw: string | null): GridCell[] {
  if (!prescriptionRaw?.trim()) return [];
  const parsed = parsePrescription(prescriptionRaw);

  const cells: GridCell[] = parsed.map(p => ({
    load: p.loadMax != null ? `${p.load}-${p.loadMax}` : p.load,
    reps: p.reps,
    sets: p.sets,
    showSuperscript: false,
  }));
  // ... superscript logic unchanged
}
```

The `load` field in GridCell is already `number | string` so interval
strings are fine.

Interval cells will be wider in print. Account for this in the cell
width: "80-90" needs ~40px vs "80" needing ~25px. Use the CSS
`min-width: 34px` which should accommodate most intervals.

---

## GROUP 9: UPDATE PROGRAMME PRINT

File: src/components/planner/PrintWeek.tsx

The Programme print layout's `InlinePrescription` component should also
show intervals. Update to check for loadMax in the parsed data.

---

## GROUP 10: ANALYSIS MODULE — VERIFY

File: src/hooks/useAnalysis.ts

The analysis module reads `summary_avg_load` and `summary_highest_load`
from planned_exercises. These are already calculated correctly in Group 6:
- `summary_avg_load` = weighted average using interval midpoints
- `summary_highest_load` = max of all upper bounds

Verify no direct reads of `planned_set_lines.load_value` exist in the
analysis hooks. If they do, update them to also consider `load_max`:
```typescript
const effectiveLoad = line.load_max != null
  ? (line.load_value + line.load_max) / 2
  : line.load_value;
```

Check `parsePlannedExercise` function in useAnalysis.ts — if it reads
set lines directly, update the tonnage calculation to use midpoints.

---

## GROUP 11: SOLLIST CHART — VERIFY

File: src/components/planner/SollIstChart.tsx

This chart reads `summary_highest_load` and `summary_avg_load` from
planned_exercises. These are already computed correctly for intervals
(Group 6). No changes needed unless the chart reads raw set lines.

The chart should show:
- "Hi" view: the upper bound of intervals (summary_highest_load)
- "Avg" view: the midpoint-based average (summary_avg_load)

This gives the coach useful information: the "hi" line shows the
ceiling of the range, the "avg" line shows estimated working load.

---

## GROUP 12: LOAD DISTRIBUTION CHART

File: src/components/planner/LoadDistribution.tsx

If this chart reads set lines directly to calculate daily load,
update to use midpoints for intervals. Check for any direct reads
of `load_value` and replace with:
```typescript
const effective = line.load_max != null
  ? (line.load_value + line.load_max) / 2
  : line.load_value;
```

---

## GROUP 13: TESTING

Open Chrome and test:

### Creating intervals
1. Open planner, select an athlete, open a day
2. Add an exercise (Back Squat, absolute_kg unit)
3. Click the first grid column → increment to 60 (fixed)
4. Ctrl+click the load cell → type "80-90" → Enter
5. Cell now shows "80 - 90" with subtle blue tint
6. Reps and sets work normally below the interval

### Grid interaction
7. Left-click LEFT half of interval cell → min increments (81-90)
8. Left-click RIGHT half → max increments (81-91)
9. Right-click LEFT half → min decrements (80-91)
10. Right-click RIGHT half → max decrements (80-90)
11. Min can't exceed max (enforced)
12. Max can't go below min (enforced)

### Adding columns
13. With last column as "80-90 x 3", click + to add column
14. New column should be "85-95 x 3" (both bounds + loadIncrement)
15. Add another: "90-100 x 3"

### Mixed fixed + interval
16. First two columns are fixed warm-up: 60 x 3, 70 x 3
17. Third column: Ctrl+click, type "80-90" → interval
18. Fourth column: auto-created as interval (85-95)
19. Summary shows correct totals using midpoints

### Combo + interval
20. Create a combo exercise (e.g., Clean + Jerk)
21. Add columns with interval loads: "80-90 x 2+1"
22. Verify interval display works with tuple reps below

### Summary calculations
23. Check day card: S / R / Tonnage values
24. For "80-90 x 3 x 4": expected tonnage = 85 × 3 × 4 = 1020 kg
25. Highest load should show 90 (upper bound)
26. Avg load should show 85 (midpoint)

### Converting between fixed and interval
27. Ctrl+click an interval cell → type "80" (no dash)
28. Cell becomes fixed load (interval removed)
29. Ctrl+click a fixed cell → type "80-90"
30. Cell becomes interval

### Percentage unit
31. Create exercise with percentage unit
32. Add interval: "75-85" (meaning 75-85% of 1RM)
33. Verify display shows "75-85" (no % symbol in grid, same as fixed)
34. Summary uses midpoint (80%) for calculations

### Print views
35. Open Print → Programme → verify intervals show as "80-90"
36. Open Print → Compact → verify intervals render in stacked notation
37. Interval cells may be slightly wider — verify no overflow

### Charts
38. Toggle load distribution chart
39. Verify bars use midpoint loads (not min or max alone)
40. Open exercise detail → SollIst chart shows correct hi/avg lines

### Persistence
41. Add interval columns, close the dialog
42. Reopen → intervals preserved correctly
43. Navigate away and back → still correct

### Edge cases
44. Interval with same min and max: "80-80" → valid but equivalent to fixed
45. Very wide interval: "50-100" → valid, display fits
46. Zero-based interval: "0-50" → valid
47. Negative dash position: "-5" is parsed as negative number, not interval
48. No console errors throughout

Fix any issues found during testing.
