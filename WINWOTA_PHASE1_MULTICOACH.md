# WINWOTA 2.0 — PHASE 1: DATA ISOLATION & ENVIRONMENT SWITCHING

Add `owner_id` to all root tables and an environment switcher in the
sidebar. No authentication, no login. Coaches switch environments via
a dropdown. Every query filters by the active coach's ID.

This is foundational infrastructure. Be careful — every hook file
changes, and a missed filter means data leaks between environments.

Work on a new branch: `feature/multi-coach-phase1`
Run `npm run build` after each group. Commit each group separately.
Do not ask for confirmation.

---

## GROUP 0: CREATE BRANCH

```bash
git checkout main
git pull
git checkout -b feature/multi-coach-phase1
```

---

## GROUP 1: DATABASE MIGRATION (create file only)

Create: `supabase/migrations/20260406_multi_coach_phase1.sql`

```sql
-- ══════════════════════════════════════════════════════════════
-- PHASE 1: Coach profiles + owner_id on root tables
-- No auth integration — just data isolation by owner_id
-- ══════════════════════════════════════════════════════════════

-- 1. Coach profiles table
CREATE TABLE IF NOT EXISTS coach_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text DEFAULT NULL,
  photo_url text DEFAULT NULL,
  club_name text DEFAULT NULL,
  locale text DEFAULT 'en',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE coach_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON coach_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Seed a default coach (all existing data will belong to this coach)
INSERT INTO coach_profiles (id, name, club_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Coach', 'My Club')
ON CONFLICT (id) DO NOTHING;

-- 3. Add owner_id to root tables
-- Each gets: column + default + FK + index + backfill

-- athletes
ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE athletes SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE athletes ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_athletes_owner ON athletes(owner_id);

-- exercises
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE exercises SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE exercises ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exercises_owner ON exercises(owner_id);

-- Fix exercise_code uniqueness: per-coach, not global
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_exercise_code_key;
ALTER TABLE exercises ADD CONSTRAINT exercises_owner_code_unique
  UNIQUE (owner_id, exercise_code);

-- Fix exercise deletion: prevent CASCADE data loss
-- planned_exercises: block deletion if exercise is in any plan
ALTER TABLE planned_exercises DROP CONSTRAINT IF EXISTS planned_exercises_exercise_id_fkey;
ALTER TABLE planned_exercises ADD CONSTRAINT planned_exercises_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT;

-- training_log_exercises: keep history, null out the reference
ALTER TABLE training_log_exercises DROP CONSTRAINT IF EXISTS training_log_exercises_exercise_id_fkey;
ALTER TABLE training_log_exercises ADD CONSTRAINT training_log_exercises_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE SET NULL;
-- exercise_id must become nullable for SET NULL to work
ALTER TABLE training_log_exercises ALTER COLUMN exercise_id DROP NOT NULL;

-- athlete_prs: block deletion if PRs exist
ALTER TABLE athlete_prs DROP CONSTRAINT IF EXISTS athlete_prs_exercise_id_fkey;
ALTER TABLE athlete_prs ADD CONSTRAINT athlete_prs_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT;

-- Add soft-delete to exercises (archive instead of delete)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;

-- week_plans
ALTER TABLE week_plans
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE week_plans SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE week_plans ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_week_plans_owner ON week_plans(owner_id);

-- macrocycles
ALTER TABLE macrocycles
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE macrocycles SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE macrocycles ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_macrocycles_owner ON macrocycles(owner_id);

-- events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE events SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE events ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);

-- training_groups
ALTER TABLE training_groups
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE training_groups SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE training_groups ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_groups_owner ON training_groups(owner_id);

-- general_settings
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE general_settings SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE general_settings ALTER COLUMN owner_id SET NOT NULL;
-- Make settings unique per coach
ALTER TABLE general_settings
  DROP CONSTRAINT IF EXISTS general_settings_owner_unique;
ALTER TABLE general_settings
  ADD CONSTRAINT general_settings_owner_unique UNIQUE (owner_id);
CREATE INDEX IF NOT EXISTS idx_general_settings_owner ON general_settings(owner_id);
```

Tell the user to run this migration manually before continuing.

---

