# EMOS — PROMPT 5F: UNIFY THE MACRO PHASE BAR ACROSS ALL SURFACES

The macro page (`MacroCycles.tsx`) still has a ~120-line inline phase
timeline that duplicates what `<MacroPhaseBar>` already does in the
two planner surfaces. This prompt collapses both into the single shared
component, gives the macro-page version the features it currently
lacks (event dots, today's playhead), and adds two presentational
modes only used on the macro page (month strip above, date span row
below).

**Scope:**
- Component changes: two new presentational props, one new callback
- Macro page: replace inline timeline with shared component, wire
  events + today's playhead, route phase clicks to scroll-and-highlight
  the table row below
- Planner integrations: add `onPhaseClick` so phase labels become
  navigation targets in those surfaces too

**Out of scope:**
- The annual wheel (different rendering, different purpose) stays
  as-is
- The `MacroSummaryBar` (volume/peak summary footer) stays as-is

**Assumes 5e routing has shipped.** All navigation handlers in this
prompt rely on `/planner/:weekStart` and `/macrocycles/:cycleId`
existing as URL targets.

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with the message at the bottom.

---

## STEP 1: FIX TYPE NAME MISMATCH IN `macroPhaseBarData.ts`

Edit `src/lib/macroPhaseBarData.ts`. The file currently imports
`Macrocycle` from `database.types.ts`, but the actual exported type
is `MacroCycle`. Fix the import:

```ts
import type {
  MacroCycle,
  MacroPhase,
  MacroWeek,
  WeekTypeConfig,
} from './database.types';
```

And update both type references:
- `Pick<Macrocycle, 'id' | 'name'>[]` → `Pick<MacroCycle, 'id' | 'name'>[]`
- `Pick<Macrocycle, 'id' | 'name'>` → `Pick<MacroCycle, 'id' | 'name'>`

Run `npm run build` to confirm no regressions.

---

## STEP 2: EXTEND `<MacroPhaseBar>` WITH NEW PROPS

Edit `src/components/planning/MacroPhaseBar.tsx`.

### 2.1 Props interface

Add three optional props:

```tsx
export interface MacroPhaseBarProps {
  cells: MacroPhaseBarCell[];
  events?: MacroPhaseBarEvent[];
  selectedWeekStart?: string | null;
  onCellClick?: (cell: MacroPhaseBarCell) => void;
  /** Fired when a phase label is clicked. Receives the first cell
   *  of the clicked phase group (which carries macroId, phase name,
   *  color). Phase clicks only fire for cells with non-null phase
   *  and macroId. */
  onPhaseClick?: (cell: MacroPhaseBarCell) => void;
  /** Render a month row above the phase strip ("Apr", "May", ...).
   *  Year suffix appears on the first month of each year only when
   *  the cells span a year boundary. Default false. */
  showMonthRow?: boolean;
  /** Render a per-cell date span row below the bar
   *  ("5 Apr — 11 Apr"). Default false. */
  showWeekDates?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
```

### 2.2 Add helper for month grouping

Below the existing `computePhaseGroups` function, add:

```tsx
interface MonthGroup {
  label: string;
  startIdx: number;
  weekCount: number;
}

function computeMonthGroups(cells: MacroPhaseBarCell[]): MonthGroup[] {
  if (cells.length === 0) return [];
  const groups: MonthGroup[] = [];
  let currentMonthYear = '';

  // Detect whether any year boundary exists — if so, year suffix
  // appears on each new year's first month.
  const years = new Set<number>();
  cells.forEach(c => {
    const d = new Date(c.weekStart + 'T00:00:00');
    years.add(d.getFullYear());
  });
  const showYearOnNewYear = years.size > 1;
  let prevYear = -1;

  cells.forEach((c, i) => {
    const d = new Date(c.weekStart + 'T00:00:00');
    const monthIdx = d.getMonth();
    const year = d.getFullYear();
    const monthYear = `${monthIdx}-${year}`;
    if (monthYear !== currentMonthYear) {
      const yearChanged = year !== prevYear;
      const yearSuffix = showYearOnNewYear && yearChanged
        ? ` '${String(year).slice(2)}`
        : '';
      groups.push({
        label: MONTHS[monthIdx] + yearSuffix,
        startIdx: i,
        weekCount: 1,
      });
      currentMonthYear = monthYear;
      prevYear = year;
    } else {
      groups[groups.length - 1].weekCount++;
    }
  });
  return groups;
}

