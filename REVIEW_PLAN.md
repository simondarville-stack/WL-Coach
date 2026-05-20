# EMOS Review Plan — 2026-05-20

## Summary

- Total unified findings: 47
- Rewrite candidates: `useTrainingLog` (deletion), `LogModeView` (targeted rewrite of data-fetch), `SentinelDisplay` (new shared component extracted from three copy-paste branches)
- Migrations required: 4 migration files covering 8 schema changes
- Cross-perspective tensions: 7
- Top risk: VAS score is silently discarded on every save due to `SessionPatch` omitting `vas_score`; the `as never` cast suppresses the TypeScript error, so all athlete readiness data written since v2 was introduced has been lost without any indication. (E-01 / DE-01)
- Estimated total effort: L

---

## Perspectives at a glance

**UX (18 findings):** The biggest workflow problem is a fragmented "done" vocabulary — six distinct visual treatments for the same semantic state across athlete and coach surfaces, with no shared token layer guaranteeing consistency. Comment invisibility is the highest-risk gap: coach exercise-level replies are written to the database but the athlete has no surface to read them. `window.confirm()` for high-stakes deletions is a data-loss risk on mobile WebKit.

**Engineering (21 findings + 4 scope-disablement items):** The VAS silent data loss (`as never` cast) and the stale generated types (`database.types.ts` has eight `any` casts suppressing type-checking on all DB writes) are the immediate ship-blockers. `useTrainingLog` is 553 lines of dead code containing direct Supabase calls. `LogModeView` does a full three-table reload on every write with a race condition on unmount. Sentinel rendering is copy-pasted across three files with divergent theme colours.

**Domain (18 findings):** The Eleiko RAW system is hardcoded into schema and component code, violating the CLAUDE.md non-negotiable principle of coach-flexibility. Percentage prescriptions are never resolved to kg, making the tonnage and planned-vs-actual figures wrong for the majority of OWL programmes. "Done" semantics are structurally inconsistent: the athlete's set-count source and the coach's status-column source can actively disagree, and the coach may see "Done" for a session where the athlete logged 1 of 5 planned sets.

**Data (22 findings + 4 migrations):** Three high-volume tables (`training_log_exercises`, `training_log_sets`, `training_log_messages`) lack `owner_id`, which blocks Auth cutover and makes RLS impractical without expensive multi-hop JOINs. The two most-queried child tables (`training_log_sets`, `training_log_messages`) have no indexes at all, causing sequential scans on every session load. A set-number uniqueness constraint is absent, allowing duplicate rows from double-taps that will cause `.single()` reads to throw.

---

## Section 0 — Scope disablement

Source: Engineering review (SD-01 through SD-04).

| ID | Location | Status | Action |
|----|----------|--------|--------|
| SD-01 | `src/components/Sidebar.tsx:41` | Already hidden (commented) | No action required |
| SD-02 | `src/components/Sidebar.tsx:50` | Already hidden | No action required |
| SD-03 | `src/App.tsx:43` | `pageTitles` entry `'/analysis': 'Analysis'` still present | Remove or comment out the entry |
| SD-04 | `src/App.tsx:174` | Redirect `/athlete-log → /training-log → /dashboard` still live | Change redirect target directly to `/dashboard` or remove the intermediate hop |

Both SD-03 and SD-04 are read-only registry changes. No schema or data impact.

---

## Section 1 — "Done" state: unified representation

The "done" state inconsistency is the single finding cited by all four reviewers (U-01, CT-1, D-08, Data Tension 1). It is the user's highest-stated priority.

### UF-01 — Done-state vocabulary fragmented across surfaces
- Source IDs: U-01, CT-1, D-08, Data Tension 1
- Issue: Six distinct visual treatments (icon, pill badge, text, coloured border, coloured row background, inline Check) represent the same semantic state; athlete and coach apps use inverted colour palettes for the same pill shape; the athlete's CheckCircle2 derives from set-count completeness while the coach's "Done" badge reads `log.status === 'completed'` — these two sources can actively disagree.
- Proposed change:
  1. Add a canonical helper `isExerciseDone(le: LoggedExerciseFull | null): boolean` to `trainingLogModel.ts`. Implementation: exercise `status === 'completed'`; also auto-promote status to `'completed'` when all planned sets have terminal status (completed or skipped) covering the planned set count. Keep explicit "Mark complete" path for free-text and GPP.
  2. Rename the "Done" button inside `ExerciseLogCard` to "Mark complete".
  3. Adopt one visual token: filled `CheckCircle2` icon + "Done" label in a shared `DoneChip` component. Session-level: pill badge. Exercise/set level: icon only. Applies to both athlete (dark) and coach (light) themes via a `variant: 'dark' | 'light'` prop.
  4. Replace all six ad-hoc implementations with `DoneChip`.
- Storage target: No schema change; exercise `status` column is the canonical field.
- Migration required: No
- Risk: M
- Effort: M
- Patch or rewrite: Patch (new shared component + helper function)

### UF-02 — Exercise completion auto-promotion logic absent
- Source IDs: D-08, CT-1
- Issue: "Log as prescribed" sets exercise status atomically. Individual set taps do not update exercise status. "Done" button can set `status = completed` without any set being completed. The two trigger paths create divergent state.
- Proposed change: In `TodayScreen` (or the service layer), after every set save, call `isExerciseDone` and patch exercise status if newly satisfied. Auto-demotion (sets removed, status back to `in_progress`) is required symmetrically.
- Storage target: `training_log_exercises.status` (existing column)
- Migration required: No
- Risk: M
- Effort: S
- Patch or rewrite: Patch

---

## Section 2 — Planned-vs-performed visibility

User's second stated priority: make planned-vs-actually-performed obvious for the coach.

### UF-03 — CoachSetEditModal lacks planned prescription context
- Source IDs: U-07
- Issue: Modal receives only `loggedSets` and `exerciseName`. Cannot show what athlete was supposed to do per set.
- Proposed change: Pass `plannedExercise` (with `prescription_raw`) to the modal; render a `StackedNotation` header and a read-only "Plan" column per set row.
- Migration required: No
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-04 — Delta colour logic fires incorrectly for free-text and GPP exercises
- Source IDs: U-14, Data Tension 2
- Issue: For GPP sentinels `logged.sets` is empty; for free-text/other units `performed_reps` is never written. `computeDelta` receives `performedReps = 0` against a non-null `planned.summary_total_reps` and emits `DeltaState: 'red'` — a misleading under-performance signal.
- Proposed change: In `LogExerciseRow`, guard: when `planned.unit` is `'free_text'`, `'other'`, or `'free_text_reps'`, or when the exercise is a GPP sentinel, pass `null` for both reps to force `DeltaState: 'pending'`.
- Migration required: No
- Risk: M (misleading quality signal)
- Effort: S
- Patch or rewrite: Patch

### UF-05 — GPP planned-vs-performed contrast absent
- Source IDs: U-15
- Issue: `display = athleteGpp ?? plannedGpp` — all-or-nothing. Coach sees only athlete's modified version; planned version is silently dropped.
- Proposed change: Render two sub-rows when athlete GPP data differs from planned: "Planned: [value]" in dim grey, "Did: [value]" in primary text. Particularly important for the `load` column.
- Migration required: No
- Risk: M
- Effort: M
- Patch or rewrite: Patch

### UF-06 — RAW table: missing value vs not-entered are visually identical
- Source IDs: U-08
- Issue: `null` displayed as `'—'` for both "no session today" and "session exists but pillar not filled". Coach cannot distinguish skipped training from forgotten rating.
- Proposed change: When a session row exists but the pillar value is null, render a distinct placeholder (`'nr'`) in a non-grey cell class (e.g. amber tint).
- Migration required: No
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-07 — Percentage prescriptions never resolved to kg
- Source IDs: D-12, D-07, Domain Tension 2
- Issue: When `unit === 'percentage'`, planned and performed summaries render `0`. Tonnage calculation uses `unit === 'absolute_kg'` guard — excluding all competition lifts written in %1RM. Coach prescribing `5×1@85%` who sees "100% reps done" cannot tell if the athlete hit the right weight.
- Proposed change: Add a `resolvePercentageToKg(prescription, athletePrs)` utility in `trainingLogModel.ts`. Render resolved kg alongside `%` in `StackedNotation` when `athlete_prs` is available. Add a coach toggle "Include resolved kg for % prescriptions" to `WeekMetricsSettings`.
- Storage target: Coach-scoped setting in `athlete_week_metrics_config` (new boolean column `show_resolved_kg`)
- Migration required: Yes (new column on `athlete_week_metrics_config`)
- Risk: H (silent tonnage misrepresentation for majority of OWL programmes)
- Effort: M
- Patch or rewrite: Patch

---

## Section 3 — Comment visibility