## GROUP 2: UPDATE TYPES

File: src/lib/database.types.ts

Add CoachProfile interface:
```typescript
export interface CoachProfile {
  id: string;
  name: string;
  email: string | null;
  photo_url: string | null;
  club_name: string | null;
  locale: string;
  created_at: string;
  updated_at: string;
}
```

Add `owner_id: string` to these existing interfaces:
- Athlete
- Exercise
- WeekPlan
- Event
- GeneralSettings
- TrainingGroup

Add `is_archived: boolean` to the Exercise interface.

Make `exercise_id` nullable in TrainingLogExercise interface:
```typescript
exercise_id: string | null;  // null = exercise was deleted
```

Do NOT add owner_id to child tables (PlannedExercise, PlannedSetLine,
MacroWeek, MacroPhase, EventAthlete, TrainingLogSession, etc.) —
they inherit isolation through their parent FK.

---

## GROUP 3: COACH STORE

Create: src/store/coachStore.ts

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CoachProfile } from '../lib/database.types';

interface CoachState {
  activeCoach: CoachProfile | null;
  coaches: CoachProfile[];
  setActiveCoach: (coach: CoachProfile) => void;
  setCoaches: (coaches: CoachProfile[]) => void;
}

export const useCoachStore = create<CoachState>()(
  persist(
    (set) => ({
      activeCoach: null,
      coaches: [],
      setActiveCoach: (activeCoach) => set({ activeCoach }),
      setCoaches: (coaches) => set({ coaches }),
    }),
    {
      name: 'winwota-coach',  // localStorage key
    }
  )
);
```

Using `persist` so the selected coach survives page refresh.

---

## GROUP 4: COACH HOOK

Create: src/hooks/useCoachProfiles.ts

```typescript
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { CoachProfile } from '../lib/database.types';

