# EMOS Engineering Review — 2026-05-20

## Summary
- Findings: 21
- Rewrite candidates: `useTrainingLog` (dead — full deletion candidate), `LogModeView` (dual data-fetch pattern, reload-on-every-write)
- Scope-disablement entry points: 4 (2 already hidden, 2 residual)
- Biggest structural risk: `SessionPatch` omits `vas_score`, so every VAS write in `TodayScreen` silently fails — data is lost at the `updateSession` call without any TypeScript error because the cast `as never` suppresses the type check

## Scope disablement (Analysis, Training Log)

### SD-01
- Location: `src/components/Sidebar.tsx:41`
- Status: Already hidden correctly (commented). No action.

### SD-02
- Location: `src/components/Sidebar.tsx:50`
- Status: Already hidden. No action.

### SD-03
- Location: `src/App.tsx:43`
- Surface: `pageTitles` registry entry `'/analysis': 'Analysis'`
- Action: Remove or comment out.

### SD-04
- Location: `src/App.tsx:174`
- Surface: redirect `/athlete-log → /training-log → /dashboard`
- Action: Change redirect target to `/dashboard` directly, or remove.

## Findings

### E-01 — VAS save silently discarded: `vas_score` absent from `SessionPatch`
- File: `src/lib/trainingLogService.ts:496-514`
- Issue: `SessionPatch` is a `Pick<TrainingLogSession>` that excludes `vas_score`. TodayScreen.tsx:325 calls `patchSession({ vas_score: vas })` but the key is stripped by the `as never` cast inside `updateSession`. VAS value never persists.
- Change: Add `'vas_score'` to the SessionPatch Pick union at line 510.
- Patch · Risk: H (silent data loss) · Effort: S

### E-02 — `useTrainingLog` is dead code with direct Supabase calls from a hook
- File: `src/hooks/useTrainingLog.ts:1-553`
- Issue: Pre-v2 hook, no component imports it. ~360 lines of direct Supabase calls duplicating `trainingLogService.ts`. Uses `status: 'planned'` (line 74), a value not in current SESSION_STATUSES.
- Change: Delete the file.
- Rewrite (deletion) · Risk: L · Effort: S

### E-03 — `LogModeView` fetches identically in `useEffect` AND in `reload`
- File: `src/components/planner/log/LogModeView.tsx:55-146`
- Issue: Lines 55-71 define a `reload` callback running three parallel fetches. Lines 122-146 duplicate this in a `useEffect` with a `cancelled` guard. `reload` lacks the guard — race on unmount.
- Change: Extract a single `loadAll(signal: AbortSignal)` async function used by both paths.
- Patch · Risk: M · Effort: S

### E-04 — `LogModeView` full-reload on every write degrades UX
- File: `src/components/planner/log/LogModeView.tsx:55-119`
- Issue: Every comment post, delete, settings change triggers a full `fetchWeekLog` + `fetchWeekMetricsConfig` + `fetchMetricDefinitions`. Coach side has no in-place merge equivalent to athlete's `mergeSession`/`mergeLogExercise`/`mergeLoggedSet`.
- Change: Adopt optimistic-merge pattern. Reserve `reload()` for settings changes.
- Patch · Risk: M (UX/perf) · Effort: M · Depends: E-03

### E-05 — `as unknown as Exercise` partial cast in TodayScreen
- File: `src/athlete/v2/screens/TodayScreen.tsx:543-544, 568-569`
- Issue: `handleSubstitute` and `handleAddOffPlanExercise` cast `{id, name, color}` to full `Exercise`. Works today but breaks type contract silently.
- Change: Introduce `PartialExercise`/`ExerciseStub` type for the narrow shape; remove the `as unknown as` casts.
- Patch · Risk: M · Effort: S

### E-06 — `SessionPatch.raw_guidance` unused
- File: `src/lib/trainingLogService.ts:507`
- Issue: `raw_guidance` is in SessionPatch and TrainingLogSession (database.types.ts:361). Computed client-side in dead `useTrainingLog`. New flow never writes it. `ensureSession` passes `undefined`.
- Change: Remove `raw_guidance` from `SessionPatch`. Consider migration to drop the column (data reviewer decision).
- Patch · Risk: L · Effort: S · Depends: E-02

### E-07 — Sentinel rendering triplicated across three files
- Files:
  - `src/athlete/v2/components/ExerciseLogCard.tsx:165-264`
  - `src/components/planner/log/LogExerciseRow.tsx:87-253`
  - `src/athlete/v2/components/SessionPreview.tsx:163-297`