User's third stated priority.

### UF-08 — Exercise-level comments invisible to athlete
- Source IDs: U-03, D-16
- Issue: Coach replies written to the database at `exercise_id` scope are never rendered on the athlete side. `TodayScreen` filters messages to `!m.exercise_id`. `ExerciseLogCard` accepts no comment props. The athlete cannot see or respond.
- Proposed change: (a) Add `exerciseMessages` and `onPostExerciseComment` props to `ExerciseLogCard`. (b) Render a compact `AthleteCommentsThread` below the notes textarea for exercise-scoped messages. (c) Thread the props through `TodayScreen` (remove the `!m.exercise_id` filter for exercise cards). (d) On `WeekScreen` day card, show a message indicator badge when the day contains unread coach messages.
- Migration required: No (data exists; display surface missing)
- Risk: H (coach feedback on a specific lift is invisible to athlete)
- Effort: M
- Patch or rewrite: Patch

### UF-09 — Coach comment visibility at week and day level absent
- Source IDs: U-02, E-19
- Issue: The collapsed `LogDayCard` header shows a per-session comment count, but the count guard (`collapsed &&`) removes it on expand. Exercise-level comments are invisible from any overview. `LogWeekOverview` has no comment signal at all.
- Proposed change: (a) Remove the `collapsed &&` guard — show count always. (b) Aggregate "N comment(s) — N from athlete" in `LogWeekOverview`. (c) In `LogDayCard` expanded state, show a small badge beside each exercise row name when `exerciseMessages.length > 0`.
- Migration required: No
- Risk: M
- Effort: M
- Patch or rewrite: Patch

### UF-10 — No read-tracking on messages (schema gap)
- Source IDs: D-18, E-19, Data Tension 3, E-OQ-04
- Issue: `training_log_messages` has no `read_at`, `read_by`, or acknowledgement field. Coach cannot surface "unread" badge. Athlete cannot tell when coach replied. Without acknowledgement, both parties operate blind and coaches will abandon the comment feature. Engineering and Domain both flagged this as H risk.
- Proposed change: Add `coach_read_at timestamptz null` and `athlete_read_at timestamptz null` to `training_log_messages`. When athlete views a session, mark all that session's messages with `athlete_read_at = now()` (and vice versa). Service exposes `markMessagesRead(sessionId, exerciseId | null, role)`. Unread badge = messages where the viewer's `read_at` is null and `sender_type != viewer_role`.
- Storage target: Two new nullable timestamp columns on `training_log_messages`
- Migration required: Yes
- Risk: H (coaching trust issue)
- Effort: M
- Patch or rewrite: Patch

Note on tension: Engineering (E-OQ-04) asks whether per-role timestamps or a join-table receipt model is correct. The per-role timestamp approach (two columns) is recommended here: simpler query, sufficient for single-coach/single-athlete scenarios, extensible later. Requires user confirmation if multi-coach shared-athlete scenarios are a near-term requirement (see Section 6, T-04).

### UF-11 — Session comments only visible in edit mode on athlete side
- Source IDs: U-10
- Issue: Coach may post a session-level comment between sessions. Athlete must enter edit mode to see it.
- Proposed change: Render a read-only message indicator in `SessionPreview` — "Coach left N comment(s)" row with the most recent comment inline; tap to reply enters edit mode.
- Migration required: No
- Risk: M
- Effort: S
- Patch or rewrite: Patch

---

## Section 4 — Correction without footguns

User's fourth stated priority.

### UF-12 — `window.confirm()` for destructive actions on mobile
- Source IDs: U-04
- Issue: All four destructive athlete actions use `window.confirm()`. On iOS WebKit and some Android in-app browsers, `window.confirm()` is suppressed or shows as an unstyled system dialog. The bonus-day delete confirm is high-stakes.
- Proposed change: Replace each `window.confirm()` with an in-app modal. Bottom-sheet for high-risk actions (bonus day delete, off-plan exercise delete). Inline undo toast ("Set removed — undo", 4-second timeout) for low-risk single-set delete.
- Migration required: No
- Risk: H (data loss on mobile)
- Effort: M
- Patch or rewrite: Patch

### UF-13 — Athlete TodayScreen: mode switch is lossy mid-edit
- Source IDs: U-06
- Issue: Selecting a different day chip while in edit mode resets `mode` to `'preview'`. Partially entered numeric values are lost silently.
- Proposed change: Track a `dirty` flag. Warn before switching slots when dirty, or switch to autosave-on-change with debounce (preferred given U-18 work).
- Migration required: No
- Risk: M
- Effort: M
- Patch or rewrite: Patch

### UF-14 — Coach can delete off-plan logged exercises but not planned-slot ones
- Source IDs: U-05
- Issue: `LogDayCard` renders planned exercises without `onDelete`; off-plan exercises get `onDelete`. Coach's only tool for a planned exercise is `CoachSetEditModal`, which requires deleting sets one by one.
- Proposed change: Pass `onDeleteLogExercise` to `LogExerciseRow` for planned exercises when a `logged` exercise exists. Requires the same in-app confirmation modal as UF-12 (shared component).
- Migration required: No
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-15 — VAS slider silently loses value on navigation
- Source IDs: U-11, E-01 (related)
- Issue: `VasField` uses `onMouseUp`/`onTouchEnd`/`onKeyUp` to commit. If athlete drags then immediately taps a day chip, the commit may not fire. Value lost silently.
- Proposed change: Add `onChange` commit (debounced 300ms) in addition to pointer-up events.
- Migration required: No
- Risk: M (silent data loss)
- Effort: S
- Patch or rewrite: Patch

### UF-16 — No save-in-progress indicator on ExerciseLogCard
- Source IDs: U-18
- Issue: While a set save is in flight, only `SetEntryRow` shows `busy`. Top-level `saving` flag is not threaded to `ExerciseLogCard`. Athlete may double-tap during laggy network, creating duplicate sets.
- Proposed change: Thread top-level `saving` to `ExerciseLogCard` as an additional `disabled` condition. Show per-card saving indicator.
- Migration required: No
- Risk: M
- Effort: S
- Patch or rewrite: Patch

---

## Section 5 — Week overview cleanup

User's fifth stated priority.

### UF-17 — WeekScreen: "Continue logging" mislabels completed sessions
- Source IDs: U-13
- Issue: For a completed session, the expanded panel shows a button labelled "Continue logging" — implies more to do when there is nothing outstanding.
- Proposed change: When `day.status === 'completed'`, change label to "View in log" and navigate to TodayScreen in preview mode.
- Migration required: No
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-18 — Coach WeekOverview: day metric table cannot distinguish skipped vs no-session
- Source IDs: U-08 (partially covered)
- Issue: See UF-06 for the display side. Related: LogWeekOverview aggregates all days without a clear absent-vs-skipped visual distinction.
- Proposed change: Resolved in UF-06; no additional change.
- Migration required: No
- Risk: L
- Effort: S (absorbed into UF-06)
- Patch or rewrite: Patch

### UF-19 — "Avg / K" label undefined
- Source IDs: D-14
- Issue: Fifth stat cell in `LogWeekOverview` labelled "Avg / K" — not standard OWL abbreviation, intent is "average kg/rep".
- Proposed change: Change to "Avg kg/rep" (or "Mean intensity"). Source from coach-configurable string.
- Migration required: No
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-20 — sRPE column shown but never entered
- Source IDs: D-15, Domain Tension 3
- Issue: Coach day card renders `session.session_rpe` as "sRPE". Athlete app explicitly omits RPE input. Column always shows blank. Misleading for coaches who rely on sRPE as their primary training load proxy.
- Proposed change: Hide sRPE from `LogDayCard` until athlete input is added. Add to `WeekMetricsSettings` toggles so coach can opt-in when they add athlete input.
- Migration required: No (schema column stays)
- Risk: M
- Effort: S
- Patch or rewrite: Patch

### UF-21 — WeekMetricsSettings popover lacks close-on-Escape
- Source IDs: U-12
- Issue: Popover closes on backdrop click but not on Escape key.
- Proposed change: Add `useEffect` listening for Escape, matching `ImageLightbox.tsx:13–17` pattern.
- Migration required: No
- Risk: L
- Effort: S (5-line change)
- Patch or rewrite: Patch

---

## Section 6 — Architecture cleanup

User's sixth stated priority.

### UF-22 — VAS score silently discarded (`SessionPatch` omits `vas_score`)
- Source IDs: E-01, DE-01
- Issue: `SessionPatch` is a `Pick<TrainingLogSession>` that excludes `vas_score`. `TodayScreen:325` calls `patchSession({ vas_score: vas })` but the key is stripped by the `as never` cast inside `updateSession`. Every VAS write since v2 has been lost without a TypeScript error or runtime warning. This is the most critical data-loss bug in the codebase.
- Proposed change: Add `'vas_score'` and `'custom_metrics'` to the `SessionPatch` Pick union at `trainingLogService.ts:510`.
- Migration required: No
- Risk: H (silent data loss)
- Effort: S
- Patch or rewrite: Patch

