# WEEKLY PLANNER — COMPREHENSIVE OVERHAUL

Read ALL sections before making changes. Start with Group 1.

Read the old implementation for reference:
```
git show 71c12b3:src/components/WeeklyPlanner.tsx > /tmp/old_WeeklyPlanner.tsx
git show 71c12b3:src/components/DayColumn.tsx > /tmp/old_DayColumn.tsx
```

---

## GROUP 1: COMBO SIMPLIFICATION — DO THIS FIRST

The current combo system uses three separate tables (planned_combos, planned_combo_items, planned_combo_set_lines), three separate components (ComboCard, ComboEditorModal, ComboCreatorModal), and completely separate summary calculation paths. This is the root cause of most bugs.

Replace the entire combo system with a much simpler model: a combo is just a regular planned_exercise with is_combo = true. It uses the same grid, same set_lines table, same rendering as every other exercise. The only difference is visual: a bracket border, component exercise names listed, and the reps field shows a tuple like "2+1" instead of a single number.

### Step 1A: Database migration

Create `supabase/migrations/20260403100000_simplify_combos.sql`:

```sql
-- Add combo support to planned_exercises
ALTER TABLE planned_exercises
  ADD COLUMN IF NOT EXISTS is_combo boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS combo_notation text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS combo_color text DEFAULT NULL;

-- Add reps_text to set_lines for tuple storage ("2+1", "1+1+1")
ALTER TABLE planned_set_lines
  ADD COLUMN IF NOT EXISTS reps_text text DEFAULT NULL;

-- Lightweight join: which exercises make up this combo
CREATE TABLE IF NOT EXISTS planned_exercise_combo_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_exercise_id uuid REFERENCES planned_exercises(id) ON DELETE CASCADE,
  exercise_id uuid REFERENCES exercises(id),
  position integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- RLS for combo members
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon access to planned_exercise_combo_members" ON planned_exercise_combo_members;
  CREATE POLICY "Allow anon access to planned_exercise_combo_members" ON planned_exercise_combo_members FOR ALL TO anon USING (true) WITH CHECK (true);
END $$;

ALTER TABLE planned_exercise_combo_members ENABLE ROW LEVEL SECURITY;
```

### Step 1B: Update database.types.ts

Add to PlannedExercise interface:
```typescript
is_combo: boolean;
combo_notation: string | null;  // display label like "2+1" or "2(1+1)"
combo_color: string | null;
```

Add to PlannedSetLine interface:
```typescript
reps_text: string | null;  // "2+1", "1+1+1" etc. null for regular exercises
```

Add new interface:
```typescript
interface PlannedExerciseComboMember {
  id: string;
  planned_exercise_id: string;
  exercise_id: string;
  position: number;
  exercise?: Exercise;  // joined
}
```

### Step 1C: Modify GridPrescriptionEditor for combo support

Add props:
```typescript
interface GridPrescriptionEditorProps {
  prescriptionRaw: string | null;
  unit: DefaultUnit;
  gridLoadIncrement: number;
  onSave: (prescriptionRaw: string) => void;
  // Combo support:
  isCombo?: boolean;
  comboPartCount?: number;  // number of exercises (2, 3, etc.)
}
```

Change the GridColumn interface to support string reps:
```typescript
interface GridColumn {
  id: string;
  load: number;
  reps: number;      // total reps (for summary calculations)
  repsText: string;   // display: "3" for regular, "2+1" for combo
  sets: number;
}
```

For regular exercises: repsText = String(reps).
For combos: repsText stores the tuple "2+1+1".

The reps cell rendering for combos must split the tuple into individually clickable numbers:

```tsx
// For combo reps cell:
const parts = col.repsText.split('+');
return (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0px' }}>
    {parts.map((part, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span style={{ color: 'var(--color-text-tertiary)', fontSize: '11px' }}>+</span>}
        <span
          className="cursor-pointer hover:bg-blue-100 px-0.5 rounded"
          onClick={(e) => handleComboRepClick(e, col.id, i, false)}
          onContextMenu={(e) => { e.preventDefault(); handleComboRepClick(e, col.id, i, true); }}
        >
          {part}
        </span>
      </React.Fragment>
    ))}
  </div>
);
```

