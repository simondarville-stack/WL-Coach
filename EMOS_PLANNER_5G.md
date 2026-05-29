# EMOS — PROMPT 5G: `<MacroTimeline>` WRAPPER UNIFIES ALL SURFACES

Collapse the three macro phase bar call sites into **one wrapper
component with two modes**, eliminating the drift problem permanently.
After this, improving the bar means editing one render path.

**Architecture:**

```
<MacroPhaseBar>          ← pure render (cells in, bar out) — unchanged
       ↑
<MacroTimeline>          ← NEW. Owns mode, data fetching, scrolling,
       ↑                    click navigation. Wraps <MacroPhaseBar>.
       │
   3 surfaces            ← Each renders <MacroTimeline mode={...} />
                           with a few identifier props.
```

**Two modes only:**

1. **Continuous** — used by the planner overview. Shows today's week
   centered with 5 weeks back + 6 weeks forward. Prev / Today / Later
   buttons shift the window by 4 weeks. Macros fade in/out as the
   window crosses their boundaries. Gap weeks render as neutral cells.

2. **Bounded** — used by the macro page and planner detail. Shows
   exactly one macro from its first to its last week. No buttons.
   Today's playhead sits inside if today is in range; otherwise no
   playhead.

**Outcome:**

- Bar comes out of `PlannerControlPanel` entirely. Panel keeps its
  tools, athlete pill, and week notes.
- All three surfaces standardize their work-area width via
  `<StandardPage>`. The 76/170 column-aligned padding in the overview
  goes away.
- Per-cell date-span row visible on every surface (already supported
  by `<MacroPhaseBar>` via the `showWeekDates` prop — we just enable
  it).

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with the message at the bottom.

---

## STEP 1: ADD CONTINUOUS-RANGE CELL BUILDER

Edit `src/lib/macroPhaseBarData.ts`. Append at the bottom:

```ts
import { addDaysToISO } from './dateUtils';

/**
 * Build cells for a continuous date range centered on a given Monday.
 * Used by the "continuous" mode of MacroTimeline (planner overview).
 *
 * Each cell represents one week. Weeks that fall inside any macro
 * receive that macro's phase + week-type metadata. Weeks that fall
 * between macros render as gap cells (phase null, neutral color,
 * empty label).
 *
 * Caller supplies `source.macros` containing every macro that could
 * possibly overlap the visible range — typically all of the athlete's
 * (or group's) macros within ~6 months of `centerWeekStart`.
 */
export function buildCellsForContinuousRange(
  centerWeekStart: string,
  weeksBack: number,
  weeksForward: number,
  source: MacroPhaseBarSource
): MacroPhaseBarCell[] {
  const weekStarts: string[] = [];
  for (let i = -weeksBack; i <= weeksForward; i++) {
    weekStarts.push(addDaysToISO(centerWeekStart, i * 7));
  }
  return buildCellsForWeekRange(weekStarts, source);
}
```

If `addDaysToISO` doesn't exist in `dateUtils.ts`, add it:

```ts
/**
 * Add (or subtract) whole days to a YYYY-MM-DD string. Returns
 * a YYYY-MM-DD string. Pure date math — no timezone shenanigans.
 */
export function addDaysToISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
```

Run `npm run build`.

---

## STEP 2: CREATE `<MacroTimeline>` WRAPPER

Create `src/components/planning/MacroTimeline.tsx`.

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { useSettings } from '../../hooks/useSettings';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO } from '../../lib/dateUtils';
import {
  buildCellsForSingleMacro,
  buildCellsForContinuousRange,
  fetchMacroPhaseBarEvents,
  resolveScopeAthleteIds,
} from '../../lib/macroPhaseBarData';
import { MacroPhaseBar } from './MacroPhaseBar';
import type {
  MacroPhaseBarCell,
  MacroPhaseBarEvent,
} from './MacroPhaseBar';
import type {
  MacroCycle,
  MacroPhase,
  MacroWeek,
} from '../../lib/database.types';

const CONTINUOUS_WEEKS_BACK = 5;
const CONTINUOUS_WEEKS_FORWARD = 6;
const SHIFT_WEEKS = 4;

// ───────────────────────────────────────────────────────────────
// Props
// ───────────────────────────────────────────────────────────────

