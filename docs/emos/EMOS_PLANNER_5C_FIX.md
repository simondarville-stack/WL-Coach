# EMOS — PROMPT 5C-FIX: MacroPhaseBar DATA + BEHAVIOR FIX

The `<MacroPhaseBar>` component built in 5c is visually correct but
is being fed the wrong data, producing these bugs in the planner
overview:

1. **Non-macro weeks appear with random phase colors** — the bar is
   receiving all rendered overview weeks, and weeks outside the
   current macro get a fallback purple color.
2. **No week-type abbreviations** — cells show only the week number;
   the letter below (h, dl, sh, etc) is missing because the integration
   passed `type: ''`.
3. **No support for multiple macros** — if the overview spans a macro
   boundary, the bar should communicate that. Currently it doesn't.

Two surfaces, two behaviors:

- **Weekly planner detail** (`PlannerControlPanel`): bar shows the
  current macro only. Single macro scope. Other macros are noise.
- **Weekly planner overview** (`PlannerWeekOverview`): bar can show
  multiple macros if they overlap the visible week range. If a new
  macro starts or the current one ends within the visible range, the
  bar visually reflects that transition.

Also: **week types are defined per-coach in settings** as
`WeekTypeConfig[] { name, abbreviation, color }`. Each macro week row
stores the abbreviation directly (e.g. "h", "dl"). The component
should render the abbreviation as-is — no internal translation map.

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with the message specified
at the bottom.

---

## STEP 1: REVISE THE COMPONENT API

Edit `src/components/planning/MacroPhaseBar.tsx`.

### 1.1 Update the types

The old API assumed a single contiguous macro with a single phase
palette. Replace with a model that supports multiple macros within a
single bar:

```tsx
/**
 * One cell in the bar. Can belong to a macro week (with phase + type)
 * or be a gap cell (no macro active that week).
 */
export interface MacroPhaseBarCell {
  /** The macro week's week_start (YYYY-MM-DD). Identifies the week. */
  weekStart: string;
  /** Phase name to show in the label strip. Null for gap cells. */
  phase: string | null;
  /** Phase color. Use a neutral color for gap cells. */
  color: string;
  /** Week-type abbreviation to show under the week number. Empty string = none. */
  typeAbbr: string;
  /** Full week-type name for the tooltip. Empty string = none. */
  typeName: string;
  /** The macro this week belongs to, if any. Null for gap cells. */
  macroId: string | null;
  /** The macro's display name, if any. */
  macroName: string | null;
  /** Display label for the cell — typically "W{n}" where n is the week's position in its macro, or blank for gaps. */
  label: string;
}

export interface MacroPhaseBarEvent {
  id: string;
  kind: 'point' | 'range';
  /** For point events: a weekStart (YYYY-MM-DD) and day 0-6 */
  weekStart?: string;
  day?: number;
  /** For range events: start + end weekStart and start + end day */
  startWeekStart?: string;
  startDay?: number;
  endWeekStart?: string;
  endDay?: number;
  /** Display name shown in the tooltip */
  title: string;
}

export interface MacroPhaseBarProps {
  /** One cell per week, in chronological order */
  cells: MacroPhaseBarCell[];
  /** Optional events to mark with top-right dots + tooltip lines */
  events?: MacroPhaseBarEvent[];
  /** The weekStart of the currently selected week. Null if none selected. */
  selectedWeekStart?: string | null;
  /** Called when a cell is clicked */
  onCellClick?: (cell: MacroPhaseBarCell) => void;
  /** Optional className for the outer wrapper */
  className?: string;
  /** Optional inline style overrides */
  style?: React.CSSProperties;
}
```

Remove the old `MacroWeekEntry` type. Remove the `weekTypeAbbreviations`
prop entirely — abbreviations now come directly from the cell data.
Remove the `macroStartDate` prop — dates are now computed from each
cell's `weekStart`.

### 1.2 Update the component body

Key changes:
- Phase labels group by macro-scoped phase runs. When `cell.macroId`
  changes between adjacent cells, that's a **macro boundary** — draw
  the phase divider there (same vertical divider style, but consider it
  a stronger boundary).