handleComboRepClick: increment/decrement just the clicked part index:
```typescript
const handleComboRepClick = (e: React.MouseEvent, columnId: string, partIndex: number, isRightClick: boolean) => {
  if (e.ctrlKey || e.metaKey) {
    // Open text input for full tuple
    const col = columns.find(c => c.id === columnId);
    if (col) {
      setEditValue(col.repsText);
      setEditingCell({ columnId, field: 'reps' });
    }
    return;
  }

  setColumns(prev => {
    const newCols = prev.map(col => {
      if (col.id !== columnId) return col;
      const parts = col.repsText.split('+').map(p => parseInt(p.trim(), 10) || 1);
      const delta = isRightClick ? -1 : 1;
      parts[partIndex] = Math.max(1, (parts[partIndex] || 1) + delta);
      const newRepsText = parts.join('+');
      const newTotalReps = parts.reduce((sum, p) => sum + p, 0);
      return { ...col, repsText: newRepsText, reps: newTotalReps };
    });
    serializeAndSave(newCols);
    return newCols;
  });
};
```

For ctrl+click on combo reps: open text input. The coach types "2+1" or "3+2+1" or "2(1+1)". On commit, store as-is in repsText. Parse total for reps integer.

Combos can have 2, 3, or more exercises. The number of parts in the tuple should match comboPartCount. When adding a new column to a combo, default repsText to "1+1" (for 2 exercises), "1+1+1" (for 3), etc.

### Step 1D: Combo serialization

For regular exercises, the grid serializes to prescription_raw as before: "60x3, 70x3, 75x2x2, 85x1x2"

For combos, the grid serializes similarly but with tuple reps: "80x2+1, 90x2+1x2, 100x1+1x2, 110x1+1"

