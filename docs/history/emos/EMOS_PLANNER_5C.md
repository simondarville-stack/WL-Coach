# EMOS — PROMPT 5C: BUILD SHARED `<MacroPhaseBar>` COMPONENT

Build a single `<MacroPhaseBar>` component and replace both existing
implementations (the inline bar in `PlannerControlPanel.tsx` and the
volume ribbon in `PlannerWeekOverview.tsx`) with it.

Design has been locked in through prototyping:
- **36px bar** with phase colors as cell backgrounds
- **16px phase label strip above** the bar, labels left-aligned with phase start
- **Phase-change dividers** extend up 20px into the label strip (height of strip + 4px buffer)
- **Regular week dividers** stay inside the bar (rgba white 30%)
- **Week number + week-type abbreviation** stacked inside each cell (11px mono + 9px mono)
- **Event dot** (5×5 white with subtle shadow) top-right corner when the week has events
- **Playhead** (2px black line, 4px above and below the bar)
- **Opacity 0.7 for non-selected, 1.0 for selected** week
- **Phase labels** shown only when phase spans ≥ 2 weeks
- **Tooltip (native `title`) lines**:
  1. `W7`
  2. `Build · High`
  3. `Week 11 · 17 Feb — 23 Feb` (ISO week · day-first European date span)
  4. `• Club training camp, Tenerife` (one line per event)
- **Every cell is clickable** → jump to that week
- **Coach-configurable week-type abbreviations** (map prop; sensible defaults)

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with message:
`feat(planning): extract shared MacroPhaseBar component`.

---

## STEP 1: ADD ISO WEEK UTILITY

Edit `src/lib/dateUtils.ts`. Append this helper at the bottom:

```ts
/**
 * ISO 8601 week number. Week starts Monday. Week 1 of a year is the
 * week containing the first Thursday (equivalently, 4 Jan).
 */
export function getISOWeek(date: Date): number {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  // Thursday in current ISO week
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const jan4 = new Date(target.getFullYear(), 0, 4);
  const jan4Monday = new Date(jan4);
  jan4Monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return 1 + Math.round((target.getTime() - jan4Monday.getTime()) / (7 * 86400000));
}
```

Run `npm run build` to confirm no regression.

---

## STEP 2: CREATE COMPONENT FOLDER + FILES

Create the directory `src/components/planning/` if it doesn't exist.

Create `src/components/planning/MacroPhaseBar.tsx` with the contents
below.