- When `cell.phase` changes but the macro doesn't, that's a phase
  change within the same macro — also draw the phase divider.
- When `cell.phase` is null (gap), render the cell with:
  - `cell.color` as background (caller provides a neutral gray)
  - No week label in the cell
  - No type abbreviation
  - No event dot
- Week number shown in the cell is `cell.label` (caller-provided),
  so the caller can decide "W3" vs "—" vs anything else.
- Tooltip uses `cell.weekStart` directly to compute ISO week + date span.
- `label` inside each cell:
  - If label is short (e.g. "W3"), just show that.
- Abbreviation rendering uses `cell.typeAbbr` directly — no lookup.

Replace the component body:

```tsx
import { getISOWeek } from '../../lib/dateUtils';

// keep MacroPhaseBarCell, MacroPhaseBarEvent, MacroPhaseBarProps above

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function formatDateEU(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

interface PhaseGroup {
  phase: string;
  startIdx: number;
  weekCount: number;
}

/**
 * Group consecutive cells by (macroId, phase). A boundary happens
 * when either the macroId changes OR the phase changes. Gap cells
 * (phase=null) are their own group and carry no label.
 */
function computePhaseGroups(cells: MacroPhaseBarCell[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  let current: PhaseGroup | null = null;
  let currentMacroId: string | null = null;
  cells.forEach((c, i) => {
    const phaseKey = c.phase ?? '';
    if (
      !current ||
      current.phase !== phaseKey ||
      currentMacroId !== c.macroId
    ) {
      current = {
        phase: phaseKey,
        startIdx: i,
        weekCount: 1,
      };
      groups.push(current);
      currentMacroId = c.macroId;
    } else {
      current.weekCount++;
    }
  });
  return groups;
}

function eventsForCell(
  cell: MacroPhaseBarCell,
  events: MacroPhaseBarEvent[]
): MacroPhaseBarEvent[] {
  return events.filter(ev => {
    if (ev.kind === 'point') return ev.weekStart === cell.weekStart;
    if (!ev.startWeekStart || !ev.endWeekStart) return false;
    return cell.weekStart >= ev.startWeekStart && cell.weekStart <= ev.endWeekStart;
  });
}

export function MacroPhaseBar({
  cells,
  events = [],
  selectedWeekStart = null,
  onCellClick,
  className,
  style,
}: MacroPhaseBarProps) {
  const total = cells.length;
  if (total === 0) return null;

  const groups = computePhaseGroups(cells);

  const buildTooltip = (c: MacroPhaseBarCell, cellEvents: MacroPhaseBarEvent[]): string => {
    const lines: string[] = [];
    if (c.label) lines.push(c.label);
    const metaParts: string[] = [];
    if (c.macroName) metaParts.push(c.macroName);
    if (c.phase) metaParts.push(c.phase);
    if (c.typeName) metaParts.push(c.typeName);
    if (metaParts.length) lines.push(metaParts.join(' · '));

    const weekStart = new Date(c.weekStart + 'T00:00:00');
    const weekEnd = addDays(weekStart, 6);
    const cw = getISOWeek(weekStart);
    lines.push(`Week ${cw} · ${formatDateEU(weekStart)} — ${formatDateEU(weekEnd)}`);

    cellEvents.forEach(ev => lines.push(`• ${ev.title}`));
    return lines.join('\n');
  };

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        paddingTop: '4px',
        paddingBottom: '4px',
        ...style,
      }}
    >
      {/* Phase label strip */}
      <div style={{ display: 'flex', position: 'relative', height: '16px' }}>
        {groups.map((g, i) => {
          const leftPct = (g.startIdx / total) * 100;
          const widthPct = (g.weekCount / total) * 100;
          return (
            <div
              key={`ph-${i}`}
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
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              {g.weekCount >= 2 ? g.phase : ''}
            </div>
          );
        })}
      </div>

      {/* Bar */}
      <div style={{ position: 'relative' }}>
        <div
          style={{
            display: 'flex',
            position: 'relative',
            height: '36px',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          {cells.map(c => {
            const cellEvents = eventsForCell(c, events);
            const tooltip = buildTooltip(c, cellEvents);
            const isSelected = selectedWeekStart != null && c.weekStart === selectedWeekStart;
            const isGap = c.phase === null;

            return (
              <div
                key={c.weekStart}
                title={tooltip}
                onClick={() => onCellClick?.(c)}
                style={{
                  flex: 1,
                  position: 'relative',
                  background: c.color,
                  opacity: isSelected ? 1 : 0.7,
                  cursor: onCellClick ? 'pointer' : 'default',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1px',
                  transition: 'filter 100ms ease-out, opacity 100ms ease-out',
                }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
              >
                {!isGap && c.label && (
                  <span
                    style={{
                      fontSize: 'var(--text-caption)',
                      fontFamily: 'var(--font-mono)',
                      lineHeight: 1,
                      color: 'rgba(255, 255, 255, 0.95)',
                      fontWeight: 500,
                      letterSpacing: '0.02em',
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                  >
                    {c.label}
                  </span>
                )}
                {!isGap && c.typeAbbr && (
                  <span
                    style={{
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      lineHeight: 1,
                      color: 'rgba(255, 255, 255, 0.75)',
                      pointerEvents: 'none',
                      userSelect: 'none',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {c.typeAbbr}
                  </span>
                )}
                {cellEvents.length > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '3px',
                      right: '3px',
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: 'rgba(255, 255, 255, 1)',
                      boxShadow: '0 0 0 0.5px rgba(0, 0, 0, 0.2)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Dividers */}
        {cells.slice(1).map((c, idx) => {
          const i = idx + 1;
          const prev = cells[i - 1];
          const isMacroChange = c.macroId !== prev.macroId;
          const isPhaseChange = (c.phase ?? '') !== (prev.phase ?? '');
          const raised = isMacroChange || isPhaseChange;
          const leftCalc = `calc(${(i / total) * 100}% - 0.25px)`;

          if (raised) {
            return (
              <div
                key={`d-${i}`}
                style={{
                  position: 'absolute',
                  top: '-20px',
                  height: 'calc(36px + 20px)',
                  left: leftCalc,
                  width: '0.5px',
                  background: 'var(--color-border-secondary)',
                  pointerEvents: 'none',
                  zIndex: 4,
                }}
              />
            );
          }
          return (
            <div
              key={`d-${i}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: leftCalc,
                width: '0.5px',
                background: 'rgba(255, 255, 255, 0.3)',
                pointerEvents: 'none',
                zIndex: 3,
              }}
            />
          );
        })}

        {/* Playhead */}
        {selectedWeekStart && (() => {
          const selIdx = cells.findIndex(c => c.weekStart === selectedWeekStart);
          if (selIdx < 0) return null;
          const leftPct = (selIdx + 0.5) * (100 / total);
          return (
            <div
              style={{
                position: 'absolute',
                top: '-4px',
                bottom: '-4px',
                left: `calc(${leftPct}% - 1px)`,
                width: '2px',
                background: 'var(--color-text-primary)',
                borderRadius: '1px',
                pointerEvents: 'none',
                zIndex: 6,
              }}
            />
          );
        })()}
      </div>
    </div>
  );
}
```

Update `src/components/planning/index.ts` to match:
```ts
export { MacroPhaseBar } from './MacroPhaseBar';
export type {
  MacroPhaseBarProps,
  MacroPhaseBarCell,
  MacroPhaseBarEvent,
} from './MacroPhaseBar';
```

Run `npm run build`.

---

## STEP 2: BUILD A SHARED CELL-BUILDER HELPER

Both call sites need to transform raw macro + macro_weeks + phases data
into `MacroPhaseBarCell[]`. Create a shared helper to avoid
duplicating logic.

Create `src/lib/macroPhaseBarData.ts`:

```ts
import type {
  MacroPhaseBarCell,
} from '../components/planning/MacroPhaseBar';
import type {
  Macrocycle,
  MacroPhase,
  MacroWeek,
  WeekTypeConfig,
} from './database.types';

