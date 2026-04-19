# ~~OUTDATED~~ EMOS — MACRO PLANNER REDESIGN

> **OUTDATED** — Handled through other means. Do not execute.

Redesign the macro cycle planner with: inline grid cells for top set
input (same interaction as PrescriptionGrid), exercise toggle chips,
Chart.js dual-axis chart with draggable points, search-based exercise
adding, auto-fill from previous week, and coach-defined custom week types.

Work on a new branch: `feature/macro-planner-redesign`
Run `npm run build` after each group. Commit each group separately.
Do not ask for confirmation.

---

## GROUP 0: CREATE BRANCH

```bash
git checkout main
git pull
git checkout -b feature/macro-planner-redesign
```

---

## GROUP 1: CUSTOM WEEK TYPES

### Problem
Week types are hardcoded as a TypeScript union:
```typescript
type WeekType = 'High' | 'Medium' | 'Low' | 'Vacation' | 'Deload' | ...
```
And colors are pattern-matched in `getMacroWeekColor()`.

This is inflexible. Different coaches use different terminology and
classification systems. A German coach might use h/m/g (hoch/mittel/
gesenkt). A Bulgarian-style coach might use "shock/restoration".

### Fix: coach-defined week types in general_settings

Add to the migration:

Create: `supabase/migrations/20260408_custom_week_types.sql`

```sql
-- Add coach-defined week types as JSONB array in general_settings
-- Each entry: { name: string, abbreviation: string, color: string }
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS week_types jsonb DEFAULT '[
    {"name": "High", "abbreviation": "h", "color": "#E24B4A"},
    {"name": "Medium", "abbreviation": "m", "color": "#EF9F27"},
    {"name": "Low", "abbreviation": "g", "color": "#1D9E75"}
  ]'::jsonb;

-- Relax the week_type column on macro_weeks to accept any text
-- (was implicitly constrained by the TypeScript union)
-- No constraint change needed — it's already text in the DB
```

### Update types

File: src/lib/database.types.ts

Add to GeneralSettings interface:
```typescript
week_types: WeekTypeConfig[];
```

Add new interface:
```typescript
export interface WeekTypeConfig {
  name: string;          // "High", "Deload", "Shock"
  abbreviation: string;  // "h", "dl", "sh" (1-3 chars)
  color: string;         // hex color "#E24B4A"
}
```

Remove (or deprecate) the fixed `WeekType` union:
```typescript
// OLD: export type WeekType = 'High' | 'Medium' | 'Low' | ...
// NEW: week_type is just a string — matches a WeekTypeConfig.abbreviation
```

Update `MacroWeek.week_type` to `string` (remove the union constraint).
Keep `week_type_text` for backward compat (it stores the display label).

### Delete getMacroWeekColor

File: src/lib/weekUtils.ts

Remove the hardcoded `getMacroWeekColor()` function. Colors now come
from the week type config. Replace all callers with a lookup:

```typescript
function getWeekTypeColor(
  abbreviation: string,
  weekTypes: WeekTypeConfig[],
): string {
  const wt = weekTypes.find(t => t.abbreviation === abbreviation);
  return wt?.color ?? '#888780'; // gray fallback
}
```

---

## GROUP 2: WEEK TYPE SETTINGS UI

File: src/components/GeneralSettings.tsx

Add a "Week types" section where the coach manages their custom types:

```
Week types (used in macro planning)
┌──────────────────────────────────────────────┐
│  Name              Abbr    Color             │
│  ──────────────────────────────────────────  │
│  [High           ] [h ]   [■ #E24B4A]  [x]  │
│  [Medium         ] [m ]   [■ #EF9F27]  [x]  │
│  [Low            ] [g ]   [■ #1D9E75]  [x]  │
│  [Deload         ] [dl]   [■ #5DCAA5]  [x]  │
│                                              │
│  [+ Add week type]                           │
└──────────────────────────────────────────────┘
```

Each row:
- Name: text input (max 20 chars)
- Abbreviation: text input (max 3 chars, lowercase enforced)
- Color: small color swatch that opens a color picker (use a native
  `<input type="color">` behind a styled button)