```tsx
import { getISOWeek } from '../../lib/dateUtils';

// ───────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────

export interface MacroWeekEntry {
  /** 1-indexed week number within the macro */
  n: number;
  /** Phase display name, e.g. "Loading", "Build" */
  phase: string;
  /** Phase color (hex or CSS color string) */
  color: string;
  /** Week type display name, e.g. "High", "Testing", "Deload" */
  type: string;
}

export interface MacroPhaseBarEvent {
  id: string;
  kind: 'point' | 'range';
  /** For point events: the macro week number (1-indexed) and day 0-6 */
  week?: number;
  day?: number;
  /** For range events: start/end macro week + day */
  startWeek?: number;
  startDay?: number;
  endWeek?: number;
  endDay?: number;
  /** Display name shown in the tooltip */
  title: string;
}

export interface MacroPhaseBarProps {
  /** One entry per week of the macro, in order */
  weeks: MacroWeekEntry[];
  /** Optional events to mark with top-right dots + tooltip lines */
  events?: MacroPhaseBarEvent[];
  /** The macro's start date (Monday of week 1) as YYYY-MM-DD */
  macroStartDate: string;
  /** Currently selected (or viewed) week — 1-indexed. Null if none. */
  selectedWeek?: number | null;
  /** Callback fired when a week cell is clicked */
  onWeekClick?: (weekNum: number) => void;
  /**
   * Coach-defined week-type abbreviation map. Example:
   *   { High: 'H', Medium: 'M', Deload: 'D', Testing: 'Ts', Taper: 'Tp' }
   * If not provided, sensible defaults are used.
   */
  weekTypeAbbreviations?: Record<string, string>;
  /** Optional className for the outer wrapper */
  className?: string;
  /** Optional style overrides for the outer wrapper */
  style?: React.CSSProperties;
}

// ───────────────────────────────────────────────────────────────
// Defaults
// ───────────────────────────────────────────────────────────────

const DEFAULT_WEEK_TYPE_ABBR: Record<string, string> = {
  High: 'H',
  Medium: 'M',
  Low: 'L',
  Deload: 'D',
  Taper: 'Tp',
  Testing: 'Ts',
  Competition: 'C',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

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
  color: string;
  startIdx: number;   // 0-indexed position of first week in this phase
  weekCount: number;
}

function computePhaseGroups(weeks: MacroWeekEntry[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  let current: PhaseGroup | null = null;
  weeks.forEach((w, i) => {
    if (!current || current.phase !== w.phase) {
      current = { phase: w.phase, color: w.color, startIdx: i, weekCount: 1 };
      groups.push(current);
    } else {
      current.weekCount++;
    }
  });
  return groups;
}

function eventsForWeek(
  weekNum: number,
  events: MacroPhaseBarEvent[]
): MacroPhaseBarEvent[] {
  return events.filter(ev => {
    if (ev.kind === 'point') return ev.week === weekNum;
    return weekNum >= (ev.startWeek ?? 0) && weekNum <= (ev.endWeek ?? 0);
  });
}

// ───────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────

export function MacroPhaseBar({
  weeks,
  events = [],
  macroStartDate,
  selectedWeek = null,
  onWeekClick,
  weekTypeAbbreviations,
  className,
  style,
}: MacroPhaseBarProps) {
  const totalWeeks = weeks.length;
  if (totalWeeks === 0) return null;

  const abbr = weekTypeAbbreviations ?? DEFAULT_WEEK_TYPE_ABBR;
  const groups = computePhaseGroups(weeks);
  const startDate = new Date(macroStartDate + 'T00:00:00');

  const buildTooltip = (w: MacroWeekEntry, cellEvents: MacroPhaseBarEvent[]): string => {
    const weekStart = addDays(startDate, (w.n - 1) * 7);
    const weekEnd = addDays(weekStart, 6);
    const cw = getISOWeek(weekStart);
    const lines = [
      `W${w.n}`,
      `${w.phase} · ${w.type}`,
      `Week ${cw} · ${formatDateEU(weekStart)} — ${formatDateEU(weekEnd)}`,
    ];
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
      {/* ── Phase label strip ── */}
      <div
        style={{
          display: 'flex',
          position: 'relative',
          height: '16px',
        }}
      >
        {groups.map((g, i) => {
          const leftPct = (g.startIdx / totalWeeks) * 100;
          const widthPct = (g.weekCount / totalWeeks) * 100;
          return (
            <div
              key={`${g.phase}-${i}`}
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

      {/* ── Bar ── */}
      <div style={{ position: 'relative' }}>
        {/* Cells */}
        <div
          style={{
            display: 'flex',
            position: 'relative',
            height: '36px',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          {weeks.map(w => {
            const cellEvents = eventsForWeek(w.n, events);
            const tooltip = buildTooltip(w, cellEvents);
            const isSelected = selectedWeek != null && w.n === selectedWeek;

            return (
              <div
                key={w.n}
                title={tooltip}
                onClick={() => onWeekClick?.(w.n)}
                style={{
                  flex: 1,
                  position: 'relative',
                  background: w.color,
                  opacity: isSelected ? 1 : 0.7,
                  cursor: onWeekClick ? 'pointer' : 'default',
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
                  {w.n}
                </span>
                {abbr[w.type] && (
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
                    {abbr[w.type]}
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

        {/* Dividers: regular week boundaries inside the bar, phase changes extending up */}
        {weeks.slice(1).map((w, idx) => {
          const i = idx + 1;
          const isPhaseChange = w.phase !== weeks[i - 1].phase;
          const leftCalc = `calc(${(i / totalWeeks) * 100}% - 0.25px)`;

          if (isPhaseChange) {
            return (
              <div
                key={`phase-div-${i}`}
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
              key={`week-div-${i}`}
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

        {/* Playhead — extends 4px above and below the bar */}
        {selectedWeek != null && (
          <div
            style={{
              position: 'absolute',
              top: '-4px',
              bottom: '-4px',
              left: `calc(${((selectedWeek - 1) + 0.5) * (100 / totalWeeks)}% - 1px)`,
              width: '2px',
              background: 'var(--color-text-primary)',
              borderRadius: '1px',
              pointerEvents: 'none',
              zIndex: 6,
            }}
          />
        )}
      </div>
    </div>
  );
}
```

Run `npm run build` to verify the component compiles.

---

## STEP 3: EXPORT FROM UI BARREL

