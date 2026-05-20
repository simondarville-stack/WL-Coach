# EMOS Data Review — 2026-05-20

## Summary

- Total findings: 22
- Migrations required (proposed, not applied): 4
- owner_id gaps: 3 tables
- Hot-path query concerns: 4
- RLS readiness: mixed

## Schema Map (in-scope tables)

| Table | Purpose | owner_id? | Notable columns | JSONB columns |
|---|---|---|---|---|
| training_log_sessions | One session per athlete per week-slot | YES (not null) | week_start, day_index, vas_score, custom_metrics | custom_metrics |
| training_log_exercises | One row per exercise in a session | NO | planned_exercise_id (nullable), status, metadata | metadata |
| training_log_sets | One row per logged set | NO | set_number, planned_load/reps, performed_load/reps, notes | none |
| training_log_messages | Coach/athlete comment thread | NO | session_id, exercise_id (nullable), sender_type | none |
| planned_exercises | Coach-written prescription row | NO (inherited) | metadata (new), prescription_raw | metadata |
| athlete_metric_definitions | Per-athlete custom metric types | YES | label, value_type, archived_at | none |
| athlete_week_metrics_config | Per-week metric toggle config | YES | track_raw/bw/vas, enabled_custom_metric_ids | none |

## Section A — owner_id Integrity

### DA-01 — training_log_exercises has no owner_id (HIGH)
`training_log_exercises` was created in `20260215134041` without `owner_id`. Subsequent multi-coach migration added it to athletes, exercises, week_plans, macrocycles, events, training_groups, general_settings — but not this table. Apr 19 added it to sessions only. RLS at Auth time will require expensive JOIN through `training_log_sessions.owner_id` or a denormalized column. Add now, backfill from sessions, NOT NULL.

### DA-02 — training_log_sets has no owner_id and no RLS (HIGH)
Created in `20260403_training_log_v2.sql` with no `owner_id` and no RLS statement. Ownership chain: sessions → exercises → sets. Two JOIN hops for RLS = fragile + expensive. Highest-volume write table. Denormalize `owner_id`.

### DA-03 — training_log_messages has no owner_id and no RLS (HIGH)
Same as DA-02. `exercise_id` nullable (session-level messages have no `exercise_id`). Ownership chain varies. Denormalize `owner_id`.

### DA-04 — fetchMetricDefinitions does not filter by owner_id (MEDIUM)
`trainingLogService.ts:1028-1041` filters only by `athlete_id`. Post-auth, a coach knowing rival's athlete UUID could read their metric definitions. Same gap in `fetchWeekMetricsConfig` at line 1094-1100.

### DA-05 — fetchWeekLog and fetchSessionForSlot do not filter by owner_id
`fetchWeekLog` (line 54-59) and `fetchSessionForSlot` (line 123-129) filter only by `athlete_id`. Single-coach deployment safe; post-auth high risk. Column exists on `training_log_sessions` — trivial to add `.eq('owner_id', ownerId)`.

## Section B — Migration Discipline

### DB-01 — Non-standard migration filenames (LOW)
`20260403_training_log_v2.sql` uses pattern `YYYYMMDD_<name>` rather than `YYYYMMDD<HHMMSS>_<n>_<name>` used elsewhere. mtime is `May 13 08:47` despite `20260403` prefix — suggests retroactive authoring. Similarly for `20260405_fix_session_constraints.sql` and `20260405_day_schedule.sql`. CLAUDE.md violation if applied outside the explicit migration process.

### DB-02 — training_log_sets and training_log_messages no RLS enabled (HIGH)
Both created without `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. Original tables had RLS at creation; v2 tables never got it. Auth cutover requires `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policies.

### DB-03 — No rollback instructions (LOW)
Migrations 20260519000001 through 20260519000004 add columns/tables but no rollback commentary. `ADD COLUMN IF NOT EXISTS` is idempotent forward-apply, but no documented rollback section.

### DB-04 — Set-number upsert no DB unique constraint (MEDIUM)
`upsertLoggedSet` (trainingLogService.ts:696-736) does manual "SELECT then INSERT or UPDATE" on `(log_exercise_id, set_number)`. No constraint. Comment says "No reliance on a DB unique constraint." Concurrent writes (athlete double-taps) can produce duplicate rows; subsequent `.single()` reads throw. GppLogCard's serial queue protects GPP path; general path unprotected. Add `UNIQUE(log_exercise_id, set_number)` + `INSERT ... ON CONFLICT DO UPDATE`.