### UF-23 — Stale generated types: eight `any` casts suppress DB write type-checking
- Source IDs: E-15
- Issue: `database.types.ts` does not match the current schema. Every DB write in `trainingLogService.ts` uses `const row: any = {...}` guarded by `as never` casts. This is the structural cause of UF-22 and would have caught it at compile time had types been current.
- Proposed change: Run `supabase gen types typescript --local > src/lib/database.types.ts` after all pending migrations are applied. Then clean up all eight call sites.
- Migration required: Yes (must run after Schema Group A migrations are applied)
- Risk: H
- Effort: S (regen) / M (cleanup)
- Patch or rewrite: Patch

### UF-24 — `useTrainingLog` is dead code with direct Supabase calls
- Source IDs: E-02
- Issue: `src/hooks/useTrainingLog.ts` (553 lines). No component imports it. Contains direct Supabase calls duplicating `trainingLogService.ts`. Uses `status: 'planned'` — a value not in current `SESSION_STATUSES`. Contains `initSetsFromPlan` (lines 281–365) — this operation is absent from the new service layer; Engineering CT-3 flags this as a domain question.
- Proposed change: Delete the file. Before deleting, confirm with domain reviewer whether `initSetsFromPlan` is intentionally absent (see Section 7, Q-06).
- Migration required: No
- Risk: L (deletion)
- Effort: S
- Patch or rewrite: Rewrite (deletion)

### UF-25 — `LogModeView` duplicate fetch path with unmount race condition
- Source IDs: E-03, E-04
- Issue: Lines 55–71 define a `reload` callback. Lines 122–146 duplicate it in a `useEffect` with an `AbortSignal` cancelled guard. `reload` lacks the guard — race on unmount. Every comment post, delete, and settings change triggers a full three-table reload.
- Proposed change: Extract a single `loadAll(signal: AbortSignal)` async function used by both paths. Adopt optimistic-merge pattern matching athlete side for comment and set mutations. Reserve `reload()` for settings changes.
- Migration required: No
- Risk: M
- Effort: M
- Patch or rewrite: Patch (targeted rewrite of the data-fetch section)

### UF-26 — Sentinel rendering triplicated across three files
- Source IDs: E-07, CT-2
- Issue: `ExerciseLogCard.tsx:165–264`, `LogExerciseRow.tsx:87–253`, and `SessionPreview.tsx:163–297` each contain their own `switch` over `text / image / video / gpp`. The image branch is ~250 lines copy-pasted. Theme colours diverge.
- Proposed change: Extract a new `SentinelDisplay` component accepting `sentinelType`, `notes`, `metadata`, `theme: 'dark' | 'light'`. Each call site becomes one line. UX reviewer must validate which theme colour differences are intentional vs drift before extraction (see T-02 in Section 8).
- Migration required: No
- Risk: M
- Effort: M
- Patch or rewrite: Rewrite (new shared component)

### UF-27 — `parseNumber` and `formatTimestamp` duplicated
- Source IDs: E-08, E-09
- Issue: `parseNumber` is byte-for-byte identical in `SetEntryRow.tsx:54–59` and `CoachSetEditModal.tsx:25–30`. `formatTimestamp` is identical in `AthleteCommentsThread.tsx:28–34` and `LogCommentsThread.tsx:31–37`.
- Proposed change: Move `parseNumber` (renamed `parseNumericInput`) to `trainingLogModel.ts`. Move `formatTimestamp` to `src/lib/logFormatUtils.ts`. Update all importers.
- Migration required: No
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-28 — Delta colour class logic duplicated in three files
- Source IDs: E-10
- Issue: Three inline ternary chains mapping `DeltaState` to Tailwind classes in `LogExerciseRow.tsx:337–349`, `SessionPreview.tsx:377–389`, and `LogWeekOverview.tsx:86–92`.
- Proposed change: Add `getDeltaBorderClass(state: DeltaState): string` and `getDeltaChipClass(state: DeltaState): string` to `trainingLogModel.ts`. Replace all three inline chains.
- Migration required: No
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-29 — `plannerUtils.ts` mixes pure utilities with direct Supabase calls
- Source IDs: E-17
- Issue: Pure functions (`getSentinelType`, `getYouTubeThumbnail`, `isDirectVideoFile`) co-located with impure `getOrCreateSentinel` that calls Supabase directly. Athlete app implicitly depends on Supabase and ownerContext through this import.
- Proposed change: Split into `sentinelUtils.ts` (pure functions) and `sentinelService.ts` (impure). Update 6+ importers.
- Migration required: No
- Risk: M
- Effort: S
- Patch or rewrite: Patch

### UF-30 — `GppLogCard` useEffect dep suppressed and stale closure
- Source IDs: E-11, E-12
- Issue: `GppLogCard.tsx:52–56` seeds rows from `planned.rows.length` only. If coach rearranges rows without changing count, merge never fires. `enqueueSave` builds payload from stale `title`/`description` closure (lines 96–98).
- Proposed change: Use content-hash dep, or memoize `planned` at call site. Pass `title`/`description` as parameters to the save function, or read from a ref.
- Migration required: No
- Risk: M
- Effort: S
- Patch or rewrite: Patch

### UF-31 — `CoachSetEditModal` concurrent save race condition
- Source IDs: E-20, E-OQ-03
- Issue: Every `onBlur` fires a direct `upsertLoggedSet`. Concurrent calls for the same `(log_exercise_id, set_number)` can both land on the `!existing` branch and attempt two inserts. No DB unique constraint exists to prevent duplicates (see also UF-35).
- Proposed change: Serialize saves with `pendingRef / processingRef` pattern matching `GppLogCard`. Add row-level `saving` flag. This is partially solved by UF-35 (DB unique constraint + upsert) but the application-level queue is still needed for UX feedback.
- Migration required: No (application change; schema change in UF-35)
- Risk: M
- Effort: S
- Patch or rewrite: Patch

### UF-32 — Miscellaneous small cleanups
- Source IDs: E-05, E-06, E-13, E-16, E-18, E-21
- Bundled changes:
  - E-05: Replace `as unknown as Exercise` casts in `TodayScreen.tsx:543–569` with a proper `ExerciseStub` type.
  - E-06: Remove unused `raw_guidance` from `SessionPatch` (after E-02 deleted `useTrainingLog`; data reviewer to decide schema drop — see Section 7, Q-02).
  - E-13: Delete dead hidden span `<span className="hidden">{logExercise.id}</span>` in `OffPlanExerciseCard.tsx:142`.
  - E-16: Replace silent `console.warn` on persistence failures with structured error surfaces.
  - E-18: Remove `loggedSetsByPlannedId` useMemo in `TodayScreen` and use already-found `le` directly.
  - E-21: Differentiate error categories in `runSave` catch — avoid unconditional `loadDay()` for transient network failures.
- Migration required: No
- Risk: L
- Effort: S
- Patch or rewrite: Patch

---

## Section 7 — Domain hardcoding (coach-flexibility violations)

### UF-33 — Eleiko RAW system hardcoded into schema and code
- Source IDs: D-03, D-05, U-17
- Issue: `ELEIKO_RAW_AXES` (four named pillars: sleep, physical, mood, nutrition), `ELEIKO_RAW_BANDS` (three score bands with verbatim Eleiko bullets), and the column structure on `training_log_sessions` (`raw_sleep`, `raw_physical`, `raw_mood`, `raw_nutrition`) all hardwire a single commercially specific wellbeing product. The label "RAW readiness (Eleiko 4-pillar)" appears in `WeekMetricsSettings.tsx:290`. Any coach using POMS, RESTQ-Sport, or a custom questionnaire cannot use the wellbeing log.
- Proposed change: This is the most invasive flexibility issue. Two resolution paths:
  - Path A (full parameterization): Coach-scoped wellbeing config table (axes: label, ratings, descriptions, direction). Schema change to `training_log_sessions` to replace four hardcoded columns with `wellbeing_scores jsonb`. Breaking migration, historical data must be transformed.
  - Path B (minimal fix): Rename "Eleiko 4-pillar" label to "Readiness (RAW 1–3 scale)" in code; leave the rest as-is, document as a known CLAUDE.md violation pending full parameterization.
- User decision required: yes — which path? (See Section 9, Q-01)
- Storage target: Path A requires new coach-scoped config table + JSONB column on sessions
- Migration required: Path A: Yes (major). Path B: No.
- Risk: H (CLAUDE.md principle 1 violation)
- Effort: Path A: L. Path B: S.
- Patch or rewrite: Path A: rewrite. Path B: patch.

