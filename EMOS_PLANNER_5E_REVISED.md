# EMOS — PROMPT 5E: SUB-ROUTES FOR PLANNER AND MACRO PAGES

Replace the current state-based view switching in `WeeklyPlanner` and
`MacroCycles` with URL-driven sub-routes. URL becomes the source of
truth for which week / which macro is in view.

**Why this matters now:**
- The phase bar's navigation contract becomes trivial:
  - Cell click → `navigate(\`/planner/${weekStart}\`)`
  - Phase click → `navigate(\`/macrocycles/${cycleId}?phase=${phaseId}\`)`
- Browser back/forward works naturally
- Coaches can bookmark / share URLs to specific weeks or macros
- Removes the latent bug where `useState` initializers ignore later
  navigation `state` changes
- Sets up the bar unification (next prompt) on solid ground

**Scope: route refactor only.** No visual changes to the planner or
macro pages. The existing inline timeline on the macro page stays as-is
for now — it gets replaced in the next prompt.

**Out of scope:** athlete/group context in the URL. Those stay in the
Zustand store; URL only carries the week / macro identifier. Two
coaches sharing one device still see the URL reflect the active
selection without needing to encode it.

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with the message at the bottom.

---

## ROUTE DESIGN

```
/planner                       → Weekly planner overview (week list)
/planner/:weekStart            → Weekly planner detail for that week
                                 (weekStart is YYYY-MM-DD, must be a Monday)

/macrocycles                   → Macro annual wheel (entry / picker)
/macrocycles/:cycleId          → That macro cycle's detail page
/macrocycles/:cycleId?phase=X  → Same, scrolled to phase X on mount
```

Both `/planner` and `/macrocycles` remain top-level entry routes (no
404 changes). Sub-routes are added.

---

## STEP 1: REGISTER SUB-ROUTES

Edit `src/App.tsx`. In the `<Routes>` block, add the sub-routes
alongside the existing ones:

```tsx
<Route path="/planner" element={<WeeklyPlanner />} />
<Route path="/planner/:weekStart" element={<WeeklyPlanner />} />
<Route path="/macrocycles" element={<MacroCycles />} />
<Route path="/macrocycles/:cycleId" element={<MacroCycles />} />
```

Keep the order so React Router matches the more-specific route first.

Run `npm run build`.

---

## STEP 2: REFACTOR `WeeklyPlanner` TO USE URL PARAM

Edit `src/components/planner/WeeklyPlanner.tsx`.

### 2.1 Replace `useLocation` with `useParams`

Find the imports:
```tsx
import { useLocation } from 'react-router-dom';
```

Replace with:
```tsx
import { useParams, useNavigate } from 'react-router-dom';
```

(`useNavigate` is already used elsewhere in the planner subtree; if
the import is already present, just add `useParams`.)

### 2.2 Read the URL param

Find the lines:
```tsx
const location = useLocation();
const locationState = (location.state as { weekStart?: string; groupId?: string } | null);
const initialWeekStart = locationState?.weekStart ?? null;
const initialGroupId = locationState?.groupId ?? null;
```

Replace with:
```tsx
const { weekStart: urlWeekStart } = useParams<{ weekStart?: string }>();
const navigate = useNavigate();
```

The `groupId` plumbing was undocumented and only used by the dashboard
"open group plan" entry. We'll move group selection to `useAthleteStore`
in the dashboard handler (Step 5). Drop `initialGroupId` from this file.

### 2.3 Bind `selectedDate` and `showWeekList` to the URL

Replace the `selectedDate` initializer:
```tsx
const [selectedDate, setSelectedDate] = useState(() => {
  if (initialWeekStart) return initialWeekStart;
  return getMondayOfWeek(new Date());
});
```

With:
```tsx
const [selectedDate, setSelectedDate] = useState(() => {
  if (urlWeekStart) return urlWeekStart;
  return getMondayOfWeek(new Date());
});
```

Replace the `showWeekList` initializer:
```tsx
const [showWeekList, setShowWeekList] = useState(() => {
  return !initialWeekStart;
});
```

With:
```tsx
const [showWeekList, setShowWeekList] = useState(() => {
  return !urlWeekStart;
});
```

### 2.4 Add an effect to react to URL changes after mount

Right after the `useState` declarations for `selectedDate` and
`showWeekList`, add:

```tsx
// Keep internal view in sync with URL on subsequent navigations.
// useState initializers only run once; this effect handles the
// case where the user navigates from /planner → /planner/2026-04-13
// while the planner is already mounted.
useEffect(() => {
  if (urlWeekStart) {
    setSelectedDate(urlWeekStart);
    setShowWeekList(false);
  } else {
    setShowWeekList(true);
  }
}, [urlWeekStart]);
```

### 2.5 Drive navigation from internal transitions

