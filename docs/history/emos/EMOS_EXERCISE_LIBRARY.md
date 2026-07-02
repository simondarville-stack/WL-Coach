# EMOS — EXERCISE LIBRARY REDESIGN

Redesign the Exercise Library page into a proper list+detail view
matching the EMOS pattern. The current implementation is a flat list
in ExerciseList.tsx with buttons in App.tsx. Replace it with a
self-contained page component.

Do not ask for confirmation. Build incrementally, run `npm run build`
after each major section, fix errors before continuing. Commit once
at the end.

---

## OVERVIEW

The new Exercise Library has:
- Left side: exercise grid/list grouped by category, with search,
  view toggle (grid/list), collapsible category sections
- Right side: detail panel (same pattern as DayEditor in the weekly
  planner — a right-side panel that slides in when an exercise is
  selected)
- Two modes based on athlete selection:
  - No athlete → coach view (definition + roster-wide PR table)
  - Athlete selected → athlete view (individual PR, progression, plans)

---

## STEP 1: ADD COLOR TO CATEGORIES

The `categories` table currently has: id, name, display_order,
created_at. Add a color column.

Create a new migration file:

```sql
-- Add color column to categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color text DEFAULT '#888780';

-- Set some default colors for existing categories based on position
UPDATE categories SET color = CASE
  WHEN display_order = 0 THEN '#E24B4A'
  WHEN display_order = 1 THEN '#7F77DD'
  WHEN display_order = 2 THEN '#D85A30'
  WHEN display_order = 3 THEN '#1D9E75'
  WHEN display_order = 4 THEN '#EF9F27'
  WHEN display_order = 5 THEN '#D4537E'
  ELSE '#888780'
END
WHERE color IS NULL OR color = '#888780';
```

Run this migration against the database.

Then update the Category interface in `src/hooks/useExercises.ts`:
```typescript
export interface Category {
  id: string;
  name: string;
  display_order: number;
  color: string;          // ADD THIS
  created_at: string;
}
```

Update `createCategory` to accept and store color. Update
`updateCategory` to accept and store color. Update
`fetchCategories` — it already does `select('*')` so the new
column will come through automatically.

---

## STEP 2: CREATE ExerciseLibrary.tsx

Create `src/components/exercise-library/ExerciseLibrary.tsx` — the
new page component. This replaces the inline JSX in App.tsx.

### Structure

```tsx
export function ExerciseLibrary() {
  // Get athlete/group context
  const { selectedAthlete } = useAthleteStore();
  const { exercises, categories, fetchExercises, fetchCategories,
          createExercise, updateExercise, deleteExercise,
          createCategory, updateCategory, deleteCategory,
          swapCategoryOrder } = useExercises();

  // View state
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  // ... data loading, filtering, etc.
}
```

### Layout — three columns

```
┌──────────────────────────────────────────────────────────────┐
│ Toolbar: [Search...] [Grid|List] [Categories] [+ Add]        │
├──────────────────────────────────────┬───────────────────────┤
│                                      │                       │
│  Category: Competition lifts    [3]  │  Exercise Detail      │
│  ┌────┐ ┌────┐ ┌────┐              │  Panel                │
│  │ Sn │ │C&J │ │ Cl │              │                       │
│  └────┘ └────┘ └────┘              │  (slides in from      │
│                                      │   right when an      │
│  Category: Partial lifts        [5]  │   exercise is        │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐      │   selected)           │
│  │PSn │ │PCl │ │HSn │ │HCl │      │                       │
│  └────┘ └────┘ └────┘ └────┘      │                       │
│  ...                                 │                       │
└──────────────────────────────────────┴───────────────────────┘
```