Add a barrel export. Since the `ui/` folder is for pure design primitives
and `planning/` is the new shared-domain folder, do NOT re-export
MacroPhaseBar from `src/components/ui/index.ts`. Instead, keep the
import path explicit at call sites:

```tsx
import { MacroPhaseBar } from '../planning/MacroPhaseBar';
```

Create `src/components/planning/index.ts`:

```ts
export { MacroPhaseBar } from './MacroPhaseBar';
export type {
  MacroPhaseBarProps,
  MacroWeekEntry,
  MacroPhaseBarEvent,
} from './MacroPhaseBar';
```

So the import becomes `import { MacroPhaseBar } from '../planning';`.

Run `npm run build`.

---

## STEP 4: INTEGRATE IN PlannerControlPanel

Edit `src/components/planner/PlannerControlPanel.tsx`.

### 4.1 Add import

At the top of the file, alongside the existing imports:

```tsx
import { MacroPhaseBar, type MacroWeekEntry, type MacroPhaseBarEvent } from '../planning';
```

### 4.2 Build the weeks + events props

The panel already has access to `macroContext`, `phases`, and `totalWeeks`.
It also has access to the set of week plans via its data flow (needed
for week types). Since week types come from the individual week plans
(which the panel doesn't currently own directly), we need to check what
props are available.

Find where `phases` and `macroContext` are used to build the existing
bar (around line 489). Replace the existing phase/week timeline rendering
block with the new component.

Current block (to be replaced):
```tsx
{macroContext && totalWeeks > 0 && (
  <div
    onClick={() => navigate('/macrocycles')}
    title="Open macro cycles"
    style={{
      display: 'flex',
      cursor: 'pointer',
      overflow: 'hidden',
      height: '28px',
      borderTop: '0.5px solid var(--color-border-tertiary)',
    }}
  >
    {Array.from({ length: totalWeeks }, (_, i) => {
      const weekNum = i + 1;
      ...
    })}
  </div>
)}
```

**What we need that the current panel doesn't have:**

1. **Per-week type strings** (High/Medium/Low/etc). Currently the panel
   only gets `macroContext.weekType` for the *current* week, not all
   weeks. Look in `phases` prop — each phase has a range `start_week_number`
   to `end_week_number`, and potentially per-week type overrides.

2. **Events list** for this athlete. Fetched from the existing
   calendar/events data model (likely `competition_events` and maybe
   a training camps table if present).

For this migration, we'll:
- **Use `phases` directly** to compute `weeks`: each week gets the
  phase it belongs to. Use phase name as `type` placeholder for now
  if per-week type data isn't accessible from this component (we'll
  tighten this when the macro data model is wired further).
- **Pass an empty events array `[]`** for now. A follow-up prompt will
  wire events once the data fetch is in place.

Add a new prop to `PlannerControlPanelProps`:
```tsx
weekTypesByNum?: Record<number, string>;
macroEvents?: MacroPhaseBarEvent[];
```

And build `weeks` from phases + macroContext:

```tsx
const phaseBarWeeks: MacroWeekEntry[] = macroContext && totalWeeks > 0
  ? Array.from({ length: totalWeeks }, (_, i) => {
      const weekNum = i + 1;
      const phase = phases.find(p => weekNum >= p.start_week_number && weekNum <= p.end_week_number);
      return {
        n: weekNum,
        phase: phase?.name ?? macroContext.phaseName ?? '—',
        color: phase?.color ?? macroContext.phaseColor ?? '#7F77DD',
        type: weekTypesByNum?.[weekNum] ?? '',
      };
    })
  : [];
```