### UF-34 — Delta thresholds hardcoded
- Source IDs: D-02
- Issue: `DEFAULT_DELTA_THRESHOLDS = { amberMin: 0.70, matchedMin: 0.95 }` are fixed constants. Peaking week needs `matchedMin: 1.0`; base block may accept `0.60`.
- Proposed change: Store per-plan override with fallback to coach default in `athlete_week_metrics_config` (or a separate plan-config table). Expose in `WeekMetricsSettings` as number inputs.
- Storage target: New JSONB `delta_thresholds` column on `athlete_week_metrics_config`
- Migration required: Yes
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-35 — Session and exercise status sets not coach-configurable
- Source IDs: D-01
- Issue: `SESSION_STATUSES` and `EXERCISE_STATUSES` are hardcoded arrays. The status `'skipped'` is written nowhere but treated as meaningful by delta logic. `'failed'` is in the type but has no UI affordance. Pain-management and modification protocols cannot distinguish "intentional skip" from "ran out of time".
- Proposed change: Coach-scoped terminal-state set with configurable labels and defaults. The `'failed'` status question (D-09) must be resolved first (see Section 9, Q-03).
- Storage target: Coach-scoped config (JSONB or FK-to-lookup)
- Migration required: Yes (if configurable status rows added)
- Risk: M
- Effort: M
- Patch or rewrite: Patch

### UF-36 — Technique rating 1–5 has no defined scale
- Source IDs: D-13
- Issue: `technique_rating` displayed as "tech N/5" with no definition of what 1 and 5 mean. Field only visible on coach side; athlete has no input affordance.
- Proposed change: Coach-defined scale labels, or replace integer with a free-text technique note field. Athlete input to be added when scale is defined.
- Storage target: Optional: new `technique_rating_labels` coach config
- Migration required: No for label config (JSONB). Yes if column type changes.
- Risk: L
- Effort: S
- Patch or rewrite: Patch

### UF-37 — Bonus day "Extra N" label hardcoded
- Source IDs: D-06, Data DG-06
- Issue: Fallback label `Extra ${d - activeDays.length}` is hardcoded. Bonus day type/purpose field absent. Label is tied to `week_plans.day_labels` (coach plan row), not `training_log_sessions` — so athlete-created bonus sessions lose their label if `weekPlanId` is null.
- Proposed change: Add `session_label text null` column to `training_log_sessions`. Service writes label there. Coach-configurable list of bonus day types to replace the hardcoded string.
- Storage target: New column on `training_log_sessions`; optional coach-scoped config for label list
- Migration required: Yes
- Risk: L
- Effort: S
- Patch or rewrite: Patch

---

## Section 8 — Schema and data layer (migrations)

### UF-38 — VAS score missing from SessionPatch (data layer fix)
- Source IDs: DE-01 (schema expression of E-01)
- Absorbed into UF-22 above. No separate action.

### UF-39 — `training_log_sets` and `training_log_messages` lack indexes
- Source IDs: DD-02, DD-03
- Issue: Both tables created without indexes. Every `fetchWeekLog` / `fetchSessionForSlot` query performs a sequential scan filtered by array membership (`IN (exIds)`). Highest-volume read tables.
- Proposed change:
  - `CREATE INDEX idx_training_log_sets_log_exercise ON training_log_sets(log_exercise_id);`
  - `CREATE INDEX idx_training_log_messages_session ON training_log_messages(session_id);`
- Migration required: Yes
- Risk: H (performance)
- Effort: S
- Patch or rewrite: Migration only

### UF-40 — No DB unique constraint on `(log_exercise_id, set_number)`
- Source IDs: DB-04, E-OQ-03
- Issue: `upsertLoggedSet` does manual SELECT-then-INSERT-or-UPDATE. No constraint. Concurrent double-taps can produce duplicate rows; `.single()` reads then throw. `GppLogCard`'s serial queue protects that path; the general path is unprotected.
- Proposed change:
  - `ALTER TABLE training_log_sets ADD CONSTRAINT uq_set_number UNIQUE (log_exercise_id, set_number);`
  - Convert `upsertLoggedSet` to `INSERT ... ON CONFLICT (log_exercise_id, set_number) DO UPDATE SET ...`.
- Migration required: Yes
- Risk: M (runtime exceptions from duplicate rows)
- Effort: S
- Patch or rewrite: Migration + service patch

### UF-41 — `owner_id` absent from three high-volume tables
- Source IDs: DA-01, DA-02, DA-03
- Issue: `training_log_exercises`, `training_log_sets`, and `training_log_messages` lack `owner_id`. RLS at Auth cutover will require expensive multi-hop JOINs. `training_log_sets` and `training_log_messages` also have RLS disabled (DB-02).
- Proposed change: Backfill `owner_id` from parent chain (sessions → exercises → sets/messages). Add `ENABLE ROW LEVEL SECURITY` + permissive anon transitional policies on `training_log_sets` and `training_log_messages`.
- Migration required: Yes (data migration + ALTER TABLE)
- Risk: H (blocks Auth cutover)
- Effort: M
- Patch or rewrite: Migration

### UF-42 — `updated_at` columns have no trigger
- Source IDs: DF-01, DF-02, DF-03
- Issue: `training_log_sets`, `training_log_exercises`, and `training_log_sessions` have `updated_at` columns but no UPDATE triggers. Columns always equal `created_at` after first write. CLAUDE.md requires "last-write-wins with timestamps" for collaborative scenarios.
- Proposed change: Add `moddatetime` trigger (or equivalent) to all three tables.
- Migration required: Yes
- Risk: M
- Effort: S
- Patch or rewrite: Migration

### UF-43 — `training_log_sets.notes` carries two semantic roles
- Source IDs: DC-01, Data Tension 2
- Issue: `notes` serves as athlete annotation (normal sets) and as "performed value" for free-text rows. Orthogonal concepts. A free-text exercise with a note would have both meanings conflated.
- Proposed change: Add `performed_text text null` to `training_log_sets`. Service writes `performed_text` for free-text rows; retains `notes` for athlete annotations.
- Migration required: Yes
- Risk: M
- Effort: S
- Patch or rewrite: Migration + service patch

### UF-44 — Hot-path `fetchAthleteDay` re-resolves weekPlanId already known from overview
- Source IDs: DD-01
- Issue: `WeekScreen` calls `fetchWeekOverview` (which resolves `weekPlanId`) and then calls `fetchAthleteDay` which re-resolves the same `weekPlanId` in 3 sequential round-trips. 500–900ms of avoidable serial latency on mobile.
- Proposed change: Pass `weekPlanId` as an optional argument to `fetchAthleteDay`. When provided, skip steps 1–3 of the resolution chain.
- Migration required: No
- Risk: L (performance)
- Effort: S
- Patch or rewrite: Patch

### UF-45 — `day_schedule.weekday` convention inconsistent between migration and service
- Source IDs: DE-02
- Issue: Migration documents `weekday: 0=Mon`. Service code says `1=Mon`. `WeekScreen.tsx:196` uses `Weekday[day.weekday]`. If planner writes 0-based and display assumes 1-based, every day label is off by one.
- Proposed change: Inspect live data to determine which convention is actually stored. Fix documentation and code to match. If storage is inconsistent, write a one-time data migration.
- Migration required: Possibly (data inspection required first)
- Risk: M (days could be shifted by one for all athletes)
- Effort: S
- Patch or rewrite: Patch

### UF-46 — Combo logging collapses per-position data
- Source IDs: D-10, Domain Tension 4
- Issue: Combo exercises (e.g. "2 Snatch + 1 OHS") logged as a single `training_log_exercise` row. No field for per-component loads. `computeDelta` aggregates against `summary_total_reps` — an athlete who skips the OHS portion shows green. Per-component data is essential during peaking cycles.
- Proposed change: Coach-scoped toggle "log combos as single unit (current) / log combos per-position". Per-position option adds sub-rows keyed by combo member position in `training_log_exercises`. Schema change required.
- User decision required: yes (see Section 9, Q-04)
- Storage target: New `combo_position` column on `training_log_exercises` (nullable); or separate junction table.
- Migration required: Yes (schema change + UI)
- Risk: H (data once logged per-position cannot be recovered)
- Effort: L
- Patch or rewrite: Rewrite