### DB-05 — athlete_week_metrics_config unique constraint (LOW now, MEDIUM post-auth)
`20260519000002` line 66: `unique (athlete_id, week_start)`. Post-auth if two coaches share an athlete, second coach blocked. Should be `unique (athlete_id, owner_id, week_start)`.

## Section C — Shape-for-Flexibility

### DC-01 — training_log_sets.notes carries two semantic roles (MEDIUM)
The `notes` column was originally athlete annotation ("bar felt heavy"). Now also serves as *performed value* for free-text rows: in `SetEntryRow.tsx:101-109`, `freeTextMode = true` → `performedText` maps to `notes`. Column now means:
- Athlete commentary (for normal quantified sets)
- "What the athlete actually did" (for free-text units)

Orthogonal concepts that may co-exist on the same set.

Proposal: Add `performed_text text null` to training_log_sets. Service writes `performed_text` when free-text. Retain `notes` for annotations.

### DC-02 — training_log_exercises.metadata.removed_set_numbers — reasonable JSONB use, lacks CHECK constraint (LOW)
Reasonable: set numbers point to ephemeral computed list, not permanent FK target. Column declared `jsonb not null default '{}'::jsonb` with no CHECK. Application bug writing `{removed_set_numbers: null}` would silently succeed → client TypeError on coercion.

Mitigation: `CHECK (metadata ? 'removed_set_numbers' IS FALSE OR jsonb_typeof(metadata -> 'removed_set_numbers') = 'array')`.

### DC-03 — training_log_exercises.metadata.gpp — nested JSONB without validation (MEDIUM)
Stores `GppSection` (title, description, rows[] with exercise/reps/sets/load/done).

Concerns:
1. `done` boolean is athlete-only (documented in database.types.ts:158), but both planned and log metadata share `GppSection` type. Dual-purpose type.
2. `GppLogCard.tsx:29-37` merges by array length using `athlete.length >= planned.length`. If coach removes a row after athlete saved, athlete's metadata has dangling reference. Athlete's copy wins — intentional but undocumented.

Proposal: Keep JSONB. Add DB comment noting `rows[*].done` athlete-side only.

### DC-04 — custom_metrics dangling UUID keys (LOW)
`training_log_sessions.custom_metrics` keys are `athlete_metric_definitions.id` UUIDs. No FK enforcement: if metric archived, historical values remain with dangling key. Acceptable, documented. `setSessionCustomMetric` (line 1146-1170) does read-then-write with last-write-wins race; could use `jsonb_set` atomic operation.

## Section D — Indexing and Query Shape

### DD-01 — fetchAthleteDay is 5–7 round-trip sequential chain (HIGH)
Hot path for opening a training slot:
1. `resolveAthleteWeekPlanId`: SELECT individual week_plan (line 191-196)
2. If not found: SELECT group_members (line 199-204)
3. If groups exist: SELECT group week_plan (line 207-216)
4. SELECT planned_exercises + exercise join (line 240-246)
5. SELECT planned_set_lines (line 251-256) — conditional
6. SELECT planned_exercise_combo_members (line 267-271) — conditional
7. `fetchSessionForSlot`: SELECT session + exercises + sets + messages (3-4 round-trips internally)
8. Parallel: `fetchWeekMetricsConfig` + `fetchMetricDefinitions` (line 299-302)

5-9 round-trips depending on plan type. 500-900ms unavoidable serial latency on mobile.

Quick win: `fetchWeekOverview` already resolves `weekPlanId` (line 350) and returns it. WeekScreen.tsx:106 calls `fetchAthleteDay` which re-resolves. Pass `weekPlanId` as argument to save steps 1-3.

### DD-02 — training_log_sets no index on log_exercise_id (HIGH)
Created without index. Every `fetchWeekLog`/`fetchSessionForSlot` query: `.in('log_exercise_id', exIds)` = seq scan filtered by array membership. `training_log_exercises` has `idx_training_log_exercises_session` (correct); child table has nothing.

