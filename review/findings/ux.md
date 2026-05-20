# EMOS UX Review — 2026-05-20
## Training Log Surfaces (Athlete App + Coach Log Mode)

## Summary

- Findings: 18
- Flows audited: Athlete Today (preview → log → finish), Athlete Week overview, Coach LogModeView → LogWeekOverview → LogDayCard → LogExerciseRow → CoachSetEditModal, Cross-surface comment threads, WeekMetricsSettings, All sentinel types (text/image/video/GPP)
- Biggest workflow friction: The "done" state is communicated differently on every surface — CheckCircle2 icon on ExerciseLogCard, a text "Done" pill on SessionPreview/LogDayCard/LogExerciseRow, a coloured left-border on LogExerciseRow, a coloured row background on SetEntryRow, and a "Done" button that is actually "Mark complete" inside ExerciseLogCard — with no single shared vocabulary.

## Flow Walkthrough

An athlete opens the app, lands on TodayScreen in preview mode showing a read-only SessionPreview. They tap "Start logging," which switches to edit mode. The athlete works through planned exercises: each card shows the prescription in StackedNotation and an expand/collapse toggle. Sets are entered row by row via SetEntryRow with ✓/✗ buttons and save-on-blur numeric cells. When all planned sets have been tapped through, the athlete taps "Finish session".

On the coach side, the same week is visible in LogModeView. A LogWeekOverview ribbon shows aggregate planned vs performed stats, day-status dots, and metric tables. Below it, one LogDayCard per day renders collapsed by default. The coach clicks to expand a day, sees each exercise paired with its planned and performed notation and a left-border colour (green/amber/red by rep-completion ratio). Per-exercise comment threads are hidden behind a "Comment" toggle link.

Obstacles: (1) The athlete has no way to reply to a coach's per-exercise comment. (2) The coach cannot tell from the collapsed LogDayCard header how many unread athlete messages exist. (3) Deleting a planned set, an off-plan exercise, an entire set, and an entire bonus day all use `window.confirm()`. (4) The WeekScreen only shows a "Done" pill and an exercise count per day; it does not show whether the coach has posted comments.

## Findings

### U-01 — Done-state vocabulary fragmented across surfaces
**Files:**
- `src/athlete/v2/components/SetEntryRow.tsx:157–163` — coloured row background (emerald-950/40 + emerald-900/50 border)
- `src/athlete/v2/components/ExerciseLogCard.tsx:301` — CheckCircle2 icon in card header
- `src/athlete/v2/components/ExerciseLogCard.tsx:382` — text button labelled "Done" that means "mark exercise complete"
- `src/athlete/v2/components/ExerciseLogCard.tsx:374` — button text changes to "All sets complete"
- `src/athlete/v2/screens/WeekScreen.tsx:225–228` — text pill "Done" (emerald-900/50)
- `src/athlete/v2/components/SessionPreview.tsx:79–82` — text pill "Done" (emerald-900/50)
- `src/athlete/v2/components/SessionHeader.tsx:97–100` — text pill "Done" (emerald-900/50)
- `src/components/planner/log/LogExerciseRow.tsx:287–289` — plain text "Done" (text-emerald-700)
- `src/components/planner/log/LogDayCard.tsx:91–94` — text pill "Done" (emerald-100/emerald-800 — light theme)
- `src/athlete/v2/components/GppLogCard.tsx:119` — Check icon only, no text

**Issue:** Six distinct visual treatments represent the same semantic state. SetEntryRow uses a background fill. ExerciseLogCard uses a CheckCircle2 icon in the header plus a text button mid-card labelled "Done" that actually means "mark exercise complete". Session-level "Done" is a pill badge in three places and plain text in a fourth. Athlete and coach apps use inverted colour palettes for the same pill shape. GPP allDone state uses only an inline Check icon.

**Proposed change:** Adopt one token for "session/exercise is complete": a filled `CheckCircle2` icon + optional "Done" label, in consistent emerald colour. Pill badge fine at the session level. At exercise/set levels use the icon only. Rename the "Done" button inside ExerciseLogCard to "Mark complete".

**Requires engineering:** No · **Risk:** M · **Effort:** S

### U-02 — Coach comment visibility at week and day level
**Files:**
- `src/components/planner/log/LogDayCard.tsx:121–123` — session comment count shown in header only when collapsed
- `src/components/planner/log/LogExerciseRow.tsx:387–415` — exercise comment toggle: no count shown in collapsed LogDayCard
- `src/components/planner/log/LogWeekOverview.tsx` — no comment data at all