### UF-47 — Miscellaneous data/schema findings
- Source IDs: DA-04, DA-05, DB-01, DB-03, DB-05, DC-02, DC-03, DC-04, DD-04, DG-06 (partially)
- Bundled:
  - DA-04/DA-05: Add `owner_id` filter to `fetchMetricDefinitions` and `fetchWeekMetricsConfig` service queries (pre-Auth hardening).
  - DB-01: Rename non-standard migration files to match project convention (`YYYYMMDDHHMMSS_n_name.sql`).
  - DB-03: Add rollback commentary to migrations 20260519000001–4.
  - DB-05: Change `athlete_week_metrics_config` unique constraint to `(athlete_id, owner_id, week_start)` post-Auth.
  - DC-02: Add CHECK constraint to `training_log_exercises.metadata` for `removed_set_numbers` array type.
  - DC-03: Add DB comment to `GppSection` JSONB noting `rows[*].done` is athlete-side only.
  - DC-04: Convert `setSessionCustomMetric` to use `jsonb_set` atomic operation.
  - DD-04: Convert `upsertWeekMetricsConfig` to `INSERT ... ON CONFLICT DO UPDATE`.
  - DG-06: Resolved by UF-37 (`session_label` column on `training_log_sessions`).
- Migration required: Partially (DB-05 constraint change, DC-02 CHECK constraint)
- Risk: L
- Effort: S
- Patch or rewrite: Patch

---

## Section 9 — Rewrite candidates

### R-01 — `useTrainingLog` (src/hooks/useTrainingLog.ts)
- Reason: Dead code. No component imports it. 553 lines of pre-v2 Supabase calls duplicating `trainingLogService.ts`. Contains `status: 'planned'` — a value not in current `SESSION_STATUSES`.
- Expected behavioral parity: None. Confirm `initSetsFromPlan` (lines 281–365) is not needed before deleting (see Q-06).
- Risk: L

### R-02 — `SentinelDisplay` (new shared component, extracted from three copy-paste branches)
- Reason: `ExerciseLogCard.tsx`, `LogExerciseRow.tsx`, and `SessionPreview.tsx` all contain their own switch over sentinel types. Image branch is ~250 lines copy-pasted. Theme colours diverge, making future sentinel types require three-file edits.
- Expected behavioral parity: Identical rendering for text, image, video, GPP sentinel types in both dark (athlete) and light (coach) themes.
- Risk: M (requires UX sign-off on which theme differences are intentional — see T-02)

### R-03 — `LogModeView` data-fetch section (src/components/planner/log/LogModeView.tsx:55–146)
- Reason: Duplicate fetch path with unmount race condition. Full three-table reload on every write. Merge these into a single `loadAll(signal)` function; add optimistic-merge for comment and set mutations.
- Expected behavioral parity: Same data visible after any mutation. Week log, metrics config, and metric definitions all load on mount and on settings change.
- Risk: M

---

## Section 10 — Cross-perspective tensions

### T-01 — "Done" sources: set-count vs exercise status column
- Perspectives involved: UX, Domain, Engineering, Data
- What each wants:
  - UX: Unified visual token (DoneChip) driven by a single source.
  - Domain: Canonical source should be exercise `status` column, auto-promoted when all planned sets reach terminal state.
  - Engineering: A `isExerciseDone()` helper in `trainingLogModel.ts` that both surfaces call.
  - Data: No schema change needed; the `status` column already exists.
- Trade-off: Auto-promotion logic must handle partial sets, free-text (no set rows), and GPP (boolean `done` flag) consistently. Getting this wrong produces "Done" badges on incomplete sessions.
- Recommended resolution: Exercise `status` as canonical source. Auto-promote on terminal-state coverage of planned count. Explicit "Mark complete" for free-text and GPP. Both athlete and coach surfaces call `isExerciseDone()`.
- Confidence: H
- Requires user decision: No

### T-02 — Sentinel rendering: consolidate vs preserve theme colours
- Perspectives involved: Engineering (consolidate), UX (validate intentional differences first)
- What each wants:
  - Engineering: Extract `SentinelDisplay` to eliminate ~750 lines of copy-paste. Three switch statements, one file.
  - UX: Some colour differences between athlete dark theme and coach light theme may be intentional design decisions, not drift. Wants visual audit before consolidation.
- Trade-off: If colours are consolidated prematurely, subtle intentional differences are lost. If consolidation is deferred, the copy-paste diverges further on every change.
- Recommended resolution: UX audit first (a side-by-side comparison of the three renderings is sufficient). Then extract `SentinelDisplay` with `theme: 'dark' | 'light'` prop. Any intentional differences become explicit theme branches in one place instead of implicit in three files.
- Confidence: H
- Requires user decision: No (UX audit is a pre-implementation step, not a user-level call)

### T-03 — `initSetsFromPlan` absent from new service layer
- Perspectives involved: Engineering (delete `useTrainingLog`), Domain (workflow coverage)
- What each wants:
  - Engineering: Delete `useTrainingLog` (dead code). `initSetsFromPlan` is in the dead hook, not in the new service.
  - Domain: Session initialisation from plan is a core OWL workflow. If the omission is accidental, deleting the hook destroys the reference implementation.
- Trade-off: If `initSetsFromPlan` is intentionally absent (TodayScreen does it differently now), safe to delete. If it was accidentally dropped during the v2 rebuild, the deletion loses the only implementation.
- Recommended resolution: Confirm with user whether "initialise sets from plan" is handled elsewhere in the v2 flow (see Section 11, Q-06). If yes, safe to delete. If no, extract the logic to `trainingLogService.ts` before deleting the hook.
- Confidence: M
- Requires user decision: Yes

### T-04 — Comment read-tracking: per-role timestamps vs join-table receipts
- Perspectives involved: Engineering (per-role timestamps simpler), Domain (per-message acknowledgement for trust), Data (either works; join table enables future multi-coach scenarios)
- What each wants:
  - Engineering: Two nullable timestamp columns (`coach_read_at`, `athlete_read_at`) on `training_log_messages`. Simple query, easy backfill.
  - Domain: Per-message acknowledgement sufficient; what coaches need is "did athlete see my reply" — same shape as timestamps.
  - Data: If multi-coach shared-athlete scenarios arrive, timestamps per row are insufficient — a `message_receipts` join table would be needed.
- Trade-off: Timestamps are simpler now but require a table-structure migration if multi-coach shared-athlete is required. Join table is future-proof but over-engineered for the current single-coach model.
- Recommended resolution: Implement per-role timestamps now. Document the multi-coach extension point in the migration file. Migrate to join table when Auth/multi-coach lands.
- Confidence: M
- Requires user decision: Yes (if multi-coach shared-athlete is a near-term target, start with join table)

### T-05 — Eleiko RAW: full parameterization vs minimal label fix
- Perspectives involved: Domain (hardcoding is a CLAUDE.md violation), Engineering (schema change is high-effort), UX (label is currently wrong regardless)
- What each wants:
  - Domain: Full parameterization (coach-scoped wellbeing axes). CLAUDE.md principle 1 is non-negotiable.
  - Engineering: Full parameterization requires replacing four named columns with JSONB and a breaking migration. High effort.
  - UX: Label "Eleiko 4-pillar" is wrong regardless of which path is chosen. Should be fixed in either case.
- Trade-off: Fixing only the label (Path B) is fast but leaves the hardcoded column structure, which is a deeper CLAUDE.md violation. Full parameterization (Path A) is correct but requires a breaking schema migration and a substantial component rewrite.
- Recommended resolution: Fix the label immediately (UF-19/UF-33 label portion, S effort). Defer full parameterization to a dedicated sprint, flagged as a known CLAUDE.md violation until resolved.
- Confidence: M
- Requires user decision: Yes (timeline for full RAW parameterization)

### T-06 — Combo logging grain: single-unit vs per-position
- Perspectives involved: Domain (per-position essential for peaking), Data (schema change + unrecoverable data decision), Engineering (L effort)
- What each wants:
  - Domain: Per-component rows required for technical analysis during peaking cycles. Current single-unit model produces false positives in `computeDelta`.
  - Data: Schema change required. Data once logged per-position cannot be recovered if the model changes again. Decision must be made before athletes start logging peaking cycles.
  - Engineering: This is a large change. Existing sentinel rendering rewrite should land first to reduce blast radius.
- Trade-off: Deferring means athletes log peaking-cycle combos with incorrect delta signals. Rushing means the schema decision is made before the sentinel rewrite is done.
- Recommended resolution: Defer until UF-26 (SentinelDisplay) lands. Then design the per-position schema with explicit migration. Add `computeDelta` guard for combos in the interim (returns `pending` not `red`).
- Confidence: M
- Requires user decision: Yes (Q-04)

### T-07 — Full reload vs optimistic merge (athlete vs coach refresh model)
- Perspectives involved: Engineering, UX
- What each wants:
  - Engineering: `LogModeView` should adopt optimistic merge (like athlete side) — only reload on settings changes.
  - UX: If the other side is simultaneously editing, neither side auto-refreshes. Neither approach solves concurrent edit visibility; optimistic merge is faster but potentially stale.