Add: `CREATE INDEX idx_training_log_sets_log_exercise ON training_log_sets(log_exercise_id)`.

### DD-03 — training_log_messages no index (MEDIUM)
Same. `fetchWeekLog` line 85-91: `.in('session_id', sessionIds)` no supporting index.

### DD-04 — upsertWeekMetricsConfig read-then-write race (LOW)
`upsertWeekMetricsConfig` (line 1103-1139) calls `fetchWeekMetricsConfig` then inserts or updates. Two browser tabs → duplicate inserts fail against unique constraint. Use `INSERT ... ON CONFLICT DO UPDATE`.

## Section E — JSONB Discipline

### DE-01 — SessionPatch omits vas_score (HIGH)
`SessionPatch` at trainingLogService.ts:496-514 is `Partial<Pick<TrainingLogSession, ...>>` that explicitly omits `vas_score` and `custom_metrics`. TodayScreen.tsx:325: `patchSession({ vas_score: vas })`. Because `updateSession` accepts `SessionPatch as never`, compiler silently allows extra key — value passes to Supabase correctly but TypeScript contract is a lie.

Fix: Add `vas_score` to SessionPatch Pick list. One-line fix.

### DE-02 — day_schedule weekday convention inconsistent (MEDIUM)
Migration `20260405_day_schedule.sql:3` documents `weekday: 0=Mon, 1=Tue, ..., 6=Sun`. database.types.ts:144 keys 1-based slot index, value has `weekday`. `trainingLogService.ts:313` says `Planned weekday (1 = Mon, …, 7 = Sun)`. WeekScreen.tsx:196 uses `Weekday[day.weekday]`. Migration says 0=Mon; service says 1=Mon. Documentation inconsistency. Stored values determined by planner writes — if planner uses 0-based and display assumes 1-based, days shift by one.

### DE-03 — planned_exercises.metadata load-bearing for sentinel rendering (MEDIUM)
`description` key read in LogExerciseRow.tsx:109 and ExerciseLogCard.tsx for media captions. `gpp` is the sole source of coach GPP block content. Migration comment "Per-row planner extras that do not warrant their own column" — but `description` is essentially mandatory for IMAGE/VIDEO captions. Sentinel persistence path should be audited for `.update({ metadata: { gpp: ... } })` calls that would stomp existing `description`.

## Section F — Concurrency and Timestamps

### DF-01 — training_log_sets and training_log_messages no updated_at trigger (MEDIUM)
`training_log_sets` has `updated_at timestamptz DEFAULT now()` but no UPDATE trigger. Column always equals `created_at` after first write. `training_log_messages` has no `updated_at` at all. CLAUDE.md requires "last-write-wins with timestamps" for collaborative scenarios. Sets table is collaborative (athlete writes, coach edits via CoachSetEditModal).

### DF-02 — training_log_exercises.updated_at no trigger (MEDIUM)
Same. Frequently updated by `removePlannedSet` and `updateLogExercise`. Post-auth two coaches → no timestamp-based conflict detection.

### DF-03 — training_log_sessions.updated_at no trigger (MEDIUM)
Same. Column exists, included in SessionPatch, but service doesn't pass `updated_at: new Date().toISOString()` on patches. Last-write-wins unreliable.

## Section G — RLS Readiness (Audit Only)

### DG-01 — training_log_sessions: ready (RLS on, owner_id present)
Anon policies from `20260215153750`, `owner_id NOT NULL` from `20260419000001`. Swap anon → auth at cutover.

### DG-02 — training_log_exercises: needs owner_id first
RLS enabled, anon policies exist, no `owner_id` (DA-01).

### DG-03 — training_log_sets and training_log_messages: not even enabled
Need: (1) RLS enabled (DB-02), (2) `owner_id` column added (DA-02, DA-03), (3) anon transitional policies, (4) auth policies.

### DG-04 — athlete_metric_definitions and athlete_week_metrics_config: ready (anon-permissive, owner_id present)
`20260519000003_metric_toggles_rls.sql` adds anon policies after fixing 42501 errors. Both have `owner_id NOT NULL`. Switch to `USING (owner_id = auth.uid())` at cutover.

### DG-05 — planned_exercises: no direct owner_id
Ownership through `weekplan_id → week_plans.owner_id`. RLS requires correlated subquery. Pre-existing, noted only because log reads it heavily.