When no exercise is selected, the detail panel is hidden and the
exercise grid takes the full width. When an exercise is clicked,
the detail panel slides in from the right (same animation pattern
as the weekly planner's sidebar dialog mode).

### Important: the detail panel should NOT be a modal overlay.

It should be an inline panel on the right side of the page, pushing
the exercise list to take less width. Use a flex layout:

```tsx
<div className="flex h-full overflow-hidden">
  {/* Exercise list — flex-1 */}
  <div className="flex-1 overflow-y-auto">
    {/* toolbar + categories + cards */}
  </div>

  {/* Detail panel — fixed width, conditionally rendered */}
  {selectedExerciseId && (
    <div className="w-[320px] flex-shrink-0 border-l border-gray-200
                    overflow-y-auto bg-white animate-sidebar-in">
      <ExerciseDetailPanel
        exercise={selectedExercise}
        category={...}
        athlete={selectedAthlete}
        onClose={() => setSelectedExerciseId(null)}
        onEdit={(ex) => { setEditingExercise(ex); setShowCreateModal(true); }}
      />
    </div>
  )}
</div>
```

---

## STEP 3: TOOLBAR

The toolbar sits at the top of the exercise list:

```tsx
<div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200
                flex-shrink-0 sticky top-0 bg-white z-10">
  {/* Search */}
  <div className="relative flex-1">
    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
    <input
      type="text"
      placeholder="Search exercises..."
      value={searchQuery}
      onChange={e => setSearchQuery(e.target.value)}
      className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200
                 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  </div>

  {/* View toggle */}
  <div className="flex gap-px bg-gray-100 rounded-md p-0.5">
    <button onClick={() => setViewMode('grid')}
      className={`px-2.5 py-1 text-[10px] rounded ${viewMode === 'grid' ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'}`}>
      Grid
    </button>
    <button onClick={() => setViewMode('list')}
      className={`px-2.5 py-1 text-[10px] rounded ${viewMode === 'list' ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'}`}>
      List
    </button>
  </div>

  {/* Category manager toggle */}
  <button onClick={() => setShowCategoryManager(v => !v)}
    className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200
               rounded-lg hover:bg-gray-50">
    Categories
  </button>

  {/* Add exercise */}
  <button onClick={() => { setEditingExercise(null); setShowCreateModal(true); }}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
               text-white bg-blue-600 rounded-lg hover:bg-blue-700">
    <Plus size={14} /> Add exercise
  </button>
</div>
```

---

## STEP 4: CATEGORY SECTIONS

Group exercises by category. Each category is a collapsible section:

```tsx
{sortedCategories.map(cat => {
  const catExercises = filteredExercises.filter(ex => ex.category === cat.name);
  if (catExercises.length === 0 && searchQuery) return null;
  const isCollapsed = collapsedCategories.has(cat.id);
  const totalPlans = catExercises.reduce((s, ex) => s + (exerciseUsage.get(ex.id) || 0), 0);

  return (
    <div key={cat.id} className="px-4">
      {/* Category header — clickable to collapse */}
      <div
        className="flex items-center gap-2 py-2.5 cursor-pointer select-none group"
        onClick={() => toggleCollapse(cat.id)}
      >
        <ChevronRight size={12}
          className={`text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: cat.color }} />
        <span className="text-xs font-medium text-gray-800">{cat.name}</span>
        <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 rounded-full">
          {catExercises.length}
        </span>
        <span className="flex-1 h-px bg-gray-100" />
        <span className="text-[9px] text-gray-400 font-mono">
          {totalPlans} uses
        </span>
      </div>

      {/* Exercise cards — hidden when collapsed */}
      {!isCollapsed && (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1.5 pb-3">
            {catExercises.map(ex => (
              <ExerciseCard key={ex.id} exercise={ex} ... />
            ))}
          </div>
        ) : (
          <div className="pb-3">
            {catExercises.map(ex => (
              <ExerciseListRow key={ex.id} exercise={ex} ... />
            ))}
          </div>
        )
      )}
    </div>
  );
})}
```

### Collapse state

```typescript
const toggleCollapse = (catId: string) => {
  setCollapsedCategories(prev => {
    const next = new Set(prev);
    if (next.has(catId)) next.delete(catId);
    else next.add(catId);
    return next;
  });
};
```

---

## STEP 5: EXERCISE CARD (Grid view)

Each card shows:
- Color dot + exercise code (mono, prominent)
- Full exercise name (smaller, secondary)
- "COMP" badge if competition lift
- Bottom row: PR value (if tracked + athlete selected), plan count,
  last used week

```tsx
<div
  onClick={() => setSelectedExerciseId(ex.id)}
  className={`border rounded-lg p-2 cursor-pointer transition-colors ${
    selectedExerciseId === ex.id
      ? 'border-blue-400 bg-blue-50'
      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
  }`}
>
  <div className="flex items-center gap-1.5 mb-1">
    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: ex.color }} />
    <span className="font-mono text-[11px] font-medium text-gray-900 truncate">
      {ex.exercise_code || ex.name}
    </span>
    {ex.is_competition_lift && (
      <span className="text-[7px] font-medium bg-red-50 text-red-500
                       px-1 rounded ml-auto">COMP</span>
    )}
  </div>
  <div className="text-[10px] text-gray-500 mb-1.5 truncate">{ex.name}</div>
  <div className="flex gap-2 text-[9px] text-gray-400">
    {/* PR — only if athlete selected and PR tracked */}
    {athletePR && (
      <span className="font-mono">
        <span className="font-medium text-gray-900">{athletePR.pr_value_kg}</span> kg
      </span>
    )}
    <span>{usageCount} plans</span>
  </div>
</div>
```

---

## STEP 6: EXERCISE LIST ROW (List view)

Compact row view for density:

```tsx
<div
  onClick={() => setSelectedExerciseId(ex.id)}
  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer
              transition-colors ${
    selectedExerciseId === ex.id
      ? 'bg-blue-50'
      : 'hover:bg-gray-50'
  }`}
>
  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ex.color }} />
  <span className="font-mono text-[11px] font-medium w-[40px]">
    {ex.exercise_code || '—'}
  </span>
  <span className="flex-1 text-[11px] text-gray-600 truncate">{ex.name}</span>
  {ex.is_competition_lift && (
    <span className="text-[7px] font-medium bg-red-50 text-red-500 px-1 rounded">COMP</span>
  )}
  {athletePR && (
    <span className="font-mono text-[11px] font-medium w-[50px] text-right">
      {athletePR.pr_value_kg} kg
    </span>
  )}
  <span className="text-[9px] text-gray-400 w-[40px] text-right">{usageCount} plans</span>
</div>
```

---

## STEP 7: EXERCISE DETAIL PANEL

Create `src/components/exercise-library/ExerciseDetailPanel.tsx`.

This is the right-side panel. It receives:

```typescript
interface ExerciseDetailPanelProps {
  exercise: Exercise;
  category: Category | null;
  athlete: Athlete | null;         // null = coach view
  allAthletes: Athlete[];          // for coach view PR table
  onClose: () => void;
  onEdit: (exercise: Exercise) => void;
  onArchive: (exerciseId: string) => void;
}
```

### Header

```tsx
<div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: exercise.color }} />
  <div className="flex-1 min-w-0">
    <div className="text-sm font-medium text-gray-900 truncate">{exercise.name}</div>
    <div className="text-[10px] text-gray-500">
      {exercise.exercise_code} · {exercise.category}
    </div>
  </div>
  <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
    <X size={16} />
  </button>
</div>
```

### Tags row

Show badges: "Competition lift" (red), "PR tracked" (blue),
unit type, stacked notation if on.

### Stats grid (2 columns)

**Coach view (no athlete):**
- "Athletes using" — count of athletes who have this exercise in
  any plan, out of total active athletes. Query: count distinct
  athlete_id from week_plans that have planned_exercises with this
  exercise_id.
- "Total plans" — count of week_plans containing this exercise.
  Query: count distinct weekplan_id from planned_exercises where
  exercise_id = this.

**Athlete view:**
- "Current PR" — from athlete_prs table. Show value + date.
- "Used in" — count of this athlete's plans containing this exercise.

### Coach view: Athlete PR table

Query `athlete_prs` for this exercise_id across all athletes.
Join with athletes table to get names. Sort by pr_value_kg desc.

Display as a list of rows:
```
[ML] Marcus L.     175 kg   Mar 20
[KH] Katrine H.    130 kg   Mar 18
[JN] Jonas N.      155 kg   Feb 28
```

Each row has an initials avatar (first letters of name), name,
PR value, date.

Below the list, show a horizontal bar chart of PRs for visual
comparison.

### Athlete view: PR Progression chart

Query `athlete_prs` for this athlete+exercise. If only one row
exists (current system), the chart won't be meaningful yet. For
now, show the single current PR value prominently.

NOTE: In the future we can add a pr_history table, but for now
just show the single PR value from athlete_prs.

### Plan usage list

Query planned_exercises for this exercise_id, join with
week_plans to get week_start, join with macrocycles to get
macro name. Show a list:

```
[dot] Spring block W5-8
[dot] Winter prep W1-3
```

If athlete is selected, filter to that athlete's plans.
If no athlete, show all plans across the roster (maybe
group by athlete).

Limit to 10 most recent. Show "and X more" if truncated.

### Related exercises

Other exercises in the same category. Show as clickable chips
that switch the detail panel to that exercise:

```tsx
<div className="flex flex-wrap gap-1">
  {relatedExercises.map(rex => (
    <button key={rex.id}
      onClick={() => onSelectExercise(rex.id)}
      className="flex items-center gap-1 px-2 py-0.5 border border-gray-200
                 rounded-full text-[9px] text-gray-600 hover:bg-gray-50">
      <span className="w-1 h-1 rounded-full" style={{ backgroundColor: rex.color }} />
      {rex.exercise_code || rex.name}
    </button>
  ))}
</div>
```

Also show the PR reference exercise if set (ex.pr_reference_exercise_id):
"Derives % from: [Snatch]"

### Notes

Show exercise.notes as text. Editable inline (click to edit,
blur to save).

### Link/reference

Show exercise.link as a clickable external link if set.

### Actions footer

Two buttons at the bottom:
- "Edit" — opens ExerciseFormModal with this exercise
- "Archive" — sets is_archived = true (soft delete)

---

## STEP 8: CATEGORY MANAGEMENT

When the "Categories" button is clicked in the toolbar, show an
inline collapsible panel ABOVE the exercise grid (not a modal).
This panel lets the coach:

1. See all categories with their color, name, exercise count,
   and display order
2. Rename a category (click the name to edit inline)
3. Change category color (click the color swatch to show a
   small color picker — use the same PRESET_COLORS from
   ExerciseForm.tsx)
4. Reorder categories (up/down arrow buttons using swapCategoryOrder)
5. Add a new category (input + button at the bottom)
6. Delete a category (only if no exercises use it; show warning
   otherwise)

Layout:
```
┌─ Categories ─────────────────────────────────────────────┐
│ [●] Competition lifts    3 exercises   [▲] [▼] [×]       │
│ [●] Partial lifts        5 exercises   [▲] [▼] [×]       │
│ [●] Pulls                2 exercises   [▲] [▼] [×]       │
│ [●] Squats               3 exercises   [▲] [▼] [×]       │
│ [+ Add category...]                                      │
└──────────────────────────────────────────────────────────┘
```

Each row:
- Color swatch (clickable → shows color picker inline)
- Category name (clickable → inline edit input)
- Exercise count (read-only)
- Up/down reorder buttons
- Delete button (disabled + tooltip if exercises exist)

---

## STEP 9: DATA LOADING

The ExerciseLibrary component needs to load:

1. **Exercises** — already available via useExercises() hook
2. **Categories** — already available via useExercises() hook
3. **Exercise usage counts** — how many plans each exercise appears in.
   Query planned_exercises grouped by exercise_id:
   ```sql
   SELECT exercise_id, COUNT(DISTINCT weekplan_id) as plan_count
   FROM planned_exercises
   GROUP BY exercise_id
   ```
   Store as Map<string, number>.

4. **Athlete PRs** — depends on mode:
   - Athlete selected: query athlete_prs for that athlete
   - No athlete: query athlete_prs for ALL athletes, join with
     athletes to get names

Load on mount and when athlete changes.

---

## STEP 10: WIRE INTO App.tsx

Replace the inline exercise library JSX in App.tsx with the new
component.

Current (approximately lines 191-229):
```tsx
<Route path="/library" element={
  <div className="max-w-7xl mx-auto px-4 ...">
    <div className="mb-6 flex items-center gap-3">
      <button>Add New Exercise</button>
      <button>Manage Categories</button>
      <button>Import from Excel</button>
    </div>
    <div className="bg-white rounded-lg shadow-md p-6">
      <ExerciseList ... />
    </div>
  </div>
} />
```

Replace with:
```tsx
<Route path="/library" element={<ExerciseLibrary />} />
```

Move the ExerciseFormModal and ExerciseBulkImportModal rendering
into ExerciseLibrary.tsx (or keep them in App.tsx if they're used
elsewhere — check first).

The exercise CRUD functions (createExercise, updateExercise,
deleteExercise) should be called from within ExerciseLibrary.tsx
via the useExercises() hook, not passed as props from App.tsx.

Also update App.tsx to remove:
- The old Add/Categories/Import buttons
- The ExerciseList import (if no longer used elsewhere)
- The showFormModal/showSettingsModal state if fully moved
- Any exercise-related state that's now encapsulated

BUT: Keep the ExerciseFormModal, ExerciseBulkImportModal, and
Settings components importable — ExerciseLibrary will use them.

---

## STEP 11: EXERCISE FORM MODAL INTEGRATION

When adding or editing an exercise from the new library:

1. Click "+ Add exercise" → setShowCreateModal(true), setEditingExercise(null)
2. Click "Edit" in detail panel → setShowCreateModal(true),
   setEditingExercise(exercise)
3. Modal uses existing ExerciseFormModal component
4. On save → refetch exercises, keep detail panel open if editing
5. On close → setShowCreateModal(false)

---

## STEP 12: BULK IMPORT INTEGRATION

Add an "Import" button in the toolbar (or as a dropdown item).
Opens the existing ExerciseBulkImportModal.

---

## STEP 13: PAGE STYLING

Match the EMOS dark sidebar layout. The page should:
- Fill the available height (like the weekly planner)
- Have a white background in the main content area
- Use the same spacing and typography as the macro and planner pages
- Detail panel has a subtle left border, same bg as main

The outer wrapper:
```tsx
<div className="flex flex-col h-full overflow-hidden bg-white">
  {/* Toolbar */}
  <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 ...">
    ...
  </div>

  {/* Main content */}
  <div className="flex flex-1 overflow-hidden">
    {/* Exercise list */}
    <div className="flex-1 overflow-y-auto">
      {/* Category manager (collapsible) */}
      {/* Category sections with cards */}
    </div>

    {/* Detail panel */}
    {selectedExerciseId && (
      <div className="w-[320px] flex-shrink-0 border-l border-gray-200
                      overflow-y-auto">
        <ExerciseDetailPanel ... />
      </div>
    )}
  </div>
</div>
```

---

## STEP 14: BUILD AND TEST

```bash
npm run build
```

Open Chrome, navigate to Exercise Library:

1. Exercises are grouped by category with colored headers
2. Category headers show color dot, name, count, total usage
3. Click category header → collapses/expands that section
4. Grid view shows exercise cards with code, name, PR, usage
5. List view shows compact rows
6. Search filters across all categories (matching code and name)
7. Click an exercise card → detail panel slides in from right
8. Detail panel shows tags, stats, related exercises, notes
9. "COMP" badge appears on competition lifts
10. Click X on detail panel → panel closes
11. Click a different exercise → panel updates
12. Click a related exercise chip → panel switches to that exercise
13. "Edit" button opens ExerciseFormModal with exercise data
14. "Archive" button soft-archives the exercise (is_archived = true)
15. "Categories" button toggles the category manager panel
16. Category manager: rename, recolor, reorder, add, delete
17. "+ Add exercise" opens ExerciseFormModal blank
18. Category colors appear on the dot swatches
19. Collapse state persists while navigating
20. No console errors

### With athlete selected:
21. Cards show that athlete's PR value
22. Detail panel shows "Current PR" with value + date
23. Plan usage filtered to that athlete's plans

### Without athlete:
24. Cards show plan count (no individual PR)
25. Detail panel shows "Athletes using: X of Y"
26. Detail panel shows roster-wide PR table sorted by value
27. PR distribution bars show visual comparison

Fix any issues found.
