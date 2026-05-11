# EMOS — PROMPT 5E: UNIFY THE MACRO PHASE BAR ACROSS ALL SURFACES

The macro page has its own inline phase timeline (~120 lines of JSX in
`MacroCycles.tsx`) that duplicates what `<MacroPhaseBar>` already does
in the weekly planner. This prompt collapses both into the single
shared component, with consistent navigation across all surfaces:

- **Click a week cell** anywhere → navigate to weekly planner for that week
- **Click a phase label** anywhere → navigate to macro page, scrolled to that phase
- **On the macro page**, phase click does the same thing programmatically
  (no URL change). Editing a phase still happens via the existing edit
  affordance on the phase table row, NOT via the bar.

This is a refactor + small feature add. The bar gets two new optional
display rows (month strip above, date span row below) and a new
`onPhaseClick` callback. The macro page replaces its inline timeline
with `<MacroPhaseBar showMonthRow showWeekDates ... />`.

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with the message at the bottom.

---

## STEP 1: EXTEND `<MacroPhaseBar>` WITH THE NEW MODES

Edit `src/components/planning/MacroPhaseBar.tsx`.

### 1.1 Update the props interface

Add three optional props:

```tsx
export interface MacroPhaseBarProps {
  cells: MacroPhaseBarCell[];
  events?: MacroPhaseBarEvent[];
  selectedWeekStart?: string | null;
  onCellClick?: (cell: MacroPhaseBarCell) => void;
  /** NEW: fired when a phase label is clicked. Receives the phase
   * group's first cell (which carries macroId, phase name, color). */
  onPhaseClick?: (cell: MacroPhaseBarCell) => void;
  /** NEW: render a month row above the phase strip (e.g. "Apr", "May") */
  showMonthRow?: boolean;
  /** NEW: render a date-span row below the bar (e.g. "5 Apr — 11 Apr") */
  showWeekDates?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
```

### 1.2 Add helper for month grouping

Below the existing `computePhaseGroups` function, add:

```tsx
interface MonthGroup {
  label: string;       // "Apr" or "Jan '27" if year crosses
  startIdx: number;
  weekCount: number;
}

function computeMonthGroups(cells: MacroPhaseBarCell[]): MonthGroup[] {
  if (cells.length === 0) return [];
  const groups: MonthGroup[] = [];
  let currentMonthYear = '';
  let currentYear = '';

  // Determine if any year boundary appears — if so, all labels include
  // a year suffix on the first month of each new year.
  const years = new Set<string>();
  cells.forEach(c => {
    const d = new Date(c.weekStart + 'T00:00:00');
    years.add(String(d.getFullYear()));
  });
  const yearChanges = years.size > 1;

  cells.forEach((c, i) => {
    const d = new Date(c.weekStart + 'T00:00:00');
    const monthIdx = d.getMonth();
    const yearStr = String(d.getFullYear()).slice(2);
    const monthYear = `${monthIdx}-${d.getFullYear()}`;
    if (monthYear !== currentMonthYear) {
      const showYear = yearChanges && yearStr !== currentYear;
      const label = MONTHS[monthIdx] + (showYear ? ` '${yearStr}` : '');
      groups.push({ label, startIdx: i, weekCount: 1 });
      currentMonthYear = monthYear;
      currentYear = yearStr;
    } else {
      groups[groups.length - 1].weekCount++;
    }
  });
  return groups;
}
```

### 1.3 Add helper for week date spans

```tsx
function formatWeekDateSpan(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = addDays(start, 6);
  return `${formatDateEU(start)} — ${formatDateEU(end)}`;
}
```

### 1.4 Update component to accept new props and render new rows

Change the component signature to destructure the new props:

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

Inside the render, compute month groups when needed:

```tsx
const monthGroups = showMonthRow ? computeMonthGroups(cells) : [];
```

### 1.5 Render the optional month row

ABOVE the existing phase label strip, conditionally render:

```tsx
{showMonthRow && (
  <div style={{ display: 'flex', position: 'relative', height: '14px', marginBottom: '2px' }}>
    {monthGroups.map((g, i) => {
      const leftPct = (g.startIdx / total) * 100;
      const widthPct = (g.weekCount / total) * 100;
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
            fontSize: 'var(--text-caption)',
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

### 1.6 Make phase labels clickable

Update the phase label strip rendering. Where it currently renders the
phase segments as div, conditionally make them clickable. The first
cell in the group is what we hand back to `onPhaseClick`:

```tsx
{groups.map((g, i) => {
  const leftPct = (g.startIdx / total) * 100;
  const widthPct = (g.weekCount / total) * 100;
  const firstCellInGroup = cells[g.startIdx];
  const isClickable =
    !!onPhaseClick && firstCellInGroup.macroId !== null && firstCellInGroup.phase !== null;
  const handleClick = isClickable
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onPhaseClick!(firstCellInGroup);
      }
    : undefined;

  return (
    <div
      key={`ph-${i}`}
      onClick={handleClick}
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
      onMouseEnter={isClickable ? e => { e.currentTarget.style.color = 'var(--color-text-primary)'; } : undefined}
      onMouseLeave={isClickable ? e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; } : undefined}
    >
      {g.phase}
    </div>
  );
})}
```

### 1.7 Render the optional week-dates row

BELOW the existing bar (after the dividers/playhead block), conditionally render:

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

### 1.8 Update the barrel export

Edit `src/components/planning/index.ts` — no change needed, props
type already exports correctly.

If `src/components/planning/planning_index.ts` exists alongside `index.ts`,
delete `planning_index.ts` (it was an artifact of the patch flow).

Run `npm run build`.

---

## STEP 2: ADD `data-phase-id` ATTRIBUTE TO MACRO TABLE PHASE ROWS

Edit `src/components/macro/MacroTableV2.tsx`.

Find the phase header row (around line 361):

```tsx
<tr key={`phase-${phase.id}`} className="border-t-2 border-gray-300">
```

Add `data-phase-id`:

```tsx
<tr key={`phase-${phase.id}`} data-phase-id={phase.id} className="border-t-2 border-gray-300">
```

This gives us a stable scroll target.

Run `npm run build`.

---

## STEP 3: REPLACE THE INLINE TIMELINE IN `MacroCycles.tsx`

Edit `src/components/macro/MacroCycles.tsx`.

### 3.1 Add imports

At the top of the file, add:

```tsx
import { useSearchParams } from 'react-router-dom';
import { MacroPhaseBar } from '../planning';
import { buildCellsForSingleMacro } from '../../lib/macroPhaseBarData';
import { useSettings } from '../../hooks/useSettings';
```

If `useSettings` is already imported, skip its import.

### 3.2 Add scroll-to-phase logic

Inside the `MacroCycles` function, near the other state, add:

```tsx
const [searchParams, setSearchParams] = useSearchParams();
const { settings } = useSettings();
const [highlightedPhaseId, setHighlightedPhaseId] = useState<string | null>(null);

// Helper: scroll to a phase row in the table and apply a brief highlight
const scrollToPhase = useCallback((phaseId: string) => {
  // Defer to next frame so the row is in the DOM
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-phase-id="${phaseId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedPhaseId(phaseId);
      window.setTimeout(() => setHighlightedPhaseId(null), 1500);
    }
  });
}, []);

// Listen to ?phase= query param on mount and on selectedCycle change
useEffect(() => {
  const phaseParam = searchParams.get('phase');
  if (phaseParam && phases.some(p => p.id === phaseParam)) {
    scrollToPhase(phaseParam);
    // Strip the param so refreshing doesn't re-scroll
    searchParams.delete('phase');
    setSearchParams(searchParams, { replace: true });
  }
}, [phases, searchParams, setSearchParams, scrollToPhase]);
```

If `useCallback` and `useState` aren't already imported, add them.

### 3.3 Apply highlight in the table rendering

Find where `MacroTableV2` is rendered. We need to pass the highlighted
phase id down. Add a prop and apply a CSS class/inline style.

In `MacroTableV2.tsx`, accept a `highlightedPhaseId?: string | null`
prop. When rendering each phase row, apply a brief background tint
when `phase.id === highlightedPhaseId`. The existing phase row has
`backgroundColor: phase.color + '25'` — when highlighted, use
`phase.color + '55'` and add a 0.5s transition. The `setHighlightedPhaseId(null)`
in `MacroCycles.tsx` after 1500ms reverts it.

Add to MacroTableV2 props:
```tsx
highlightedPhaseId?: string | null;
```

In the phase row td style:
```tsx
backgroundColor: phase.color + (phase.id === highlightedPhaseId ? '55' : '25'),
transition: 'background-color 400ms ease-out',
```

In `MacroCycles.tsx`, pass the prop:
```tsx
<MacroTableV2 ... highlightedPhaseId={highlightedPhaseId} />
```

### 3.4 Build cells for the new bar

Inside the `MacroCycles` function, near where `phases` and `macroWeeks`
are available (just before the JSX return), compute:

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
```

### 3.5 Replace the inline timeline JSX

Find the block starting with `{/* Detailed phase timeline */}` (around
line 713) and ending where the closing `})()}` is followed by `</div>`
of the cycle info container (around line 822).

Replace the entire `{macroWeeks.length > 0 && (() => { ... })()}` block
with:

```tsx
{phaseBarCells.length > 0 && (
  <div style={{ padding: '8px 16px 12px' }}>
    <MacroPhaseBar
      cells={phaseBarCells}
      selectedWeekStart={null}
      showMonthRow
      showWeekDates
      onCellClick={(cell) => {
        navigate('/planner', { state: { weekStart: cell.weekStart } });
      }}
      onPhaseClick={(cell) => {
        if (cell.macroId === null) return;
        // We're already on the macro page — find the phase by name+macro
        const phase = phases.find(
          p => p.name === cell.phase && p.macrocycle_id === cell.macroId
        );
        if (phase) scrollToPhase(phase.id);
      }}
    />
  </div>
)}
```

The `selectedWeekStart={null}` because no playhead in the macro page
context (no "currently editing this week" concept on this page).

### 3.6 Remove dead code

The inline timeline used these helpers (declared inside the IIFE):
`isoWeek`, `fmtMD`, `addDays`. They're now provided by `<MacroPhaseBar>`
and `dateUtils`. Since they were defined inside the IIFE that we just
deleted, they go away automatically.

Run `npm run build`.

---

## STEP 4: WIRE `onPhaseClick` IN PLANNER INTEGRATIONS

### 4.1 PlannerWeekOverview

Edit `src/components/planner/PlannerWeekOverview.tsx`.

Find the `<MacroPhaseBar>` render. Add the `onPhaseClick` prop:

```tsx
<MacroPhaseBar
  cells={phaseBarCells}
  events={barEvents}
  selectedWeekStart={today}
  onCellClick={(cell) => onSelectWeek(cell.weekStart)}
  onPhaseClick={(cell) => {
    if (cell.macroId === null) return;
    // Look up the phase id from the cell's macroId + phase name
    const macroPhases = rawPhases.filter(p => p.macrocycle_id === cell.macroId);
    const phase = macroPhases.find(p => p.name === cell.phase);
    if (phase) navigate(`/macrocycles?phase=${phase.id}`);
  }}
/>
```

If `navigate` isn't already imported via `useNavigate`, add it:
```tsx
import { useNavigate } from 'react-router-dom';
// ...
const navigate = useNavigate();
```

### 4.2 PlannerControlPanel

Edit `src/components/planner/PlannerControlPanel.tsx`.

`navigate` is already used. Find the `<MacroPhaseBar>` render. Update:

```tsx
<MacroPhaseBar
  cells={phaseBarCells}
  events={fetchedEvents}
  selectedWeekStart={phaseBarSelectedWeekStart}
  onCellClick={(cell) => {
    navigate('/planner', { state: { weekStart: cell.weekStart } });
  }}
  onPhaseClick={(cell) => {
    if (cell.macroId === null) return;
    const phase = phases.find(p => p.name === cell.phase);
    if (phase) navigate(`/macrocycles?phase=${phase.id}`);
  }}
/>
```

The `onCellClick` previously navigated to `/macrocycles`; that's
inconsistent with the unified model. Cell click → planner detail for
that week.

(Note: in the control panel, the user is already in the planner. The
navigation with `state.weekStart` triggers the planner to load that
week. This works because `WeeklyPlanner.tsx` reads `locationState?.weekStart`
on mount/change.)

Run `npm run build`.

---

## STEP 5: VERIFY

### Macro page (`/macrocycles`):
1. ✅ The old inline phase timeline is gone, replaced by `<MacroPhaseBar>`
2. ✅ Month row appears above the phase strip with month labels
3. ✅ Week date spans appear below the bar in mono
4. ✅ Phase labels are clickable; clicking scrolls the table to that phase row with brief highlight
5. ✅ Week cells are clickable; clicking navigates to weekly planner for that week
6. ✅ No console errors
7. ✅ Visiting `/macrocycles?phase=<id>` directly auto-scrolls to that phase on load

### Planner overview (`/planner`):
1. ✅ Bar still renders correctly (no regression from the new optional rows)
2. ✅ Cell click → opens that week (existing behavior)
3. ✅ Phase label click → navigates to `/macrocycles?phase=<id>`, which then auto-scrolls to that phase row

### Planner detail (`/planner` with a week selected):
1. ✅ Bar still renders correctly
2. ✅ Cell click → opens that week (was previously `/macrocycles`, now correctly opens the week)
3. ✅ Phase label click → navigates to `/macrocycles?phase=<id>`

### Highlight effect:
1. ✅ Clicking a phase from the planner views jumps to the macro page with the phase row briefly tinted, then fades to normal
2. ✅ Clicking a phase from inside the macro page itself produces the same highlight without a URL change
3. ✅ The phase row scrolls into the center of the viewport

---

## STEP 6: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "refactor(planning): unify macro phase bar across macro page and planner

The macro page previously had its own ~120-line inline phase timeline
duplicating <MacroPhaseBar>. This change replaces it with the shared
component and adds two presentational modes that the macro page needs:

- showMonthRow: renders a month strip above the phase labels
- showWeekDates: renders a date-span row below the bar

Also adds an onPhaseClick callback so phase labels become navigation
targets in all surfaces:

- Click a week cell anywhere → navigate to weekly planner for that week
- Click a phase label anywhere → navigate to macro page, scrolled to
  and briefly highlighted on that phase row

On the macro page itself, the phase click is handled programmatically
with no URL change (already there). Editing a phase still happens
via the phase row's existing edit affordance — single-click on the
bar is reserved for navigation.

The /macrocycles page now reads ?phase=<id> on mount and auto-scrolls
to that phase row, so deep links from the planner land cleanly.

The planner control panel's cell click was previously navigating to
/macrocycles; this is corrected to navigate to the weekly planner
for that week, matching the uniform navigation contract.

MacroTableV2 gains a data-phase-id attribute on phase header rows
for scroll targeting, and a highlightedPhaseId prop for the brief
tint animation.

Files removed: the ~120-line inline timeline IIFE in MacroCycles.tsx
including its private isoWeek, fmtMD, and addDays helpers — those
behaviors live in MacroPhaseBar and dateUtils now."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ `<MacroPhaseBar>` accepts `showMonthRow`, `showWeekDates`, `onPhaseClick`
3. ✅ Macro page uses `<MacroPhaseBar>` instead of inline timeline
4. ✅ MacroTableV2 has `data-phase-id` on phase rows + `highlightedPhaseId` prop
5. ✅ Macro page handles `?phase=<id>` query param on mount
6. ✅ Phase click on macro page scrolls + highlights without URL change
7. ✅ Phase click in planner surfaces navigates to `/macrocycles?phase=<id>`
8. ✅ Cell click in all surfaces navigates to weekly planner for that week
9. ✅ No regression in week-type abbreviations, event dots, or playhead
10. ✅ No console errors
11. ✅ Committed and pushed

---

## KNOWN LIMITATIONS / FUTURE WORK

- **Phase edit still on the table row.** Coaches who used to single-click
  the phase ribbon to open the edit modal need to use the row's edit
  affordance (existing). Document this in release notes if you ship a
  changelog.
- **No keyboard navigation yet** — cells and phase labels are clickable
  but not focusable. Tab navigation isn't supported. Future work.
- **Highlight tint duration** is hardcoded to 1500ms. Could be tunable
  later.