type CommonProps = {
  athleteId: string | null;
  groupId: string | null;
  className?: string;
  style?: React.CSSProperties;
};

type ContinuousProps = CommonProps & {
  mode: 'continuous';
};

type BoundedProps = CommonProps & {
  mode: 'bounded';
  /** Required for bounded mode — the macro to render. */
  cycleId: string;
  /** Selected week — drives the playhead. If null, playhead falls
   *  back to today (when today is in macro range). */
  selectedWeekStart?: string | null;
  /** Optional callback for phase clicks. The bounded surfaces use
   *  this for navigation (planner views) or scroll-to-phase (macro
   *  page). If omitted, phase labels are not interactive. */
  onPhaseClick?: (cell: MacroPhaseBarCell) => void;
};

export type MacroTimelineProps = ContinuousProps | BoundedProps;

// ───────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────

export function MacroTimeline(props: MacroTimelineProps) {
  const navigate = useNavigate();
  const { settings } = useSettings();

  // Local state for continuous mode's window center
  const [centerWeekStart, setCenterWeekStart] = useState(() =>
    getMondayOfWeekISO(new Date())
  );

  // Raw data for cell construction
  const [allMacros, setAllMacros] = useState<MacroCycle[]>([]);
  const [allPhases, setAllPhases] = useState<MacroPhase[]>([]);
  const [allMacroWeeks, setAllMacroWeeks] = useState<MacroWeek[]>([]);
  const [events, setEvents] = useState<MacroPhaseBarEvent[]>([]);

  const todayMonday = getMondayOfWeekISO(new Date());

  // ── Load macros + phases + macro_weeks ──
  useEffect(() => {
    void (async () => {
      const ownerId = getOwnerId();
      if (!ownerId) return;

      // Fetch the right macros depending on mode
      let macrosQuery = supabase
        .from('macrocycles')
        .select('*')
        .eq('owner_id', ownerId);

      if (props.mode === 'bounded') {
        macrosQuery = macrosQuery.eq('id', props.cycleId);
      } else {
        // Continuous: scope by athlete or group
        if (props.athleteId) {
          macrosQuery = macrosQuery.or(`athlete_id.eq.${props.athleteId},group_id.is.not.null`);
          // We'll filter group macros to those where the athlete is a
          // member after fetching members. For now grab all and filter.
        } else if (props.groupId) {
          macrosQuery = macrosQuery.eq('group_id', props.groupId);
        }
      }

      const { data: macros } = await macrosQuery;
      let macrosFiltered = (macros as MacroCycle[]) ?? [];

      // For continuous mode with an athlete, drop group macros where
      // the athlete is not currently a member.
      if (props.mode === 'continuous' && props.athleteId) {
        const groupMacros = macrosFiltered.filter(m => m.group_id);
        if (groupMacros.length > 0) {
          const groupIds = [...new Set(groupMacros.map(m => m.group_id!))];
          const { data: memberships } = await supabase
            .from('group_members')
            .select('group_id, athlete_id')
            .in('group_id', groupIds)
            .eq('athlete_id', props.athleteId)
            .is('left_at', null);
          const memberOfGroups = new Set((memberships || []).map(m => m.group_id));
          macrosFiltered = macrosFiltered.filter(
            m => !m.group_id || memberOfGroups.has(m.group_id)
          );
        } else if (!props.athleteId) {
          macrosFiltered = [];
        }
      }

      setAllMacros(macrosFiltered);

      const macroIds = macrosFiltered.map(m => m.id);
      if (macroIds.length === 0) {
        setAllPhases([]);
        setAllMacroWeeks([]);
        return;
      }

      const { data: phases } = await supabase
        .from('macro_phases')
        .select('*')
        .in('macrocycle_id', macroIds)
        .order('position');
      setAllPhases((phases as MacroPhase[]) ?? []);

      const { data: macroWeeks } = await supabase
        .from('macro_weeks')
        .select('*')
        .in('macrocycle_id', macroIds)
        .order('week_number');
      setAllMacroWeeks((macroWeeks as MacroWeek[]) ?? []);
    })();
  }, [
    props.mode,
    props.mode === 'bounded' ? props.cycleId : null,
    props.athleteId,
    props.groupId,
  ]);

  // ── Build cells ──
  const cells = useMemo(() => {
    if (allMacros.length === 0 && props.mode === 'bounded') return [];

    const source = {
      macros: allMacros,
      phases: allPhases,
      weeks: allMacroWeeks,
      weekTypeConfigs: settings?.week_types ?? [],
    };

    if (props.mode === 'bounded') {
      const macro = allMacros.find(m => m.id === props.cycleId);
      if (!macro) return [];
      return buildCellsForSingleMacro(macro, source);
    }

    // continuous
    return buildCellsForContinuousRange(
      centerWeekStart,
      CONTINUOUS_WEEKS_BACK,
      CONTINUOUS_WEEKS_FORWARD,
      source
    );
  }, [
    props.mode,
    props.mode === 'bounded' ? props.cycleId : null,
    allMacros,
    allPhases,
    allMacroWeeks,
    settings?.week_types,
    centerWeekStart,
  ]);

  // ── Load events for the visible range ──
  useEffect(() => {
    if (cells.length === 0) {
      setEvents([]);
      return;
    }
    void (async () => {
      const athleteIds = await resolveScopeAthleteIds(
        props.athleteId,
        props.groupId
      );
      if (athleteIds.length === 0) {
        setEvents([]);
        return;
      }
      const rangeStart = cells[0].weekStart;
      const lastCell = cells[cells.length - 1];
      const rangeEnd = addDaysToISO(lastCell.weekStart, 6);
      const fetched = await fetchMacroPhaseBarEvents(
        athleteIds,
        rangeStart,
        rangeEnd
      );
      setEvents(fetched);
    })();
  }, [cells, props.athleteId, props.groupId]);

  // ── Resolve playhead + selected week ──
  const playheadDate = todayMonday;
  const selectedWeekStart =
    props.mode === 'bounded'
      ? props.selectedWeekStart ?? todayMonday
      : todayMonday;

  // ── Click handlers ──
  const handleCellClick = (cell: MacroPhaseBarCell) => {
    navigate(`/planner/${cell.weekStart}`);
  };

  const handlePhaseClick = (cell: MacroPhaseBarCell) => {
    if (cell.macroId === null) return;
    if (props.mode === 'bounded' && props.onPhaseClick) {
      props.onPhaseClick(cell);
      return;
    }
    // Continuous: navigate to the macro page for that cycle
    navigate(`/macrocycles/${cell.macroId}`);
  };

  // ── Continuous-mode nav ──
  const showNav = props.mode === 'continuous';
  const earlierEnabled = true;
  const laterEnabled = true;

  return (
    <div className={props.className} style={props.style}>
      {showNav && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginBottom: '8px',
          }}
        >
          <button
            type="button"
            onClick={() =>
              setCenterWeekStart(addDaysToISO(centerWeekStart, -SHIFT_WEEKS * 7))
            }
            disabled={!earlierEnabled}
            style={navBtnStyle}
          >
            ← Earlier
          </button>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {cells.length > 0
              ? `${cells[0].weekStart} → ${addDaysToISO(cells[cells.length - 1].weekStart, 6)}`
              : ''}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setCenterWeekStart(todayMonday)}
              style={navBtnStyle}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() =>
                setCenterWeekStart(addDaysToISO(centerWeekStart, SHIFT_WEEKS * 7))
              }
              disabled={!laterEnabled}
              style={navBtnStyle}
            >
              Later →
            </button>
          </div>
        </div>
      )}

      <MacroPhaseBar
        cells={cells}
        events={events}
        selectedWeekStart={selectedWeekStart}
        playheadDate={playheadDate}
        showMonthRow
        showWeekDates
        onCellClick={handleCellClick}
        onPhaseClick={handlePhaseClick}
      />
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md, 6px)',
  padding: '4px 10px',
  fontSize: '11px',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};
