# EMOS 2.0 — TRAINING DAY ASSIGNMENT & REST VISUALIZATION

Add optional weekday assignment to training slots. When assigned, the
week view shows cards positioned on their actual weekday with rest gaps
visible. Each card shows hours since the last training. The load
distribution chart uses time-accurate spacing.

This is ADDITIVE — the existing abstract slot mode stays as default.
Coaches opt in to calendar mapping per week plan.

Work on the current branch. Run `npm run build` after each group.
Commit each group separately. Do not ask for confirmation.

---

## GROUP 1: DATABASE MIGRATION (create file only)

Create: `supabase/migrations/20260405_day_schedule.sql`

```sql
-- Maps training slot index → weekday + optional time
-- Format: {"1": {"weekday": 0, "time": "09:00"}, "2": {"weekday": 0, "time": "15:30"}, ...}
-- weekday: 0=Mon, 1=Tue, ..., 6=Sun
-- time: HH:MM string (24h format), null = no specific time
-- When the whole column is null, the week plan is in abstract slot mode
ALTER TABLE week_plans
  ADD COLUMN IF NOT EXISTS day_schedule jsonb DEFAULT NULL;
```

A single jsonb column. When null or empty, the week plan is in abstract
slot mode (current behavior). When populated, it's in calendar-mapped mode.

Update src/lib/database.types.ts — add to WeekPlan:
```typescript
day_schedule: Record<number, { weekday: number; time: string | null }> | null;
// slot → { weekday: 0=Mon..6=Sun, time: "15:30" or null }
```

---

## GROUP 2: DAY CONFIG — ADD WEEKDAY ASSIGNMENT

File: src/components/DayConfigModal.tsx (or wherever day config lives)

Add a weekday dropdown AND a time input to each day slot row. Current row:
```
[drag handle] [Day label input] [toggle active]
```

New row:
```
[drag handle] [Day label input] [weekday dropdown] [time input] [toggle active]
```