**Issue:** The coach can only see a per-session comment count in the LogDayCard header while it is collapsed. Once expanded, the count disappears because of a `collapsed &&` guard. Exercise-level comments are invisible from any overview. LogWeekOverview has no comment signal.

**Proposed change:** (a) Show the session-level comment count regardless of collapsed state. (b) Aggregate "N comment(s) — N from athlete" in LogWeekOverview. (c) In LogDayCard header (expanded state), show a small badge beside each exercise row's name when `exerciseMessages.length > 0`.

**Requires engineering:** No · **Risk:** M · **Effort:** M

### U-03 — Athlete app: no comment visibility on Week screen or in exercise cards
**Files:**
- `src/athlete/v2/screens/WeekScreen.tsx:193–280` — day list cards, no comment indicator
- `src/athlete/v2/components/ExerciseLogCard.tsx` — no `onPostComment` prop, no coach-reply surface
- `src/athlete/v2/screens/TodayScreen.tsx:774–784` — session-level messages only, filtered to `!m.exercise_id`

**Issue:** When a coach replies to an athlete's exercise-level comment, that reply is written to the database but the athlete has no way to see it. ExerciseLogCard accepts no comment props. TodayScreen filters messages to session-level only.

**Proposed change:** (a) Add an `onPostComment` prop to ExerciseLogCard, thread it through TodayScreen, render a compact AthleteCommentsThread below the notes textarea. (b) On WeekScreen day card, show a message indicator when day data contains coach messages. Requires `WeekDayOverview` to surface message counts per day.

**Requires engineering:** Yes · **Risk:** H · **Effort:** M

### U-04 — `window.confirm()` for destructive actions on mobile
**Files:** `src/athlete/v2/screens/TodayScreen.tsx:443, 481, 493, 511–515`

**Issue:** All four destructive athlete actions use `window.confirm()`. On iOS WebKit and some Android in-app browsers `window.confirm()` is suppressed or shows as an unstyled system dialog. The bonus-day delete confirm (lines 511–515) is high-stakes.

**Proposed change:** Replace each `window.confirm()` with an in-app destructive confirmation: bottom-sheet modal for high-risk actions (bonus day delete, off-plan exercise delete), inline undo for low-risk (single set delete: "Set removed — undo" toast for 4 seconds).

**Requires engineering:** No · **Risk:** H · **Effort:** M

### U-05 — Coach Log: planned exercise delete asymmetry
**Files:**
- `src/components/planner/log/LogDayCard.tsx:137–153` — planned exercises rendered without `onDelete`
- `src/components/planner/log/LogDayCard.tsx:161–177` — off-plan exercises rendered with `onDelete`

**Issue:** Coach can delete off-plan logged exercises but cannot delete logged exercises for planned slots. If athlete logged wrong weight, coach's only tool is CoachSetEditModal — to wipe an entire planned exercise's log requires deleting sets one by one.

**Proposed change:** Pass `onDeleteLogExercise` to `LogExerciseRow` for planned exercises when a `logged` exercise exists.

**Requires engineering:** No · **Risk:** L · **Effort:** S

### U-06 — Athlete Today: preview/edit mode transition is lossy
**Files:** `src/athlete/v2/screens/TodayScreen.tsx:109–174, 654–685`

**Issue:** Selecting a different day chip while in edit mode resets `mode` to `'preview'`. If the athlete has partially entered a value mid-blur, it is lost silently.

**Proposed change:** Track dirty state; warn before switching slots, or switch to autosave-on-change with debounce.

**Requires engineering:** Yes · **Risk:** M · **Effort:** M

### U-07 — CoachSetEditModal lacks planned-vs-performed context
**Files:**
- `src/components/planner/log/CoachSetEditModal.tsx:127–178`
- `src/components/planner/log/LogDayCard.tsx:150`

**Issue:** Modal receives only `loggedSets` and `exerciseName`. Cannot show what athlete was supposed to do per set. Placeholder fallback to `row.planned_load` only works if the set was upserted with planned values.

**Proposed change:** Pass `plannedExercise` (with `prescription_raw`) to the modal and render a StackedNotation header. Add a read-only "Plan" column per row.

**Requires engineering:** No · **Risk:** L · **Effort:** S