Currently the planner flips between overview and detail via
`setShowWeekList(true | false)`. After this refactor, those state
transitions should also push a URL change so that browser back/forward
work and the URL reflects the current view.

Find the overview's `onSelectWeek` callback (around line 624):
```tsx
onSelectWeek={(weekStart) => {
  setSelectedDate(weekStart);
  setShowWeekList(false);
}}
```

Replace with:
```tsx
onSelectWeek={(weekStart) => {
  navigate(`/planner/${weekStart}`);
}}
```

The effect we added in 2.4 will fire when the URL changes, syncing
`selectedDate` and `showWeekList`. Don't `setSelectedDate` /
`setShowWeekList` directly — let the URL be the source of truth.

Find the "Back to overview" button (around line 638):
```tsx
<button
  onClick={() => setShowWeekList(true)}
  ...
```

Replace with:
```tsx
<button
  onClick={() => navigate('/planner')}
  ...
```

### 2.6 When the week navigates within the detail view

Find any place that calls `setSelectedDate` for week navigation
(e.g. `goToPreviousWeek`, `goToNextWeek`, "Today" handlers). These
need to update the URL too. Look around the `goToPreviousWeek` /
`goToNextWeek` definitions in the file.

For each of these, change `setSelectedDate(newDate)` to
`navigate(\`/planner/${newDate}\`)`. The effect in 2.4 will pick up
the URL change and update internal state.

If the `setSelectedDate` is called inside an effect that responds to
*other* state (e.g. selecting an athlete with no plan for the current
week), leave those alone — they're internal corrections, not user
navigations.

To keep the diff focused: only convert the calls that are wired to
explicit user actions (button clicks, week-prev/next, today).

### 2.7 Reset when the URL is cleared

The existing reset `useEffect` (around line 184):
```tsx
setPanelView('overview');
setSelectedDayIndex(null);
setSelectedExerciseId(null);
```

stays unchanged. It runs on `[selectedDate, planSelection]`, which now
depends on URL via the effect in 2.4. This implicitly resets the panel
when the URL changes weeks.

Run `npm run build`.

---

## STEP 3: REFACTOR `MacroCycles` TO USE URL PARAM

Edit `src/components/macro/MacroCycles.tsx`.

### 3.1 Add imports

At the top, add (or extend if already present):
```tsx
import { useParams, useNavigate } from 'react-router-dom';
```

### 3.2 Read the URL param

Inside the `MacroCycles` function, near the other state hooks, add:
```tsx
const { cycleId: urlCycleId } = useParams<{ cycleId?: string }>();
const navigate = useNavigate();
```

### 3.3 Bind `selectedCycle` to the URL

Currently:
```tsx
const [selectedCycle, setSelectedCycle] = useState<MacroCycle | null>(null);
```

Add an effect that syncs URL → selectedCycle:

```tsx
// Sync the URL cycleId param to selectedCycle. When the URL changes
// (entering /macrocycles/:cycleId or going back to /macrocycles),
// update internal state.
useEffect(() => {
  if (!urlCycleId) {
    setSelectedCycle(null);
    return;
  }
  const cycle = macrocycles.find(c => c.id === urlCycleId);
  if (cycle) {
    setSelectedCycle(cycle);
  }
  // If cycle isn't loaded yet (initial mount before macros fetch
  // resolves), the dependency on `macrocycles` re-runs this when
  // they arrive.
}, [urlCycleId, macrocycles]);
```

### 3.4 Drive navigation from internal transitions

Find the `onSelectCycle` callback in the `<MacroAnnualWheel>` render
(around line 942):
```tsx
onSelectCycle={(cycle) => setSelectedCycle(cycle)}
```

Replace with:
```tsx
onSelectCycle={(cycle) => navigate(`/macrocycles/${cycle.id}`)}
```

Find any "back to wheel" button or handler (search for places where
`setSelectedCycle(null)` is called). For each user-initiated transition
back to the wheel, replace with `navigate('/macrocycles')`.

If `setSelectedCycle(null)` is used after deletion (around line 161),
that's a side effect of mutation — keep `setSelectedCycle(null)` and
add `navigate('/macrocycles')` after it so URL also updates.

### 3.5 Defer the bar/timeline work

The `?phase=` query param handling and the inline-timeline replacement
are scope for the next prompt (5f, the bar unification). Do NOT touch
the inline timeline in this prompt.

Run `npm run build`.

---

## STEP 4: UPDATE `App.tsx` DASHBOARD HANDLERS

Edit `src/App.tsx`.

### 4.1 Convert `state`-based navigations to URL-based

Find:
```tsx
const handleNavigateToPlanner = (athlete: Athlete, weekStart: string) => {
  setSelectedAthlete(athlete);
  navigate('/planner', { state: { weekStart } });
};

const handleNavigateToGroupPlanner = (group: TrainingGroup, weekStart: string) => {
  navigate('/planner', { state: { weekStart, groupId: group.id } });
};
```