- Trade-off: Optimistic merge is correct for single-editor scenarios. Full reload on every write provides freshness but penalises the coach UX. CLAUDE.md explicitly rules out real-time sync.
- Recommended resolution: Adopt optimistic merge on the coach side (matching athlete). Add a manual "Refresh" affordance for cases where the coach suspects stale data. Document non-real-time as a known limitation.
- Confidence: H
- Requires user decision: No

---

## Section 11 — Open questions for user

### Topic: Wellbeing / RAW system

**Q-01** — Is Eleiko RAW the only wellbeing framework EMOS needs, or should coaches be able to define custom axes (POMS, RESTQ-Sport, 5-pillar models)? This determines whether UF-33 takes Path A (full parameterization, L effort, breaking schema migration) or Path B (label fix only, S effort). (Sources: D-Q1, U-OQ3)

### Topic: Status vocabulary

**Q-02** — Should `raw_guidance` be dropped from the `training_log_sessions` schema? It is currently in `SessionPatch` and `database.types.ts` but is never written by the current code. (Source: E-OQ-02)

**Q-03** — What does `failed` mean at set level: "athlete attempted and missed the lift" only, or also "aborted mid-attempt"? And should a `failed` attempt be exposed with a third button in `SetEntryRow` (three states: completed / skipped / failed), or modelled as a `miss_count` column? This drives UI design for UF-35. (Sources: D-Q2, D-09)

**Q-04** — Should combo exercises be logged as a single unit (current model) or per-position (e.g. Snatch portion and OHS portion as separate rows)? This is a one-way schema decision — once athletes log in one model, switching requires a data migration. (Source: D-Q4, UF-46)

**Q-05** — For tonnage aggregation (UF-07 / D-11): should warm-up sets be excluded? If yes, how does the system identify warm-up sets — a flag on the set row, a threshold relative to top weight, or not at all? (Source: D-Q5)

**Topic: Comment read-tracking**

**Q-06** — Is multi-coach shared-athlete a near-term scenario? This determines whether the comment read-tracking model uses two nullable timestamps on `training_log_messages` (simple, sufficient for single-coach) or a `message_receipts` join table (future-proof for multi-coach). (Sources: E-OQ-04, T-04)

**Topic: Service layer**

**Q-07** — In the v2 flow, is "initialise sets from plan" (previously `initSetsFromPlan` in `useTrainingLog.ts`) handled by `TodayScreen` or the service layer, or was it accidentally dropped during the v2 rebuild? If dropped accidentally, the logic must be extracted before `useTrainingLog.ts` is deleted. (Source: E-CT-3)

**Q-08** — Is the Supabase CLI connected so that `supabase gen types typescript` can regenerate `database.types.ts`? Resolving UF-23 depends on this. (Source: E-OQ-01)

**Topic: UX behaviour**

**Q-09** — Should athlete be able to reply to per-exercise coach comments from `TodayScreen`, or from session-level only? (Source: U-OQ-1)

**Q-10** — Is sRPE a permanent omission from the athlete app, or a P7 deferral? This determines whether the empty sRPE column is hidden (UF-20) or an athlete input field is added. (Source: D-Q3)

**Q-11** — Is "Finish session" the authoritative completion trigger, or should all-sets-completed auto-complete? (Source: U-OQ-4)

**Q-12** — What is the intended refresh cadence on coach `LogModeView`? (manual only, periodic background poll, or on-focus?) (Source: U-OQ-5)

**Topic: Data**

**Q-13** — `day_schedule.weekday`: inspection of live data required to confirm whether 0-based or 1-based indexing is actually stored. If inconsistent, a one-time data migration is needed. (Source: DE-02)

**Q-14** — When a coach edits a GPP row after the athlete has already saved their version, the current code preserves athlete's edits and appends new rows. Is this the intended merge behaviour? (Source: Data-OQ-4)

---

## Section 12 — Gaps in the review

1. **`TRAINING_LOG_PLAN.md` not cross-referenced.** CLAUDE.md notes a Training Log rebuild in progress. No reviewer audited whether the plan document aligns with current code state. Recommend a pass before implementation.
2. **Athlete PR table not audited.** UF-07 (percentage → kg resolution) requires `athlete_prs`. No reviewer confirmed the table schema, whether PRs are per-exercise or per-lift-category, or whether the lookup is indexed. This must be clarified before implementing D-12.
3. **`fetchAthleteDay` 5–7 round-trip chain (DD-01).** The full latency fix (passing `weekPlanId`) is straightforward, but the internal structure of `fetchSessionForSlot` (which itself has 3–4 round-trips) was not audited for consolidation. A dedicated query-shape review of the hot path would reduce mobile latency further.
4. **`computeDelta` against %1RM values (D-07, D-12).** No reviewer confirmed what value is actually stored in `planned_load` when the prescription is written as a percentage — is it the raw percentage (e.g. 80) or the resolved kg value? This affects how UF-07 should be implemented.
5. **Combo exercise UI (D-10, UF-46).** The combo rendering path in `ExerciseLogCard` was described but not exhaustively audited. The per-position schema design was not proposed in detail; this needs a dedicated design spike before implementation.
6. **E-19 / UF-10 implementation feasibility.** Marking messages as read requires knowing which user is the viewer. Current code has no auth context. The implementation must use a client-side `localStorage` last-seen timestamp or a server-side role field. Neither path was fully designed.
7. **Migration file naming (DB-01).** Data reviewer flagged potential retroactive authoring. The actual applied state of these migrations was not verified. User should confirm which migrations have been applied before writing new ones.

---

## Proposed execution order

Findings are grouped into commits. Each group must typecheck and build cleanly before the next group starts. Groups within the same letter can be implemented in parallel if independent.

---

### Group A — Schema migrations (apply before any code changes)

These must be applied first because code changes in later groups depend on the new columns or constraints.

**Commit A1: `fix(db): add indexes on training_log_sets and training_log_messages`**
- Findings: UF-39 (DD-02, DD-03)
- Preconditions: None
- Post-conditions: Migration file written; user applies; no code changes in this commit
- Migration: `CREATE INDEX idx_training_log_sets_log_exercise ON training_log_sets(log_exercise_id); CREATE INDEX idx_training_log_messages_session ON training_log_messages(session_id);`

**Commit A2: `fix(db): add unique constraint and convert upsert to ON CONFLICT`**
- Findings: UF-40 (DB-04, E-OQ-03)
- Preconditions: A1 applied
- Post-conditions: No duplicate set rows possible. `upsertLoggedSet` in service updated to use `INSERT ... ON CONFLICT`.
- Migration: `ALTER TABLE training_log_sets ADD CONSTRAINT uq_set_number UNIQUE (log_exercise_id, set_number);`

**Commit A3: `fix(db): add performed_text column to training_log_sets`**
- Findings: UF-43 (DC-01)
- Preconditions: None (independent of A1/A2)
- Post-conditions: Column exists; service updated to write `performed_text` for free-text units
- Migration: `ALTER TABLE training_log_sets ADD COLUMN IF NOT EXISTS performed_text text null;`

**Commit A4: `fix(db): add updated_at triggers to log tables`**
- Findings: UF-42 (DF-01, DF-02, DF-03)
- Preconditions: None
- Post-conditions: `updated_at` updated correctly on all writes
- Migration: Add `moddatetime` or equivalent trigger to `training_log_sets`, `training_log_exercises`, `training_log_sessions`

**Commit A5: `fix(db): add read-tracking columns to training_log_messages`**
- Findings: UF-10 (D-18, E-19, Data Tension 3) — schema portion only
- Preconditions: User has answered Q-06 (single-coach vs multi-coach model)
- Post-conditions: `coach_read_at` and `athlete_read_at` columns exist; existing rows null
- Migration: `ALTER TABLE training_log_messages ADD COLUMN IF NOT EXISTS coach_read_at timestamptz null; ADD COLUMN IF NOT EXISTS athlete_read_at timestamptz null;`

**Commit A6: `fix(db): add session_label column to training_log_sessions`**
- Findings: UF-37 (D-06, DG-06)
- Preconditions: None
- Post-conditions: `session_label` column exists; bonus day label service updated
- Migration: `ALTER TABLE training_log_sessions ADD COLUMN IF NOT EXISTS session_label text null;`

**Commit A7: `fix(db): add owner_id to exercises, sets, messages; enable RLS`**
- Findings: UF-41 (DA-01, DA-02, DA-03, DB-02)
- Preconditions: A4 applied (triggers in place before backfill adds rows)
- Post-conditions: `owner_id NOT NULL` on all three tables; RLS enabled on sets and messages with permissive anon policies
- Migration: See data reviewer P1 migration sketch; add RLS statements

---

### Group B — Critical data-loss fixes (service layer, no migrations needed)