```

Update the barrel export at `src/components/planning/index.ts`:

```ts
export { MacroPhaseBar } from './MacroPhaseBar';
export { MacroTimeline } from './MacroTimeline';
export type {
  MacroPhaseBarProps,
  MacroPhaseBarCell,
  MacroPhaseBarEvent,
} from './MacroPhaseBar';
export type { MacroTimelineProps } from './MacroTimeline';
```

If a stale `planning_index.ts` file exists alongside `index.ts`, delete
it.

Run `npm run build`.

---

## STEP 3: USE `<MacroTimeline>` ON THE MACRO PAGE

Edit `src/components/macro/MacroCycles.tsx`.

### 3.1 Replace the existing bar with `<MacroTimeline mode="bounded">`

Find the current `<MacroPhaseBar ... />` block (the one wrapped in
`{phaseBarCells.length > 0 && (...)}`). Replace it with:

```tsx
{selectedCycle && (
  <div style={{ padding: '12px 16px 8px' }}>
    <MacroTimeline
      mode="bounded"
      cycleId={selectedCycle.id}
      athleteId={selectedAthlete?.id ?? null}
      groupId={selectedGroup?.id ?? null}
      onPhaseClick={(cell) => {
        const phase = phases.find(
          p => p.macrocycle_id === cell.macroId && p.name === cell.phase
        );
        if (phase) scrollToPhase(phase.id);
      }}
    />
  </div>
)}
```

### 3.2 Remove now-dead code

- The `phaseBarCells` computation, `todayMonday` variable, `barEvents`
  state, and the `useEffect` that fetched events all move into
  `<MacroTimeline>`. Delete them from `MacroCycles.tsx`.
- The `buildCellsForSingleMacro`, `fetchMacroPhaseBarEvents`,
  `resolveScopeAthleteIds` imports are no longer needed in this file
  — drop them.
- Keep `scrollToPhase`, `highlightedPhaseId`, the `useSearchParams`
  query-param effect — those are macro-page-specific scroll behaviors
  and stay.
- The direct `MacroPhaseBar` import in this file is no longer used —
  drop it.

Update the import:
```tsx
import { MacroTimeline } from '../planning';
```

Run `npm run build`.

---

## STEP 4: USE `<MacroTimeline>` IN THE PLANNER OVERVIEW

Edit `src/components/planner/PlannerWeekOverview.tsx`.

### 4.1 Replace the existing bar

Find the current `<MacroPhaseBar ... />` block (the one rendering
`phaseBarCellsData`). Replace it with:

```tsx
{(athlete || group) && (
  <div style={{ marginBottom: 'var(--space-md)' }}>
    <MacroTimeline
      mode="continuous"
      athleteId={athlete?.id ?? null}
      groupId={group?.id ?? null}
    />
  </div>
)}
```

The 76/170 horizontal padding goes away — `<MacroTimeline>` lives
in the same `<StandardPage>` content area as the rest of the
overview, with no special inset.

### 4.2 Drop the overview's local cell-building

The overview's `usePlannerWeekOverview` hook currently exposes a
`phaseBarCells` callback. The overview was using it to build
`phaseBarCellsData`. Both are now redundant.

- Remove `phaseBarCells` from `usePlannerWeekOverview.ts`'s return
  shape and its `useCallback` definition.
- Remove `rawPhases`, `rawMacroWeeks`, `barEvents` from the hook's
  return shape if they are no longer used elsewhere in the overview.
  (Confirm with a grep before deleting; some of these may still feed
  the per-week metric column or the macro-context pill at the top.)
- Update the consumer in `PlannerWeekOverview.tsx` accordingly.

If the overview's per-week list still needs to highlight which weeks
belong to which macro (for the row's macro-context pill or its
left-meta colored stripe), keep the necessary raw data — just remove
the parts that fed the bar. We're removing redundancy, not features.

### 4.3 Drop the centerDate / earlier / later state

Since the bar handles its own window, the overview's centerDate
state and Earlier/Today/Later buttons no longer need to drive the
bar's range. Two options:

- **A.** Keep the row-list pagination separate from the bar (each
  has its own range). The list still uses centerDate. The bar uses
  its own internal state.
- **B.** Drop centerDate entirely — the row list now always shows
  a fixed window centered on today. Coaches scroll the row list
  using the same Earlier/Later buttons but those move both the row
  list and the bar's window in sync via a shared state.

Choose **A** for minimum disruption. The row list and the bar are
independent. Coaches can scroll the bar to navigate to a week, click
a cell to open it, and the row list serves a different purpose
(scanning recent and upcoming weeks at a glance). This is a small
ergonomic redundancy — both controls do navigation in different
ways — and I'm OK with it for this prompt. Future tightening can
unify them if it feels clunky.

Run `npm run build`.

---

## STEP 5: USE `<MacroTimeline>` IN THE WEEKLY PLANNER DETAIL

The bar comes out of `PlannerControlPanel` and moves up to
`WeeklyPlanner` so it sits at the top of the detail view, above the
panel.

### 5.1 Edit `WeeklyPlanner.tsx`

Add the import:
```tsx
import { MacroTimeline } from '../planning';
```

Find the detail-view JSX (the branch where `panelView !== 'overview'`
and `currentWeekPlan` is being shown — search for `<PlannerControlPanel`).

Just above the `<PlannerControlPanel>` render, add:
```tsx
{macroContext && planSelection.athlete && (
  <div style={{ padding: '12px 24px 0' }}>
    <MacroTimeline
      mode="bounded"
      cycleId={macroContext.macroId}
      athleteId={planSelection.athlete.id}
      groupId={planSelection.group?.id ?? null}
      selectedWeekStart={selectedDate}
    />
  </div>
)}
```

(The exact wrapping container depends on the detail view's layout —
adjust the wrapper styling so the timeline aligns with the panel
below it. The control panel currently has its own padding; mirror
it.)

### 5.2 Remove the bar from `PlannerControlPanel.tsx`

- Delete the block that renders `<MacroPhaseBar ... />` and its
  surrounding wrapper `<div>`.
- Delete the `phaseBarCells` computation, `phaseBarSelectedWeekStart`,
  `fetchedEvents` state, `todayPlayhead` const, and any imports that
  are now dead (`buildCellsForSingleMacro`,
  `fetchMacroPhaseBarEvents`, `MacroPhaseBar`, `MacroPhaseBarEvent`).
- Drop the `loadMacroWeeks` function and the `macroWeeks` state if
  nothing else in the panel uses them. (The panel's other content
  — tools row, athlete pill, week notes — does not depend on
  `macroWeeks`.)

Run `npm run build`.

---

## STEP 6: STANDARDIZE WORK-AREA WIDTH

Wrap the macro page content in `<StandardPage>` like the planner
already does, so all three surfaces share the same horizontal frame.

### 6.1 Macro page

In `MacroCycles.tsx`, find the outer container of the cycle-detail
view (the branch where `selectedCycle` is set). Wrap its contents
in `<StandardPage>`:

```tsx
import { StandardPage } from '../ui';
// ...

