# ~~OUTDATED~~ EMOS — MACRO TABLE FIXES (SURGICAL)

> **OUTDATED** — Handled through other means. Do not execute.

Fix specific issues in the macro planner. Each fix is a targeted edit.
Run `npm run build` after all fixes. Commit once at the end.
Do not ask for confirmation.

---

## FIX 1: PHANTOM +1 ON FIRST CLICK

File: src/components/macro/MacroGridCell.tsx

When clicking an empty grid cell, it should fill from previous week
WITHOUT any increment. Currently `fillFromPrev(delta)` is called
with delta=0 from the isEmpty check, which is correct. BUT the
handleLoadClick also passes the click's delta:

Check line ~65 in handleLoadClick:
```
if (isEmpty) {
  fillFromPrev(0);  // This should be delta=0, NOT the click delta
  return;
}
```

If this is already 0, the phantom +1 issue is in handleInlineClick
in MacroTableV2.tsx. Check that when currentValue is null, the fill
does NOT add any delta:

File: src/components/macro/MacroTableV2.tsx
Around line 154:
```typescript
if (currentValue === null) {
  // Fill from previous — NO delta applied
  onUpdateTarget(weekId, teId, field, String(prevValue ?? 0));
  return;
}
```

Verify this is exactly what the code does. If it adds +1 anywhere
on the first click of a null value, remove that addition.

---

## FIX 2: TABLE PADDING — MATCH OTHER PAGES

File: src/components/macro/MacroCycles.tsx

The table wrapper currently has `px-4` but the table itself goes
edge to edge within its container. The issue is likely the parent
container having no padding/margin on the right, or the table
`overflow-auto` stretching full width.

Find the main content wrapper — it likely looks like:
```tsx
<div className="flex-1 overflow-y-auto flex flex-col gap-3 ...">
```

Ensure it has consistent padding matching other EMOS pages.
Look at how WeeklyPlanner.tsx wraps its content for reference.
The table wrapper should be:
```tsx
<div className="px-4 pt-3 pb-2">
  <MacroTableV2 ... />
</div>
```

This is likely already there but check that the parent flex container
isn't overriding it. The outer wrapper might need `px-4` too.

---

## FIX 3: REPS BARS — THINNER AND CENTERED

File: src/components/macro/MacroDraggableChart.tsx

The reps bars in the chart are too wide and not centered on the
week tick marks. In Recharts, control bar width with:

```tsx
<Bar
  dataKey={...}
  barSize={16}        // was probably 30-40, make it 16px
  // ... other props
/>
```

If there's no `barSize` prop, add it. The default bar size in
Recharts `ComposedChart` is often too wide.

Also check if `XAxis` has `padding` that misaligns the bars:
```tsx
<XAxis
  type="category"
  // If bars aren't centered, ensure there's no asymmetric padding
/>
```

---

## FIX 4: PHASE BACKGROUND COLOR ON ROWS

File: src/components/macro/MacroTableV2.tsx

Currently phase rows are separator headers only. The individual
week rows inside a phase should have a subtle background tint
matching the phase color at 30% opacity.

Where week rows are rendered (around line 345), add the phase
background color to the `<tr>`:

```tsx
const phaseColor = phase?.color;

rows.push(
  <tr
    key={week.id}
    className="hover:bg-gray-50/50 transition-colors"
    style={phaseColor ? { backgroundColor: phaseColor + '0D' } : undefined}
    // 0D = ~5% opacity (subtle). Use '1A' for 10%, '4D' for 30%
  >
```

Use `4D` suffix for 30% opacity: `phaseColor + '4D'`

The phase color comes from `weekToPhase.get(week.id)?.color`.
Make sure it's available where the data row is rendered.

---

## FIX 5: GENERAL COLUMNS — EDITABLE + CORRECT STYLING

File: src/components/macro/MacroTableV2.tsx

### 5a. Tonnage and Avg should be computed, not editable
Tonnage = sum of (reps * avg) for all exercises in that week.
Avg = weighted average intensity = tonnage / total reps.
These are already computed correctly as `weekTonnage` and `weekAvgInt`.
They should NOT be editable — they're derived values.

Verify the current code computes them (around line 330-340):
```typescript
let weekK = 0;
let weekTonnage = 0;
displayed.forEach(te => {
  const t = getTarget(week.id, te.id);
  const reps = t?.target_reps ?? 0;
  const avg = t?.target_avg ?? 0;
  weekK += reps;
  if (reps > 0 && avg > 0) weekTonnage += reps * avg;
});
const weekAvgInt = weekK > 0 && weekTonnage > 0 ? Math.round(weekTonnage / weekK) : null;
```

### 5b. Format tonnage display
Tonnage in kg is large (e.g., 12450). Display as tonnes with 1 decimal:
```tsx
{weekTonnage > 0 ? (weekTonnage / 1000).toFixed(1) : ''}
```
So 12450 shows as "12.5" (tonnes), not "12,450".

### 5c. K column should show total reps, editable for the target
The K column currently shows computed `weekK` (total reps from
exercises). But `macro_weeks` also has a `total_reps_target` field.
Show the computed value, and make it clickable to set the target:
- Display: computed total (or target if set)
- Ctrl+click: edit the target
- If target differs from computed, show target in parentheses