- Delete button (x) — shows confirm if the type is in use

"+ Add week type" appends a new row with empty fields.

Save immediately on change (same pattern as other settings).

Abbreviation uniqueness is enforced — can't have two types with
the same abbreviation. Show red border if duplicate detected.

---

## GROUP 3: WEEK TYPE SELECTOR IN MACRO TABLE

File: src/components/macro/MacroTable.tsx

### Current
The week type column uses `onUpdateWeekType` with a hardcoded select.

### New
Replace the week type cell with a clickable badge that cycles through
the coach's defined week types:

```tsx
<td
  onClick={() => cycleWeekType(week.id, week.week_type)}
  className="cursor-pointer"
  title="Click to change week type"
>
  <span
    className="text-[8px] font-medium rounded px-1.5 py-0.5"
    style={{
      backgroundColor: getWeekTypeColor(week.week_type, weekTypes) + '20',
      color: getWeekTypeColor(week.week_type, weekTypes),
    }}
  >
    {week.week_type || '-'}
  </span>
</td>
```

Click → cycles to next type in the list.
Right-click → cycles backward.
Ctrl+click → opens a dropdown with all types for direct selection.

```typescript
function cycleWeekType(weekId: string, current: string) {
  const types = settings?.week_types || [];
  const idx = types.findIndex(t => t.abbreviation === current);
  const next = types[(idx + 1) % types.length];
  onUpdateWeekType(weekId, next.abbreviation);
  onUpdateWeekLabel(weekId, next.name);
}
```

---

## GROUP 4: REPLACE EXERCISE DROPDOWN WITH SEARCH

File: src/components/macro/MacroCycles.tsx

Replace the `<select>` dropdown (lines ~463-498) with the existing
ExerciseSearch component from the planner:

```tsx
import { ExerciseSearch } from '../planner/ExerciseSearch';

{showAddExercise ? (
  <div className="relative" style={{ minWidth: 220 }}>
    <ExerciseSearch
      exercises={availableExercises}
      onAdd={async (exercise) => {
        const nextPos = trackedExercises.length > 0
          ? Math.max(...trackedExercises.map(te => te.position)) + 1
          : 0;
        await addTrackedExercise(selectedCycle!.id, exercise.id, nextPos);
        await fetchTrackedExercises(selectedCycle!.id);
        setShowAddExercise(false);
      }}
      placeholder="Search exercise to track..."
    />
  </div>
) : (
  <button onClick={() => setShowAddExercise(true)} ...>
    <Plus size={13} /> Track exercise
  </button>
)}
```

If ExerciseSearch renders slash commands (/combo, /text, etc.), add
a prop to disable them in macro context. Slash commands are irrelevant
when tracking exercises in a macrocycle.

---

## GROUP 5: EXERCISE TOGGLE CHIPS

Create: src/components/macro/ExerciseToggleBar.tsx

```tsx
interface ExerciseToggleBarProps {
  exercises: MacroTrackedExerciseWithExercise[];
  visible: Set<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
}

export function ExerciseToggleBar({ exercises, visible, onToggle, onShowAll }: ExerciseToggleBarProps) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center mb-2">
      <span className="text-[10px] text-gray-400 mr-1">Exercises:</span>
      {exercises.map(te => {
        const on = visible.has(te.id);
        return (
          <button
            key={te.id}
            onClick={() => onToggle(te.id)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-all
              ${on ? 'bg-opacity-10' : 'border-gray-200 text-gray-400 line-through opacity-40'}`}
            style={on ? { color: te.exercise.color, borderColor: te.exercise.color } : undefined}
          >
            {te.exercise.exercise_code || te.exercise.name.slice(0, 6)}
          </button>
        );
      })}
      {exercises.some(te => !visible.has(te.id)) && (
        <button onClick={onShowAll} className="text-[9px] text-gray-400 hover:text-gray-600 ml-1">
          Show all
        </button>
      )}
    </div>
  );
}
```

### Wire into MacroCycles.tsx

```typescript
const [visibleExercises, setVisibleExercises] = useState<Set<string>>(new Set());