export interface MacroPhaseBarSource {
  macros: Macrocycle[];
  phases: MacroPhase[];
  weeks: MacroWeek[];
  weekTypeConfigs: WeekTypeConfig[];
}

/** Neutral gap color for weeks without a macro. */
const GAP_COLOR = 'var(--color-border-secondary)';

function findPhaseForWeek(phases: MacroPhase[], macroId: string, weekNumber: number): MacroPhase | null {
  return phases.find(p =>
    p.macrocycle_id === macroId &&
    weekNumber >= p.start_week_number &&
    weekNumber <= p.end_week_number
  ) ?? null;
}

function resolveWeekType(
  abbr: string | null | undefined,
  configs: WeekTypeConfig[]
): { abbr: string; name: string } {
  if (!abbr) return { abbr: '', name: '' };
  const wt = configs.find(c => c.abbreviation === abbr)
         ?? configs.find(c => c.name.toLowerCase() === abbr.toLowerCase());
  return {
    abbr: wt?.abbreviation ?? abbr,
    name: wt?.name ?? abbr,
  };
}

/**
 * Given a contiguous range of week_start dates (Mondays), return one
 * MacroPhaseBarCell per week. Weeks that fall inside a macro get the
 * macro's phase color + label "W{n}". Weeks outside any macro get a
 * gap cell (null phase, neutral color, empty label).
 */