These fix active data loss bugs. Implement immediately after Group A migrations are applied.

**Commit B1: `fix(log): add vas_score and custom_metrics to SessionPatch`**
- Findings: UF-22 (E-01, DE-01)
- Preconditions: None (code-only change)
- Post-conditions: VAS writes persist. TypeScript error surface restored.

**Commit B2: `chore(db): regenerate database.types.ts; clean up any casts`**
- Findings: UF-23 (E-15)
- Preconditions: All Group A migrations applied; Supabase CLI connected (Q-08)
- Post-conditions: No `any` casts in service layer; type safety restored for all DB writes

**Commit B3: `fix(scope): remove Analysis pageTitles entry and stale redirect`**
- Findings: SD-03, SD-04
- Preconditions: None
- Post-conditions: No reachable entry point to Analysis module

---

### Group C — Shared utilities and dead code removal

**Commit C1: `refactor(log): delete useTrainingLog dead hook`**
- Findings: UF-24 (E-02)
- Preconditions: Q-07 answered (initSetsFromPlan not needed)
- Post-conditions: File deleted; no import references remain; build passes

**Commit C2: `refactor(log): extract parseNumericInput, formatTimestamp, delta class helpers`**
- Findings: UF-27 (E-08, E-09), UF-28 (E-10)
- Preconditions: None
- Post-conditions: `trainingLogModel.ts` exports `parseNumericInput`, `getDeltaBorderClass`, `getDeltaChipClass`; `logFormatUtils.ts` exports `formatTimestamp`; all callers updated

**Commit C3: `refactor(log): split plannerUtils into sentinelUtils and sentinelService`**
- Findings: UF-29 (E-17)
- Preconditions: None
- Post-conditions: Athlete app no longer imports Supabase through `plannerUtils`; 6+ importers updated

**Commit C4: `fix(log): fix GppLogCard stale closure and dep suppression`**
- Findings: UF-30 (E-11, E-12)
- Preconditions: None
- Post-conditions: GPP rows re-seed when coach reorders without changing count; save payload uses fresh title/description

**Commit C5: `fix(log): misc small cleanups (ExerciseStub, dead span, console.error, useMemo, runSave)`**
- Findings: UF-32 (E-05, E-06, E-13, E-16, E-18, E-21)
- Preconditions: C1 (raw_guidance removal depends on useTrainingLog deletion)
- Post-conditions: No `as unknown as Exercise` casts; no dead spans; structured error surfaces; no redundant useMemo

---

### Group D — "Done" state unification (user priority 1)

**Commit D1: `feat(log): add isExerciseDone helper and auto-promotion logic`**
- Findings: UF-01 (U-01, CT-1, D-08, Data Tension 1) — logic portion, UF-02 (D-08, CT-1)
- Preconditions: C2 (delta helpers extracted to trainingLogModel)
- Post-conditions: `trainingLogModel.ts` exports `isExerciseDone()`; `TodayScreen` and `trainingLogService` auto-promote exercise status after each set save

**Commit D2: `feat(log): add DoneChip shared component; replace all six ad-hoc done indicators`**
- Findings: UF-01 visual portion (U-01, CT-1)
- Preconditions: D1
- Post-conditions: Single `DoneChip` component with `variant: 'dark' | 'light'`; "Done" button renamed "Mark complete"; all six implementations replaced

---

### Group E — Comment visibility (user priority 3)

**Commit E1: `feat(log): surface exercise-level comments in ExerciseLogCard`**
- Findings: UF-08 (U-03, D-16)
- Preconditions: A5 (read-tracking columns), B1 (service layer correct), B2 (types regenerated)
- Post-conditions: Athlete can see and reply to exercise-scoped coach messages in TodayScreen; no `!m.exercise_id` filter on exercise cards

**Commit E2: `feat(log): add comment counts to LogWeekOverview and LogDayCard`**
- Findings: UF-09 (U-02, E-19)
- Preconditions: E1
- Post-conditions: `LogWeekOverview` shows aggregated comment signal; `LogDayCard` collapsed and expanded both show comment count; exercise-level badge visible

**Commit E3: `feat(log): mark messages read; add unread badge`**
- Findings: UF-10 (D-18, E-19, Data Tension 3) — service + UI portion
- Preconditions: A5 (schema), E1, E2
- Post-conditions: Service marks messages read on view; unread dot badge on exercise rows; athlete `WeekScreen` shows unread indicator

**Commit E4: `feat(log): show session comments in preview mode`**
- Findings: UF-11 (U-10)
- Preconditions: E1
- Post-conditions: `SessionPreview` renders read-only comment indicator; tap to reply enters edit mode

---

### Group F — Planned-vs-performed (user priority 2)

**Commit F1: `fix(log): correct delta colouring for free-text and GPP exercises`**
- Findings: UF-04 (U-14, Data Tension 2)
- Preconditions: D1 (isExerciseDone in place)
- Post-conditions: Free-text and GPP exercises show `DeltaState: 'pending'` instead of misleading `'red'`

**Commit F2: `feat(log): add planned prescription context to CoachSetEditModal`**
- Findings: UF-03 (U-07)
- Preconditions: F1
- Post-conditions: Modal renders `StackedNotation` header and read-only "Plan" column per set row

**Commit F3: `feat(log): render GPP planned-vs-performed sub-rows`**
- Findings: UF-05 (U-15)
- Preconditions: F1
- Post-conditions: GPP rows show "Planned" dim sub-row and "Did" primary sub-row when values differ

**Commit F4: `fix(log): distinguish missing vs not-entered in RAW table`**
- Findings: UF-06 (U-08)
- Preconditions: None
- Post-conditions: Existing-session-but-null pillar renders `'nr'` in amber; no-session rows remain `'—'`

---

### Group G — Correction without footguns (user priority 4)

**Commit G1: `feat(log): replace window.confirm with in-app confirmation modals`**
- Findings: UF-12 (U-04)
- Preconditions: None (but benefits from D2 DoneChip for visual consistency)
- Post-conditions: No `window.confirm` calls; bottom-sheet modal for high-risk; undo toast for low-risk set delete

**Commit G2: `feat(log): add save-in-progress indicator and dirty-state guard`**
- Findings: UF-16 (U-18), UF-13 (U-06)
- Preconditions: B1 (VAS fix landed so saving flag is meaningful)
- Post-conditions: `ExerciseLogCard` receives and shows `saving` prop; day-chip navigation warns when dirty or autosaves

**Commit G3: `fix(log): serialize CoachSetEditModal saves`**
- Findings: UF-31 (E-20, E-OQ-03)
- Preconditions: A2 (DB unique constraint), B2 (types regenerated)
- Post-conditions: Serial save queue in `CoachSetEditModal`; row-level `saving` flag; no concurrent `upsertLoggedSet` calls

**Commit G4: `fix(log): add coach delete affordance for planned-slot exercises`**
- Findings: UF-14 (U-05)
- Preconditions: G1 (shared confirmation modal available)
- Post-conditions: `LogExerciseRow` for planned exercises receives `onDeleteLogExercise` when a logged exercise exists

---

### Group H — Week overview cleanup (user priority 5)

**Commit H1: `fix(log): fix sRPE and "Continue logging" label; add Escape key to settings popover`**
- Findings: UF-17 (U-13), UF-20 (D-15), UF-21 (U-12)
- Preconditions: None
- Post-conditions: Completed sessions show "View in log"; sRPE hidden from LogDayCard; Escape closes WeekMetricsSettings

**Commit H2: `fix(log): fix "Avg / K" label and remove Eleiko branding from settings`**
- Findings: UF-19 (D-14), UF-33 label portion (D-05, U-17)
- Preconditions: None
- Post-conditions: Label changed to "Avg kg/rep"; "Eleiko 4-pillar" text removed

**Commit H3: `fix(log): complete free-text exercise done indicator`**
- Findings: UF-09 portion (U-09) — free-text completion signal
- Preconditions: D2 (DoneChip available)
- Post-conditions: `isFreeTextUnit` exercises show `DoneChip` on all-rows-completed

**Commit H4: `perf(log): pass weekPlanId from overview to fetchAthleteDay`**
- Findings: UF-44 (DD-01)
- Preconditions: B2 (types correct)
- Post-conditions: `fetchAthleteDay` skips 3 round-trips when `weekPlanId` is already known; mobile load time reduced

---

### Group I — Architecture cleanup (user priority 6)

**Commit I1: `refactor(log): fix LogModeView data-fetch duplication and reload pattern`**
- Findings: UF-25 (E-03, E-04)
- Preconditions: C2 (shared helpers), B2 (types correct)
- Post-conditions: Single `loadAll(signal)` function; optimistic merge for comment/set mutations; `reload()` only on settings change; no unmount race