The weekday dropdown:
- Options: "Unassigned", "Monday", "Tuesday", ..., "Sunday"
- Default: "Unassigned" (preserving current abstract behavior)
- When a weekday is selected, the day label auto-fills with that
  weekday name IF the label was previously "Day 1", "Day 2" etc.
  (don't overwrite custom labels like "Heavy snatches")

The time input:
- Only visible when a weekday is selected (hidden when "Unassigned")
- HTML time input: `<input type="time" />` — gives native HH:MM picker
- Default: null (no time specified)
- When two slots share the same weekday, time becomes REQUIRED —
  show a red border and "Time required for same-day sessions" hint
- Common presets as small pills below: "09:00" "15:30" "17:00"
  (clickable, auto-fill the time input)

Duplicate weekday validation:
- If two slots share a weekday WITHOUT times: show error, block save
- If two slots share a weekday WITH times: show info text
  "AM/PM split" and sort them by time within the day
- If two slots share a weekday and same time: show error, block save

Save the structure in `week_plans.day_schedule` on save:
```json
{
  "1": { "weekday": 0, "time": "15:30" },
  "2": { "weekday": 2, "time": "09:00" },
  "3": { "weekday": 4, "time": "15:30" },
  "4": { "weekday": 5, "time": "15:30" }
}
```

### State management
In WeeklyPlanner.tsx:
```typescript
const [daySchedule, setDaySchedule] = useState<Record<number, { weekday: number; time: string | null }>>({});
```

Load from `currentWeekPlan.day_schedule` when week plan loads.
Save alongside day_labels and active_days in saveDayLabels.

Helper to check if calendar-mapped:
```typescript
const isCalendarMapped = Object.keys(daySchedule).length > 0;
```

---

## GROUP 3: REST CALCULATION UTILITY

Create: src/lib/restCalculation.ts

```typescript
export interface ScheduleEntry {
  weekday: number;      // 0=Mon..6=Sun
  time: string | null;  // "15:30" or null
}

export interface RestInfo {
  slotIndex: number;
  weekday: number | null;
  time: string | null;
  hoursFromPrevious: number | null;
  recoveryLevel: 'full' | 'partial' | 'short' | 'same-day' | null;
}

/**
 * Convert weekday + time to a comparable number (hours from Monday 00:00)
 * Monday 09:00 = 9, Tuesday 15:30 = 24+15.5 = 39.5, etc.
 */
function toWeekHour(weekday: number, time: string | null): number {
  const dayHours = weekday * 24;
  if (!time) return dayHours + 12; // default to noon if no time set
  const [h, m] = time.split(':').map(Number);
  return dayHours + h + (m || 0) / 60;
}

/**
 * Calculate rest hours between training sessions based on schedule.
 * Uses actual times when available for same-day precision.
 */
export function calculateRestInfo(
  activeSlots: number[],
  schedule: Record<number, ScheduleEntry> | null,
): RestInfo[] {
  if (!schedule || Object.keys(schedule).length === 0) {
    return activeSlots.map(s => ({
      slotIndex: s, weekday: null, time: null,
      hoursFromPrevious: null, recoveryLevel: null,
    }));
  }

  // Build list and sort by weekHour (weekday + time)
  const assigned = activeSlots
    .filter(s => schedule[s] !== undefined)
    .map(s => ({
      slotIndex: s,
      weekday: schedule[s].weekday,
      time: schedule[s].time,
      weekHour: toWeekHour(schedule[s].weekday, schedule[s].time),
    }))
    .sort((a, b) => a.weekHour - b.weekHour);

  return assigned.map((slot, i) => {
    if (i === 0) {
      return { slotIndex: slot.slotIndex, weekday: slot.weekday, time: slot.time,
               hoursFromPrevious: null, recoveryLevel: null };
    }
    const prev = assigned[i - 1];
    const hours = Math.round((slot.weekHour - prev.weekHour) * 10) / 10;

    let recoveryLevel: RestInfo['recoveryLevel'];
    if (hours <= 0) recoveryLevel = 'same-day';      // shouldn't happen with times
    else if (hours < 8) recoveryLevel = 'same-day';   // AM/PM split
    else if (hours < 24) recoveryLevel = 'short';
    else if (hours < 48) recoveryLevel = 'partial';
    else recoveryLevel = 'full';

    return { slotIndex: slot.slotIndex, weekday: slot.weekday, time: slot.time,
             hoursFromPrevious: hours, recoveryLevel };
  });
}

/**
 * Get all 7 weekday cells with their status for the calendar grid.
 */
export interface WeekdayCell {
  weekday: number;
  weekdayName: string;
  isRestDay: boolean;
  trainingSessions: { slotIndex: number; time: string | null }[];
  recoveryFromPrevTraining: number | null;  // hours
}

export function buildWeekdayCells(
  activeSlots: number[],
  schedule: Record<number, ScheduleEntry> | null,
): WeekdayCell[] {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  if (!schedule || Object.keys(schedule).length === 0) return [];

  const slotsByWeekday = new Map<number, { slotIndex: number; time: string | null }[]>();
  activeSlots.forEach(s => {
    const entry = schedule[s];
    if (!entry) return;
    const arr = slotsByWeekday.get(entry.weekday) || [];
    arr.push({ slotIndex: s, time: entry.time });
    slotsByWeekday.set(entry.weekday, arr);
  });

  // Sort sessions within same day by time
  slotsByWeekday.forEach(sessions => {
    sessions.sort((a, b) => {
      const ta = a.time ? parseInt(a.time.replace(':', '')) : 1200;
      const tb = b.time ? parseInt(b.time.replace(':', '')) : 1200;
      return ta - tb;
    });
  });

  let lastTrainingWeekHour: number | null = null;

  return DAYS.map((name, wd) => {
    const sessions = slotsByWeekday.get(wd) || [];
    const isRest = sessions.length === 0;
    
    let recovery: number | null = null;
    if (!isRest && lastTrainingWeekHour !== null) {
      const firstSessionHour = toWeekHour(wd, sessions[0].time);
      recovery = Math.round((firstSessionHour - lastTrainingWeekHour) * 10) / 10;
    }
    if (!isRest) {
      const lastSession = sessions[sessions.length - 1];
      lastTrainingWeekHour = toWeekHour(wd, lastSession.time);
    }

    return {
      weekday: wd,
      weekdayName: name,
      isRestDay: isRest,
      trainingSessions: sessions,
      recoveryFromPrevTraining: recovery,
    };
  });
}
```

---

## GROUP 4: REST BADGE COMPONENT

Create: src/components/planner/RestBadge.tsx

Small badge showing rest time since last training:

```tsx
interface RestBadgeProps {
  hours: number | null;       // null = first session or unassigned
  recoveryLevel: 'full' | 'partial' | 'short' | 'same-day' | null;
}

export function RestBadge({ hours, recoveryLevel }: RestBadgeProps) {
  if (hours === null || recoveryLevel === null) return null;
  
  // Color mapping
  const styles = {
    'full':     'bg-[#E1F5EE] text-[#085041]',     // green — 48h+
    'partial':  'bg-[#FAEEDA] text-[#633806]',      // amber — 24-48h
    'short':    'bg-[#FCEBEB] text-[#791F1F]',      // red — <24h
    'same-day': 'bg-[#EEEDFE] text-[#3C3489]',     // purple — AM/PM split
  };

  // Label — handle fractional hours from same-day sessions
  const label = hours === 0 ? 'Same day'
    : hours < 1 ? `${Math.round(hours * 60)}min`
    : hours < 24 ? `${Math.round(hours)}h rest`
    : hours === 24 ? '24h rest'
    : hours === 48 ? '48h rest'
    : `${Math.round(hours / 24)}d rest`;

  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${styles[recoveryLevel]}`}>
      {/* Small clock icon */}
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="flex-shrink-0">
        <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="1"/>
        <path d="M4 2v2l1.5 1" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
      </svg>
      {label}
    </span>
  );
}
```

---

## GROUP 5: UPDATE DAY CARD HEADERS

File: src/components/planner/DayCard.tsx

When `day_schedule` is populated and the slot has a weekday assigned,
show the RestBadge in the card header:

```
┌──────────────────────────────────┐
│ Training 1  S 14 R 26   ⏱ 48h  │
│ ─────────────────────────────── │
│ ...exercises...                  │
```

### Props change
Add to DayCardProps:
```typescript
restInfo?: RestInfo | null;
```

In the header div, after the S/R totals:
```tsx
{restInfo && restInfo.hoursFromPrevious !== null && (
  <RestBadge 
    hours={restInfo.hoursFromPrevious} 
    recoveryLevel={restInfo.recoveryLevel} 
  />
)}
```

### Wire in WeeklyPlanner → WeekOverview → DayCard
Calculate restInfo in WeeklyPlanner using `calculateRestInfo()` and
pass it through WeekOverview to each DayCard.

---

## GROUP 6: CALENDAR-MAPPED WEEK VIEW

File: src/components/planner/WeekOverview.tsx

When `day_schedule` is populated, switch from the current
`grid-cols-N` (where N = number of active days) to a 7-column grid
showing all weekdays:

```tsx
const isCalendarMapped = schedule && Object.keys(schedule).length > 0;