export function buildCellsForWeekRange(
  weekStarts: string[],
  source: MacroPhaseBarSource
): MacroPhaseBarCell[] {
  const { macros, phases, weeks, weekTypeConfigs } = source;

  return weekStarts.map(ws => {
    const weekRow = weeks.find(w => w.week_start === ws);
    const macro = weekRow
      ? macros.find(m => m.id === weekRow.macrocycle_id)
      : null;

    if (!weekRow || !macro) {
      return {
        weekStart: ws,
        phase: null,
        color: GAP_COLOR,
        typeAbbr: '',
        typeName: '',
        macroId: null,
        macroName: null,
        label: '',
      };
    }

    const phase = findPhaseForWeek(phases, macro.id, weekRow.week_number);
    const type = resolveWeekType(weekRow.week_type, weekTypeConfigs);

    return {
      weekStart: ws,
      phase: phase?.name ?? null,
      color: phase?.color ?? GAP_COLOR,
      typeAbbr: type.abbr,
      typeName: type.name,
      macroId: macro.id,
      macroName: macro.name,
      label: `W${weekRow.week_number}`,
    };
  });
}

/**
 * Build cells for a single macro from its first to last week.
 * Used by the weekly planner detail view which locks to one macro.
 */
export function buildCellsForSingleMacro(
  macro: Macrocycle,
  source: MacroPhaseBarSource
): MacroPhaseBarCell[] {
  const macroWeeks = source.weeks
    .filter(w => w.macrocycle_id === macro.id)
    .sort((a, b) => a.week_number - b.week_number);

  if (macroWeeks.length === 0) return [];

  const weekStarts = macroWeeks.map(w => w.week_start);
  return buildCellsForWeekRange(weekStarts, source);
}
```

Run `npm run build`.

---

## STEP 3: FIX PlannerWeekOverview INTEGRATION

Edit `src/components/planner/PlannerWeekOverview.tsx`.

### 3.1 Fetch what we need

The overview already fetches `macros`, `macro_phases`, and `macro_weeks`.
It needs to also fetch the coach's `GeneralSettings.week_types`.

Find the effect that fetches macro data (around line 275). Add to the
existing Supabase fetch — or fetch settings once and stash in local state.

Add to the state at the top of the component:
```tsx
const [weekTypeConfigs, setWeekTypeConfigs] = useState<import('../../lib/database.types').WeekTypeConfig[]>([]);
```

In the main fetch effect, after the existing fetches:
```tsx
const { data: settings } = await supabase
  .from('general_settings')
  .select('week_types')
  .eq('owner_id', await getOwnerId())
  .maybeSingle();
