# EMOS — WIRE NEW MACRO TABLE COMPONENTS

Three new component files have already been created in the repo:
- `src/components/macro/MacroGridCell.tsx` — prescription grid cell (load/reps/sets)
- `src/components/macro/ExerciseToggleBar.tsx` — exercise visibility toggle chips
- `src/components/macro/MacroTableV2.tsx` — redesigned table with 3 columns per exercise

Your job is to wire these into MacroCycles.tsx, replacing the old MacroTable.
Do NOT modify the new component files. Only change MacroCycles.tsx and
any parent/integration files.

Work on branch `feature/macro-planner-redesign`.
Run `npm run build` after each group. Commit each group.
Do not ask for confirmation.

---

## GROUP 1: CREATE BRANCH AND READ FILES

```bash
git checkout main && git pull
git checkout -b feature/macro-planner-redesign
```

Read these files to understand them:
- `src/components/macro/MacroGridCell.tsx`
- `src/components/macro/ExerciseToggleBar.tsx`
- `src/components/macro/MacroTableV2.tsx`
- `src/components/macro/MacroCycles.tsx` (the parent that needs changes)

---

## GROUP 2: ADD VISIBILITY STATE TO MacroCycles.tsx

Add exercise visibility state:

```typescript
const [visibleExercises, setVisibleExercises] = useState<Set<string>>(new Set());

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
```

---

## GROUP 3: REPLACE MacroTable IMPORT WITH MacroTableV2

In MacroCycles.tsx:

```typescript
// OLD:
import { MacroTable } from './MacroTable';
// NEW:
import { MacroTableV2 } from './MacroTableV2';
import { ExerciseToggleBar } from './ExerciseToggleBar';
```

Find where `<MacroTable` is rendered and replace with:

```tsx
{/* Exercise toggle bar — above both table and graph */}
{trackedExercises.length > 0 && (
  <ExerciseToggleBar
    exercises={trackedExercises}
    visible={visibleExercises}
    onToggle={toggleExercise}
    onShowAll={() => setVisibleExercises(new Set(trackedExercises.map(t => t.id)))}
  />
)}

{/* Table view */}
{viewMode === 'table' && (
  <MacroTableV2
    macroWeeks={macroWeeks}
    trackedExercises={trackedExercises}
    targets={targets}
    phases={phases}
    actuals={actuals}
    onUpdateTarget={handleUpdateTarget}
    onUpdateWeekType={handleUpdateWeekType}
    onUpdateWeekLabel={handleUpdateWeekLabel}
    onUpdateTotalReps={handleUpdateTotalReps}
    onUpdateNotes={handleUpdateNotes}
    onMoveExerciseLeft={handleMoveExerciseLeft}
    onMoveExerciseRight={handleMoveExerciseRight}
    onRemoveExercise={handleRemoveExercise}
    onPasteTargets={handlePasteTargets}
    onExerciseDoubleClick={handleExerciseDoubleClick}
    visibleExercises={visibleExercises}
  />
)}
```

Match the exact prop names from MacroCycles — they may be named
slightly differently (e.g., `handleUpdateTarget` vs `onUpdateTarget`).
Read the existing MacroTable usage to get the right prop values.

---

## GROUP 4: REPLACE EXERCISE DROPDOWN WITH SEARCH

Find the `showAddExercise` block in MacroCycles.tsx (the <select>
dropdown around line 463-498).

Replace with ExerciseSearch from the planner:

```tsx
import { ExerciseSearch } from '../planner/ExerciseSearch';

{showAddExercise ? (
  <div className="relative" style={{ minWidth: 240 }}>
    <ExerciseSearch
      exercises={availableExercises}
      onAdd={async (exercise) => {
        await handleAddExercise(exercise.id);
        setShowAddExercise(false);
      }}
      placeholder="Search exercise to track..."
    />
  </div>
) : (
  <button onClick={() => setShowAddExercise(true)} className="...existing classes...">
    <Plus size={13} /> Track exercise
  </button>
)}
```

Adjust `handleAddExercise` to accept an exercise ID directly instead
of reading from `selectedExerciseId` state. Remove `selectedExerciseId`
state if it's no longer needed.

Check if ExerciseSearch has an `onSlashCommand` prop — if so, don't
pass it (slash commands like /combo, /text are irrelevant in macro).

---

## GROUP 5: PASS VISIBILITY TO GRAPH VIEW

If MacroGraphView / MacroDraggableChart is rendered, pass
`visibleExercises` to it so hidden exercises are also hidden in the
chart. Filter `trackedExercises` before passing:

```tsx
const displayedForGraph = trackedExercises.filter(te => visibleExercises.has(te.id));
```

Pass `displayedForGraph` instead of `trackedExercises` to the graph.

---

## GROUP 6: TEST IN CHROME

Open http://localhost:5173, navigate to Macro Cycles:

1. Select an athlete with a macrocycle
2. Table renders with new 3-column layout: Reps | Max set | Avg
3. Max set cells show load/divider/reps format (like prescription grid)
4. Click top half of max set cell → load +1
5. Right-click → load -1
6. Click bottom half → reps +1
7. Shift+click bottom → sets +1 (sets number appears right of divider)
8. Ctrl+click load → direct input, type 95, Enter
9. Ctrl+click reps → reps + sets input, Tab between them
10. Exercise toggle chips visible above table
11. Click a chip → exercise column hides
12. Toggle back → column reappears
13. "Track exercise" shows search field, not dropdown
14. Type exercise name → filtered results → Enter to add
15. Week type badges show colored abbreviations
16. Click badge → cycles through types
17. Phase separator rows appear with colored accent
18. Average row at bottom shows cycle peak
19. Empty cells show ghost of previous week value
20. Click empty cell → fills from previous week + increments
21. Switch to graph view → hidden exercises also hidden there
22. No console errors

Fix any issues found.
