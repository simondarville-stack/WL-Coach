# EMOS — PROMPT 5D: WIRE EVENTS TO MacroPhaseBar

Populate the MacroPhaseBar's event dots from the `events` table. Events
already exist (created via the CompetitionCalendar), and the bar
component already has rendering for them (dot in the top-right corner,
event names in the tooltip) — we just need to fetch and pass the data.

**Scope: data layer + two integrations only.** The MacroPhaseBar
component does not change.

**Data model recap:**
- `events` table: `id, name, event_date, end_date, event_type, color`
- `event_athletes` join: `event_id ↔ athlete_id`
- Groups do NOT link to events directly — athlete membership in a
  group is expanded at event creation time in the UI
- If `end_date` is null or equals `event_date` → point event
- Otherwise → range event (may span multiple weeks)

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with the message at the bottom.

---

## STEP 1: ADD HELPERS TO `macroPhaseBarData.ts`

Edit `src/lib/macroPhaseBarData.ts`. Add the following at the bottom.

```ts
import { supabase } from './supabase';
import { getMondayOfWeekISO } from './weekUtils';
import type { Event } from './database.types';
import type { MacroPhaseBarEvent } from '../components/planning/MacroPhaseBar';

/**
 * Day-of-week index for our bar: Monday = 0, Sunday = 6.
 * JS getDay() returns Sunday = 0, Monday = 1, etc.
 */
function dayIndexFromDate(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  return (d.getDay() + 6) % 7;
}

/**
 * Convert a raw event row to the MacroPhaseBarEvent shape.
 * Point vs range is inferred from whether end_date is set and differs
 * from event_date.
 */
export function convertEventToPhaseBarEvent(
  event: Pick<Event, 'id' | 'name' | 'event_date' | 'end_date'>
): MacroPhaseBarEvent {
  const startMonday = getMondayOfWeekISO(new Date(event.event_date + 'T00:00:00'));
  const startDay = dayIndexFromDate(event.event_date);

  if (!event.end_date || event.end_date === event.event_date) {
    return {
      id: event.id,
      kind: 'point',
      weekStart: startMonday,
      day: startDay,
      title: event.name,
    };
  }

  const endMonday = getMondayOfWeekISO(new Date(event.end_date + 'T00:00:00'));
  const endDay = dayIndexFromDate(event.end_date);

  return {
    id: event.id,
    kind: 'range',
    startWeekStart: startMonday,
    startDay,
    endWeekStart: endMonday,
    endDay,
    title: event.name,
  };
}

/**
 * Resolve athlete IDs given either an athlete or group. Returns []
 * if neither is given. For groups, returns all currently-active member
 * ids (left_at is null).
 */
export async function resolveScopeAthleteIds(
  athleteId: string | null,
  groupId: string | null
): Promise<string[]> {
  if (athleteId) return [athleteId];
  if (groupId) {
    const { data: members } = await supabase
      .from('group_members')
      .select('athlete_id')
      .eq('group_id', groupId)
      .is('left_at', null);
    return (members || []).map((m: { athlete_id: string }) => m.athlete_id);
  }
  return [];
}

/**
 * Fetch all events attached to the given athlete IDs that overlap
 * the given date range (inclusive). Returns already-converted
 * MacroPhaseBarEvent objects, deduplicated by id.
 *
 * An event is considered to overlap the range [rangeStart, rangeEnd] if
 * its start ≤ rangeEnd AND its end ≥ rangeStart, where end defaults
 * to event_date when end_date is null.
 */
export async function fetchMacroPhaseBarEvents(
  athleteIds: string[],
  rangeStart: string,
  rangeEnd: string
): Promise<MacroPhaseBarEvent[]> {
  if (athleteIds.length === 0) return [];

  const { data: ea } = await supabase
    .from('event_athletes')
    .select('event_id')
    .in('athlete_id', athleteIds);

  const eventIds = [...new Set((ea || []).map((e: { event_id: string }) => e.event_id))];
  if (eventIds.length === 0) return [];

  const { data: events } = await supabase
    .from('events')
    .select('id, name, event_date, end_date, event_type, color')
    .in('id', eventIds)
    .order('event_date', { ascending: true });

  return (events || [])
    .filter((ev: Pick<Event, 'event_date' | 'end_date'>) => {
      const start = ev.event_date;
      const end = ev.end_date || ev.event_date;
      return start <= rangeEnd && end >= rangeStart;
    })
    .map((ev: Event) => convertEventToPhaseBarEvent(ev));
}
```