const configs = (settings?.week_types as import('../../lib/database.types').WeekTypeConfig[] | undefined) ?? [];
setWeekTypeConfigs(configs);
```

Also store the raw `macros`, `phases`, and `macroWeeks` arrays in state
so we can feed them into `buildCellsForWeekRange` later. If they aren't
already stored as state, add:
```tsx
const [rawMacros, setRawMacros] = useState<import('../../lib/database.types').Macrocycle[]>([]);
const [rawPhases, setRawPhases] = useState<import('../../lib/database.types').MacroPhase[]>([]);
const [rawMacroWeeks, setRawMacroWeeks] = useState<import('../../lib/database.types').MacroWeek[]>([]);
```

And after the existing queries:
```tsx
setRawMacros(macros || []);
setRawPhases(phases || []);
setRawMacroWeeks(macroWeeks || []);
```

### 3.2 Replace the old phaseBarWeeks computation

Find the code added in 5c where `phaseBarWeeks` is computed from
`weeks.map(...)` and the `<MacroPhaseBar>` is rendered. Replace with:

```tsx
import { buildCellsForWeekRange } from '../../lib/macroPhaseBarData';

const phaseBarCells = buildCellsForWeekRange(
  weeks.map(w => w.weekStart),
  { macros: rawMacros, phases: rawPhases, weeks: rawMacroWeeks, weekTypeConfigs }
);

const selectedWeekStart = weeks.find(w => w.weekStart === today)?.weekStart ?? null;
```

And the render block becomes:

```tsx
{phaseBarCells.length > 0 && (
  <div style={{ paddingLeft: '76px', paddingRight: '170px' }}>
    <MacroPhaseBar
      cells={phaseBarCells}
      events={[]}
      selectedWeekStart={selectedWeekStart}
      onCellClick={(cell) => onSelectWeek(cell.weekStart)}
    />
  </div>
)}
```

Remove the old `phaseBarWeeks` computation entirely.

Run `npm run build`.

---

## STEP 4: FIX PlannerControlPanel INTEGRATION

Edit `src/components/planner/PlannerControlPanel.tsx`.

The control panel must show **only the current macro**, not cross-macro
views. Because it already receives `macroContext`, `phases`, and
`settings` (GeneralSettings), it has almost everything. It needs access
to the current macro's raw `macro_weeks` rows to read each week's type.

### 4.1 Identify what's already there

`macroContext` gives current macro id, week number, phase name, etc.
`phases` is the phases of the current macro.
`settings.week_types` gives the coach's WeekTypeConfig list.

`macroWeeks` of the current macro is NOT currently passed into the
panel. That's what we need.

Two approaches:
- **A. Fetch `macro_weeks` inside the panel** (self-contained, extra query)
- **B. Lift the fetch to the parent** (`WeeklyPlanner`) and pass down

Approach **B** is cleaner. The parent already loads macro data and
could pass `macroWeeks` alongside `phases`.

### 4.2 Lift the fetch

Edit `src/components/planner/WeeklyPlanner.tsx`. Find the effect that
loads the current macro's phases. Right next to that phases query, add:

```tsx
const { data: mwRows } = await supabase
  .from('macro_weeks')
  .select('*')
  .eq('macrocycle_id', macroId)
  .order('week_number');
```

Store in a new state `currentMacroWeeks: MacroWeek[]`. Pass it down to
`<PlannerControlPanel currentMacroWeeks={currentMacroWeeks} ... />`.

Add the prop to `PlannerControlPanelProps`:
```tsx
currentMacroWeeks: MacroWeek[];
```

### 4.3 Build cells in the panel

In `PlannerControlPanel.tsx`, replace the existing `phaseBarWeeks`
computation (from 5c) with:

```tsx
import { buildCellsForSingleMacro } from '../../lib/macroPhaseBarData';

const macroForBar = macroContext ? {
  id: macroContext.macrocycleId,
  name: macroContext.macrocycleName,
} as Macrocycle : null;

const phaseBarCells = macroForBar && currentMacroWeeks.length > 0
  ? buildCellsForSingleMacro(
      macroForBar,
      {
        macros: [macroForBar],
        phases,
        weeks: currentMacroWeeks,
        weekTypeConfigs: settings?.week_types ?? [],
      }
    )
  : [];

const selectedWeekStart = macroContext
  ? currentMacroWeeks.find(w => w.week_number === macroContext.weekNumber)?.week_start ?? null
  : null;