Need `macroStartDate` too. If `macroContext` doesn't expose it directly,
look for it in the phases data (the first phase's start date = macro start).
Add to `MacroContext` or derive inline:
```tsx
const macroStartDate = phases[0]?.start_date ?? null;
```

If `phases[0].start_date` isn't available, the MacroPhaseBar can't render
the tooltip date spans. In that case the component should fail gracefully —
it already handles missing events; we just need to pass a reasonable default
(e.g. the selected week's Monday) or make `macroStartDate` optional in the
component. For this prompt, **make `macroStartDate` optional in the component**
and show the tooltip without the date line when it's absent.

**Update the component:** in `MacroPhaseBar.tsx`, make `macroStartDate`
optional. Inside `buildTooltip`, if `macroStartDate` is null/undefined,
skip the "Week N · date — date" line.

Change the type:
```tsx
macroStartDate?: string | null;
```

And update the tooltip builder:
```tsx
const buildTooltip = (w: MacroWeekEntry, cellEvents: MacroPhaseBarEvent[]): string => {
  const lines = [`W${w.n}`, `${w.phase} · ${w.type}`];
  if (macroStartDate) {
    const startDate = new Date(macroStartDate + 'T00:00:00');
    const weekStart = addDays(startDate, (w.n - 1) * 7);
    const weekEnd = addDays(weekStart, 6);
    const cw = getISOWeek(weekStart);
    lines.push(`Week ${cw} · ${formatDateEU(weekStart)} — ${formatDateEU(weekEnd)}`);
  }
  cellEvents.forEach(ev => lines.push(`• ${ev.title}`));
  return lines.join('\n');
};
```

### 4.3 Render the component

Replace the old bar with:

```tsx
{macroContext && totalWeeks > 0 && phaseBarWeeks.length > 0 && (
  <div
    style={{
      padding: 'var(--space-sm) var(--space-lg)',
      borderTop: '0.5px solid var(--color-border-tertiary)',
    }}
  >
    <MacroPhaseBar
      weeks={phaseBarWeeks}
      events={macroEvents}
      macroStartDate={phases[0]?.start_date ?? null}
      selectedWeek={macroContext.weekNumber}
      onWeekClick={() => navigate('/macrocycles')}
      weekTypeAbbreviations={/* coach setting — leave undefined for defaults */ undefined}
    />
  </div>
)}
```

For now, clicking a week in the PlannerControlPanel navigates to the
macro cycles page (matching the old bar's single click target). A
future prompt can make it navigate to the specific week in the planner.

Run `npm run build`.

---

## STEP 5: INTEGRATE IN PlannerWeekOverview

Edit `src/components/planner/PlannerWeekOverview.tsx`.

The overview currently has a "Volume ribbon" — a mini bar chart of
tonnage per week. We will **replace it with `<MacroPhaseBar>`**.

The reason: the overview already has per-week metric columns on the
right showing reps, sets, tonnage, etc. The volume ribbon duplicates
that information in a less precise way. Replacing it with the phase
bar (timeline locator) serves a distinct purpose and unifies the
bar's semantics across surfaces.

### 5.1 Add import

```tsx
import { MacroPhaseBar, type MacroWeekEntry } from '../planning';
```

### 5.2 Build weeks prop

Near the top of the `PlannerWeekOverview` render body, compute `weeks`
from the macro data:

```tsx
const phaseBarWeeks: MacroWeekEntry[] = currentMacro
  ? weeks.map(w => {
      const phaseInfo = getPhaseForWeek(w.weekStart);
      return {
        n: (() => {
          const macroStart = new Date(currentMacro.startDate + 'T00:00:00');
          const weekDate = new Date(w.weekStart + 'T00:00:00');
          const diffWeeks = Math.floor((weekDate.getTime() - macroStart.getTime()) / (7 * 86400000)) + 1;
          return Math.max(1, diffWeeks);
        })(),
        phase: phaseInfo?.phase.phaseName ?? '—',
        color: phaseInfo?.phase.color ?? '#7F77DD',
        type: '',
      };
    })
  : [];
```

(Note: the overview's `weeks` local variable is the array of week
summaries. The phase bar wants one entry per *macro* week, not per
rendered week. If the overview shows weeks outside the current macro
too, you'll want to filter to only those within the macro, or pass
all weeks with a neutral phase. For simplicity this prompt uses all
rendered weeks directly — we can tighten later.)

### 5.3 Replace the volume ribbon

Find the existing "Volume ribbon" block:
```tsx
<div
  style={{
    display: 'flex',
    gap: '2px',
    alignItems: 'flex-end',
    height: '28px',
    paddingLeft: '76px',
    paddingRight: '170px',
  }}
>
  {weeks.map(w => { /* ... */ })}
</div>
```

Replace with:
```tsx
{phaseBarWeeks.length > 0 && currentMacro && (
  <div style={{ paddingLeft: '76px', paddingRight: '170px' }}>
    <MacroPhaseBar
      weeks={phaseBarWeeks}
      events={[]}
      macroStartDate={currentMacro.startDate}
      selectedWeek={(() => {
        const macroStart = new Date(currentMacro.startDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffWeeks = Math.floor((todayDate.getTime() - macroStart.getTime()) / (7 * 86400000)) + 1;
        return Math.max(1, diffWeeks);
      })()}
      onWeekClick={(weekNum) => {
        const macroStart = new Date(currentMacro.startDate + 'T00:00:00');
        const targetDate = new Date(macroStart);
        targetDate.setDate(macroStart.getDate() + (weekNum - 1) * 7);
        const weekStartStr = targetDate.toISOString().split('T')[0];
        onSelectWeek(weekStartStr);
      }}
    />
  </div>
)}
```

Clicking a week in the overview's bar jumps to that week's weekly
planner — matching the overview's existing row-click behavior.

Run `npm run build`.

---

## STEP 6: VERIFY

Navigate through the app:

**Planner overview (`/planner` default view):**
1. ✅ Volume ribbon has been replaced with the new phase bar
2. ✅ Phase labels appear above the bar, left-aligned with phase starts
3. ✅ Phase-change dividers extend up into the label strip
4. ✅ Current week has full opacity, others at 70%
5. ✅ Hover any cell shows tooltip with W-number, phase, type, calendar week, date span
6. ✅ Click a cell navigates to that week's detail view
7. ✅ No event dots yet (we haven't wired events)
8. ✅ Playhead (black line) marks the current week, extends slightly above/below

**Weekly planner detail (`/planner` with a week selected):**
1. ✅ Old per-week colored-segment bar is replaced with new phase bar
2. ✅ Same visual treatment as the overview
3. ✅ Selected week (current macro week) at full opacity, others at 70%
4. ✅ Hover shows full tooltip
5. ✅ Click navigates to macrocycles page (existing behavior preserved)

**Consistency:**
1. ✅ Both bars look identical in typography, spacing, dividers
2. ✅ Both use phase colors from data, no hardcoded colors
3. ✅ Both use the same tooltip format

Known limitations (documented, to be addressed in later prompts):
- Week type abbreviations come from a hardcoded default; coach
  settings for custom letters aren't wired yet
- Events array is empty in both call sites; wiring to calendar data
  is a follow-up
- Clicking a cell in the PlannerControlPanel's bar navigates to
  /macrocycles rather than jumping within the planner; this matches
  the old behavior and can be improved later

---

## STEP 7: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "feat(planning): extract shared MacroPhaseBar component

New component at src/components/planning/MacroPhaseBar.tsx unifies
the macro timeline treatment across the weekly planner and the
planner overview.

- 36px bar with phase colors as cell backgrounds
- 16px phase label strip above, labels left-aligned at phase start
- Phase-change dividers extend up 20px into the label strip
- Regular week dividers are subtle hairlines inside the bar
- Cell content: week number + week-type abbreviation (both mono)
- Event dot top-right when events overlap the week
- Playhead (2px) marks selected week, extends 4px above/below bar
- Opacity: 0.7 non-selected, 1.0 selected
- Phase labels shown only when phase spans ≥ 2 weeks
- Tooltip: W-number, phase · type, ISO week + day-first date span,
  bulleted event names
- Coach-configurable week-type abbreviation map (defaults provided)
- Click handler per cell; every cell is a navigation target

PlannerControlPanel: replaces the previous inline week-timeline
block with <MacroPhaseBar>.

PlannerWeekOverview: replaces the volume ribbon (which duplicated
the per-week tonnage column on the right) with <MacroPhaseBar>.
Volume info still present in the Target/Planned metric column.

Adds getISOWeek helper to src/lib/dateUtils.ts.

Events list is empty for now — a follow-up prompt will wire events
from the calendar/competitions data. Week type abbreviations use
sensible defaults; settings UI for custom letters is future work."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ `src/components/planning/MacroPhaseBar.tsx` created
3. ✅ `src/components/planning/index.ts` exports the component + types
4. ✅ `getISOWeek` added to dateUtils
5. ✅ PlannerControlPanel renders the new component
6. ✅ PlannerWeekOverview replaces volume ribbon with new component
7. ✅ Tooltips show W-number, phase · type, ISO week + date span
8. ✅ Playhead visible, extends above/below bar
9. ✅ Clicking a cell in the overview jumps to that week
10. ✅ Clicking a cell in the detail view navigates to macrocycles
11. ✅ No console errors
12. ✅ Committed and pushed

---

## NEXT STEPS

- **5d** — Wire macro events (competitions, training camps) from the
  calendar/events data model so event dots actually appear
- **5e** — Fix slot-to-weekday mapping in PlannerWeekOverview so
  sessions with a day_schedule render in their assigned weekday column
- **5f** — Migrate DayCard.tsx (single-week day cards) + fix the
  too-narrow layout you flagged earlier
- **5g** — Add settings UI for custom week-type abbreviations