Run `npm run build`.

---

## STEP 2: WIRE EVENTS IN PlannerWeekOverview

Edit `src/components/planner/PlannerWeekOverview.tsx`.

### 2.1 Add events state

Alongside the other raw data state, add:
```tsx
const [barEvents, setBarEvents] = useState<import('../planning').MacroPhaseBarEvent[]>([]);
```

And reset it in the empty branch alongside the other resets:
```tsx
setBarEvents([]);
```

### 2.2 Fetch events at the end of loadData

Import the helpers at the top:
```tsx
import {
  buildCellsForWeekRange,
  fetchMacroPhaseBarEvents,
  resolveScopeAthleteIds,
} from '../../lib/macroPhaseBarData';
```

At the end of the `loadData` effect's try block (after setting
`weekTypeConfigs`), add:
```tsx
// Load events for the visible range
const rangeStart = weekDates[0];
const rangeEnd = addDays(weekDates[weekDates.length - 1], 6);
const scopeAthleteIds = await resolveScopeAthleteIds(targetId, targetGroupId);
const fetched = await fetchMacroPhaseBarEvents(scopeAthleteIds, rangeStart, rangeEnd);
setBarEvents(fetched);
```

The `addDays` function already exists in the file (used for week end
dates). `weekDates` is the array of week_start strings built at the top
of the effect.

### 2.3 Pass events to the bar

Find the `<MacroPhaseBar>` render site. Change:
```tsx
<MacroPhaseBar
  cells={phaseBarCells}
  events={[]}
  selectedWeekStart={today}
  onCellClick={(cell) => onSelectWeek(cell.weekStart)}
/>
```

To:
```tsx
<MacroPhaseBar
  cells={phaseBarCells}
  events={barEvents}
  selectedWeekStart={today}
  onCellClick={(cell) => onSelectWeek(cell.weekStart)}
/>
```

Run `npm run build`.

---

## STEP 3: WIRE EVENTS IN PlannerControlPanel

Edit `src/components/planner/PlannerControlPanel.tsx`.

### 3.1 Add imports

The file already imports from `../../lib/macroPhaseBarData` for
`buildCellsForSingleMacro`. Extend that import:

```tsx
import {
  buildCellsForSingleMacro,
  fetchMacroPhaseBarEvents,
} from '../../lib/macroPhaseBarData';
```

### 3.2 Add events state

Alongside the other state (`macroWeeks`, `phases`, etc.), add:
```tsx
const [fetchedEvents, setFetchedEvents] = useState<MacroPhaseBarEvent[]>([]);
```

Note: the panel already has a `macroEvents` prop (plumbed in as empty
in 5c). Keep it — the prop is now a secondary source that gets merged
with the fetched events. We use the prop as a fallback/extension
point; fetched events take priority. If you want simpler behavior,
just ignore the prop and use the fetched array. For this prompt: only
use the fetched events; remove the `macroEvents` prop wiring. If the
prop is still declared in the interface, keep it declared but don't
use it.

### 3.3 Fetch events

Add an effect that depends on the current athlete + macro range:

```tsx
useEffect(() => {
  if (!selectedAthlete || macroWeeks.length === 0) {
    setFetchedEvents([]);
    return;
  }
  const rangeStart = macroWeeks[0].week_start;
  const lastWeek = macroWeeks[macroWeeks.length - 1];
  // end date = last week's Monday + 6 days
  const lastMonday = new Date(lastWeek.week_start + 'T00:00:00');
  lastMonday.setDate(lastMonday.getDate() + 6);
  const rangeEnd = lastMonday.toISOString().split('T')[0];

  void fetchMacroPhaseBarEvents([selectedAthlete.id], rangeStart, rangeEnd)
    .then(setFetchedEvents);
}, [selectedAthlete?.id, macroWeeks]);
```

### 3.4 Pass events to the bar

Find the `<MacroPhaseBar>` render site. Change:
```tsx
<MacroPhaseBar
  cells={phaseBarCells}
  events={macroEvents}
  selectedWeekStart={phaseBarSelectedWeekStart}
  onCellClick={() => navigate('/macrocycles')}
/>
```