function formatWeekDateSpan(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = addDays(start, 6);
  return `${formatDateEU(start)} — ${formatDateEU(end)}`;
}
```

### 2.3 Update component signature

Change to destructure the new props with defaults:

```tsx
export function MacroPhaseBar({
  cells,
  events = [],
  selectedWeekStart = null,
  onCellClick,
  onPhaseClick,
  showMonthRow = false,
  showWeekDates = false,
  className,
  style,
}: MacroPhaseBarProps) {
```

Inside the function body, before the return, compute month groups:

```tsx
const monthGroups = showMonthRow ? computeMonthGroups(cells) : [];
```

### 2.4 Render the optional month row

Inside the outer wrapper `<div>` (the one that already has
`paddingTop: '4px'`), at the very top BEFORE the existing phase label
strip, add:

```tsx
{showMonthRow && monthGroups.length > 0 && (
  <div style={{ display: 'flex', position: 'relative', height: '14px', marginBottom: '2px' }}>
    {monthGroups.map((g, i) => {
      const leftPct = (g.startIdx / cells.length) * 100;
      const widthPct = (g.weekCount / cells.length) * 100;
      return (
        <div
          key={`m-${i}`}
          style={{
            position: 'absolute',
            top: 0,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            height: '14px',
            display: 'flex',
            alignItems: 'center',
            fontSize: '10px',
            color: 'var(--color-text-tertiary)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            paddingLeft: '6px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {g.label}
        </div>
      );
    })}
  </div>
)}
```

### 2.5 Make phase labels clickable

Find the phase label strip rendering (the existing `groups.map(...)`
block that produces phase labels). Change each phase segment to
support click + hover when `onPhaseClick` is provided.

Replace the inner segment `<div>` with:

```tsx
{groups.map((g, i) => {
  const leftPct = (g.startIdx / cells.length) * 100;
  const widthPct = (g.weekCount / cells.length) * 100;
  const firstCellInGroup = cells[g.startIdx];
  const isClickable =
    !!onPhaseClick &&
    firstCellInGroup.macroId !== null &&
    firstCellInGroup.phase !== null;

  return (
    <div
      key={`ph-${i}`}
      onClick={isClickable ? (e) => {
        e.stopPropagation();
        onPhaseClick!(firstCellInGroup);
      } : undefined}
      style={{
        position: 'absolute',
        top: 0,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        height: '16px',
        display: 'flex',
        alignItems: 'center',
        fontSize: 'var(--text-caption)',
        fontWeight: 500,
        color: 'var(--color-text-secondary)',
        fontFamily: 'var(--font-sans)',
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        paddingLeft: '6px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        pointerEvents: isClickable ? 'auto' : 'none',
        userSelect: 'none',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'color 100ms ease-out',
      }}
      onMouseEnter={isClickable ? e => {
        e.currentTarget.style.color = 'var(--color-text-primary)';
      } : undefined}
      onMouseLeave={isClickable ? e => {
        e.currentTarget.style.color = 'var(--color-text-secondary)';
      } : undefined}
    >
      {g.phase}
    </div>
  );
})}
```

### 2.6 Render the optional date span row

After the existing dividers/playhead block (i.e. as the last child of
the outermost wrapper `<div>`), add:

```tsx
{showWeekDates && (
  <div style={{ display: 'flex', position: 'relative', height: '14px', marginTop: '2px' }}>
    {cells.map(c => (
      <div
        key={`d-${c.weekStart}`}
        style={{
          flex: 1,
          fontSize: '9px',
          color: 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-mono)',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          padding: '0 2px',
          letterSpacing: '0.02em',
          pointerEvents: 'none',
        }}
      >
        {c.label ? formatWeekDateSpan(c.weekStart) : ''}
      </div>
    ))}
  </div>
)}
```

Run `npm run build`.

---

## STEP 3: ADD HIGHLIGHT INFRASTRUCTURE TO `MacroTableV2`

Edit `src/components/macro/MacroTableV2.tsx`.

### 3.1 Add `highlightedPhaseId` prop

Find the props interface (around line 25). Add:
```tsx
highlightedPhaseId?: string | null;
```

Update the destructuring at the function signature to include it.

### 3.2 Apply highlight to phase rows

Find the phase header `<tr>` rendering (around line 361):
```tsx
<tr key={`phase-${phase.id}`} className="border-t-2 border-gray-300">
  <td
    colSpan={leftColCount + displayed.length * 3 + (onSwapWeeks ? 1 : 0)}
    className="sticky left-0 text-left px-2 py-1 text-[9px] font-medium tracking-wide"
    style={{
      backgroundColor: phase.color + '25',
      borderLeft: `3px solid ${phase.color}`,
      color: phase.color,
    }}
  >
```

Update to include `data-phase-id` and the highlight-aware background:
```tsx
<tr
  key={`phase-${phase.id}`}
  data-phase-id={phase.id}
  className="border-t-2 border-gray-300"
>
  <td
    colSpan={leftColCount + displayed.length * 3 + (onSwapWeeks ? 1 : 0)}
    className="sticky left-0 text-left px-2 py-1 text-[9px] font-medium tracking-wide"
    style={{
      backgroundColor: phase.color + (phase.id === highlightedPhaseId ? '55' : '25'),
      borderLeft: `3px solid ${phase.color}`,
      color: phase.color,
      transition: 'background-color 400ms ease-out',
    }}
  >
```

Run `npm run build`.

---

## STEP 4: REPLACE THE INLINE TIMELINE IN `MacroCycles.tsx`

Edit `src/components/macro/MacroCycles.tsx`.

### 4.1 Imports

Near the top of the file, add (keep existing imports intact):
```tsx
import { useNavigate } from 'react-router-dom';
import { MacroPhaseBar } from '../planning';
import {
  buildCellsForSingleMacro,
  fetchMacroPhaseBarEvents,
  resolveScopeAthleteIds,
} from '../../lib/macroPhaseBarData';
import { useSettings } from '../../hooks/useSettings';
import { getMondayOfWeek } from '../../lib/dateUtils';
import type { MacroPhaseBarEvent } from '../planning';
```

If `useNavigate`, `useSettings`, or `getMondayOfWeek` are already
imported, skip those duplicates.

### 4.2 New state for events + highlight

Inside the `MacroCycles` function, alongside the other state hooks,
add:

```tsx
const navigate = useNavigate();
const { settings } = useSettings();
const [barEvents, setBarEvents] = useState<MacroPhaseBarEvent[]>([]);
const [highlightedPhaseId, setHighlightedPhaseId] = useState<string | null>(null);
```

### 4.3 Build cells

Right before the JSX `return`, after `phases` and `macroWeeks` are
guaranteed available (they're already loaded via existing hooks),
compute:

```tsx
const phaseBarCells = selectedCycle && macroWeeks.length > 0
  ? buildCellsForSingleMacro(
      { id: selectedCycle.id, name: selectedCycle.name },
      {
        macros: [{ id: selectedCycle.id, name: selectedCycle.name }],
        phases,
        weeks: macroWeeks,
        weekTypeConfigs: settings?.week_types ?? [],
      }
    )
  : [];

const todayMonday = getMondayOfWeek(new Date()).toISOString().split('T')[0];
```

`todayMonday` will be the bar's `selectedWeekStart`. The bar handles
"selected week not in cells" by simply not rendering a playhead, so
when today is outside the macro range nothing shows. Correct behavior.

### 4.4 Fetch events for the macro's scope

Add an effect that loads events when the cycle changes:

```tsx
useEffect(() => {
  if (!selectedCycle || macroWeeks.length === 0) {
    setBarEvents([]);
    return;
  }
  void (async () => {
    const athleteIds = await resolveScopeAthleteIds(
      selectedCycle.athlete_id,
      selectedCycle.group_id
    );
    if (athleteIds.length === 0) {
      setBarEvents([]);
      return;
    }
    const rangeStart = macroWeeks[0].week_start;
    const lastWeek = macroWeeks[macroWeeks.length - 1];
    const lastMonday = new Date(lastWeek.week_start + 'T00:00:00');
    lastMonday.setDate(lastMonday.getDate() + 6);
    const rangeEnd = lastMonday.toISOString().split('T')[0];
    const fetched = await fetchMacroPhaseBarEvents(athleteIds, rangeStart, rangeEnd);
    setBarEvents(fetched);
  })();
}, [selectedCycle?.id, macroWeeks]);
```

### 4.5 Add scroll-to-phase helper

```tsx
const scrollToPhase = useCallback((phaseId: string) => {
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-phase-id="${phaseId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedPhaseId(phaseId);
      window.setTimeout(() => setHighlightedPhaseId(null), 1500);
    }
  });
}, []);
```

If `useCallback` isn't already imported from React, add it.

### 4.6 Replace the inline timeline with `<MacroPhaseBar>`

Find the block that renders the cycle info row + inline timeline.
The structure is roughly:

```
{selectedCycle && (
  <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
    <div className="flex items-center gap-3 px-4 py-1.5 ...">
      {/* meta row: name, dates, week count, group badge, competition badges */}
    </div>
    {macroWeeks.length > 0 && (() => {
      // ~120 lines of inline timeline
    })()}
  </div>
)}
```

Reorder this block so the bar sits **above** the meta row at the top
of the page section, while the meta row + competitions chips remain
as an element of their own below. The new structure:

```tsx
{selectedCycle && (
  <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
    {/* Macro phase bar — full width with small horizontal padding */}
    {phaseBarCells.length > 0 && (
      <div style={{ padding: '12px 16px 8px' }}>
        <MacroPhaseBar
          cells={phaseBarCells}
          events={barEvents}
          selectedWeekStart={todayMonday}
          showMonthRow
          showWeekDates
          onCellClick={(cell) => navigate(`/planner/${cell.weekStart}`)}
          onPhaseClick={(cell) => {
            if (cell.macroId === null || cell.phase === null) return;
            const phase = phases.find(
              p => p.macrocycle_id === cell.macroId && p.name === cell.phase
            );
            if (phase) scrollToPhase(phase.id);
          }}
        />
      </div>
    )}

    {/* Meta row: cycle name, dates, week count, group, competitions */}
    <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-gray-600 flex-wrap">
      <span className="font-medium text-gray-800">{selectedCycle.name}</span>
      <span className="text-gray-400">{selectedCycle.start_date} → {selectedCycle.end_date}</span>
      <span className="text-gray-400">{macroWeeks.length} weeks</span>
      {isGroupMode && selectedGroup && (
        <span className="flex items-center gap-1 text-purple-600 font-medium">
          <Users size={11} />
          {selectedGroup.name}
          {groupMembers.length > 0 && (
            <span className="text-gray-400 font-normal ml-1">
              ({groupMembers.length} members: {groupMembers.map(m => m.athlete.name).join(', ')})
            </span>
          )}
        </span>
      )}
      {competitions.map(comp => (
        <MacroCompetitionBadge key={comp.id} competition={comp} />
      ))}
    </div>
  </div>
)}
```

The ~120-line inline timeline IIFE (and its private `isoWeek`,
`fmtMD`, `addDays`, `monthGroups`, `Seg` helpers) is fully removed —
all behavior now lives in `<MacroPhaseBar>` and the existing date
utils.

### 4.7 Pass highlight prop to the table

Find the `<MacroTableV2>` render. Add the prop:

```tsx
<MacroTableV2
  ... existing props ...
  highlightedPhaseId={highlightedPhaseId}