Replace with:
```tsx
const handleNavigateToPlanner = (athlete: Athlete, weekStart: string) => {
  setSelectedAthlete(athlete);
  navigate(`/planner/${weekStart}`);
};

const handleNavigateToGroupPlanner = (group: TrainingGroup, weekStart: string) => {
  setSelectedGroup(group);
  navigate(`/planner/${weekStart}`);
};
```

The group handler now writes the group selection to the store directly,
matching how the athlete handler already writes `setSelectedAthlete`.
This removes the `groupId` `state` plumbing that WeeklyPlanner was
reading off `location.state`.

If `setSelectedGroup` isn't currently destructured from
`useAthleteStore` in `AppRouter`, add it:
```tsx
const { setSelectedAthlete, setSelectedGroup } = useAthleteStore();
```

Run `npm run build`.

---

## STEP 5: VERIFY

### Direct URL navigation
1. ✅ `/planner` → shows the week overview
2. ✅ `/planner/2026-04-13` → shows the weekly planner detail for that week
3. ✅ `/macrocycles` → shows the annual wheel
4. ✅ `/macrocycles/<some-cycle-id>` → shows that cycle's detail page
5. ✅ Reloading any of the above URLs preserves the view

### Internal transitions
1. ✅ On overview, clicking a week → URL becomes `/planner/<weekStart>`
2. ✅ "Back to overview" button → URL becomes `/planner`
3. ✅ Prev/next week buttons → URL updates with new week
4. ✅ "Today" → URL becomes `/planner/<this Monday>`
5. ✅ On macro wheel, clicking a cycle → URL becomes `/macrocycles/<id>`
6. ✅ Going back from a cycle to the wheel → URL becomes `/macrocycles`

### Browser navigation
1. ✅ After navigating overview → week → another week, browser **Back**
   returns through them in reverse
2. ✅ Forward button works
3. ✅ Bookmarking `/planner/2026-04-13` and reopening loads that week
4. ✅ Bookmarking `/macrocycles/<id>` and reopening loads that cycle

### Cross-app navigation
1. ✅ Dashboard "open this week's plan" → lands directly on the
   detail view for that week (no overview flash)
2. ✅ Dashboard "open this group's plan" → lands directly on the
   group's planner for the relevant week
3. ✅ The athlete/group store is set so the planner shows the right
   athlete/group on arrival

### No regressions
1. ✅ The phase bar still works on both surfaces (uses internal
   handlers; we'll switch them to URL-based in 5f)
2. ✅ Athlete selection via the sidebar still works
3. ✅ Settings save still works
4. ✅ Day editor / exercise editor open and close as before

---

## STEP 6: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "refactor(routing): URL-driven sub-routes for planner and macrocycles

Replaces state-based view switching in WeeklyPlanner and MacroCycles
with URL params:

- /planner            → week overview
- /planner/:weekStart → weekly planner detail
- /macrocycles        → annual wheel
- /macrocycles/:cycleId → macro cycle detail

WeeklyPlanner now reads :weekStart from useParams and treats the URL
as the source of truth. Internal transitions (overview ↔ detail, week
prev/next, today) navigate to the corresponding URL; an effect syncs
URL changes back to internal state on subsequent visits.

MacroCycles binds selectedCycle to the URL the same way.

App.tsx dashboard navigation handlers updated to push URLs instead of
location state. The previously-undocumented groupId state plumbing is
replaced by writing the group selection to useAthleteStore directly.

Browser back/forward, bookmarking, and reload now all behave
correctly. Coaches can share URLs to specific weeks or macros.

The inline phase timeline on the macro page and the existing
MacroPhaseBar integrations are unchanged in this prompt — the bar
unification follows in 5f and will leverage the new URLs for cleaner
navigation handlers."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ Sub-routes registered in `App.tsx`
3. ✅ `WeeklyPlanner` reads `:weekStart` from `useParams`
4. ✅ `MacroCycles` reads `:cycleId` from `useParams`
5. ✅ URL changes after mount sync to internal state via effect
6. ✅ User-initiated transitions push URLs via `navigate(...)`
7. ✅ Dashboard handlers use URLs instead of `location.state`
8. ✅ Browser back/forward works as expected
9. ✅ Reloading a sub-route URL preserves the view
10. ✅ No console errors
11. ✅ Committed and pushed

---

## NEXT STEP

**5f — Bar unification.** Now that URLs are the navigation contract, the
unified MacroPhaseBar's click handlers become trivial:

- Cell click → `navigate(\`/planner/${weekStart}\`)`
- Phase click → `navigate(\`/macrocycles/${cycleId}?phase=${phaseId}\`)`

5f also replaces the inline timeline in MacroCycles with the shared
component, adds month-row + week-dates display modes, and adds the
`?phase=` query param handling for scroll-to-phase.