if (isCalendarMapped) {
  const cells = buildWeekdayCells(activeSlots, schedule);
  
  return (
    <div className="p-4">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-2 mb-1">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} className="text-center text-[10px] font-medium text-gray-400">{d}</div>
        ))}
      </div>
      
      {/* Recovery strip */}
      <RecoveryStrip cells={cells} />
      
      {/* Day cards / rest cells */}
      <div className="grid grid-cols-7 gap-2">
        {cells.map(cell => (
          cell.isRestDay ? (
            <div key={cell.weekday} className="rounded-lg bg-gray-50/50 border border-dashed border-gray-200 min-h-[80px] flex items-center justify-center">
              <span className="text-[10px] text-gray-300 italic">rest</span>
            </div>
          ) : (
            // Render DayCard(s) for each slot assigned to this day
            // Multiple slots = stacked (AM/PM split)
            <div key={cell.weekday} className="space-y-2">
              {cell.trainingSessions.map(session => (
                <div key={session.slotIndex}>
                  {/* Time label for same-day splits */}
                  {cell.trainingSessions.length > 1 && session.time && (
                    <div className="text-[9px] text-gray-400 font-medium mb-0.5 text-center">
                      {session.time}
                    </div>
                  )}
                  <DayCard
                    dayIndex={session.slotIndex}
                    // ... all existing props
                    restInfo={restInfoMap.get(session.slotIndex)}
                  />
                </div>
              ))}
            </div>
          )
        ))}
      </div>
    </div>
  );
}
```

When NOT calendar-mapped, use the existing layout (unchanged).

### Double sessions (same weekday)
If two slots are assigned to the same weekday, stack their DayCards
vertically inside the same grid cell. Add a small "AM" / "PM" or
"Session 1" / "Session 2" indicator.

---

## GROUP 7: RECOVERY STATUS STRIP

File: src/components/planner/RecoveryStrip.tsx

Create a thin horizontal bar showing recovery status across the week:

```tsx
interface RecoveryStripProps {
  cells: WeekdayCell[];
}