- Issue: All three contain own switch for `text`, `image`, `video`, `gpp`. Image branch ~250 lines copy-pasted across all three files. Theme colours differ.
- Change: Extract `SentinelDisplay` component (pure, theme-agnostic) accepting `sentinelType`, `notes`, `metadata`, `theme: 'dark'|'light'`. Each call site becomes single line.
- Rewrite (new shared component) · Risk: M · Effort: M

### E-08 — `parseNumber` duplicated
- Files:
  - `src/athlete/v2/components/SetEntryRow.tsx:54-59`
  - `src/components/planner/log/CoachSetEditModal.tsx:25-30`
- Issue: Byte-for-byte identical.
- Change: Move to `trainingLogModel.ts` as `parseNumericInput(text)`. Import both callers.
- Patch · Risk: L · Effort: S

### E-09 — `formatTimestamp` duplicated
- Files:
  - `src/athlete/v2/components/AthleteCommentsThread.tsx:28-34`
  - `src/components/planner/log/LogCommentsThread.tsx:31-37`
- Issue: Identical function body.
- Change: Move to `src/lib/logFormatUtils.ts`.
- Patch · Risk: L · Effort: S

### E-10 — Delta colour classes duplicated
- Files:
  - `src/components/planner/log/LogExerciseRow.tsx:337-349`
  - `src/athlete/v2/components/SessionPreview.tsx:377-389`
  - `src/components/planner/log/LogWeekOverview.tsx:86-92`
- Issue: Three inline ternary chains map `DeltaState`/ratio → Tailwind classes.
- Change: Move maps + percentage chip class logic into `trainingLogModel.ts` as `getDeltaBorderClass`, `getDeltaChipClass`.
- Patch · Risk: L · Effort: S

### E-11 — `GppLogCard` useEffect dep suppressed with eslint-disable
- File: `src/athlete/v2/components/GppLogCard.tsx:52-56`
- Issue: Re-seeds rows from `planned.rows` only on `planned?.rows.length` change. If coach rearranges rows without changing count, merge never fires.
- Change: Use content-hash dep, or memoise `planned` at call site so referential equality is reliable.
- Patch · Risk: M (silent GPP update miss) · Effort: S

### E-12 — `GppLogCard` serial-queue uses stale closure for title/description
- File: `src/athlete/v2/components/GppLogCard.tsx:96-98`
- Issue: `enqueueSave` builds payload using `title`/`description` from closure (lines 58-59). Stale if `planned` changes after mount.
- Change: Pass `title`/`description` as parameters or read from a ref.
- Patch · Risk: L · Effort: S · Depends: E-11

### E-13 — Dead hidden span in OffPlanExerciseCard
- File: `src/athlete/v2/components/OffPlanExerciseCard.tsx:142`
- Issue: `<span className="hidden">{logExercise.id}</span>` — scaffolding residue.
- Change: Delete the line.
- Patch · Risk: L · Effort: S

### E-14 — Duplicated metric fetches between athlete and coach
- File: `src/components/planner/log/LogModeView.tsx:58-65, 126-135`
- Issue: `fetchAthleteDay` already bundles `fetchWeekMetricsConfig + fetchMetricDefinitions`. LogModeView does same manually.
- Change: Extract `fetchWeekMetricsAndDefs(athleteId, weekStart)` helper used by both.
- Patch · Risk: L · Effort: S

### E-15 — Eight `eslint-disable any` due to stale generated types
- File: `src/lib/trainingLogService.ts:476, 549, 705, 849, 885, 970, 1050, 1113`
- Issue: Every write uses `const row: any = {...}` because Supabase-generated `database.types.ts` doesn't match current schema. `as never` casts suppress type checking on every update. **Direct cause of E-01.**
- Change: Run `supabase gen types typescript` to regenerate. Clean up all call sites.
- Patch · Risk: H (type safety absent for all DB writes) · Effort: S (regen) / M (cleanup) · Depends: E-01

### E-16 — `console.error`/`console.warn` swallowing errors silently
- Files:
  - `src/components/planner/log/WeekMetricsSettings.tsx:41`
  - `src/athlete/v2/screens/WeekScreen.tsx:110, 138`
- Issue: `console.warn('Could not set bonus day label', e)` silently swallows persistence failures.
- Change: Replace with structured error logging or surface to user.
- Patch · Risk: L · Effort: S