### U-08 — RAW table: missing value vs not-entered are identical
**Files:** `src/components/planner/log/LogWeekOverview.tsx:360–367`

**Issue:** `null` displayed as `'—'` for both "no session" and "session exists but pillar not filled". Coach cannot distinguish skipped training from forgotten rating.

**Proposed change:** Distinct placeholder ('nr') in a non-gray cell class when session exists but pillar is null.

**Requires engineering:** No · **Risk:** L · **Effort:** S

### U-09 — "Log as prescribed" hidden for free-text; completion indicator weak
**Files:**
- `src/athlete/v2/components/ExerciseLogCard.tsx:367–386`
- `src/athlete/v2/components/ExerciseLogCard.tsx:144` — `isFreeTextUnit` flag

**Issue:** For free_text/other units, "Log as prescribed" and "Done" buttons are suppressed. After athlete taps ✓ on the synthesised row, the CheckCircle2 in the header is tiny. The `completedCount/rows.length` shows as `1/1` — not a prominent success signal.

**Proposed change:** For isFreeTextUnit when all rows completed, show a prominent CheckCircle2 or emerald badge equivalent to the session "Done" pill.

**Requires engineering:** No · **Risk:** L · **Effort:** S

### U-10 — Session comments visible only in edit mode, not in preview
**Files:**
- `src/athlete/v2/screens/TodayScreen.tsx:774–784`
- `src/athlete/v2/components/SessionPreview.tsx`

**Issue:** Coach may post a session comment between sessions. Athlete must enter edit mode to see it.

**Proposed change:** Read-only message indicator in SessionPreview — "Coach left N comment(s)" row with most recent inline; tap to reply enters edit mode.

**Requires engineering:** No · **Risk:** M · **Effort:** S

### U-11 — VAS slider commits only on pointer/touch/keyboard up
**Files:** `src/athlete/v2/components/VasField.tsx:36–43`

**Issue:** Uses `onMouseUp`, `onTouchEnd`, `onKeyUp` to commit. If athlete drags then immediately taps a day chip, the commit may not fire — value lost silently.

**Proposed change:** Add `onChange` commit (debounced 300ms) in addition to pointer-up.

**Requires engineering:** No · **Risk:** M (silent data loss) · **Effort:** S

### U-12 — WeekMetricsSettings popover lacks close-on-Escape
**Files:** `src/components/planner/log/WeekMetricsSettings.tsx:263–453`

**Issue:** Popover closes on backdrop click but not on Escape. Doesn't match ImageLightbox pattern.

**Proposed change:** Add `useEffect` listening for Escape key, matching `ImageLightbox.tsx:13–17`.

**Requires engineering:** No · **Risk:** L · **Effort:** S (5-line change)

### U-13 — Athlete Week: expand/collapse ambiguous for completed sessions
**Files:** `src/athlete/v2/screens/WeekScreen.tsx:209–247, 257–268`

**Issue:** For a completed session, the expanded panel shows SessionPreview with a button labelled "Continue logging" — implies more to do when there isn't.

**Proposed change:** When `day.status === 'completed'`, change button to "View in log" (or hide it), navigate to TodayScreen in preview mode.

**Requires engineering:** No · **Risk:** L · **Effort:** S

### U-14 — Delta ratio undefined for free-text and GPP exercises
**Files:**
- `src/components/planner/log/LogExerciseRow.tsx:59` — `computeDelta(planned?.summary_total_reps ?? null, performedReps, !!logged)`
- `src/lib/trainingLogModel.ts:30–41` — `DeltaState` computed from ratio

**Issue:** For GPP sentinels, `logged.sets` is empty. For free-text/other units, `performed_reps` is never written. In both cases `computeDelta` receives `performedReps = 0` and `planned?.summary_total_reps` may be non-null. Produces a `DeltaState` of `'red'` — misleadingly shows under-performance.

**Proposed change:** In `LogExerciseRow`, check `planned?.unit === 'free_text' || 'other' || 'free_text_reps'`. Treat `summary_total_reps` as `null` to force neutral `pending` state.

**Requires engineering:** No · **Risk:** M (misleading quality signal) · **Effort:** S

### U-15 — GPP planned vs performed contrast absent
**Files:**
- `src/athlete/v2/components/SessionPreview.tsx:253–297` — GPP preview
- `src/components/planner/log/LogExerciseRow.tsx:199–253` — GPP in coach Log

