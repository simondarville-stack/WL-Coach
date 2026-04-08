# EMOS 2.0 — FIX TRAINING SLOT vs CALENDAR DATE MODEL

## The problem

Training days in EMOS are ABSTRACT SLOTS, not calendar weekdays.
A coach writes "Training 1", "Training 2", "Training 3" — the athlete
might do Training 2 on Monday, Training 1 on Wednesday, and Training 3
on Friday. Or do two sessions on the same day. Or skip one entirely.

The planned_exercises table uses `day_index` as a slot number (1-7),
NOT as a weekday ordinal. The coach can label these anything via
`week_plans.day_labels`.

BUT multiple places in the code calculate a calendar date by doing:
```typescript
date = weekStart + (dayIndex - 1) days
```
This is WRONG. It assumes day_index 1 = Monday, 2 = Tuesday, etc.

## Where the bug exists

1. `src/hooks/useTrainingLog.ts` line 54:
   `selectedDate.setDate(selectedDate.getDate() + selectedDayIndex - 1)`
   Then queries session by `.eq('date', dateISO)` — won't find a session
   if the athlete logged it on a different calendar date.

2. `src/components/training-log/SessionView.tsx` line 178-181:
   Derives display date from `weekStart + dayIndex - 1`.

3. `src/components/training-log/SessionHistory.tsx` lines 90-92:
   Streak calculation uses `weekStart + day_index - 1` to compute gaps.

4. `src/components/AthleteLog.tsx` lines 95, 315:
   Same date calculation for the old training log.

## The correct model

```
PLANNED SIDE (abstract, no dates):
  week_plans.week_start ─────────── anchors the week to a calendar week
  planned_exercises.day_index ───── slot number (1, 2, 3...) within the plan
  week_plans.day_labels ─────────── display names ("Training 1", "Monday", etc.)

LOGGING SIDE (concrete dates):
  training_log_sessions.date ────── actual calendar date the athlete trained
  training_log_sessions.day_index ─ which plan slot they were executing
  training_log_sessions.week_start ─ which week plan this belongs to
  training_log_exercises.planned_exercise_id ── direct FK to planned exercise

MATCHING:
  Plan → Log:  week_start + day_index  (slot-based, NOT date-based)
  Exercise → Exercise:  planned_exercise_id  (direct FK)
  NEVER: weekStart + (dayIndex - 1) days  (this is wrong)
```

## Constraints

Work on the current branch (feature/compact-print-and-polish).
Run `npm run build` after each group. Commit each group separately.
Do not ask for confirmation.

---

## GROUP 0: DATABASE MIGRATION (create file only — do NOT run)

Create: `supabase/migrations/20260405_fix_session_constraints.sql`

```sql
-- 1. Remove the day_index 1-7 constraint (already removed for planned_exercises,
--    but training_log_sessions still has it)
ALTER TABLE training_log_sessions
  DROP CONSTRAINT IF EXISTS training_log_sessions_day_index_check;
ALTER TABLE training_log_sessions
  ADD CONSTRAINT training_log_sessions_day_index_check CHECK (day_index >= 1);

-- 2. Change unique constraint from (athlete_id, date) to (athlete_id, week_start, day_index)
--    This allows:
--    - Multiple sessions on the same calendar date (different training slots)
--    - Only one session per training slot per week (logical uniqueness)
ALTER TABLE training_log_sessions
  DROP CONSTRAINT IF EXISTS training_log_sessions_athlete_id_date_key;
ALTER TABLE training_log_sessions
  ADD CONSTRAINT training_log_sessions_athlete_week_day_key
  UNIQUE (athlete_id, week_start, day_index);

-- 3. Add index for the new lookup pattern
CREATE INDEX IF NOT EXISTS idx_training_log_sessions_athlete_week_day
  ON training_log_sessions(athlete_id, week_start, day_index);
```

Tell the user to run this migration in Supabase SQL Editor before continuing.

---

## GROUP 1: FIX useTrainingLog.ts

File: src/hooks/useTrainingLog.ts

### Current (broken):
```typescript
const selectedDate = new Date(weekStart);
selectedDate.setDate(selectedDate.getDate() + selectedDayIndex - 1);
const dateISO = toLocalISO(selectedDate);

const { data: sessionData } = await supabase
  .from('training_log_sessions')
  .select('*')
  .eq('athlete_id', athleteId)
  .eq('date', dateISO)        // ← WRONG: queries by calculated date
  .maybeSingle();
```

### Fix:
Query by `week_start` + `day_index` instead of calculated date:
```typescript
const weekStartISO = toLocalISO(weekStart);

const { data: sessionData } = await supabase
  .from('training_log_sessions')
  .select('*')
  .eq('athlete_id', athleteId)
  .eq('week_start', weekStartISO)
  .eq('day_index', selectedDayIndex)
  .maybeSingle();
```

When creating a NEW session (no existing session found), use TODAY's
actual date, not a calculated date:
```typescript
setSession({
  id: '',
  athlete_id: athleteId,
  date: toLocalISO(new Date()),  // ← actual date = today
  week_start: weekStartISO,
  day_index: selectedDayIndex,
  // ... rest
});
```

### Also fix saveSession:
When inserting a new session, the `date` should be the actual current
date (today), not a calculated date from dayIndex:
```typescript
const { data: newSession, error } = await supabase
  .from('training_log_sessions')
  .insert({
    athlete_id: athleteId,
    date: toLocalISO(new Date()),  // ← today's actual date
    week_start: currentSession.week_start,
    day_index: currentSession.day_index,
    // ... rest
  })
```

---

## GROUP 2: FIX SessionView.tsx