## Bonus Day Session Lifecycle

### DG-06 — setAthleteDayLabel silently drops label when no week plan
`setAthleteDayLabel` returns void when `weekPlanId` is null. WeekScreen.tsx:134-138 calls after `createBonusSession` and logs console.warn on failure. Session row written (with `day_index = max + 1`); label lost. Falls back to auto-generated `Extra N` string. Bonus label tied to coach's plan row (`week_plans.day_labels`), not athlete's session row. If label is important, should live on `training_log_sessions` (`session_label` column).

## Cross-Perspective Tensions

**Tension 1: "Done" representation inconsistency (user concern).** Four representations: session status, exercise status, set status, GppRow.done boolean. `computeDelta` derives from `performed_reps` — does not look at status. Set marked completed with zero reps shows as zero-reps completion in delta. Genuine semantic inconsistency: status says done, reps say nothing.

**Tension 2: Planned-vs-actual delta computability.** Plan values are snapshotted at logging time (planned_load, planned_reps on training_log_sets). Free-text rows have null planned_load/reps. Free-text completion tracked only via training_log_exercises.status, not set-level data.

**Tension 3: Comment visibility for coach query.** No `read_at` column on training_log_messages. No `is_read` flag, no read-receipt mechanism. Coach reads all messages in bulk via `fetchWeekLog`. No way to surface "unread" without client-side `last_seen` timestamp or schema change. No index on `(session_id, exercise_id, sender_type)`.

## Priority Recommendations

### P1 — Critical, block Auth cutover:

1. Add owner_id to training_log_exercises, training_log_sets, training_log_messages with backfill (DA-01, DA-02, DA-03). Migration sketch:

```sql
-- PROPOSED, DO NOT APPLY
ALTER TABLE training_log_exercises
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES coach_profiles(id);
UPDATE training_log_exercises tle
  SET owner_id = tls.owner_id
  FROM training_log_sessions tls
  WHERE tle.session_id = tls.id AND tle.owner_id IS NULL;
ALTER TABLE training_log_exercises ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE training_log_sets
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES coach_profiles(id);
UPDATE training_log_sets tls2
  SET owner_id = tle.owner_id
  FROM training_log_exercises tle
  WHERE tls2.log_exercise_id = tle.id AND tls2.owner_id IS NULL;
ALTER TABLE training_log_sets ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE training_log_messages
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES coach_profiles(id);
UPDATE training_log_messages tlm
  SET owner_id = tls.owner_id
  FROM training_log_sessions tls
  WHERE tlm.session_id = tls.id AND tlm.owner_id IS NULL;
ALTER TABLE training_log_messages ALTER COLUMN owner_id SET NOT NULL;
```

2. Enable RLS on training_log_sets and training_log_messages with permissive anon policies (DB-02).

### P2 — Fix before log feature is stable:

3. Add `performed_text` column; service writes to it for free-text rows (DC-01, Tension 2).
4. Add `vas_score` to SessionPatch (DE-01). One-line fix.
5. Add indexes on `training_log_sets(log_exercise_id)` and `training_log_messages(session_id)` (DD-02, DD-03).
6. Add `UNIQUE(log_exercise_id, set_number)` + convert to `INSERT ... ON CONFLICT DO UPDATE` (DB-04).

### P3 — Medium-term quality:

7. Add `updated_at` triggers to all log tables (DF-01, DF-02, DF-03).
8. Pass `weekPlanId` from WeekOverview into `fetchAthleteDay` (DD-01).
9. Clarify `day_schedule.weekday` convention (DE-02).
10. Add `owner_id` filter to `fetchMetricDefinitions` and `fetchWeekMetricsConfig` (DA-04).

## Open Questions

1. Should `training_log_sets.notes` continue to serve dual roles, or add `performed_text`?
2. Is "exercises with unread coach comments" query a near-term requirement? Drives `read_at` migration.
3. Should bonus day labels live on `training_log_sessions` (athlete-owned) or `week_plans.day_labels` (current — coach-shared)?
4. GppSection merge conflict: when coach edits after athlete saved, current code preserves athlete's edits and appends new rows. Intended?
5. `day_schedule.weekday` 0-based vs 1-based — which is correct in the live database? Needs data inspection.