**Issue:** `display = athleteGpp ?? plannedGpp` — all-or-nothing. Unlike main exercise rows which show "Plan" and "Did" side by side, GPP shows only one version.

**Proposed change:** Render two sub-rows when athlete data differs: "Planned: [value]" dim grey, "Did: [value]" primary. Especially important for `load` column.

**Requires engineering:** No · **Risk:** M · **Effort:** M

### U-16 — PerformedOnField date input awkwardly positioned
**Files:** `src/athlete/v2/screens/TodayScreen.tsx:671–685, 817–844`

**Issue:** Date picker + Preview toggle row appear above SessionHeader. On 375px screens, RAW dial may be fully below the fold.

**Proposed change:** Move PerformedOnField inside SessionHeader as a secondary row. Convert to inline "Edit date" tap.

**Requires engineering:** No · **Risk:** L · **Effort:** S

### U-17 — WeekMetricsSettings RAW label bakes in "Eleiko" branding
**Files:** `src/components/planner/log/WeekMetricsSettings.tsx:290`

**Issue:** Label "RAW readiness (Eleiko 4-pillar)" violates CLAUDE.md principle 1 — OWL labels embedded in components.

**Proposed change:** "RAW readiness (4-pillar: Sleep/Physical/Mood/Nutrition)" or "Readiness (RAW 1–3 scale)".

**Requires engineering:** No · **Risk:** L · **Effort:** S

### U-18 — No saving-in-progress indicator on ExerciseLogCard
**Files:**
- `src/athlete/v2/components/ExerciseLogCard.tsx:65–66`
- `src/athlete/v2/components/SetEntryRow.tsx:66, 95–96`
- `src/athlete/v2/screens/TodayScreen.tsx:99, 611+`

**Issue:** While a set save is in flight, only the SetEntryRow shows `busy`. Top-level `saving` flag is not threaded to ExerciseLogCard. Athlete may double-tap during laggy network, creating duplicate sets.

**Proposed change:** Pass top-level `saving` to ExerciseLogCard, thread to SetEntryRow as additional `disabled` condition. Show per-card saving indicator.

**Requires engineering:** No · **Risk:** M · **Effort:** S

## Cross-Perspective Tensions

**T-1: Done vocabulary splits along light/dark theme boundary.** The athlete app (dark) uses `bg-emerald-900/50 text-emerald-300`; the coach app (light) uses `bg-emerald-100 text-emerald-800`. No token layer — each component hardcodes its Tailwind classes. Drift is guaranteed.

**T-2: Planned vs performed clear for numeric, breaks for free-text/GPP/combo.** For standard kg exercises, Plan/Did side-by-side model is excellent. For free-text there's no numeric performed value. For GPP the coach sees only athlete's modified version. The delta colouring system is partially applied — fires incorrectly for free-text (U-14) and not at all for GPP.

**T-3: Comment threads exist at two scopes but routing surface only shows session scope.** Coach has rich per-exercise conversation visible in LogExerciseRow. Athlete only sees session-level. Until exercise-level comments are visible to the athlete (U-03), coach replies are invisible.

**T-4: Refresh model diverges.** Athlete uses optimistic merges; coach LogModeView does full `reload()` on every mutation. Neither side auto-refreshes if the other is simultaneously editing.

## Priority Recommendations

1. **Fix exercise-level comments on athlete side (U-03).** Highest-risk invisible gap.
2. **Unify "done" vocabulary (U-01).** Widest blast radius, lowest-effort relative to clarity payoff.
3. **Replace `window.confirm` on mobile (U-04).** Data-loss risk on iOS.
4. **Surface comment counts to coach overview (U-02) and athlete week (U-10).** Low-effort discoverability.
5. **Fix delta colouring for free-text units (U-14).** Misleading red borders undermine trust.
6. **Add planned-prescription context to CoachSetEditModal (U-07).** Removes daily friction.
7. **Fix VAS slider commit-on-navigate (U-11).** Silent data loss on a coach-configured metric.
8. **Add Escape key to WeekMetricsSettings popover (U-12).** One-line fix.

## Open Questions

1. Should athlete be able to reply to per-exercise comments from TodayScreen, or session-level only?
2. Free-text/other units: "acknowledge / did not do" (binary), or quantitative data allowed?
3. Should coach delete athlete's logged data for planned exercises (not just off-plan)?
4. Is "Finish session" the authoritative trigger, or should all-sets-completed auto-complete?
5. Intended refresh cadence on coach LogModeView?