### E-17 — `plannerUtils.ts` mixes pure utilities with direct Supabase calls
- File: `src/components/planner/plannerUtils.ts:74-110`
- Issue: Pure functions (`getSentinelType`, `getYouTubeThumbnail`, `isDirectVideoFile`) co-located with impure `getOrCreateSentinel` that calls supabase directly. Athlete app implicitly depends on supabase + ownerContext through this import.
- Change: Split into `sentinelUtils.ts` (pure) and `sentinelService.ts` (impure).
- Patch · Risk: M (cross-cutting; 6+ importers) · Effort: S

### E-18 — Redundant memoised map in TodayScreen
- File: `src/athlete/v2/screens/TodayScreen.tsx:176-182, 723`
- Issue: `loggedSetsByPlannedId` Map built via useMemo, but lookup at line 723 uses same key for which a `.find` already ran at line 715.
- Change: Replace `.get(p.exercise.id)` with `le?.sets ?? []` using the already-found `le`. Remove the useMemo.
- Patch · Risk: L · Effort: S

### E-19 — No unread-comment indicator anywhere
- File: `src/components/planner/log/LogDayCard.tsx:120-125`
- Issue: No `read_at`/`is_read` column on `training_log_messages`. LogDayCard shows MessageSquare + count only on collapsed header for session-level messages. Exercise-level comments invisible from day header.
- Change: (a) Add `read_by_coach_at` nullable timestamp on training_log_messages, (b) compute `unread_exercise_comment_count` in DayLog, (c) surface as dot badge on exercise row.
- Patch (new feature) · Risk: M · Effort: M

### E-20 — CoachSetEditModal: no save queue, race on rapid blur
- File: `src/components/planner/log/CoachSetEditModal.tsx:86, 115`
- Issue: Every `onBlur` fires direct `upsertLoggedSet`. Two concurrent calls for the same `(logExerciseId, setNumber)` could land both on the `!existing` branch and attempt two inserts.
- Change: Serialise saves with `pendingRef/processingRef` pattern matching `GppLogCard`. Add row-level `saving` flag.
- Patch · Risk: M (race condition) · Effort: S

### E-21 — `runSave` over-aggressive reload on errors
- File: `src/athlete/v2/screens/TodayScreen.tsx:217-228`
- Issue: `catch` calls `await loadDay()` for any error including transient network failures. Doubles error surface.
- Change: Differentiate error categories. Flag-based `opts?.reloadOnError = true` defaulting false for set saves, true for structural mutations.
- Patch · Risk: L · Effort: S

## Cross-perspective tensions

**CT-1: "Done" vocabulary fragmentation.** `ExerciseLogCard` uses `allCompleted` (all sets completed). `LogExerciseRow` uses `logged.log.status === 'completed'` (exercise-level field). `SessionPreview` uses `allCompleted` again. Semantically different. Fix: canonical `isExerciseDone(le: LoggedExerciseFull | null): boolean` helper in trainingLogModel.

**CT-2: Sentinel rendering duplication (E-07) vs clean light/dark theming.** A `SentinelDisplay` will need theme prop. UX reviewer should validate visual differences are intentional before consolidation.

**CT-3: `useTrainingLog` dead code (E-02) vs service layer contract.** Old hook contains `initSetsFromPlan` (line 281-365) — operation absent from new service. Confirm with domain reviewer whether the omission is intentional.

## Priority recommendations

1. **Ship E-01 immediately** (vas_score silent data loss)
2. **E-15 + E-01 together** (regenerating types eliminates both)
3. **E-02** — delete `useTrainingLog.ts`
4. **E-03 + E-04** — fix LogModeView load/reload duplication
5. **E-07** — consolidate sentinel rendering
6. **E-08 + E-09 + E-10** — batch small extractions in one commit
7. **E-17** — split `plannerUtils.ts`
8. **E-19** — unread comment indicator (flag to data reviewer)

## Open questions

**OQ-01** — Is Supabase CLI connected so `supabase gen types typescript` can regenerate? Resolving E-15 depends on this.

**OQ-02** — Should `raw_guidance` be dropped from schema? Never written by current code.

**OQ-03** — Is there a unique constraint on `training_log_sets(log_exercise_id, set_number)`? Determines severity of E-20.

**OQ-04** — For unread-comment feature (E-19): per-role (athlete reads/coach reads) or per-sender? Changes schema from nullable timestamp to join table.