Update parsePrescription and formatPrescription in prescriptionParser.ts to handle tuple reps:
- When parsing, if the reps part contains "+", treat it as a tuple string (don't parse as integer)
- Store reps_text in set_lines alongside reps (total)
- formatPrescription should output the tuple: "80x2+1x2" not "80x3x2"

### Step 1E: Combo bracket UI in ExerciseCard and day editor

A combo exercise renders with a bracket visual:
- A border wrapping it (using combo_color or default green)
- Below the name: component exercise names with colored dots: "● Clean + ● Jerk"
- A notation badge showing combo_notation (e.g., "2+1")
- The same grid component as regular exercises

In the day card compact view, combos show:
```
┌─ ● Clean + ● Jerk  [2+1] ──────┐
│  80    90     100    110        │
│  ──    ──     ──     ──         │
│  2+1   2+1    1+1    1+1   2   │
└──────────────────────────────────┘
```

### Step 1F: Create combo flow

When the user types /combo in the search:
1. Open a modal to select 2+ exercises
2. Set combo name, unit, default notation
3. On create:
   - Insert a planned_exercise with is_combo = true, combo_notation, combo_color
   - Insert planned_exercise_combo_members for each component exercise
   - The exercise_id on the planned_exercise can reference the first component or a special combo sentinel

### Step 1G: Remove old combo code

After the new system works:
- Stop using: planned_combos, planned_combo_items, planned_combo_set_lines tables
- Delete: ComboCard.tsx, ComboEditorModal.tsx
- Simplify: ComboCreatorModal.tsx to use the new model
- Remove: all comboExerciseIds filtering in WeeklyPlanner
- Remove: all separate combo summary calculation paths (lines 398-433 and 465-527 in WeeklyPlanner.tsx)
- Remove: combo-specific code in useCombos.ts (most of it)
- Remove: loadDayCombos, combo state in DayColumn.tsx

Summary calculations become uniform — just iterate planned_exercises. For combos, use reps from set_lines (the total integer) for calculations. No more dual paths.

### Step 1H: Verify combo summary calculations

After simplification, the weekly summary should just be:
```typescript
Object.values(plannedExercises).forEach(dayExercises => {
  dayExercises.forEach(ex => {
    if (!ex.exercise.counts_towards_totals) return;
    totalSets += ex.summary_total_sets || 0;
    totalReps += ex.summary_total_reps || 0;
    if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
      totalTonnage += ex.summary_avg_load * (ex.summary_total_reps || 0);
    }
  });
});
```

No comboExerciseIds. No combo set line iteration. No dual paths.

---

## GROUP 2: GRID LAYOUT AND INTERACTION FIXES

### Issue 2A: Grid layout must use stacked fraction notation

Current layout uses horizontal rows. Replace with stacked fractions per column:

Each column renders as:
```
┌─────┐
│ 85  │  load (top, clickable)
│─────│  1px divider line (bg-gray-400)
│  1  │  reps (bottom, clickable — or "2+1" split for combos)
└─────┘2 sets (right of fraction, vertically centered)
```

Remove the "KG:" and "R / S:" row labels. The unit is shown in the exercise header.

### Issue 2B: Load increment is wrong

Current: uses gridClickIncrement for all fields.
Fix: load uses gridLoadIncrement (default 5), reps and sets use hardcoded 1.

```typescript
const delta = field === 'load'
  ? (isRightClick ? -gridLoadIncrement : gridLoadIncrement)
  : (isRightClick ? -1 : 1);
```

### Issue 2C: New column auto-enters edit mode

Remove the setTimeout block that opens edit mode after adding a column. Just create the column with defaults.

### Issue 2D: Edit mode value handling

When ctrl+clicking: set input value to current cell value. Select all text on focus. Only commit on Enter or blur. Do not update the visible cell on each keystroke.

### Issue 2E: Default to grid mode

Change PrescriptionModal line 44: `useState<'text' | 'grid'>('grid')`

---

## GROUP 3: DISPLAY AND PERSISTENCE

### Issue 3A: Add stacked notation display for day cards

Create a StackedNotationDisplay component that parses prescription_raw and renders compact inline fractions. Use this in ExerciseCard instead of the raw text on line 889. For combos, parse the tuple reps and display them.

### Issue 3B: Grid changes must persist immediately

Current: GridPrescriptionEditor calls onSave which only updates local state in PrescriptionModal. DB save requires clicking Save button.

Fix: The grid's onSave should write to the database immediately. In PrescriptionModal, change the grid's onSave:
```typescript
onSave={async (newPrescription) => {
  setPrescription(newPrescription);
  await savePrescription(plannedEx.id, { prescription: newPrescription, notes, unit });
  await onSave(); // refresh parent
}}
```

### Issue 3C: Contrast

- Grid load/reps: text-gray-900 font-medium (not text-gray-600)
- Grid sets: text-gray-700 font-medium
- Grid divider: bg-gray-400
- Day header day name: text-gray-900 font-medium
- Summary values: text-gray-900 font-semibold
- Summary labels: text-gray-500
- Hover state: bg-blue-50 with border-blue-300

---

## GROUP 4: DAY CONFIGURATION

### Issue 4A: Removed days not deleted from DB

In saveDayLabels, after saving, delete exercises for removed days:
```typescript
const removedDays = (currentWeekPlan?.active_days || []).filter(d => !activeDays.includes(d));
for (const dayIdx of removedDays) {
  await supabase.from('planned_exercises').delete()
    .eq('weekplan_id', currentWeekPlan.id).eq('day_index', dayIdx);
}
```

Then reload week plan and exercises.

### Issue 4B: Default days not shown in config

Ensure dayDisplayOrder includes all active day indices on initialization. If day_display_order is null/empty, use all keys from editingDayLabels sorted.

---

## GROUP 5: SLASH COMMANDS AND SENTINELS

/text, /video, /image don't work because sentinel exercises may not exist.

Auto-create if not found:
```typescript
async function getOrCreateSentinel(code: string, name: string, color: string) {
  let sentinel = await fetchExerciseByCode(code);
  if (!sentinel) {
    const { data } = await supabase.from('exercises').insert({
      name, category: '— System', default_unit: 'other',
      color, exercise_code: code,
      use_stacked_notation: false, counts_towards_totals: false,
    }).select().single();
    sentinel = data;
  }
  return sentinel;
}
```

Also filter '— System' category from search results.

---

## GROUP 6: SHIFT+CLICK DELETE

Add global shift key tracker in WeeklyPlanner:
```typescript
const [shiftHeld, setShiftHeld] = useState(false);
useEffect(() => {
  const down = (e: KeyboardEvent) => e.key === 'Shift' && setShiftHeld(true);
  const up = (e: KeyboardEvent) => e.key === 'Shift' && setShiftHeld(false);
  const blur = () => setShiftHeld(false);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
}, []);
```

Pass shiftHeld to DayColumn and GridPrescriptionEditor.

When shift is held:
- Exercise rows: bg-red-50 tint. Click = delete exercise.
- Grid columns: bg-red-50 tint. Click any cell = delete that column.

---

## GROUP 7: VERIFY OLD FUNCTIONALITY

Check all of these work. Reference old code if missing:
- Drag exercises between days (move)
- Ctrl+drag exercises between days (copy with set lines)
- Drag day headers to reorder
- Drag day onto another = SWAP content
- Ctrl+drag day onto another = COPY (replace destination)
- Copy week button stores weekplan ID
- Paste week opens CopyWeekModal
- Print week button opens PrintWeek
- Load distribution toggle
- Category breakdown expandable
- Week description saves on blur
- Day display order persistence

---

## IMPLEMENTATION ORDER

1. Group 1 (combo simplification) — this is the biggest change and eliminates root causes
2. Group 2 (grid layout and interactions)
3. Group 3 (display and persistence)
4. Group 4 (day configuration)
5. Group 5 (slash commands)
6. Group 6 (shift+click)
7. Group 7 (verify old features)

Run `npx tsc --noEmit` after completing each group.