### 5d. Notes column should be editable
Verify the notes column has click-to-edit (it should based on
the current code with `editingNotesId`). Make sure clicking the
notes cell opens the input field.

### 5e. Consistent styling for General vs Exercise columns
The General section (Ton, Avg, Notes) should have:
- Same row height as exercise columns
- A subtle blue-ish background (`bg-blue-50/5`) to distinguish
  from exercise columns
- Same font size and family
- Clear left border separating from the sticky week columns

---

## FIX 6: AVERAGE ROW — CORRECT CALCULATIONS

File: src/components/macro/MacroTableV2.tsx

### 6a. K column average
Currently shows `cycleTotals.k` (total reps across ALL weeks).
It should show the AVERAGE per week: `Math.round(cycleTotals.k / macroWeeks.length)`.

Change line ~583:
```tsx
{cycleTotals.k > 0 ? Math.round(cycleTotals.k / macroWeeks.length) : ''}
```

### 6b. Tonnage average
Show average weekly tonnage, not total:
```tsx
{cycleTotals.tonnage > 0 ? (cycleTotals.tonnage / macroWeeks.length / 1000).toFixed(1) : ''}
```

### 6c. Per-exercise average reps
Currently divides by `weekCount` which is the number of weeks that
have data. This is correct — it averages across weeks with entries.
Verify it excludes weeks with 0 reps.

### 6d. Peak max set in average row
The MacroGridCell in the average row shows the peak target_max
across all weeks. This is correct. Make sure it shows "peak" not
"average" — the peak top set is the most useful summary metric.

---

## FIX 7: SETS INTERACTION IN GRID CELL

File: src/components/macro/MacroGridCell.tsx

### 7a. Sets visibility
Currently sets shows "1" with opacity-0 (hidden) and reveals on
hover. This matches the PrescriptionGrid behavior. Check that:
- Sets = 1: hidden, shows on hover with opacity-40
- Sets > 1: always visible at full opacity
- The hover area is large enough to click

If the hover area is too small, increase the cell height slightly:
```tsx
style={{ minWidth: 52, height: 38 }}  // was 36, try 38
```

### 7b. Sets click area
The sets number is only 9px font in a small area. Make the click
target larger by adding padding:
```tsx
<div className="... self-center pr-1.5 pl-1 py-2 cursor-pointer ...">
```

Add `py-2` to make the click target vertically taller without
changing the visual layout.

### 7c. Sets increment/decrement
Left click on sets area → sets +1
Right click → sets -1
This is already implemented. Verify it works by checking the
onClick and onContextMenu handlers on the sets div.

---

## FIX 8: VERIFY DELETE MODE WORKS

Hold the Delete key → all non-empty editable cells should
highlight red. Click any red cell → value clears.

### Check MacroTableV2:
- `useShiftHeld()` hook returns `deleteMode` boolean (line 85)
- Reps cells: `repsIsDeleteTarget = deleteMode && repsVal !== null`
- Avg cells: `avgIsDeleteTarget = deleteMode && avgVal !== null`  
- Grid cells: `deleteMode` and `onDelete` props passed to MacroGridCell

### Check MacroGridCell:
- `isDeleteMode = deleteMode && !isEmpty && !disabled`
- When `isDeleteMode`, entire cell gets `border-red-300 bg-red-50`
- Click calls `onDelete?.()`

Verify `onDelete` is wired correctly — it should call
`handleGridDelete` which clears target_max, target_reps_at_max,
and target_sets_at_max.

Test: hold Delete → click a filled grid cell → all three fields
should clear (load, reps, sets all become null).

### Check General columns:
- Notes: verify delete mode clears notes
- K column: should NOT be deletable (it's computed)
- Tonnage/Avg: should NOT be deletable (they're computed)

---

## FIX 9: CHART — PHASE BACKGROUND BANDS

File: src/components/macro/MacroDraggableChart.tsx

If the chart doesn't show phase background bands, add them using
Recharts `ReferenceArea`:

```tsx
{phases.sort((a, b) => a.position - b.position).map(phase => (
  <ReferenceArea
    key={phase.id}
    x1={`W${phase.start_week_number}`}
    x2={`W${phase.end_week_number}`}
    fill={phase.color}
    fillOpacity={0.08}
    stroke="none"
  />
))}
```

The x1/x2 values must match the XAxis dataKey format (likely
week labels like "W1", "W2"). Check what the chart uses for
x-axis labels and match accordingly.

---

## FIX 10: BUILD AND TEST

```bash
npm run build
```

Open Chrome, navigate to Macro Cycles:

1. Click an empty reps cell → fills with previous week's value (NO +1)
2. Click an empty avg cell → fills with previous week's value (NO +1)
3. Click an empty grid cell → fills with previous week's values (NO +1 on load)
4. Table has consistent side padding matching other pages
5. Chart bars are thinner and centered on week tick marks
6. Week rows inside phases have subtle phase-colored background
7. Tonnage column shows values in tonnes (e.g., "12.5" not "12450")
8. Avg column shows computed weighted average
9. Notes column is clickable and editable
10. Average row shows per-week averages (not cycle totals)
11. Hold Delete → all filled cells highlight red
12. Click a red cell → value clears
13. Grid cell sets: hidden when 1, visible when >1, appears on hover
14. Sets click target is large enough to interact with
15. Chart has subtle phase background bands
16. No console errors

Fix any issues found.