{selectedCycle ? (
  <StandardPage>
    {/* existing content: timeline, meta row, table, etc. */}
  </StandardPage>
) : (
  // wheel branch unchanged
)}
```

### 6.2 Planner detail

In `WeeklyPlanner.tsx`, the detail view's outermost container should
also be a `<StandardPage>` if it isn't already. Confirm by inspection;
if `<PlannerControlPanel>` is already wrapped in `<StandardPage>` (or
if the panel renders inside a parent with the same framing), no
change needed.

If the detail view doesn't currently use `<StandardPage>`, wrap it
now so the timeline + panel + day cards all live in a single framed
work area.

### 6.3 Overview already uses it

`PlannerWeekOverview` already uses `<StandardPage>`. No change.

Run `npm run build`.

---

## STEP 7: VERIFY

### Macro page (`/macrocycles/<cycleId>`):
1. ✅ Timeline renders at the top of the cycle-detail panel
2. ✅ Bounded mode — full macro span, week numbers, week-type
   abbreviations
3. ✅ Month row above and date span row below visible
4. ✅ Today's playhead visible if today is in macro range
5. ✅ Event dots on weeks with events
6. ✅ Cell click → navigates to weekly planner detail
7. ✅ Phase click → scrolls table to that phase row + brief highlight
8. ✅ No console errors

### Planner overview (`/planner`):
1. ✅ Continuous timeline at top
2. ✅ Earlier / Today / Later buttons shift the window by 4 weeks
3. ✅ Multiple macros visible if range crosses boundaries
4. ✅ Gap weeks render as neutral cells
5. ✅ Today's playhead always visible (today is centered initially)
6. ✅ Cell click → opens that week
7. ✅ Phase click → navigates to that macro's detail page

### Planner detail (`/planner/<weekStart>`):
1. ✅ Bounded timeline at top of the detail view, above the control
   panel
2. ✅ Shows the current macro from first to last week
3. ✅ Selected week (URL param) drives the playhead
4. ✅ Cell click → navigates to that other week
5. ✅ Phase click → navigates to the macro page

### Cross-surface consistency:
1. ✅ All three timelines share visual treatment
2. ✅ All three sit inside `<StandardPage>` framing → same page
   width
3. ✅ Per-cell dates (`5 Apr — 11 Apr`) visible on every surface

### No regressions:
1. ✅ The control panel still functions (tools, athlete pill, week
   notes intact)
2. ✅ The macro page table + scroll-to-phase still work
3. ✅ The overview's per-week row list still renders
4. ✅ Athlete and group selection still work
5. ✅ Browser back / forward / reload work as expected

---

## STEP 8: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "refactor(planning): MacroTimeline wrapper unifies all surfaces

The macro phase bar is now consumed exclusively through a single
<MacroTimeline> wrapper that owns mode, data fetching, scrolling, and
click navigation. Three surfaces, two modes, one render path.

New: src/components/planning/MacroTimeline.tsx

Modes:
- continuous: today centered, 5 weeks back + 6 forward, prev/today/
  later buttons shift the window by 4 weeks. Macros fade in and out
  as the visible range crosses their boundaries. Used by the planner
  overview.
- bounded: shows exactly one macro from first to last week, no
  scrolling. Today's playhead sits inside if today is in range.
  Used by the macro page and the planner detail view.

New cell builder: buildCellsForContinuousRange in
src/lib/macroPhaseBarData.ts

New helper: addDaysToISO in src/lib/dateUtils.ts

The wrapper internally:
- Fetches macros, phases, macro_weeks scoped to the athlete or group
- Handles group-macro membership filtering for continuous mode
- Builds cells via buildCellsForSingleMacro or
  buildCellsForContinuousRange depending on mode
- Loads events for the visible date range
- Wires onCellClick to /planner/<weekStart>
- Wires onPhaseClick to either /macrocycles/<id> (continuous /
  planner) or a caller-provided handler (macro page's
  scroll-to-phase)

Surfaces:
- MacroCycles.tsx: replaces its <MacroPhaseBar> block + local
  fetches with <MacroTimeline mode='bounded' />
- PlannerWeekOverview.tsx: replaces its <MacroPhaseBar> block +
  hook-derived bar data with <MacroTimeline mode='continuous' />.
  The 76/170 column-aligned padding around the bar is removed.
- WeeklyPlanner.tsx: now renders <MacroTimeline mode='bounded' />
  at the top of the detail view, above the PlannerControlPanel.
- PlannerControlPanel.tsx: bar removed entirely along with its
  phaseBarCells, fetchedEvents, loadMacroWeeks plumbing. Panel now
  hosts only the tools row, athlete pill, and week notes.

All three surfaces are wrapped in <StandardPage> so the work-area
width is identical across them.

The MacroPhaseBar component itself is unchanged — it remains a pure
'cells in, bar out' renderer. All mode-specific behavior lives in
the wrapper. Future improvements to the bar update one place and
propagate to all three surfaces."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ `MacroTimeline.tsx` created with `mode` prop and the two
   variants typed correctly
3. ✅ `buildCellsForContinuousRange` and `addDaysToISO` added
4. ✅ Macro page uses `<MacroTimeline mode='bounded'>`
5. ✅ Overview uses `<MacroTimeline mode='continuous'>`
6. ✅ Planner detail uses `<MacroTimeline mode='bounded'>` above the
   control panel
7. ✅ Bar fully removed from `PlannerControlPanel`
8. ✅ All three surfaces wrapped in `<StandardPage>`
9. ✅ Per-cell date span row visible everywhere
10. ✅ Cell click → planner; phase click → macro page (or scroll on
    macro page)
11. ✅ No console errors
12. ✅ Committed and pushed

---

## KNOWN LIMITATIONS / FUTURE WORK

- **Continuous mode group-macro membership filtering** is done via a
  separate `group_members` query inside `<MacroTimeline>`. If
  performance becomes a concern with many group macros, this could
  move into a single `.in()` filter at the database level.
- **Earlier/Later step is hardcoded to 4 weeks** — could be made a
  prop later if you want different defaults for different surfaces.
- **The overview row list and the timeline scroll independently.**
  This is intentional for now (the lists serve different purposes).
  If it feels disconnected in practice, we can wire them to share
  centerDate state in a follow-up.
- **No keyboard navigation** — cells and phase labels are mouse-only.
  Tab focus is future work.