/>
```

Run `npm run build`.

---

## STEP 5: ADD `onPhaseClick` TO PLANNER INTEGRATIONS

The planner's two integrations already use the bar correctly. Add the
new `onPhaseClick` prop so phase labels also become navigation targets
in those surfaces. The handler in both surfaces navigates to the
macro page for that cycle.

### 5.1 PlannerWeekOverview

Edit `src/components/planner/PlannerWeekOverview.tsx`.

Find the `<MacroPhaseBar>` render. Add:

```tsx
<MacroPhaseBar
  cells={phaseBarCells}
  events={barEvents}
  selectedWeekStart={today}
  onCellClick={(cell) => onSelectWeek(cell.weekStart)}
  onPhaseClick={(cell) => {
    if (cell.macroId === null) return;
    navigate(`/macrocycles/${cell.macroId}`);
  }}
/>
```

If `navigate` isn't already available in this file via `useNavigate`,
add the import:
```tsx
import { useNavigate } from 'react-router-dom';
// ...
const navigate = useNavigate();
```

### 5.2 PlannerControlPanel

Edit `src/components/planner/PlannerControlPanel.tsx`.

`navigate` is already used. Update the `<MacroPhaseBar>` render:

```tsx
<MacroPhaseBar
  cells={phaseBarCells}
  events={fetchedEvents}
  selectedWeekStart={phaseBarSelectedWeekStart}
  onCellClick={(cell) => navigate(`/planner/${cell.weekStart}`)}
  onPhaseClick={(cell) => {
    if (cell.macroId === null) return;
    navigate(`/macrocycles/${cell.macroId}`);
  }}
