# EMOS — WIRE ANNUAL WHEEL AS MACRO ENTRY VIEW

A new component `MacroAnnualWheel.tsx` has been added to
`src/components/macro/`. It renders a circular year view showing all
macrocycles, phases, and competitions. It is the new entry point to
the macro cycles page.

Your job: wire it into MacroCycles.tsx so the flow is:
1. No cycle selected → annual wheel view
2. Click a macro arc → detail view (existing table/chart)  
3. Back button → returns to wheel

Do NOT modify MacroAnnualWheel.tsx.
Run `npm run build` after all edits. Commit.
Do not ask for confirmation.

---

## STEP 1: Import the component

At the top of `src/components/macro/MacroCycles.tsx`, add:

```typescript
import { MacroAnnualWheel } from './MacroAnnualWheel';
```

Also add `ArrowLeft` to the lucide-react import.

---

## STEP 2: Remove auto-selection of first cycle

Find the useEffect that auto-selects the first macrocycle. It looks
approximately like this:

```typescript
useEffect(() => {
  if (macrocycles.length > 0 && !selectedCycle) {
    setSelectedCycle(macrocycles[0]);
  }
}, [macrocycles]);
```

DELETE this entire useEffect block. The wheel is the entry view now —
we don't want to skip it by auto-selecting.

---

## STEP 3: Show wheel when no cycle is selected

Find the return JSX. Currently the structure is approximately:

```tsx
return (
  <div className="flex flex-col h-full overflow-hidden">
    {/* Top toolbar */}
    <div className="flex items-center gap-2 px-4 py-3 ...">
      {/* Cycle selector dropdown */}
      {/* Create button */}
      {/* Chart toggle, etc — only if selectedCycle */}
    </div>

    {/* Main content — table, chart, etc */}
    {selectedCycle ? (
      // ... existing detail view
    ) : (
      // ... some "no cycle" placeholder
    )}
  </div>
);
```

Replace the structure so that when `selectedCycle` is null, the
ENTIRE page (including toolbar) is replaced by the wheel. The wheel
has its own "New macrocycle" button, so the toolbar isn't needed.

The new structure should be:

```tsx
return (
  <div className="flex flex-col h-full overflow-hidden">
    {selectedCycle ? (
      <>
        {/* Existing toolbar — BUT with a back button added */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-shrink-0 flex-wrap">
          {/* NEW: Back button — first item */}
          <button
            onClick={() => setSelectedCycle(null)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg mr-1"
            title="Back to annual view"
          >
            <ArrowLeft size={14} />
          </button>

          {/* Existing cycle selector dropdown */}
          {/* ... rest of existing toolbar ... */}
        </div>

        {/* Existing detail content (table, chart, etc) */}
        {/* ... everything that was inside selectedCycle check ... */}
      </>
    ) : (
      <div className="flex-1 overflow-y-auto">
        <MacroAnnualWheel
          macrocycles={macrocycles}
          onSelectCycle={(cycle) => setSelectedCycle(cycle)}
          onCreateCycle={() => setShowCreateModal(true)}
          athleteName={selectedAthlete?.name}
          groupName={selectedGroup?.name}
        />
      </div>
    )}

    {/* Modals — OUTSIDE the conditional, always rendered */}
    {showCreateModal && (
      <MacroCreateModal ... />
    )}
    {showEditModal && (
      <MacroEditModal ... />
    )}
    {/* ... other modals ... */}
  </div>
);
```

IMPORTANT: Make sure the modals (MacroCreateModal, MacroEditModal,
MacroPhaseModal) are rendered OUTSIDE the selectedCycle conditional
so they work from both the wheel and detail views.

---

## STEP 4: Update cycle creation callback

When a new cycle is created from the wheel, we want to navigate
into it. Find the `onCreate` handler in the MacroCreateModal usage.
After creating a cycle, it should call `setSelectedCycle(newCycle)`.

Check if this already happens. If not, ensure the create flow ends
with selecting the newly created cycle.

---

## STEP 5: Update delete to return to wheel

Find the delete cycle handler. After deleting a cycle, it should
set `setSelectedCycle(null)` to return to the wheel view.

Check if this already happens — it likely does since the deleted
cycle won't exist anymore.

---

## STEP 6: Keep the cycle selector dropdown working

The dropdown in the toolbar should still work for switching between
macrocycles WITHOUT going back to the wheel. When the user selects
a different cycle from the dropdown, it switches directly.

The back arrow (ArrowLeft button) is the explicit "go back to wheel"
action.

---

## STEP 7: Page title

The page title in the sidebar is already "Macro cycles". No changes
needed there.

But consider: when the wheel is shown, the page should NOT show
"Macro cycles" as a redundant header above the wheel. The wheel
itself has the year and counts in the center. If there's a page
title rendered above the content area, it's fine to keep it.

---

## STEP 8: Build and test

```bash
npm run build
```

Open Chrome, navigate to Macro Cycles:

1. The annual wheel appears (not the detail view)
2. The wheel shows macrocycles as colored arcs around the year
3. Hover any arc → tooltip with name, dates, "Click to open"
4. Hover a phase → tooltip with phase name + parent macro
5. Hover a competition diamond → tooltip with name + date
6. Year navigation ‹ › works
7. "Today" button jumps to current year
8. Today needle shows on current year
9. Click a macro arc → detail view appears with table
10. Back arrow (←) in toolbar → returns to wheel
11. Cycle dropdown still works for switching macros in detail view
12. "New macrocycle" button on wheel opens create modal
13. Creating a new macro → enters detail view for the new macro
14. Deleting a macro → returns to wheel
15. Cross-year macros show chevron indicators at year boundaries
16. Navigate to previous/next year to see the continuation
17. Switching athlete in top bar → wheel updates with new data
18. No console errors

Fix any issues found.