export function RecoveryStrip({ cells }: RecoveryStripProps) {
  return (
    <div className="px-4 pb-3">
      <div className="grid grid-cols-7 gap-2 h-1.5">
        {cells.map(cell => {
          let bg = 'bg-gray-100'; // rest day
          if (!cell.isRestDay) {
            if (cell.recoveryFromPrevTraining === null) bg = 'bg-teal-400'; // first
            else if (cell.recoveryFromPrevTraining >= 48) bg = 'bg-teal-400';
            else if (cell.recoveryFromPrevTraining >= 24) bg = 'bg-amber-400';
            else bg = 'bg-red-400';
          }
          return <div key={cell.weekday} className={`rounded-full ${bg}`} />;
        })}
      </div>
    </div>
  );
}
```

Show this strip between the weekday headers and the day cards grid,
only when calendar-mapped.

---

## GROUP 8: LOAD DISTRIBUTION — TIME-ACCURATE

File: src/components/planner/LoadDistribution.tsx

When `day_schedule` is populated, change the chart from
"one bar per training slot" to "7 columns for Mon-Sun":

### Current behavior (abstract mode)
X-axis labels = day labels ("Training 1", "Training 2")
Bars packed together, no gaps

### New behavior (calendar-mapped mode)
X-axis labels = Mon, Tue, Wed, Thu, Fri, Sat, Sun (all 7)
Training days get bars, rest days show nothing (empty column)
This creates visual gaps that represent actual rest periods

### Implementation
```typescript
const isCalendarMapped = schedule && Object.keys(schedule).length > 0;

const chartData = isCalendarMapped
  ? buildCalendarChartData(plannedExercises, schedule, activeDays, dayLabels)
  : buildAbstractChartData(plannedExercises, activeDays, dayLabels, dayDisplayOrder);