**Commit I2: `refactor(log): extract SentinelDisplay shared component`**
- Findings: UF-26 (E-07, CT-2)
- Preconditions: C3 (sentinelUtils split), I1 (LogModeView stable), UX audit of theme colour differences complete
- Post-conditions: `SentinelDisplay` component with `theme` prop; three call sites each one line; identical rendering confirmed

**Commit I3: `fix(log): add PerformedOnField inside SessionHeader; fix VAS commit-on-navigate`**
- Findings: UF-15 (U-11), U-16 (cosmetic reposition)
- Preconditions: G2 (autosave work done)
- Post-conditions: VAS commits on debounced `onChange`; `PerformedOnField` positioned inside SessionHeader

---

### Group J — Domain hardcoding (coach-flexibility, deferred pending user decisions)

These require user decisions (Q-01, Q-03, Q-04, Q-05) before implementation begins.

**Commit J1: `feat(log): make delta thresholds coach-configurable per plan`**
- Findings: UF-34 (D-02)
- Preconditions: A group complete; user decision on storage target
- Post-conditions: Coach can override amber/green thresholds in WeekMetricsSettings

**Commit J2: `feat(log): make session and exercise status sets configurable`**
- Findings: UF-35 (D-01), UF-36 (D-13)
- Preconditions: J1; Q-03 answered
- Post-conditions: Coach-scoped terminal-state config; technique rating scale defined or replaced

**Commit J3: `fix(log): fix tonnage calculation for percentage prescriptions`**
- Findings: UF-07 (D-12, D-07, Domain Tension 2)
- Preconditions: Athlete PR table audited (Section 12, gap 2); Q-05 answered
- Post-conditions: `resolvePercentageToKg` utility; tonnage includes resolved %1RM loads; toggle in WeekMetricsSettings

**Commit J4: `feat(log): Eleiko RAW full parameterization (Path A)`**
- Findings: UF-33 (D-03, D-05, U-17) — full path
- Preconditions: Q-01 answered; J1–J3 complete; breaking migration designed
- Post-conditions: Coach-scoped wellbeing config; JSONB `wellbeing_scores` replaces four hardcoded columns; historical data migrated

**Commit J5: `feat(log): combo logging per-position option`**
- Findings: UF-46 (D-10, Domain Tension 4)
- Preconditions: I2 (SentinelDisplay); Q-04 answered; per-position schema designed
- Post-conditions: Coach toggle for combo logging grain; per-position rows in `training_log_exercises`; `computeDelta` per-component

---

### Group K — Miscellaneous and pre-Auth hardening

**Commit K1: `fix(db): add owner_id filter to metric definition queries`**
- Findings: UF-47 portion (DA-04, DA-05)
- Preconditions: A7 (owner_id backfill applied)
- Post-conditions: `fetchMetricDefinitions` and `fetchWeekMetricsConfig` filter by `owner_id`

**Commit K2: `chore(db): rename non-standard migration files; add rollback comments`**
- Findings: UF-47 portion (DB-01, DB-03)
- Preconditions: User confirms which migrations are applied (Section 12, gap 7)
- Post-conditions: All migration filenames match `YYYYMMDDHHMMSS_n_name.sql` convention

**Commit K3: `fix(db): add CHECK constraint on metadata.removed_set_numbers; atomise jsonb_set`**
- Findings: UF-47 portion (DC-02, DC-04)
- Preconditions: B2 (types current)
- Post-conditions: Invalid JSONB shape rejected at DB level; `setSessionCustomMetric` uses atomic `jsonb_set`


---

## Section 13 — User decisions (locked 2026-05-20)

The following decisions have been made by the user and are binding for the implementer. They override any conflicting interpretation in earlier sections.

### Approved scope

Execute **Groups A through I** in order. Defer **Groups J and K** to a later cycle (domain hardcoding and pre-Auth hardening, respectively).

### Locked answers

**Q-01 (Eleiko RAW)** — **Just relabel.** Keep four pillars + three bands hardcoded. Change only the user-visible "Eleiko 4-pillar" string in WeekMetricsSettings (UF-34 / D-05). Full parameterization of RAW (D-03) is deferred — DO NOT touch the column structure on `training_log_sessions` or the `ELEIKO_RAW_AXES`/`ELEIKO_RAW_BANDS` constants. Document this decision in CLAUDE.md so future agents don't reopen it.

**Q-04 (Combo grain)** — **Keep single-unit (current).** Do not introduce per-position set rows. Group J's combo-grain item (UF-46 / D-10) is deferred indefinitely. The existing combo + free_text_reps fix already shipped on main is sufficient for now.

**Q-06 (Comment read-tracking)** — **Two timestamps on the message row.** Group A5 adds `coach_read_at timestamptz null` and `athlete_read_at timestamptz null` columns to `training_log_messages`. Do NOT introduce a `message_receipts` join table. If multi-coach shared athletes becomes a near-term scenario, revisit then.

**Q-07 (initSetsFromPlan)** — **Investigate before deletion.** Group C1 implementer must verify whether the v2 athlete flow has lost the "reset all sets to plan" capability:
- Read TodayScreen + trainingLogService and confirm no caller needs this behaviour.
- If a coach-facing "reset to plan" affordance is desired, port the logic into `trainingLogService` as a new function before deleting `useTrainingLog.ts`.
- If genuinely unused, delete `useTrainingLog.ts` as planned.
- Document the conclusion in the C1 commit message.

**Q-08 (Supabase CLI)** — **Not connected on user's machine.** Group B2 implementer must NOT attempt to run `supabase gen types typescript`. Instead, hand-extend `database.types.ts` with the missing columns: `vas_score` on `TrainingLogSession`; `custom_metrics` on `TrainingLogSession`; any other columns recently migrated but missing from the type. The eight `any` casts in `trainingLogService.ts` can then be removed. User will run the gen command later.

**Q-09 (Athlete comment surface)** — **Per-exercise thread in TodayScreen.** Group E1: add `onPostComment` prop to `ExerciseLogCard`, render a compact `AthleteCommentsThread` below the notes textarea filtered to that exercise's `exercise_id`. Use the same component shell as the session-level thread but with `exercise_id` set on writes.

### Defaulted answers (lower-priority questions)

The following questions were not asked individually. The implementer proceeds with these defaults; user can override at PR-review time.

**Q-02 (raw_guidance)** — Drop the column. Add a migration in Group A (call it A8) to drop `raw_guidance` from `training_log_sessions`. Remove from `SessionPatch` Pick list and `database.types.ts`. The Eleiko guidance is now derived client-side from `ELEIKO_RAW_BANDS`.

**Q-03 (failed at set level)** — Remove `'failed'` from the set status union in `database.types.ts` and `trainingLogModel.ts`. Migrate any existing `'failed'` rows to `'skipped'` (defensive, almost certainly zero rows). The UI keeps two buttons (✓ done / ✗ skipped). Move to Group I architecture cleanup.

**Q-05 (warm-up exclusion in tonnage)** — Deferred. Tonnage stays as-is. Document this in CLAUDE.md alongside Q-01.

**Q-10 (sRPE)** — Hide the sRPE column on the coach `LogDayCard` header until a per-week metrics toggle is added. Add the toggle in Group H (week overview cleanup) as a low-priority commit, defaulting OFF. Do not remove the column from the schema.

**Q-11 (Finish session)** — Keep "Finish session" as the authoritative manual trigger. Auto-completion is NOT introduced. Add a subtle hint above the button when all planned sets are completed ("All exercises done — tap to finish") to reduce confusion.

**Q-12 (LogModeView refresh)** — Manual only, with the existing timestamp. No auto-refresh. The reload→merge change in Group H is independent of refresh cadence.

**Q-13 (weekday convention)** — Investigate during Group H. Implementer reads `weekday` values from the live data via a one-time SELECT (read-only, no schema change), confirms whether 0-based or 1-based is the actual stored convention, and updates the JSDoc on the wrong side to match. If both conventions are mixed in the data, a data migration is needed — flag and stop.

**Q-14 (GPP merge behaviour)** — Document current behaviour as intended. The existing comment in `GppLogCard.tsx:35-36` is sufficient; add a corresponding note in `database.types.ts` near the `GppSection` type.

### Implementer ground rules (reiterated from CLAUDE.md)

- Create branch `feature/review/2026-05-20` off current main.
- DO NOT push the branch (leave for manual review).
- DO NOT merge.
- Migration files are WRITTEN under `supabase/migrations/`; the user APPLIES them. Do not run `supabase db push` or any equivalent.
- After each group: typecheck (`npx tsc --noEmit`) and build (`npm run build`) must pass before moving to the next group.
- Stop immediately on any failure, surface the error, do not improvise scope changes.
- Conventional Commits. One logical change per commit. Reference finding IDs in commit bodies where useful.