File: src/components/training-log/SessionView.tsx

### Current (broken):
```typescript
// Derive the nominal date for display (weekStart + dayIndex - 1 days)
const date = (() => {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + dayIndex - 1);
  // ...
})();
```

### Fix:
Use the session's actual `date` field for display. If the session
doesn't exist yet (new session), use today's date:
```typescript
const displayDate = session?.date || toLocalISO(new Date());
```

For the header display, show BOTH the slot label and the actual date:
```
Training 2  ·  Wednesday 2 April 2026
```
This makes it clear which plan slot is being executed and when.

### Also:
The `fetchWeekData` call should match by week_start + dayIndex (Group 1
already fixes this in the hook). Verify the SessionView doesn't
recalculate dates independently.

---

## GROUP 3: FIX SessionHistory.tsx STREAK CALCULATION

File: src/components/training-log/SessionHistory.tsx

### Current (broken):
```typescript
const prevDate = new Date(prev.week_start + 'T00:00:00');
prevDate.setDate(prevDate.getDate() + prev.day_index - 1);
const currDate = new Date(curr.week_start + 'T00:00:00');
currDate.setDate(currDate.getDate() + curr.day_index - 1);
const diffDays = (prevDate.getTime() - currDate.getTime()) / 86400000;
```

### Fix:
Use the session's actual `date` field for streak calculation:
```typescript
const prevDate = new Date(prev.date + 'T00:00:00');
const currDate = new Date(curr.date + 'T00:00:00');
const diffDays = (prevDate.getTime() - currDate.getTime()) / 86400000;
```

The `date` field on training_log_sessions IS the actual calendar date
the athlete trained. Use it directly — don't recalculate from day_index.

---

## GROUP 4: FIX AthleteLog.tsx (OLD LOG)

File: src/components/AthleteLog.tsx

### Fix lines 95 and 315:
Same pattern — replace `weekStart + (dayIndex - 1)` with either:
- The session's actual `date` field (if session exists)
- Today's date (if creating a new session)

If AthleteLog is still used (check if it's routed in App.tsx), apply
the same fixes. If it's been replaced by the new training-log components,
note that it's deprecated but fix it anyway for safety.

---

## GROUP 5: UPDATE SESSION DISPLAY TO SHOW SLOT + DATE

### SessionHistory day slots
File: src/components/training-log/SessionHistory.tsx

When rendering each day slot, show:
- The slot label (from day_labels): "Training 1" or "Monday"
- If a session exists for that slot, also show the actual date:
  "Training 1 · logged 2 Apr"

This helps the coach see WHEN the athlete actually did each training.

### SessionView header
File: src/components/training-log/SessionView.tsx

Show both slot and date in the header:
```
Training 2
Wednesday, 2 April 2026
```

If the session hasn't been started yet, show:
```
Training 2
Today · Wednesday, 2 April 2026
```

---

## GROUP 6: VERIFY ANALYSIS MODULE

File: src/hooks/useAnalysis.ts

Verify the analysis module does NOT use the `weekStart + dayIndex - 1`
pattern anywhere. It should:
- Aggregate PLANNED data by week_start (from week_plans) — correct
- Aggregate PERFORMED data by week_start (from training_log_sessions) — correct
- Match planned ↔ performed via planned_exercise_id — correct
- Use session.date for time-series when needed — correct

If any day-level analysis exists (X axis = "Day"), it should use the
session's actual `date` field, not calculated dates.

Check and fix if needed. If already correct, just verify and move on.

---

## GROUP 7: VERIFY PLANNER STATUS DOTS

File: src/components/planner/DayCard.tsx or WeeklyPlanner.tsx

If the planner shows training log status dots on day cards (🟢 completed,
🟡 in progress, 🔵 planned only), verify it queries by:
```sql
SELECT status FROM training_log_sessions
WHERE week_start = ? AND day_index = ? AND athlete_id = ?
```

NOT by a calculated calendar date. If status dots aren't implemented
yet, skip this group.

---

## GROUP 8: TEST

Test these scenarios in Chrome:

### Scenario A: Standard weekday mapping
1. Coach has day_labels as Monday, Tuesday, etc.
2. Athlete opens Training Log → sees day slots
3. Clicks "Monday" → session view opens
4. Starts and completes session
5. Close and reopen → session is found correctly

### Scenario B: Abstract slot names
1. Coach renames days to "Training 1", "Training 2", "Training 3"
2. Athlete opens Training Log → sees "Training 1", "Training 2", etc.
3. Clicks "Training 2" on a Monday
4. Starts and logs exercises
5. The session's date = today (Monday), day_index = 2
6. Close → session shows "Training 2 · logged Mon 7 Apr"
7. Navigate to next day → click "Training 1"
8. Both sessions exist, different dates, same week

### Scenario C: Streak calculation
1. Athlete completes sessions on non-consecutive calendar days
   but consecutive plan slots
2. Streak count should use actual session dates, not calculated dates
3. E.g., Training 1 on Monday, Training 2 on Thursday = gap of 3 days

### Scenario D: Analysis
1. Open Analysis page
2. Select "Planned vs Performed"
3. Verify weekly totals match correctly regardless of which day
   exercises were actually performed on

### Scenario E: 9+ sessions per week
1. Coach adds day 8 and day 9 in day config (labels: "Extra 1", "Extra 2")
2. Athlete opens training log → sees all 9 slots
3. Athlete logs Training 8 → session created with day_index=8
4. No database constraint error
5. Athlete logs two sessions on the same calendar date (e.g., Training 1
   in the morning, Training 2 in the afternoon) → both save correctly
6. Both sessions appear in session history under the correct slots

Fix any issues found.