function buildCalendarChartData(...) {
  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return DAYS.map((name, wd) => {
    // Find which slot(s) are assigned to this weekday
    const slots = Object.entries(schedule)
      .filter(([_, w]) => w === wd)
      .map(([slot]) => parseInt(slot));
    
    if (slots.length === 0) {
      return { day: name, dayIndex: -1, load: 0, reps: 0, stress: 0, isRest: true };
    }
    
    // Aggregate data from all slots assigned to this weekday
    let totalLoad = 0, totalReps = 0, totalStress = 0;
    slots.forEach(slotIndex => {
      const exs = plannedExercises[slotIndex] || [];
      // ... calculate same as current code
    });
    
    return { day: name, dayIndex: slots[0], load: totalLoad, reps: totalReps, stress: totalStress, isRest: false };
  });
}
```

In the Recharts bar chart, rest days render as empty columns (data value 0).
Color the bars by intensity: high intensity = coral/red, medium = blue,
low/technique = teal/green.

---

## GROUP 9: WEEKLY STRESS CURVE (OPTIONAL OVERLAY)

File: src/components/planner/LoadDistribution.tsx

Add an optional toggle: "Show stress curve"

When enabled, overlay a smoothed line on the load distribution chart
showing accumulated training stress across the week.

Simple model:
```typescript
function calculateStressCurve(chartData: DayData[]): number[] {
  // Stress accumulates on training days, decays on rest days
  const DECAY_RATE = 0.35;  // 35% recovery per rest day
  
  let stress = 0;
  return chartData.map(d => {
    if (d.isRest) {
      stress *= (1 - DECAY_RATE);
    } else {
      stress += d.stress;
    }
    return Math.round(stress);
  });
}
```

Render as a smooth line on a secondary Y axis (using Recharts Line
inside a ComposedChart). Color: semi-transparent coral/red.

This shows the coach:
- Where fatigue peaks during the week
- Whether rest days provide enough recovery
- If the week structure creates an overreaching pattern

---

## GROUP 10: PLANNER CONTROL PANEL INTEGRATION

File: src/components/planner/PlannerControlPanel.tsx

Add a small indicator showing the schedule mode:

When calendar-mapped:
```
Mon 15:30 · Wed 09:00 · Fri 15:30 · Sat 15:30    [avg 39h rest]
```

If times are set, show them. If not, show just the weekday:
```
Mon · Wed · Fri · Sat    [48h · 48h · 24h avg rest]
```

Show as a subtle text line in the control panel, near the week dates.
This gives the coach a quick overview without opening day config.

When abstract (unassigned): show nothing extra.

---

## GROUP 11: COPY WEEK — PRESERVE ASSIGNMENTS

File: src/components/planner/CopyWeekModal.tsx
File: src/hooks/useWeekPlans.ts

When copying a week, also copy `day_schedule`. The pasted week
should inherit the same day-to-weekday assignments.

---

## GROUP 12: PRINT — SHOW WEEKDAY IN COMPACT MODE

File: src/components/planner/PrintWeekCompact.tsx

When calendar-mapped, the day headers should show the assigned weekday and time:

```
─── Training 1 (Monday 15:30) ───────────── WH  MHG  BW ───
```

If no time set, just the weekday:
```
─── Training 1 (Monday) ────────────────── WH  MHG  BW ───
```

Instead of just:
```
─── Training 1 ──────────────────────── WH  MHG  BW ───
```

Also, in the Programme print mode (PrintWeek.tsx), add the weekday
if assigned.

---

## GROUP 13: TESTING

Open Chrome and test:

### Abstract mode (default — no change)
1. Open planner for an athlete without weekday assignments
2. Verify day cards render exactly as before (no regression)
3. Load distribution chart unchanged
4. No rest badges visible
5. No recovery strip

### Assign weekdays
6. Open Day Config (gear icon)
7. Each day slot now has a weekday dropdown (default: Unassigned)
8. Assign: Day 1→Mon, Day 2→Wed, Day 3→Fri, Day 4→Sat
9. Save

### Calendar-mapped view
10. Week view switches to 7-column grid
11. Mon, Wed, Fri, Sat show training cards
12. Tue, Thu, Sun show "rest" placeholders
13. Cards show rest badges: first, 48h, 48h, 24h

### Rest validation
14. Change Day 4 from Sat to Fri (same as Day 3)
15. Time inputs become REQUIRED — red border appears on both
16. Set Day 3 time to "09:00", Day 4 time to "15:30"
17. Save — both appear stacked in Friday column
18. Day 3 shows no rest badge (first of the day)
19. Day 4 shows "7h rest" badge (purple — same-day split)
20. The time "09:00" and "15:30" labels appear above each stacked card

### Time edge cases
21. Assign two slots to same weekday with same time → error, can't save
22. Assign two slots to same weekday, no times set → error "Time required"
23. Set Day 1 to Mon 15:30, Day 2 to Tue 09:00 → "18h rest" (amber)
24. Set Day 1 to Mon 09:00, Day 2 to Wed 09:00 → "48h rest" (green)
25. Remove all times (set weekday only, no time) → defaults to noon for calculation

### Load distribution
18. Toggle load distribution chart on
19. Chart shows 7 columns (Mon-Sun) with gaps for rest days
20. Training days have bars, rest days are empty
21. If stress curve toggle exists, enable it and verify line

### Recovery strip
22. Thin colored strip visible below weekday headers
23. Green for 48h+ transitions, amber for 24h, red for same-day

### Print
24. Open print → Compact mode
25. Day headers show "(Monday)", "(Wednesday)" etc.

### Copy week
26. Copy current week → navigate to next week → paste
27. Pasted week has same weekday assignments

### Edge cases
28. Remove all weekday assignments → view reverts to abstract mode
29. Have only 2 of 4 days assigned → assigned days show on calendar,
    unassigned days appear in a separate "unscheduled" section below
30. No console errors throughout

Fix any issues found during testing.

---

## GROUP 14: CHART VISUAL QA — FULL APP SWEEP

Open Chrome at http://localhost:5173. Navigate to every page that
contains a chart or graph. For EACH chart, take a screenshot and
inspect for these issues. Fix every problem you find.

### What to check on every chart

1. **Text overlap** — axis labels overlapping each other, overlapping
   bars, overlapping the chart boundary. Common on X-axis when labels
   are long (day names, exercise names, week labels).
2. **Text clipping** — labels cut off by the chart container. Check
   Y-axis labels (are numbers fully visible?), X-axis labels (are
   they cut off at the bottom?), legend text.
3. **Label readability** — text too small to read (< 10px), text
   same color as background, text on colored bars without contrast.
4. **Axis scaling** — Y-axis not starting at a sensible value (e.g.,
   starting at 0 when all values are 80-100, wasting 80% of the chart
   height). Set min value to leave ~20% padding below lowest data point.
5. **Bar/line proportions** — bars too thin or too wide for the data,
   lines too thick, point markers too large or too small.
6. **Tooltip positioning** — hover tooltips going off-screen or
   overlapping the cursor. Test on leftmost, rightmost, and center bars.
7. **Responsive sizing** — resize the browser window to 1024px, 1280px,
   and 1600px width. Charts should resize without breaking layout.
8. **Empty data** — what happens when there's no data? Chart should
   show a clean empty state, not a broken axis or NaN labels.
9. **Legend** — if chart has a legend, verify it doesn't overlap the
   chart area, labels are complete (not truncated), and colors match.
10. **Color contrast** — all bar/line colors distinguishable from each
    other AND from the background in both light theme.

### Charts to inspect

**Weekly Planner — Load Distribution**
- Navigate to planner, select athlete with data, toggle Charts on
- Check: X-axis day labels readable, Y-axis load values not clipped,
  bars have reasonable width, tooltip works on hover
- In calendar-mapped mode: verify rest-day gaps render correctly,
  bar labels don't overlap into empty columns

**Weekly Planner — Stress Curve (if implemented)**
- Check: line doesn't clip at edges, secondary Y-axis labels visible,
  line color distinguishable from bars

**Analysis — Pivot Builder**
- Navigate to Analysis, select athlete, set up a chart
- Test with: X=Week, Primary=Tonnage, Overlay=Bodyweight
- Check: dual Y-axes don't overlap, overlay line visible against bars,
  axis titles readable
- Test with X=Day (more data points) — labels should not overlap

**Analysis — Planned vs Performed**
- Open the preset
- Check: grouped bars (planned ghost + performed solid) don't overlap,
  compliance % line on secondary axis readable, bar colors correct
  (green/blue/amber/red by compliance)
- Check the weekly breakdown table below: compliance bars render
  inside their cells, percentage text doesn't overflow

**Analysis — Intensity Zones**
- Open the preset
- Check: stacked bars have distinguishable colors, zone labels in
  legend are complete, Y-axis shows reasonable scale
- Check: stacked segments don't have gaps between them

**Analysis — Lift Ratios**
- Open the tab
- Check: ratio bars render within their container, percentage labels
  don't overflow, target range text is readable
- Trend line chart below: axis labels visible, line not clipped

**Analysis — Competition Lift Trends**
- Check: multi-line chart has distinguishable line colors, data point
  markers visible, macro phase background bands don't obscure data

**Analysis — Volume Distribution**
- Check: stacked bars by category have distinct colors, legend matches

**Analysis — PR Timeline**
- Check: markers don't overlap when PRs are close together,
  exercise name labels readable, date axis properly spaced

**Analysis — Bodyweight Trend**
- Check: moving average line smooth, weight class boundary lines
  visible but subtle, scatter points don't obscure the line

**Analysis — Training Patterns**
- Check: heatmap or bar chart renders cleanly, weekday labels visible

**Analysis — Readiness vs Performance**
- Check: scatter points have reasonable size, axis labels visible,
  trendline doesn't extend past data range

**Macro Cycles — Charts**
- Navigate to Macro Cycles, open a macrocycle
- Check any graph/chart views: phase bars, week type indicators,
  draggable chart handles all render correctly
- Axis labels for week numbers don't overlap

**Dashboard — Sparklines (if implemented)**
- Check: mini charts render within their cells, don't overflow

### Fixes to apply

For each issue found:
- **Overlapping X-axis labels**: add `angle: -45` and `textAnchor: 'end'`
  to XAxis tick props, or use `interval: 0` with `tick={{ fontSize: 10 }}`
- **Clipped labels**: add `padding={{ left: 10, right: 10 }}` to chart,
  or increase container height/margin
- **Bad Y-axis range**: set `domain={[dataMin => Math.floor(dataMin * 0.8), 'auto']}`
  or explicit `[min, max]` with padding
- **Tooltip off-screen**: add `wrapperStyle={{ zIndex: 100 }}` and
  use `position={{ x: ..., y: ... }}` if needed
- **Bars too thin**: adjust `barSize` or `barCategoryGap` in Recharts
- **Empty state**: wrap chart in conditional: if no data, show
  "No data for this period" message instead of empty chart

After fixing, re-check each chart to confirm the fix didn't break
anything else. Commit as "Chart visual QA fixes".