export function useCoachProfiles() {
  const [loading, setLoading] = useState(false);

  const fetchCoaches = async (): Promise<CoachProfile[]> => {
    const { data, error } = await supabase
      .from('coach_profiles')
      .select('*')
      .order('name');
    if (error) throw error;
    return data || [];
  };

  const createCoach = async (profile: {
    name: string;
    email?: string;
    club_name?: string;
  }): Promise<CoachProfile> => {
    const { data, error } = await supabase
      .from('coach_profiles')
      .insert([profile])
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const updateCoach = async (
    id: string,
    updates: Partial<CoachProfile>,
  ): Promise<void> => {
    const { error } = await supabase
      .from('coach_profiles')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
  };

  const deleteCoach = async (id: string): Promise<void> => {
    // CASCADE will delete all owned data!
    const { error } = await supabase
      .from('coach_profiles')
      .delete()
      .eq('id', id);
    if (error) throw error;
  };

  return { loading, fetchCoaches, createCoach, updateCoach, deleteCoach };
}
```

---

## GROUP 5: OWNER_ID HELPER

Create: src/lib/ownerContext.ts

A simple helper that every hook uses to get the active owner_id:

```typescript
import { useCoachStore } from '../store/coachStore';

/**
 * Get the active coach's owner_id.
 * Returns the default coach ID if none is selected.
 * Every Supabase query to a root table must use this.
 */
export function getOwnerId(): string {
  const coach = useCoachStore.getState().activeCoach;
  return coach?.id ?? '00000000-0000-0000-0000-000000000001';
}
```

This is a non-hook function (reads from Zustand store directly)
so it can be called inside async functions without hook rules.

---

## GROUP 6: UPDATE ALL HOOKS — ADD OWNER_ID FILTERING

This is the biggest group. Every hook that queries a root table
must filter by `owner_id`. Every hook that inserts into a root
table must include `owner_id` in the insert.

### Pattern for SELECT:
```typescript
// BEFORE:
const { data } = await supabase.from('athletes').select('*').order('name');

// AFTER:
const { data } = await supabase
  .from('athletes')
  .select('*')
  .eq('owner_id', getOwnerId())
  .order('name');
```

### Pattern for INSERT:
```typescript
// BEFORE:
await supabase.from('athletes').insert([athleteData]);

// AFTER:
await supabase.from('athletes').insert([{ ...athleteData, owner_id: getOwnerId() }]);
```

### Files to update (check each one):

**src/hooks/useAthletes.ts**
- fetchActiveAthletes: add `.eq('owner_id', getOwnerId())`
- fetchAllAthletes: add `.eq('owner_id', getOwnerId())`
- fetchAthleteById: no filter needed (querying by ID is already specific)
- createAthlete: add `owner_id: getOwnerId()` to insert
- updateAthlete: no change (updating by ID)
- deleteAthlete: no change (deleting by ID)
- fetchPRs: no change (PRs are via athlete_id FK)
- upsertPR: no change

**src/hooks/useExercises.ts**
- fetchExercises / fetchExercisesByName: add `.eq('owner_id', getOwnerId())`
- createExercise: add `owner_id: getOwnerId()` to insert
- bulkImportExercises: add `owner_id: getOwnerId()` to each row
- updateExercise: no change
- deleteExercise: no change

**src/hooks/useWeekPlans.ts**
- fetchOrCreateWeekPlan: add `.eq('owner_id', getOwnerId())` to the
  SELECT query, and `owner_id: getOwnerId()` to the INSERT
- All other functions query by weekplan_id or planned_exercise_id
  (child tables), so they don't need owner_id directly
- fetchWeekPlanForAthlete: add `.eq('owner_id', getOwnerId())`

**src/hooks/useMacroCycles.ts**
- fetchMacrocycles: add `.eq('owner_id', getOwnerId())`
- createMacrocycle: add `owner_id: getOwnerId()` to insert
- All other functions work via macrocycle_id FK

**src/hooks/useEvents.ts**
- fetchEvents: add `.eq('owner_id', getOwnerId())`
- createEvent: add `owner_id: getOwnerId()` to insert
- updateEvent / deleteEvent: by ID, no change
- fetchUpcomingEvents: add `.eq('owner_id', getOwnerId())`

**src/hooks/useTrainingGroups.ts**
- fetchGroups: add `.eq('owner_id', getOwnerId())`
- createGroup: add `owner_id: getOwnerId()` to insert
- Other operations by group_id FK

**src/hooks/useSettings.ts**
- fetchSettings: change from `.maybeSingle()` to
  `.eq('owner_id', getOwnerId()).maybeSingle()`
- When creating default settings (no row exists), add
  `owner_id: getOwnerId()` to insert
- updateSettings: add `.eq('owner_id', getOwnerId())` as a safety filter

**src/hooks/useCoachDashboard.ts**
- All queries that fetch athletes, macrocycles, events: add owner_id filter
- Or rely on the fact that it calls other hooks (check which)

**src/hooks/useAnalysis.ts**
- fetchWeeklyAggregates: week_plans query needs `.eq('owner_id', getOwnerId())`
- exercises query needs `.eq('owner_id', getOwnerId())`
- Other queries go through athlete_id FK (already scoped)

**src/hooks/useTrainingLog.ts**
- Queries go through athlete_id and weekplan_id FKs — but verify
  the week_plan lookup includes owner_id

**src/hooks/useCombos.ts**
- week_plans queries need `.eq('owner_id', getOwnerId())`

**src/hooks/useMediaUpload.ts**
- No table queries, skip

**src/hooks/useShiftHeld.ts**
- No table queries, skip

### Import needed in every updated hook:
```typescript
import { getOwnerId } from '../lib/ownerContext';
```

### CRITICAL: Test after this group
Run `npm run build` AND open the app in Chrome. Navigate to every
page and verify data still loads. The default coach ID matches all
existing data, so nothing should change visually.

---

## GROUP 7: ENVIRONMENT SWITCHER IN SIDEBAR

File: src/components/Sidebar.tsx

Add a coach switcher at the TOP of the sidebar, above the navigation:

```tsx
// At the top of the sidebar, above the first section header
<div className="px-3 py-3 border-b border-gray-200">
  <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">
    Environment
  </div>
  <select
    value={activeCoach?.id ?? ''}
    onChange={(e) => {
      const coach = coaches.find(c => c.id === e.target.value);
      if (coach) {
        setActiveCoach(coach);
        // Clear athlete/group selection when switching coach
        useAthleteStore.getState().setSelectedAthlete(null);
        window.location.reload(); // force full data reload
      }
    }}
    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5
               bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
  >
    {coaches.map(c => (
      <option key={c.id} value={c.id}>
        {c.name}{c.club_name ? ` — ${c.club_name}` : ''}
      </option>
    ))}
  </select>
  <button
    onClick={() => setShowNewCoachModal(true)}
    className="w-full mt-1.5 text-[10px] text-blue-600 hover:text-blue-700 text-left px-1"
  >
    + New environment
  </button>
</div>
```

### Load coaches on app startup
File: src/App.tsx (or a top-level provider)

On mount:
1. Fetch all coach profiles
2. If no active coach in store, set the first one (or default)
3. Store in `useCoachStore`

```typescript
useEffect(() => {
  const init = async () => {
    const coaches = await fetchCoaches();
    setCoaches(coaches);
    if (!activeCoach && coaches.length > 0) {
      setActiveCoach(coaches[0]);
    }
  };
  init();
}, []);
```

---

## GROUP 8: NEW COACH MODAL

Create: src/components/CoachProfileModal.tsx

Simple modal for creating a new coach environment:

```
┌────────────────────────────────────┐
│ New coaching environment           │
│                                    │
│ Name: [________________]           │
│ Club:  [________________]          │
│ Email: [________________]          │
│                                    │
│ ⚠ This creates a completely       │
│   separate data environment.       │
│   Athletes, exercises, and plans   │
│   are not shared between           │
│   environments.                    │
│                                    │
│ [Cancel]  [Create environment]     │
└────────────────────────────────────┘
```

On create:
1. Insert into coach_profiles
2. Create default general_settings row for this coach
3. Set as active coach
4. Reload the page

---

## GROUP 9: COACH PROFILE IN SETTINGS

File: src/components/Settings.tsx or src/components/GeneralSettings.tsx

Add a "Coach profile" section at the top of Settings:

- Name (editable)
- Club name (editable)
- Email (editable)
- Photo upload (optional — can implement later)
- "Delete environment" button (red, with confirmation:
  "This will permanently delete all athletes, exercises, plans,
  and settings in this environment. This cannot be undone.")

---

## GROUP 10: ATHLETE SELECTOR SCOPING

File: src/components/AthleteSelector.tsx

The athlete selector in the top-right should only show athletes
belonging to the active coach. This should already work if
`useAthletes` filters by owner_id (Group 6), but verify:

1. Switch coach environment → athlete dropdown clears
2. Athletes from other environments don't appear
3. Creating a new athlete assigns it to the active coach

---

## GROUP 11: PRINT HEADER — SHOW COACH/CLUB

File: src/components/planner/PrintWeekCompact.tsx
File: src/components/planner/PrintWeek.tsx

Update the print header to show the coach name and club:

Compact mode:
```
[Coach name]        WEEKLY PLAN        [Club name]
[Athlete name]                         Week [N] / [Year]
```

Programme mode: add coach/club in a subtle header line.

Get these from `useCoachStore` — read the active coach's name and club_name.

---

## GROUP 12: EXERCISE LIBRARY — SHARED VS OWNED

There's an important decision here: should exercises be shared across
coach environments or owned per-coach?

**Decision: OWNED per coach.** Each coach has their own exercise library.
Reasons:
- Coaches use different exercise names, codes, and categories
- Exercise codes are meaningful per-coach (IAT numbering differs)
- Sharing exercises creates confusion when one coach edits a shared exercise

This means when a new coach environment is created, they start with
an EMPTY exercise library. They can:
- Add exercises manually
- Bulk import from CSV (existing feature)
- Future: copy from another coach's library (not in this phase)

Verify: after Group 6, creating a new coach environment and switching
to it shows an empty exercise library. This is correct.

---

## GROUP 12B: EXERCISE ARCHIVE (SOFT DELETE)

### Problem solved
Deleting an exercise currently CASCADE-deletes all planned_exercises,
training_log_exercises, and athlete_prs that reference it. This
destroys historical data.

### New behavior
File: src/hooks/useExercises.ts

Change `deleteExercise` to archive instead of delete:
```typescript
const deleteExercise = async (id: string) => {
  // Try actual delete first (works if exercise is unused)
  const { error } = await supabase.from('exercises').delete().eq('id', id);
  
  if (error?.code === '23503') {
    // FK violation — exercise is in use, archive instead
    await supabase.from('exercises')
      .update({ is_archived: true })
      .eq('id', id);
    return { archived: true };
  }
  
  if (error) throw error;
  return { archived: false };
};
```

### Exercise list filtering
File: src/hooks/useExercises.ts

All fetch queries should filter out archived exercises by default:
```typescript
.eq('is_archived', false)
```

Add a separate function for fetching including archived (for settings/admin):
```typescript
const fetchAllExercisesIncludingArchived = async () => {
  // No is_archived filter
};
```

### Exercise search in planner
File: src/components/planner/ExerciseSearch.tsx (and DayCard.tsx)

Exercise search should NOT show archived exercises. Already handled
if the hook filters them out.

### Training log display
File: src/components/training-log/* 

When displaying a logged exercise where `exercise_id` is null
(exercise was hard-deleted before this fix) or where the exercise
`is_archived` is true:
- Show exercise name as "[Deleted exercise]" or the archived name
- Style in italic text-gray-400
- Still show the performed data (reps, load, notes)

### UI in exercise library
File: src/components/ExerciseList.tsx

When the coach clicks delete on an exercise:
1. Try to delete
2. If it's in use, show a message:
   "This exercise is used in [N] plans and [M] training logs.
   It has been archived and hidden from the exercise picker.
   You can restore it from Settings → Archived exercises."
3. Add an "Archived" section at the bottom of the exercise list
   (collapsed by default) showing archived exercises with a
   "Restore" button on each

---

## GROUP 13: DATA INTEGRITY CHECK

After all changes, verify data isolation works:

1. Open the app — Default Coach environment is active
2. All existing data (athletes, exercises, plans) visible
3. Create a new coach environment: "Test Coach"
4. Switch to "Test Coach"
5. Verify:
   - Roster: empty (no athletes)
   - Exercise library: empty (no exercises)
   - Planner: "Select an athlete" (none available)
   - Macro cycles: empty
   - Calendar: empty
   - Settings: fresh defaults (new general_settings row created)
   - Training log: empty
   - Dashboard: empty
   - Analysis: empty
6. Create an athlete "Test Athlete" in the Test Coach environment
7. Switch back to Default Coach
8. Verify "Test Athlete" is NOT visible
9. Switch to Test Coach — "Test Athlete" is there
10. Delete "Test Coach" environment → confirm
11. Switch back to Default Coach — all original data intact
12. "Test Athlete" is gone (CASCADE delete)

---

## GROUP 14: PREVENT CROSS-ENVIRONMENT ACCESS

Add a safety check in critical operations. When updating or deleting
a resource by ID, verify it belongs to the active coach:

```typescript
// In useAthletes.ts updateAthlete:
const { data: existing } = await supabase
  .from('athletes')
  .select('owner_id')
  .eq('id', id)
  .single();
if (existing?.owner_id !== getOwnerId()) {
  throw new Error('Access denied: resource belongs to another environment');
}
```

Add this check to:
- updateAthlete / deleteAthlete
- updateExercise / deleteExercise
- updateWeekPlan
- deleteMacrocycle
- deleteEvent

This prevents accidental cross-environment writes even if an old
URL or cached ID is used.

---

## GROUP 15: TESTING

Open Chrome and run through:

### Basic flow
1. App loads with Default Coach selected
2. All existing data visible and functional
3. Navigate every page — no errors
4. Planner works: add exercise, grid edits, save, close, persist

### Environment switching
5. Create "Coach B" environment
6. Switch to Coach B — everything empty
7. Add an athlete + exercise + plan in Coach B
8. Switch back to Default Coach — Coach B data invisible
9. Switch to Coach B — data is there

### Settings isolation
10. Change a setting in Coach B (e.g., grid increment)
11. Switch to Default Coach — setting unchanged
12. Switch to Coach B — setting preserved

### Cleanup
13. Delete Coach B — confirm cascade
14. Default Coach data untouched
15. No console errors throughout

Fix any issues found during testing.