/>
```

This also corrects the previous `onCellClick` which navigated to
`/macrocycles` — under the unified contract, cell click always opens
the weekly planner for that week.

Run `npm run build`.

---

## STEP 6: VERIFY

### Macro page (`/macrocycles/<cycleId>`):
1. ✅ Inline timeline is gone, replaced by `<MacroPhaseBar>`
2. ✅ Bar sits at the top of the page section
3. ✅ Meta row (name, dates, week count, group, competitions) sits below
4. ✅ Month row visible above phase labels (e.g. "Apr", "May", "Jun")
5. ✅ Per-week date spans visible below the bar (e.g. "5 Apr — 11 Apr")
6. ✅ Event dots appear on weeks where the macro's athlete (or any
   group member) has events
7. ✅ Today's week shows the black playhead line (when today is
   inside the macro range)
8. ✅ Click a week cell → navigates to `/planner/<weekStart>`
9. ✅ Click a phase label → table scrolls to that phase row, brief
   highlight (~1.5s tint), then fades
10. ✅ No console errors

### Planner overview (`/planner`):
1. ✅ Bar still renders correctly (no regression)
2. ✅ Cell click → opens that week's detail
3. ✅ Phase label is clickable; click → navigates to `/macrocycles/<cycleId>`

### Planner detail (`/planner/<weekStart>`):
1. ✅ Bar still renders correctly
2. ✅ Cell click now correctly navigates to `/planner/<otherWeekStart>`
   (not to `/macrocycles` as before)
3. ✅ Phase label click → navigates to `/macrocycles/<cycleId>`

### Cross-surface consistency:
1. ✅ All three surfaces use the same bar component
2. ✅ Visual treatment identical across surfaces (same fonts, colors,
   spacing, divider rules)
3. ✅ Click contract identical (cell → planner, phase → macro)
4. ✅ Macro page additionally shows month and date rows

---

## STEP 7: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "refactor(planning): unify macro phase bar across all surfaces

The macro page previously had a ~120-line inline phase timeline
duplicating <MacroPhaseBar>. This change replaces it with the shared
component and adds two presentational modes for the macro page:

- showMonthRow: month strip above the phase labels (Apr, May, ...).
  Year suffix shown when cells span a year boundary.
- showWeekDates: per-cell date span row below the bar (5 Apr — 11 Apr)

A new onPhaseClick callback makes phase labels navigation targets in
all surfaces:

- Click a week cell anywhere → /planner/<weekStart>
- Click a phase label in planner views → /macrocycles/<cycleId>
- Click a phase label on the macro page → scroll table to phase row
  with a brief highlight (handled programmatically, no URL change)

The macro page bar gains two features it previously lacked:
- Event dots for events attached to the macro's athlete or any
  current group member (via fetchMacroPhaseBarEvents and
  resolveScopeAthleteIds)
- Today's playhead — a black line marking the current week. Hidden
  automatically when today is outside the macro's date range.

MacroTableV2 gains a data-phase-id attribute on phase header rows
and a highlightedPhaseId prop driving a 400ms tint transition for
the scroll-to-phase highlight effect.

The planner control panel's cell click was previously navigating to
/macrocycles; this is corrected to navigate to /planner/<weekStart>,
matching the uniform navigation contract.

Also fixes a latent type-name typo in macroPhaseBarData.ts that
imported 'Macrocycle' (the actual type is 'MacroCycle').

Files removed: the inline timeline IIFE in MacroCycles.tsx including
its private isoWeek, fmtMD, addDays, MonthGroup, and Seg helpers."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ Type name fixed in `macroPhaseBarData.ts`
3. ✅ `<MacroPhaseBar>` accepts `showMonthRow`, `showWeekDates`, `onPhaseClick`
4. ✅ `MacroTableV2` has `data-phase-id` and `highlightedPhaseId`
5. ✅ Macro page uses shared `<MacroPhaseBar>` with month and date rows
6. ✅ Macro page shows event dots for the macro's scope
7. ✅ Macro page shows today's playhead when today is in range
8. ✅ Phase click on macro page scrolls + highlights the phase row
9. ✅ Phase click in planner surfaces navigates to the cycle
10. ✅ Cell click in all surfaces navigates to that week's planner
11. ✅ No console errors
12. ✅ Committed and pushed

---

## KNOWN LIMITATIONS / FUTURE WORK

- **Phase edit still requires the row's edit affordance.** The bar
  intentionally does not open the edit modal on click. This was a
  decision we made earlier to keep single-click reserved for navigation.
- **No keyboard navigation.** Cells and phase labels are mouse-only.
  Tab navigation is future work.
- **Event dot scope on the macro page** uses the macro's `athlete_id`
  or `group_id`. If the macro has neither (orphan/template), no events
  will be shown. This is the correct behavior for now but may need
  adjustment if you introduce template macros that aren't tied to a
  specific athlete or group.
- **Highlight tint duration** hardcoded at 1500ms.

---

## NEXT STEPS (still on the planner backlog)

- Slot-to-weekday mapping in `PlannerWeekOverview` so day cards render
  in their assigned weekday columns and stack when multiple sessions
  fall on the same day
- DayCard.tsx migration (addresses the too-narrow day card issue)
- Settings UI for editing custom week-type abbreviations