// Initialize when tracked exercises load
useEffect(() => {
  setVisibleExercises(new Set(trackedExercises.map(t => t.id)));
}, [trackedExercises.length]);

const toggleExercise = (id: string) => {
  setVisibleExercises(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
};

// Filter for display
const displayedExercises = trackedExercises.filter(te => visibleExercises.has(te.id));
```

Render the toggle bar above both the table and graph views.
Pass `displayedExercises` instead of `trackedExercises` to column
rendering (but keep full list for data operations).

---

## GROUP 6: REDESIGN TABLE — 3 COLUMNS PER EXERCISE

File: src/components/macro/MacroTable.tsx

### Current: 5 sub-columns per exercise
Reps | Max | Sets@Max | Reps@Max | Avg — too wide

### New: 3 sub-columns per exercise
Reps | Max set (grid cell) | Avg

The "Max set" column combines Max + Reps@Max + Sets@Max into a single
visual grid cell that looks and behaves like the PrescriptionGrid.

### Header structure
```
Wk | B | K    | [Ex1 code+name]      | [Ex2 code+name]      | ...
   |   |      | Reps  Max set   Avg  | Reps  Max set   Avg  |
```

- Wk: week number (24px)
- B: week type badge (20px)
- K: total reps K1-7 (32px)
- Per exercise: Reps (28px) + Max set (52px) + Avg (28px) = 108px

### Data mapping
The existing `MacroTarget` fields map to the new columns:

```
MacroTarget.target_reps      →  Reps column
MacroTarget.target_max       →  Max set grid cell — load value
MacroTarget.target_reps_at_max →  Max set grid cell — reps value
MacroTarget.target_sets_at_max →  Max set grid cell — sets count (right of divider)
MacroTarget.target_avg       →  Avg column
```

---

## GROUP 7: MAX SET GRID CELL COMPONENT

Create: src/components/macro/MacroGridCell.tsx

A mini version of PrescriptionGrid's column — shows load on top,
divider, reps below, and sets count to the right of the divider at
normal size. Same click interactions.

```tsx
interface MacroGridCellProps {
  load: number | null;
  reps: number | null;
  sets: number | null;
  onUpdate: (field: 'load' | 'reps' | 'sets', value: number) => void;
  disabled?: boolean;
}

export function MacroGridCell({ load, reps, sets, onUpdate, disabled }: MacroGridCellProps) {
  const [editing, setEditing] = useState<'load' | 'reps' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ... (implementation below)
}
```

### Visual structure
```
┌────────────┐
│    128     │  ← load (centered, font-mono, 11px, weight 500)
│────────── 5│  ← divider line with sets count right-aligned at divider midline
│     7      │  ← reps (centered, font-mono, 9px)
└────────────┘
```

The sets count (5) sits OUTSIDE the load/reps stack, to the RIGHT,
vertically aligned with the divider line. It is NORMAL font size
(9px), NOT a superscript. The divider and the sets share the same
vertical midline.

Implementation:
```tsx
<div className="gc-wrap" style="display:flex;align-items:center">
  {/* Left: load-over-reps stack */}
  <div style="display:flex;flex-direction:column;align-items:center;flex:1">
    <div className="gc-load">128</div>
    <div className="gc-div" />
    <div className="gc-reps">7</div>
  </div>
  {/* Right: sets count, vertically centered on divider */}
  {sets > 1 && (
    <div className="gc-sets" style="font-family:var(--font-mono);font-size:9px;color:var(--color-text-tertiary);align-self:center;padding-left:2px">
      {sets}
    </div>
  )}
</div>
```

Width: 52px. Height: ~32px. Border: 0.5px solid transparent, shows
on hover (border-color transitions to border-tertiary).

The sets number only shows when sets > 1 (if sets = 1, it's implied
and the right side stays empty — same convention as the weekly planner).

### Interactions — MUST match PrescriptionGrid behavior

**Load area (top half):**
- Left click → load + 1
- Right click → load - 1
- Ctrl+click → direct input (number field replaces the load text)

**Reps area (bottom half):**
- Left click → reps + 1
- Right click → reps - 1
- Shift+click → sets + 1
- Shift+right-click → sets - 1
- Ctrl+click → direct input (shows reps and sets side by side)

**Empty cell (load/reps/sets all null):**
→ See Group 8 (auto-fill from previous week)

**Keyboard when editing:**
- Enter → commit and close edit
- Escape → cancel edit
- Tab → move to next field (load → reps → next cell)

### Save callback
Every click/edit calls `onUpdate(field, value)` which triggers
`upsertTarget(weekId, trackedExId, field, value)` in the hook.

---

## GROUP 8: AUTO-FILL FROM PREVIOUS WEEK

### The problem
When building a macro, most weeks start similar to the previous week
(progressive overload = small increments). Clicking into 18×8 empty
cells and ctrl+clicking each one is tedious.

### The fix
When a cell is EMPTY (no value set) and the coach clicks it for the
first time, auto-fill with the value from the previous week's same
exercise:

```typescript
function getDefaultFromPreviousWeek(
  targets: MacroTarget[],
  macroWeeks: MacroWeek[],
  currentWeekId: string,
  trackedExId: string,
): { load: number; reps: number; sets: number } | null {
  // Find current week's number
  const currentWeek = macroWeeks.find(w => w.id === currentWeekId);
  if (!currentWeek) return null;

  // Find previous week
  const prevWeek = macroWeeks.find(w => w.week_number === currentWeek.week_number - 1);
  if (!prevWeek) return null;

  // Find target for previous week + same exercise
  const prevTarget = targets.find(
    t => t.macro_week_id === prevWeek.id && t.tracked_exercise_id === trackedExId
  );
  if (!prevTarget) return null;

  return {
    load: prevTarget.target_max ?? 0,
    reps: prevTarget.target_reps_at_max ?? 0,
    sets: prevTarget.target_sets_at_max ?? 0,
  };
}
```

### Behavior in MacroGridCell
When all three values (load, reps, sets) are null AND the coach
clicks the cell:

1. Look up the previous week's values
2. Pre-fill the cell with those values
3. Save them immediately (so the cell is no longer empty)
4. THEN apply the click action (increment/decrement)

This means: first click on an empty cell = copies previous week
and increments by 1. The coach gets progressive overload with a
single click per cell.

If there's no previous week (week 1), the first click creates a
cell with load=0, reps=1, sets=1 — the coach then clicks up to
the desired values.

### Visual hint for empty cells
Empty cells show a subtle ghost of the previous week's value:

```tsx
{load === null ? (
  <div className="text-[9px] text-gray-300 italic text-center py-1">
    {prevWeekData ? `${prevWeekData.load}` : '-'}
  </div>
) : (
  // normal grid cell rendering
)}
```

The ghost value shows what will be filled on first click.

---

## GROUP 9: REPS AND AVG COLUMNS

### Reps column
Plain number, same interaction as the current table:
- Left click → +1
- Right click → -1
- Ctrl+click → direct input

Auto-fill from previous week on first click (same as grid cell).

### Avg column
Plain number:
- Left click → +1
- Right click → -1
- Ctrl+click → direct input

Auto-fill from previous week on first click.

### onContextMenu
All clickable cells need `onContextMenu` handlers with
`event.preventDefault()` to prevent the browser context menu
from appearing on right-click.

---

## GROUP 10: CHART.JS DUAL-AXIS CHART WITH DRAGGABLE POINTS

File: src/components/macro/MacroDraggableChart.tsx

### Replace Recharts with Chart.js
The current chart uses Recharts (LineChart + Lines). Replace with
Chart.js which handles dual-axis composite charts better and supports
direct canvas events for dragging.

Install Chart.js if not already available:
```bash
npm install chart.js
```

### Chart structure
Type: composite bar + line chart

```
Left Y-axis:  Intensity (kg) — for Max and Avg lines
Right Y-axis: Volume (reps) — for bars
X-axis:       Week numbers
```

Datasets:
1. **Bars** — total reps per week, colored by phase
2. **Max line** — solid, exercise color, large draggable dots (r=5)
3. **Avg line** — dashed, amber, smaller dots (r=3)

### Draggable points
When the coach mousedowns on a Max or Avg dot:
- Cursor changes to `ns-resize`
- Mouse move updates the value in real-time
- The Y position maps to the y1 scale value
- The table cell updates live during drag (call renderTable)
- Mouse up commits the value via upsertTarget

```typescript
// On mousedown — detect which point was clicked
canvas.onmousedown = (e) => {
  const elements = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
  if (!elements.length) return;
  const el = elements[0];
  if (el.datasetIndex === 1) dragField = 'target_max';       // Max line
  else if (el.datasetIndex === 2) dragField = 'target_avg';  // Avg line
  else return;
  dragIndex = el.index;
  isDragging = true;
};

// On mousemove — update value
canvas.onmousemove = (e) => {
  if (!isDragging) return;
  const y1 = chart.scales.y1;
  const rect = canvas.getBoundingClientRect();
  const value = Math.round(y1.getValueForPixel(e.clientY - rect.top));
  // Update data, chart, and table
};

// On mouseup — commit
canvas.onmouseup = () => {
  if (isDragging) {
    upsertTarget(weekId, trackedExId, dragField, value);
    isDragging = false;
  }
};
```

### Exercise selector
Dropdown above the chart to select which exercise's lines are shown.
Only visible (toggled-on) exercises appear in the dropdown.

### Phase coloring
Bar colors come from the phase that contains each week. The phase
color provides the background fill for the bars, creating visual
bands that show periodization structure.

### Competition markers
Vertical dashed lines at weeks that have competitions, with the
competition label at the top.

### Tooltip
Shows all three values when hovering a week:
```
Week 7
Max: 90 kg (3r x 2s)
Avg: 75 kg
Reps: 24
```

---

## GROUP 11: GRAPH VIEW INTEGRATION

File: src/components/macro/MacroGraphView.tsx

Replace the current Recharts-based graph view with the new Chart.js
component from Group 10. The graph view should show:

1. **Total reps chart** — bar chart showing K1-7 totals per week
   with a horizontal target line if `total_reps_target` is set
2. **Exercise chart** — the dual-axis chart (bars + Max/Avg lines)
   for the selected exercise

Both charts should share the same X-axis (weeks) and phase coloring.
The exercise toggle bar appears above both charts.

Keep the existing "Drag dots to adjust" hint below the chart.

---

## GROUP 12: TABLE AVERAGE ROW

At the bottom of the table, show an average row (Ø):

```
Ø |   | [avg K] | [avg R] [peak grid cell] [avg Avg] | ...
```

For each exercise:
- Reps: average weekly reps across the cycle
- Max set: shows the PEAK top set of the entire cycle
  (highest load, with the reps/sets from that specific week)
- Avg: weighted average intensity across the cycle

This gives the coach a quick summary without scrolling.

---

## GROUP 13: PHASE ROW SEPARATORS

When the table transitions from one phase to another, show a colored
phase header row:

```
┌─────────────────────────── Grundlagenphase (W2-W7) ──┐
│ 2  h  65   14  [70/3 x2]  62   ...                   │
│ 3  h  68   15  [72/3 x2]  64   ...                   │
│ ...                                                    │
├─────────────────────────── Aufbauphase (W8-W14) ──────┤
│ 8  g  52   10  [68 x 2]   58   ...                   │
│ ...                                                    │
```

Phase rows use the phase color as a left border accent and subtle
background tint. The phase name and week range are left-aligned.

---

## GROUP 14: COPY/PASTE WEEKS

Keep the existing copy/paste functionality but make it more discoverable:

- Right-click a week number → context menu: "Copy week" / "Paste week"
- Or: small copy icon appears on hover at the left edge of each row
- Paste fills all exercise values from the copied week
- Visual feedback: pasted cells flash briefly

This already exists in the codebase — just make sure it works with
the new table structure and the grid cells.

---

## GROUP 15: WIRE EVERYTHING TOGETHER

File: src/components/macro/MacroCycles.tsx

### State
```typescript
const [visibleExercises, setVisibleExercises] = useState<Set<string>>(new Set());
const [viewMode, setViewMode] = useState<'table' | 'graph' | 'both'>('both');
```

### Layout
```
[Summary strip: Reps | Avg | Tonnage | K]
[Exercise toggle bar]
[Table view]    ← when mode is 'table' or 'both'
[Chart view]    ← when mode is 'table' or 'both'
```

### Mode toggle
```
[Table] [Chart] [Both]
```

In "Both" mode, the table and chart are stacked vertically. The chart
updates live when table values change, and vice versa (drag chart →
table updates).

### Settings dependency
Load `settings.week_types` and pass to the table component for week
type badge rendering and cycling.

---

## GROUP 16: TESTING

### Custom week types
1. Open Settings → "Week types" section visible
2. Default types: High (h, red), Medium (m, amber), Low (g, green)
3. Add a new type: "Deload" / "dl" / pick a teal color → saves
4. Add "Competition" / "c" / pick a blue color → saves
5. Try duplicate abbreviation → red border, blocked
6. Delete a type not in use → removed
7. Open macro planner → click a week type badge → cycles through all types
8. The new "Deload" and "Competition" types appear with correct colors

### Exercise search
9. Click "Track exercise" → search field appears (not dropdown)
10. Type "sn" → filters to Snatch
11. Arrow down, Enter → exercise added to macro
12. Search field disappears

### Exercise toggles
13. Toggle chips appear above table
14. Click "BSq" chip → it grays out, column disappears from table
15. Switch to chart → BSq line gone
16. Toggle back → reappears
17. "Show all" resets

### Grid cell interaction
18. Click load area (top half) of a max set cell → load +1
19. Right-click load area → load -1
20. Click reps area (bottom half) → reps +1
21. Shift+click reps area → sets +1
22. Ctrl+click load → direct input field, type 95, Enter → saves
23. Ctrl+click reps → two fields (reps + sets), Tab between, Enter → saves
24. Cell shows "90" on top, divider with "2" to the right, "3" on bottom
    (meaning: 90 kg, 3 reps, 2 sets)

### Auto-fill from previous week
25. Navigate to a week with empty cells
26. Previous week has Snatch at 85 x 3 x 2
27. Ghost text "85" visible in the empty cell
28. Click the empty cell → fills with 86 x 3 x 2 (prev + 1 increment)
29. Right-click the newly filled cell → load decrements to 85
30. Week 1 (no previous) → first click creates 0 x 1 x 1

### Chart drag interaction
31. Select "Snatch" in chart dropdown
32. Grab a Max dot → drag upward → value increases
33. Table cell updates live during drag
34. Release → value committed
35. Grab an Avg dot → same behavior
36. Tooltip shows "Max: 90 kg (3r x 2s)" on hover

### Reps and Avg columns
37. Click reps cell → +1
38. Right-click → -1
39. Ctrl+click → direct input
40. Same for Avg column
41. Both auto-fill from previous week when empty

### Phase rows
42. Phase header rows show between phase transitions
43. Phase color as left accent + background tint
44. Phase name and week range displayed

### Average row
45. Ø row at bottom shows cycle averages
46. Max set column shows peak top set of entire cycle

### Copy/paste
47. Copy a week → navigate to another → paste
48. All values including grid cell (load/reps/sets) are pasted
49. Pasted cells flash briefly

### Edge cases
50. Empty macro (no targets) → all cells show ghost values or "-"
51. Single week macro → no previous week for auto-fill
52. Toggle all exercises off → table shows just week info
53. Delete tracked exercise → column removed, toggle chip removed
54. Very long exercise name → truncated in toggle chip
55. No console errors throughout

Fix any issues found during testing.