```

And render:
```tsx
{phaseBarCells.length > 0 && (
  <div
    style={{
      padding: 'var(--space-sm) var(--space-lg)',
      borderTop: '0.5px solid var(--color-border-tertiary)',
    }}
  >
    <MacroPhaseBar
      cells={phaseBarCells}
      selectedWeekStart={selectedWeekStart}
      onCellClick={() => navigate('/macrocycles')}
    />
  </div>
)}
```

Note: clicking a cell in the control panel still navigates to the
macro cycles page (existing behavior). Future enhancement can make it
navigate to that specific week in the planner.

Run `npm run build`.

---

## STEP 5: VERIFY WITH REAL DATA

### Overview view (`/planner` default):
1. ✅ Phase bar renders with correct colors for each macro week
2. ✅ Week-type abbreviations (h, dl, sh, etc.) appear under each week number
3. ✅ Non-macro weeks (if any) render as gap cells in neutral gray with no label
4. ✅ When a macro boundary falls in the visible range, the divider at that boundary is raised (extends into the label strip)
5. ✅ Each macro's phase labels only appear within that macro's span
6. ✅ Playhead marks "today" week correctly
7. ✅ Click any cell → jumps to that week in the planner
8. ✅ No phantom phase colors in cells that don't belong to a macro

### Weekly planner detail (`/planner` with a week selected):
1. ✅ Phase bar shows the full current macro (first to last week)
2. ✅ Week-type abbreviations show
3. ✅ Current macro week is at full opacity, others at 70%
4. ✅ Tooltip shows macro name, phase, week type name, ISO week, date span
5. ✅ Click cell → navigates to macrocycles page (preserving existing behavior)
6. ✅ No cells shown from other macros

### Tooltip check:
Hover a week. The tooltip should show:
```
W3
Smolov base mesocycle · Loading · High
Week 15 · 13 Apr — 19 Apr
```

If the coach has week_type abbreviation "h" with name "High", the
tooltip shows the full name "High", not the letter.

### Multiple macros check (overview only):
If the coach has two back-to-back macros and the overview range
includes the boundary, the bar should show cells for both macros with
a raised divider where they meet.

---

## STEP 6: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "fix(planning): wire macro data + coach week-types to MacroPhaseBar

The MacroPhaseBar built in 5c had a correct visual treatment but was
being fed incomplete data, producing bugs:

- Non-macro weeks showed random phase colors (fallback purple)
- Week-type abbreviations never rendered (empty type strings)
- Didn't support cross-macro visibility in the overview

This change reshapes the component API around cells rather than
weeks + phases, and adds a shared data-builder.

Component API changes:
- MacroWeekEntry → MacroPhaseBarCell (includes macroId, phase,
  color, typeAbbr, typeName, label)
- MacroPhaseBarEvent uses weekStart-based identifiers instead of
  week numbers (which were ambiguous across macros)
- Removed weekTypeAbbreviations prop — abbreviations come from the
  cell data directly
- Removed macroStartDate prop — dates computed from each cell's
  weekStart
- Raised divider drawn at both phase boundaries AND macro boundaries

New: src/lib/macroPhaseBarData.ts with two helpers —
buildCellsForWeekRange (overview, cross-macro) and
buildCellsForSingleMacro (detail view, locked to one macro).

PlannerWeekOverview now fetches general_settings.week_types and
builds cells for the full visible week range, allowing macro
transitions to be seen within the overview.

PlannerControlPanel now receives currentMacroWeeks from the parent
(WeeklyPlanner) and shows the single current macro only.

Week-type abbreviations are resolved from GeneralSettings.week_types
(coach-configurable), matching the existing data model."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ `MacroPhaseBar` refactored with `MacroPhaseBarCell[]` API
3. ✅ `src/lib/macroPhaseBarData.ts` created with both builder helpers
4. ✅ `MacroWeek` rows fetched in `WeeklyPlanner`, passed to control panel
5. ✅ `week_types` from settings used to resolve type abbreviations
6. ✅ Overview shows cross-macro ranges correctly with raised dividers
7. ✅ Detail view shows only the current macro
8. ✅ Week-type letters visible under week numbers
9. ✅ Gap cells render as neutral gray with no label
10. ✅ Tooltips include full week type name and macro name
11. ✅ No console errors
12. ✅ Committed and pushed