To:
```tsx
<MacroPhaseBar
  cells={phaseBarCells}
  events={fetchedEvents}
  selectedWeekStart={phaseBarSelectedWeekStart}
  onCellClick={() => navigate('/macrocycles')}
/>
```

Run `npm run build`.

---

## STEP 4: VERIFY WITH REAL DATA

**Precondition:** Make sure at least one event exists in the
CompetitionCalendar that is attached to the athlete you're viewing and
that falls within the date range of one of their macros. If no such
event exists, create one for testing (e.g. a competition next month, a
training camp spanning two weeks).

**Overview (`/planner` default):**
1. ✅ Event dots appear on weeks that contain events (top-right of cell)
2. ✅ Hover a cell with events — tooltip shows the event name(s) as
   bulleted lines
3. ✅ A multi-week event (training camp) shows dots on all weeks it
   overlaps
4. ✅ Events outside the visible range do NOT cause dots

**Weekly planner detail (`/planner` with a week selected):**
1. ✅ Event dots appear on cells within the current macro that overlap
   any event
2. ✅ Hovering reveals event names
3. ✅ Events outside the current macro do NOT cause dots on that macro's cells

**Group view (if applicable):**
1. ✅ Select a group in the overview
2. ✅ Event dots appear for events attached to ANY member of the group
3. ✅ Event dots disappear when switching back to a single athlete (and
   reappear/disappear based on that athlete's events)

---

## STEP 5: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "feat(planning): wire events from calendar to MacroPhaseBar

Events created in the CompetitionCalendar now populate the event dot
indicators on the MacroPhaseBar in both the planner overview and the
weekly planner detail view.

New helpers in src/lib/macroPhaseBarData.ts:
- convertEventToPhaseBarEvent: transforms a raw Event row into the
  MacroPhaseBarEvent shape (point vs range inferred from end_date)
- resolveScopeAthleteIds: returns the athlete IDs for the active
  planner scope (single athlete or all active members of a group)
- fetchMacroPhaseBarEvents: queries event_athletes + events, filters
  to the given date range, returns already-converted MacroPhaseBar
  events deduplicated by id

PlannerWeekOverview fetches events for the full visible week range
scoped to the selected athlete or group members.

PlannerControlPanel fetches events for the current macro's date range
scoped to the selected athlete.

The MacroPhaseBar component itself is unchanged — it was already
rendering event dots from the events prop."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ `convertEventToPhaseBarEvent` added to `macroPhaseBarData.ts`
3. ✅ `resolveScopeAthleteIds` added to `macroPhaseBarData.ts`
4. ✅ `fetchMacroPhaseBarEvents` added to `macroPhaseBarData.ts`
5. ✅ `PlannerWeekOverview` fetches and passes events
6. ✅ `PlannerControlPanel` fetches and passes events
7. ✅ Event dots visible on weeks with events
8. ✅ Hover shows event names in tooltip
9. ✅ Multi-week events produce dots on all overlapping weeks
10. ✅ Group view works (dots reflect group members' events)
11. ✅ No console errors
12. ✅ Committed and pushed

---

## KNOWN LIMITATIONS

- **Single dot per cell regardless of event count.** If a week contains
  3 events, there's still one dot. The tooltip reveals all of them.
  This matches the prototype decision ("dot is binary, information in
  tooltip"). If you later want a count badge or differently-sized dot,
  that's a component-level change.
- **No event-type differentiation.** All event types render as the same
  white dot. Competition vs training camp vs vacation are indistinct
  in the bar — only the tooltip shows them. If you want competitions
  to be red or camps to be outlined, that's a component extension.
- **No click-through on the event dots.** Clicking a cell still just
  jumps to that week. Clicking "on the dot" (which is inside the cell)
  does the same thing. Dedicated event click handling is a future
  enhancement.

---

## NEXT STEPS

- **5e** — slot-to-weekday mapping fix in `PlannerWeekOverview` so day
  cards render in their assigned weekday columns and stack when
  multiple sessions fall on the same day
- **5f** — migrate `DayCard.tsx` (addresses the too-narrow day cards
  you flagged in the week rows)
- **5g** — settings UI for custom week-type abbreviations (already
  partially covered — the component reads from settings, but dedicated
  edit UI is still pending)
