# EMOS — WIRE PLANNER WEEK OVERVIEW AS ENTRY VIEW

A new component `PlannerWeekOverview.tsx` has been added to
`src/components/planner/`. It shows a multi-week overview with day
blocks, volume ribbon, and stats — the entry point to the weekly
planner. Clicking a week row drills into the existing day-by-day
planner view.

NOTE: There is already a `WeekOverview` component in the planner
folder — that is the day cards grid for a SINGLE week. The new
`PlannerWeekOverview` is the MULTI-WEEK entry list view. Do NOT
confuse them.

Your job: wire it into WeeklyPlanner.tsx so the flow is:
1. No week actively being edited → PlannerWeekOverview (full page)
2. Click a week row → existing planner detail view for that week
3. Back button → returns to the multi-week overview

Do NOT modify PlannerWeekOverview.tsx.
Run `npm run build` after all edits. Commit.
Do not ask for confirmation.

---

## STEP 1: Import the component

At the top of `src/components/planner/WeeklyPlanner.tsx`, add:

```typescript
import { PlannerWeekOverview } from './PlannerWeekOverview';
import { ArrowLeft } from 'lucide-react';
```

(ArrowLeft may already be imported — check first.)

---

## STEP 2: Add overview mode state

Add a new state variable to control whether the overview is shown:

```typescript
const [showWeekList, setShowWeekList] = useState(() => {
  // If navigated here with a specific weekStart (e.g. from macro wheel),
  // go straight to detail view. Otherwise show the overview.
  return !initialWeekStart;
});
```

This means:
- Navigating to `/planner` normally → shows overview
- Navigating with `{ state: { weekStart: '2026-04-14' } }` from the
  macro annual wheel → skips overview, shows that week directly

---

## STEP 3: Restructure the return JSX

Currently the main return looks like:

```tsx
return (
  <div className="min-h-screen bg-slate-50 p-4 md:p-5">
    <div className="max-w-[1600px] mx-auto">
      {error && ...}
      {!planSelection.athlete && !planSelection.group ? (
        // "Select an athlete" placeholder
      ) : (
        <>
          <PlannerControlPanel ... />
          <LoadDistribution ... />
          <WeekOverview ... />
          {/* dialogs and modals */}
        </>
      )}
    </div>
  </div>
);
```

Restructure so that when `showWeekList` is true AND an athlete/group
is selected, the ENTIRE content area shows PlannerWeekOverview instead
of the control panel + day cards:

```tsx
return (
  <div className="min-h-screen bg-slate-50 p-4 md:p-5">
    <div className="max-w-[1600px] mx-auto">
      {error && ...}

      {!planSelection.athlete && !planSelection.group ? (
        // "Select an athlete" placeholder — KEEP AS IS
        <div className="bg-white rounded-lg ...">
          ...
        </div>
      ) : showWeekList ? (
        // ── OVERVIEW MODE ──
        <PlannerWeekOverview
          athlete={planSelection.athlete}
          group={planSelection.group}
          onSelectWeek={(weekStart) => {
            setSelectedDate(weekStart);
            setShowWeekList(false);
          }}
        />
      ) : (
        // ── DETAIL MODE (existing planner) ──
        <>
          {/* Back button + existing PlannerControlPanel */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setShowWeekList(true)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              title="Back to week overview"
            >
              <ArrowLeft size={14} />
            </button>
          </div>

          <PlannerControlPanel ... />
          {/* ... rest of existing detail view ... */}
          <LoadDistribution ... />
          <WeekOverview ... />
          {/* dialogs ... */}
        </>
      )}

      {/* Modals that should work from BOTH views */}
      {/* Keep modals OUTSIDE the showWeekList conditional */}
    </div>
  </div>
);
```

IMPORTANT: Make sure ALL modals (settings, print, etc.) are rendered
OUTSIDE the `showWeekList` conditional block so they still work when
triggered from the overview.

---

## STEP 4: Position the back button

The back button should appear ABOVE the PlannerControlPanel when in
detail mode. It's a simple `<ArrowLeft>` icon button that sets
`showWeekList(true)`.

Alternatively, you can ADD it as the FIRST element inside the existing
PlannerControlPanel div, before the week navigation arrows. Either
approach works — pick whichever is cleaner.

If adding inside PlannerControlPanel.tsx, add a new prop:
```typescript
onBackToOverview?: () => void;
```
And render a back arrow when the prop is provided.

---

## STEP 5: Handle athlete/group changes

When the athlete or group changes (via the top-right selector),
the overview should reset. Find the useEffect that responds to
athlete/group changes and add:

```typescript
setShowWeekList(true);
```

This ensures switching athletes always returns to the overview first,
so the coach sees the new athlete's week summary before drilling in.

---

## STEP 6: Verify navigation from macro wheel still works

The macro annual wheel (or other pages) can navigate to the planner
with:
```typescript
navigate('/planner', { state: { weekStart: '2026-04-14' } })
```

The `initialWeekStart` from `location.state` is already read in
WeeklyPlanner.tsx. Step 2 ensures that when `initialWeekStart` is
set, `showWeekList` defaults to false — skipping the overview and
going straight to that week's detail view.

Verify this works:
- Click a week in the macro wheel → navigate to planner → detail
  view shows that specific week, NOT the overview
- Click back arrow → overview appears

---

## STEP 7: Build and test

```bash
npm run build
```

Open Chrome, navigate to Weekly planner:

1. With an athlete selected, the multi-week overview appears
2. Volume ribbon at the top shows relative tonnage per week
3. Phase section labels appear where macro phases change
4. Current week is highlighted with blue background and "now" badge
5. Past weeks show solid day blocks with exercise color bars
6. Future weeks show dashed day blocks with faded exercise bars
7. Stats column shows reps, tonnage, avg, compliance bar + badge
8. Click any week row → detail planner view opens for that week
9. Back arrow (←) appears above/beside the control panel
10. Click back arrow → returns to multi-week overview
11. Switching athlete in top selector → overview resets
12. Week navigation (← →) in detail view still works normally
13. Navigating from macro annual wheel → goes straight to detail
14. Earlier/Later buttons in overview scroll the date range
15. "Today" button centers on current week
16. No console errors

Fix any issues found.
