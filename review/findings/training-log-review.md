# EMOS Training-Log Subsystem — Definitive Review

## 1. Verdict

**Yes — the training-log subsystem is buggy, but in a specific and fixable way.** The numeric "happy path" (`absolute_kg` sets) is genuinely well-engineered: optimistic saves keyed on a stable `(log_exercise_id, set_number)`, planned-vs-logged separation respected everywhere, GPP's serial save queue, and a coherent Plan/Did coach review. The bugs cluster around **non-numeric prescription types** and **the boundary between "a set" and "a note/acknowledgement."** That is exactly the area you flagged.

**Headline answer to your free-text complaint.** Your instinct is correct, and the root cause is precise:

- **Pure `free_text` / `other` already does the right thing** — it renders a single merged ✓/✗ "accept / did-not-do-it" cell with no kg/reps fields (`ExerciseLogCard.tsx:125-135`). So the cleanest case is *not* broken.
- **The bug is in `free_text_reps`**, which `detectIntendedUnit` assigns to **any** load cell containing a letter (`prescriptionParser.ts:28-29`). It splits into two failure modes:
  1. **Prose-with-reps** (e.g. `moderate × 5 × 3`) → synthesises kg-labelled numeric `SetEntryRow`s with the prose demoted to a vanishing placeholder (`ExerciseLogCard.tsx:109-124` + `SetEntryRow.tsx:256-257`). This is the "free text also creates a SET" you described.
  2. **Prose-with-no-reps** (e.g. `Technique work`, `Mobility`) → `parseFreeTextPrescription` returns `[]` → **dead, un-loggable card** showing "No set lines defined" with no ✓, no ✗, no Mark-complete (`ExerciseLogCard.tsx:332-335`). The athlete can neither accept nor skip; the session never completes; the coach sees it as "not logged."

**One-line fix direction:** route `free_text_reps` down the same merged ✓/✗ path as `free_text` (synthesise a `freeTextMode` row when the parse yields zero rows), and de-label the load cell when `plannedLoadValue` is null. Mirror the change in `expectedPlannedSetCount` (return 1) so auto-promote stays consistent.

**The 3–5 dominant themes:**

1. **Type-blind rendering & one-tap mislog.** The athlete set row (`expandSetLines`/`SetEntryRow`) never receives the prescription `unit`, so `percentage` and `rpe` render a cell hard-labelled "kg", and a one-tap ✓ back-fills the % / RPE number into `performed_load` as kilograms — silent data corruption that poisons coach deltas, tonnage, and even PR detection (TYPE-TRANSLATION-3, UX-BESTPRACTICE-3).
2. **The coach review tool destroys athlete data.** `CoachSetEditModal` writes a whole-row upsert that omits `performed_text`, so editing — *or merely toggling ✓/✗ status on* — a combo or free-text set silently NULLs the athlete's `2+2+2` tuple or prose (COACH-REVIEW-1, UX-BESTPRACTICE-7). This is the single most serious finding and directly violates "athlete input is never mutated."
3. **The set-vs-note semantic is invisible.** Accept-only rows reuse the exact set-number badge and ✓/✗ chrome as quantified sets; non-quantified exercises render meaningless "Sets 0/1 Reps 0/0" compliance noise on the coach side (UX-BESTPRACTICE-6, COACH-REVIEW-3). The athlete and coach can't tell "confirm you did it" from "log your kilos."
4. **Loss-on-the-edges robustness.** A single-slot undo buffer drops the first of two rapid set-deletes (ATHLETE-ROBUSTNESS-1); onBlur-only notes vanish when the phone is locked (ATHLETE-ROBUSTNESS-3); non-atomic JSON read-modify-write can clobber a concurrent custom-metric (ATHLETE-ROBUSTNESS-6 / METRICS-TRANSLATION-6).
5. **Convention drift.** Every date/time render is US month-first / AM-PM against the non-negotiable European rule (UX-BESTPRACTICE-4, COACH-REVIEW-7), and the entire coach Log subsystem is hand-rolled raw Tailwind / `bg-blue-600` instead of tokens and the `Button` primitive (UX-BESTPRACTICE-5).

The **Metrics function** (RAW / Bodyweight / VAS / custom) is the *cleanest* part — none of it generates a set; the user's "free text creates a set" complaint does not live here. Its issues are display fidelity (truncation, decimals, glance asymmetry) and a couple of latent data hazards.

---

## 2. Prescription-type translation matrix

| Type | What coach authors | What athlete sees | Coach-review render | Verdict |
|------|--------------------|--------------------|---------------------|---------|
| **absolute_kg** | Pure number in grid/text (`detectIntendedUnit`→kg); numeric `planned_set_lines` written | One numeric kg+reps `SetEntryRow` per set; "Log as prescribed" enabled only here (`ExerciseLogCard.tsx:238-241`) | Plan/Did `StackedNotation` + per-cell green/red delta + valid Sets/Reps/Avg/Max | ✅ good |
| **percentage** | `80%×3×5`; `%` stripped, bare `80` stored in `load_value` (`prescriptionParser.ts:61`) | Cell hard-labelled **"kg"** pre-hinted `80`; one-tap ✓ logs `80` as `performed_load` kg (`SetEntryRow.tsx:133-135, 257`) | Avg/Max labelled "kg" compares planned **%** vs performed **kg**, mis-tinted "on target" (`LogExerciseRow.tsx:320-321`) | ❌ broken |
| **rpe** | Selectable via dropdown only; numeric path stores RPE number in `load_value` | If set lines exist → kg-labelled cell hinted with the RPE number, no RPE input anywhere; if not → **dead card** | Avg/Max planned side null; storage-vs-summary path inconsistent (`prescriptionParser.ts:385` vs `useWeekPlans.ts:496-499`) | ❌ broken |
| **free_text** | Prose; **no** set lines written | Single merged read-only prose cell + ✓/✗; ✓ writes status-only set (load/reps/text null) | "✓ Done"/"Skipped"/prose via `LoggedStackedNotation` all-non-numeric branch; **but** strip shows "Sets 0/1 Reps 0/0" noise | ⚠️ needs work (render correct, compliance-strip noise + edit-modal wipes it) |
| **free_text_reps** | Any letter in load cell (`detectIntendedUnit`); **no** set lines written | **Prose+reps** → kg-labelled numeric rows (prose vanishes on type); **prose, no `×`** → dead un-loggable card | Plan prose columns or raw prose; Did numeric or "✓ Done" | ❌ broken (this is your headline bug) |
| **other** | Auto-assigned to sentinels; behaves as free_text | Single merged ✓/✗ row (prose if present, else "—") | Same as free_text | ⚠️ needs work (same compliance-noise/edit-modal issues as free_text) |
| **combo** (`is_combo`) | ≥2 members, `+`-tuple reps (`80×2+1×3`); `planned_set_lines` with `reps_text`, `reps`=sum | Reps cell switches to text keyboard on `+`; `2+2+2` round-trips via `performed_text` | "Combo" chip; `LoggedStackedNotation` preserves tuple via `performed_text` | ⚠️ needs work (coherent end-to-end, **but** edit modal NULLs the tuple; prose-load combos show "0 kg") |
| **TEXT sentinel** | `/text`; body in `notes` | `SentinelDisplay` note + notes textarea; no set | Gray-bordered `SentinelDisplay`, no Plan/Did stack | ✅ good (no acknowledge affordance — minor) |
| **IMAGE sentinel** | `/image`; URL in `notes`, caption in `metadata` | Thumbnail → lightbox; no set | Pink-bordered `SentinelDisplay` | ✅ good (broken URL hides silently) |
| **VIDEO sentinel** | `/video`; URL in `notes` | YouTube thumb or generic icon → new tab; no set | Indigo-bordered `SentinelDisplay` | ✅ good (Vimeo/other hosts get generic icon only) |
| **GPP sentinel** | `/gpp`; rows in `metadata.gpp` (string reps/sets/load + done) | Interactive `GppLogCard`, per-row ✓; never a `training_log_set` | Planned-vs-athlete table renders correctly **but** Day-total rollup counts it as **0/0** (dead summary path) | ⚠️ needs work (render good; rollup miscount + mid-block coach edit desync) |

---

## 3. Critical & High findings

Ordered by severity, then surface.

### CRITICAL

**[COACH-REVIEW-1 / UX-BESTPRACTICE-7] Coach editing or status-toggling any set silently NULLs the athlete's `performed_text` (combo tuple) and legacy notes**
*(critical, coach-review)* — `CoachSetEditModal.tsx:104-115, 251-264`; `trainingLogService.ts:733, 736, 742`
**Impact:** `upsertLoggedSet` builds a *whole-row* object with `performed_text: patch.performedText ?? null` and upserts on conflict — a full-row replace, not a patch. `CoachSetEditModal.saveRow` never forwards `performedText`/`notes`, so it resolves to `null` and the ON-CONFLICT update **actively wipes** the column. Triggered not only by editing a kg/reps field but by clicking the ✓/✗ status toggle (`cycleDone`/`cycleSkipped`, lines 259-264). A coach making a routine correction — or just marking a combo set done — irreversibly destroys the athlete's recorded `2+2+2` tuple (rendered via `performed_text` at `StackedNotation.tsx:276-282`). The edit modal also exposes only kg/reps inputs, so for prose/combo/percentage/RPE exercises the coach edits blind. This is the review tool itself mutating logged athlete data — a direct breach of EMOS principle 4. *(Note: live per-exercise athlete notes use `training_log_exercises.performed_notes`, a separate table; the `notes`-column loss applies to legacy "pre-A3" rows. The `performed_text` loss is fully current and reachable.)*
**Recommendation:** In `saveRow`, carry `row.performed_text` and `row.notes` through to `upsertLoggedSet` (the full `TrainingLogSet` is already in scope at `:66-69`). Longer-term, make `upsertLoggedSet` patch-only (column-scoped update) so no future caller can clobber omitted fields. Make the modal unit-aware: a text field for prose/combo, %/RPE labels for those units.

### HIGH

**[TYPE-TRANSLATION-2 / ATHLETE-ROBUSTNESS-2 / UX-BESTPRACTICE-1] `free_text_reps` with no parsable "× reps" is a dead, un-loggable card**
*(high, athlete-entry)* — `ExerciseLogCard.tsx:94-140, 332-335`; `prescriptionParser.ts:190-210`; `plannedSetCount.ts:21-24`; `useWeekPlans.ts:530`
**Impact:** Reachable via the ExerciseDetail **Text mode** textarea (`ExerciseDetail.tsx:212-219`): any prose with letters → `detectIntendedUnit` returns `free_text_reps`; `writePrescription` guarantees zero `planned_set_lines` for that unit (`useWeekPlans.ts:530`). When the prose lacks an `x`/`×` separator (`Technique work`, `Mobility`), `parseFreeTextPrescription` returns `[]` → `rows=[]` → the card shows only "No set lines defined." The ✓/✗, Add-set, and Mark-complete controls are all inside the `rows.length>0` branch, so none render. `expectedPlannedSetCount` returns null and `isExerciseDone` is false with zero sets, so the exercise can never auto-promote. The athlete cannot acknowledge or skip a perfectly valid coaching cue; the coach gets no signal. This is your "free text is buggy" concern at its worst end.
**Recommendation:** When `free_text_reps` parses to `[]`, fall through to the same single merged ✓/✗ row `free_text`/`other` use (synthesise a `freeTextMode` row carrying `prescription_raw`). Return `1` in `expectedPlannedSetCount` for that branch. *(Implementer note: `isFreeTextUnit` at `ExerciseLogCard.tsx:157` is `free_text||other` only; scope the fix so it doesn't accidentally re-enable Log-as-prescribed for the prose case — the row's own `freeTextMode:true` drives the correct ✓/✗ render.)*

**[TYPE-TRANSLATION-3 / UX-BESTPRACTICE-3] Percentage (and RPE) render as "kg" cells; one-tap ✓ logs the %/RPE number as a kg load**
*(high, athlete-entry)* — `SetEntryRow.tsx:133-135, 256-257, 330-352`; `ExerciseLogCard.tsx:157`; `useWeekPlans.ts:529-541`; downstream `LogExerciseRow.tsx:320-321`, `LogWeekOverview.tsx:78-79`, `factFetch.ts:432-452`
**Impact:** `expandSetLines` is unit-blind: it copies `load_value` (the bare percent `80`, or RPE `8`) into `plannedLoadValue`, and `SetEntryRow` hard-labels the load cell "kg". Tapping ✓ with an empty cell back-fills `performedLoad = plannedLoadValue` (no unit guard), persisting `performed_load=80` as kilograms. The card header *does* show "80%" (`StackedNotation.tsx:167`), so header and entry cell disagree, and the stored truth is wrong. Downstream this fabricates kg history the coach reviews as real, inflates weekly **tonnage** (`LogWeekOverview.tsx:78-79`), is ingested by the analysis fact layer as kg (`factFetch.ts:432-452`), and can even fire a **false PR** (`TodayScreen.tsx:577`). Percentage is the common, actively-offered case; the bulk "Log as prescribed" button is *already* correctly gated to `absolute_kg` (`ExerciseLogCard.tsx:238-241`) — the per-row ✓ back-fill simply lacks the same guard. *(RPE caveat: the mislabel is only reachable for bare-number RPE prescriptions like `8×3`; the common `RPE 8` form instead hits the dead-card path above.)*
**Recommendation:** Thread `unit` into `expandSetLines`; label the cell "%"/"RPE" (or render percentage read-only). For non-`absolute_kg` units, ✓-without-value must **not** back-fill `plannedLoadValue` into `performed_load` — apply the existing `canLogAsPrescribed` unit guard to the SetEntryRow back-fill. Also gate the analysis fact layer and the coach Avg/Max axis on `unit==='absolute_kg'`. Fix must cover combos (which also store the bare percent in `load_value`).

**[ATHLETE-ROBUSTNESS-1] Deleting a second set inside the 4s undo window abandons the first delete**
*(high, athlete-entry)* — `TodayScreen.tsx:678-699, 1124-1161`; `UndoToast.tsx:44-54`
**Impact:** `pendingSetDelete` is a single object, not a queue. The DB delete only fires in `UndoToast.onDismiss` after the timeout. Deleting set A then set B within 4s overwrites `pendingSetDelete=B`; the timer re-arms (because `onDismiss` is a fresh inline arrow each render) and commits only B. **Deterministically, the earlier delete (A) is never committed** — A vanishes from the UI but its DB row survives and resurrects on the next `fetchAthleteDay`. The coach then reviews a set the athlete believed they removed. *(Correction to the original framing: it is always the first delete that's abandoned, not "either depending on timing.")*
**Recommendation:** Flush-on-overwrite — in `handleDeleteSet`, if a `pendingSetDelete` exists, synchronously commit it (`runSave(() => deleteLoggedSet(prev.setId))`) before storing the new one. The single-toast UI can still show only the latest.

**[ATHLETE-ROBUSTNESS-3] onBlur-only notes silently lost when the app is backgrounded/locked without blurring**
*(high, athlete-entry)* — `SessionHeader.tsx:151-162`; `ExerciseLogCard.tsx:189-200, 490-502`; `OffPlanExerciseCard.tsx:160-171`; `GppLogCard.tsx:214-226`
**Impact:** Every free-text **note** textarea persists only on blur. On mobile the dominant way a session ends — app-switch, phone-lock, PWA eviction — does not fire blur. There is no `visibilitychange`/`pagehide` flush anywhere in the athlete app (the two existing `visibilitychange` listeners only refresh inbox/threads). The athlete types "left shoulder felt off, stopped at 80%", locks the phone, and the note — the highest-value qualitative data the coach reads — is gone. *(Note: numeric kg/reps cells are also onBlur-commit, so the surface is slightly broader than notes alone; only ✓/✗ status taps persist immediately.)*
**Recommendation:** Add a `visibilitychange`/`pagehide` flush that commits dirty note fields (or an additive ~800ms debounce-on-type alongside the existing onBlur). Either still routes through `onPatchNotes`/`onUpdateNotes`, preserving the API-first boundary.

---

## 4. Medium / Low / Nits

### MEDIUM

- **[TYPE-TRANSLATION-1 / UX-BESTPRACTICE-2] `free_text_reps` (prose-with-reps) emits kg-labelled numeric set rows.** `ExerciseLogCard.tsx:109-124`, `SetEntryRow.tsx:256-257`. The prose load ("moderate") is a vanishing placeholder under a "kg" label. *Fix the load cell only — keep the reps cell (the coach authored real reps×sets); do NOT collapse to the merged ✓/✗, which would discard structured reps.*
- **[COACH-REVIEW-2] GPP day-total rollup miscounts as 0/0.** `logSummary.ts:169` casts `exercise_code` off `PlannedExercise` (always undefined; it lives on the joined `Exercise`), so the `gppSummary` branch never fires. GPP work is dropped from `LogDayCard`'s Day total (the per-row GPP table itself renders fine via `LogExerciseRow.tsx:69`). Fix: `getSentinelType(planned?.exercise?.exercise_code ?? null)`, widening the signature.
- **[COACH-REVIEW-3] free_text/other/rpe render "Sets 0/1 Reps 0/0" compliance noise.** `LogExerciseRow.tsx:316-322`, `logSummary.ts:193-202`. A meaningless quantified strip under a graceful "✓ Done" Did row; +1 inflation in the day Sets total per ticked note exercise. Suppress the PlanActual strip for non-quantified units. *(Correction: planned side renders `0`, not `—`, except for legacy NULL-summary rows.)*
- **[COACH-REVIEW-4] Percentage Avg/Max compares planned % vs performed kg under a "kg" label.** `LogExerciseRow.tsx:320-321`, `logSummary.ts:200-201`. Mis-tinted "on target." Suppress the load axes (`—`) for non-`absolute_kg`, matching the tonnage gate already at `LogWeekOverview.tsx:61`. *(Only `percentage` is affected; rpe/free_text already render `—`.)*
- **[COACH-REVIEW-5] Sessions stat & day-dots under-report any fully-logged-but-not-"Finished" session.** Sessions are `pending` until the athlete taps "Finish" (`TodayScreen.tsx:1041-1049`); exercises auto-promote but the session does not. `LogWeekOverview.tsx:140-142, 157` counts only `status==='completed'`. A diligent athlete who closes without tapping Finish reads as a grey "no work" day. Derive a "logged enough" signal (≥1 completed exercise) or a distinct dot state.
- **[COACH-REVIEW-7 / UX-BESTPRACTICE-4] US date/time formatting violates the non-negotiable European DD/MM + 24h rule.** `SessionHeader.tsx:82-86`, `SessionPreview.tsx:51-55`, `WeekScreen.tsx:198-201`, `WeekNavigator.tsx:39-41`, `LogDayCard.tsx:90-94`, `logFormatUtils.ts:12-20` (plus `ProfileScreen`, `PRDetailScreen`, `CoachThreadScreen`, `TodayScreen`). Bypass the existing `dateUtils` helpers (`formatDateShort`→DD/MM, `formatDateRange`); `undefined` locale flips with the viewer's OS. Mechanical sweep onto `dateUtils` + an explicit DD/MM HH:mm formatter.
- **[UX-BESTPRACTICE-5] Coach Log subsystem hand-rolled with raw Tailwind + two `bg-blue-600` buttons.** `LogCommentsThread.tsx:96`, `WeekMetricsSettings.tsx:440`, plus pervasive `gray-*/blue-*/amber-*` literals across `LogWeekOverview`/`LogDayCard`/`LogExerciseRow`/`CoachSetEditModal`. `GroupLogView` (same subsystem) uses tokens correctly, proving it's drift, not a constraint. Migrate to tokens + `Button` primitive; leave data-driven colours (RAW bands, status dots, deltas) untouched.
- **[UX-BESTPRACTICE-6] Set-vs-accept distinction not visually signalled.** `SetEntryRow.tsx:185-251`, `ExerciseLogCard.tsx:125-135`. The accept-only row reuses the set-number "1" badge and ✓/✗ chrome of a quantified set; the "1" implies "set 1 of N." Drop the badge; label it "Mark done."
- **[UX-BESTPRACTICE-8] Sub-40px touch targets on a mobile gym surface.** RAW score buttons `h-8`=32px (`RawScoreDial.tsx:180-192`), GPP done checkbox 24px (`GppLogCard.tsx:164-176`), Substitute ≈20px / Trash ≈25px icon buttons, ✓/✗ pills 32px. *(Icon boxes are even smaller than the original estimate.)* Raise to ~40px hit boxes; give GPP inputs a persistent border.
- **[ATHLETE-ROBUSTNESS-6 / METRICS-TRANSLATION-6] Non-atomic read-modify-write of `custom_metrics` / `metadata`.** `trainingLogService.ts:1660-1684, 619-675`. `runSave` doesn't serialise across handlers and custom-metric fields aren't `disabled` while saving, so two fast blur-to-blur custom-metric entries on one session can clobber a key. Built-in metrics (separate columns) are immune. Use an atomic Postgres `jsonb` update (`custom_metrics || jsonb_build_object(...)`) via a gated RPC, or a per-session serial queue.
- **[ATHLETE-ROBUSTNESS-8 / METRICS-TRANSLATION-9] BodyweightField/CustomMetricField silently discard invalid input.** `BodyweightField.tsx:16-29`, `CustomMetricField.tsx:24-39`. Worse for custom number metrics: a stray character calls `onChange(null)`, which **deletes** a previously-saved valid value (`trainingLogService.ts:1674`) with no warning. Keep raw text + inline hint on parse failure; never `onChange(null)` on parse failure (only on genuinely empty). *(Correction: `'8O'` is parsed as `8` and silently accepted — a separate hazard — so the revert path triggers on `'0'`, negatives, and non-leading-digit text.)*
- **[METRICS-TRANSLATION-3] Null VAS visually identical to a logged 0.** `VasField.tsx:55`. The thumb defaults to position 0; only the readout disambiguates. Render an explicit unset state.
- **[METRICS-TRANSLATION-4 / COACH-REVIEW-9 / UX-BESTPRACTICE-10] Text custom-metric values hard-truncated to 14 chars in the only coach surface.** `LogWeekOverview.tsx:588` (`.slice(0,14)`), full value hover-only (inaccessible on touch). "left shoulder, front delt" → "left shoulder,". Allow wrap/expand. *(Same finding raised by three dimensions — merged.)*
- **[METRICS-TRANSLATION-5] Custom-metric `value_type` can't be edited after creation; correcting a mistype orphans history.** `WeekMetricsSettings.tsx:217-237` (edit patches label+unit only). Archive+recreate yields a new id; historical values keyed by the old id remain in `custom_metrics` JSON but are never rendered again. Allow editing `value_type` when no values exist, or warn on archive. *(Data isn't destroyed — it becomes invisible; the archive confirm text "Past data is preserved" is misleading here.)*

### LOW

- **[ATHLETE-ROBUSTNESS-5] Bonus-day delete reads a stale `overview` closure.** `TodayScreen.tsx:764-784`. Real stale-closure + redundant double-`setDayIndex`, but it always resolves to a *valid* surviving day (just not `pickDefaultDay`'s preferred one) — the "blank/erroring day" impact is refuted. Drop the manual `setDayIndex` and let `loadWeek`'s `pickDefaultDay` own it.
- **[ATHLETE-ROBUSTNESS-7] Auto-promote/PR read stale `data` closure under rapid tapping.** `TodayScreen.tsx:518-581`. Real mechanism, but the visible "done" indicators derive from set statuses (correctly merged); only the `training_log_exercises.status` DB column lags, and the PR-miss is limited to the just-substituted-then-immediately-logged case. Compute the projected list from a ref.
- **[ATHLETE-ROBUSTNESS-11] GppLogCard fully trusts the athlete copy once its length ≥ planned, so a coach mid-block rename/reorder of an existing row is invisible.** `GppLogCard.tsx:31-39, 65-70`. Precondition: athlete has *edited/ticked* a row (not merely opened it). Merge per-position: coach name/reps/sets/load as source-of-truth, keep only athlete `done`.
- **[COACH-REVIEW-6] Exercise-scoped comment threads are read-only on the coach side.** `LogExerciseRow.tsx:251-256`, `LogModeView.tsx:138`. Latent: no app path *creates* an exercise-scoped message today (every `addComment` caller passes `exerciseId:null`), so the count badge is dead code. Wire end-to-end if the feature is wanted.
- **[COACH-REVIEW-8] `GroupLogView` calls supabase directly (API-first violation).** `GroupLogView.tsx:17, 52-66` — the only Log-mode presentational component hitting supabase. Extract `fetchGroupSyncStatus` into `trainingLogService`.
- **[COACH-REVIEW-10] Substituted exercise compared against the original plan's loads with no caveat.** `LogExerciseRow.tsx:53-63, 286-322`. The swap is chipped, but the Avg/Max delta tint compares a different lift's kg against the planned targets. Dim/annotate the load axes when `isSubstituted` (scoped to `absolute_kg`/combo, where loads are non-null).
- **[ATHLETE-ROBUSTNESS-10 / UX-BESTPRACTICE-11] Sentinel (TEXT/IMAGE/VIDEO) cards have no acknowledge affordance.** `ExerciseLogCard.tsx:178-204`. No "Got it" toggle; a coach can't tell whether the cue was read. *(Correction: there is NO session-level "X/Y exercises" counter — day status is binary on `session.status` — so these do not make a session "read incomplete." Pure product gap, nit-level.)*
- **[METRICS-TRANSLATION-1] DB defaults (`track_raw/bw DEFAULT false`) contradict the app's no-config fallback (RAW+BW on).** `migration:60-62` vs `SessionHeader.tsx:91-93`. Fully masked today (the sole insert path always sends explicit booleans), latent foot-gun the day any other path inserts an under-specified row; default duplicated in 4 places (principle #3). Align the DB default to `true` and dedupe into one exported constant.
- **[METRICS-TRANSLATION-2] VAS comment/migration promises 0.5-step precision the integer slider can't deliver.** `VasField.tsx:54` (`step={1}`), `migration:14-15`. No coach VAS entry control exists at all. Either deliver `step={0.5}` or remove the misleading comment.
- **[METRICS-TRANSLATION-7] RAW Eleiko model (pillars, 1–3 scale, bands) fully hardcoded.** `trainingLogModel.ts:139-230`. A coach can't define an alternative readiness instrument (principle #1 tension) — but it's documented as a deliberate named standard. Flag, don't force.
- **[METRICS-TRANSLATION-8] VAS & custom metrics absent from the per-day glance (`LogDayCard` header) and `SessionPreview`,** unlike BW/RAW. `LogDayCard.tsx:124-140`. Visible only in the week table. Add symmetric chips.
- **[METRICS-TRANSLATION-11] Custom metric definitions are strictly per-athlete with no group/template.** `trainingLogService.ts:1557-1579`. A common metric must be recreated N times for an N-athlete squad, each with a distinct id (no cross-athlete aggregation). Backlog: a metric template / "copy to athletes."
- **[UX-BESTPRACTICE-13] Substitution applies instantly with no confirm and silently inherits the original's kg/% set lines.** `TodayScreen.tsx:786-812, 1089-1095`, `ExerciseLogCard.tsx:362-393`. Swap is labelled but inherited targets aren't flagged "from {planned}". Add a "Targets carried over from {planned}" line; consider an undo affordance.

### NITS

- **[METRICS-TRANSLATION-12] Three parallel "metrics" vocabularies coexist** (`metrics.ts` legacy summary, `metricRegistry.ts` analysis, session wellbeing); `metricRegistry.ts:6` says it should subsume `metrics.ts` but both ship, and they compute **tonnage differently** (`metrics.ts:102` mixes % loads; `metricRegistry.ts:99` excludes them). Analysis coach-metrics persist only to `localStorage` (per-browser). No athlete impact — disambiguation only.
- **[METRICS-TRANSLATION-10] Numeric metric review uses period decimals** (`toFixed(1)`) vs the EU comma mandate — but this is a project-wide display convention gap, not localised to these lines.
- **[COACH-REVIEW-11] Hand-rolled `bg-blue-600` Send/Pencil/Trash chrome** in `LogCommentsThread.tsx:96` & `LogExerciseRow` — subset of UX-BESTPRACTICE-5.
- **[ATHLETE-ROBUSTNESS-13] UndoToast timer re-arms on every parent re-render** (`onDismiss` is a fresh closure). Real but benign: no autonomous re-renders exist; only a user-initiated `runSave` within the 4s window extends the window. `useCallback` the handler. *(Compounds ATHLETE-ROBUSTNESS-1.)*
- **[ATHLETE-ROBUSTNESS-12] VAS doc-comment "0.5-step" is internally consistent** (it says the slider snaps to integers) — partially refuted; the genuinely misleading line is the migration comment (see METRICS-TRANSLATION-2).
- **[UX-BESTPRACTICE-9] "RAW n/12" / "Combo" / "GPP" always-present chips carry no signal.** RAW is an inline metric (no pill, conditional) lacking a tooltip; the "Combo" chip is redundant with the adjacent member-dot list; the "GPP" pill is unconditional. Add a RAW tooltip; drop the redundant Combo chip.
- **[UX-BESTPRACTICE-12] Inconsistent unlabeled-slot day numbering:** `GroupViewerScreen.tsx:81` uses `Day ${idx+1}` while Today/Week use `Day ${dayIndex}` (canonical `DEFAULT_LABEL` at `trainingLogService.ts:354`). Off-by-one for a coach comparing surfaces (day_index is 1-based, so "Day 1" vs "Day 2", not "Day 0"). Centralise the helper.

---

## 5. UI/UX best-practice assessment (decisions proven against the rules)

### Coach surface (light theme — tokens + `Button` primitive mandated)

| Decision | Rule | Upholds / Violates |
|---|---|---|
| `GroupLogView` uses `var(--color-*)` tokens | "Colour = design tokens, not raw Tailwind palette" | ✅ Upholds — proves the rest of the subsystem *could* |
| `LogWeekOverview`/`LogDayCard`/`LogExerciseRow`/`CoachSetEditModal` use raw `gray-*/blue-*/amber-*` literals | Same rule; "never hand-roll `bg-blue-600`" | ❌ Violates (UX-BP-5) — `LogCommentsThread.tsx:96` & `WeekMetricsSettings.tsx:440` are the exact `#2563EB` off-brand tell vs accent `#185FA5` |
| No `Button` primitive imported anywhere in `src/components/planner/log/` | "always use `Button` from `src/components/ui`" | ❌ Violates (UX-BP-5, COACH-REVIEW-11) |
| US `toLocaleDateString` month-first / AM-PM | "Dates day-first DD/MM, times 24-hour" (non-negotiable) | ❌ Violates (COACH-REVIEW-7, UX-BP-4) |
| Text metric `.slice(0,14)` in a dense table | "information density and scan-friendly hierarchy" | ❌ Violates (COACH-REVIEW-9) — defeats the at-a-glance purpose |
| Always-on "Combo"/"GPP"/"RAW n/12" chips | "render a chip only when it conveys actionable, non-obvious info; a chip on every row carries no signal; prefer a `title` tooltip for terse labels like RAW …/12" | ❌ Violates (UX-BP-9) — RAW even matches the exact example in the rule |
| RAW band colours / status dots / delta green-red left as raw palette | "Never tokenise data-driven or semantic colour" | ✅ Upholds — correctly excluded from token migration |
| Plan/Did `StackedNotation` reused across coach + athlete | "Single source of truth per concept" (prescription display) | ✅ Upholds |
| Destructive ops via `ConfirmModal`; single-set delete via `UndoToast` | Good destructive-action discipline | ✅ Upholds |

### Athlete surface (intentionally dark — raw Tailwind is correct here)

| Decision | Rule | Upholds / Violates |
|---|---|---|
| Dark `gray-900` palette | Athlete app is deliberately dark | ✅ Upholds (not flagged) |
| Load cell hard-labelled "kg" for %/RPE | "never present one unit's value under another unit's label" | ❌ Violates (TYPE-TRANSLATION-3) |
| Accept-only row reuses set-number badge + ✓/✗ chrome | Clarity / scan-friendly hierarchy | ❌ Violates (UX-BP-6) — implies "set 1 of N" |
| 24–32px tap targets on a gym mobile surface | ~44px Apple / 48px Material touch minimum | ❌ Violates (UX-BP-8) |
| US date formatting in `SessionHeader`/`WeekScreen`/`WeekNavigator` | European DD/MM 24h | ❌ Violates (UX-BP-4) |
| Optimistic save keyed on `(log_exercise_id, set_number)`, new rows `max+1` | Data-loss-safe set entry | ✅ Upholds |
| All athlete writes target `training_log_*`, never the plan | "Planned data read-only in athlete views; derive by comparison, not mutation" | ✅ Upholds everywhere |
| `free_text` → merged ✓/✗ row, no numeric set | "should be accepted or did-not-do-it, NOT a set" (your directive) | ✅ Upholds (the *correct* model — the fix is to extend it to `free_text_reps`) |

### Cross-cutting architecture

- **API-first (principle 2):** Upheld across the athlete app and most of Log mode; **violated** once by `GroupLogView` (COACH-REVIEW-8).
- **Single source of truth (principle 3):** Violated by the 4× metric-default duplication (METRICS-TRANSLATION-1), the two row-count computations living in separate files (`plannedSetCount.ts` vs `ExerciseLogCard.tsx`), and the three metric vocabularies (METRICS-TRANSLATION-12).
- **Coach-flexibility (principle 1):** RAW is hardcoded to Eleiko (METRICS-TRANSLATION-7) — an accepted named-standard tension, not a regression.

---

## 6. Robustness assessment (athlete entry — data-loss / race / dead-end)

| Risk | Mechanism | Rating |
|---|---|---|
| **Coach set-edit wipes `performed_text`** | Whole-row upsert omits the field; fires on edit *and* status toggle (COACH-REVIEW-1) | 🔴 Critical — irreversible loss of logged athlete data via the review tool |
| **Dead un-loggable card** | `free_text_reps` with no `×` → zero rows, no ✓/✗/complete (TYPE-TRANSLATION-2) | 🔴 High — total in-card dead-end, session never completes, no workaround |
| **One-tap %/RPE mislog** | Unguarded back-fill stores % as kg `performed_load` (TYPE-TRANSLATION-3) | 🔴 High — silent corruption of performed data + tonnage + PR on the most common gesture |
| **Lost set-delete** | Single-slot `pendingSetDelete` drops the first of two rapid deletes (ATHLETE-ROBUSTNESS-1) | 🔴 High — deleted set resurrects; athlete intent ≠ stored truth |
| **Lost note on background** | onBlur-only persistence, no `pagehide` flush (ATHLETE-ROBUSTNESS-3) | 🔴 High — silent loss of irrecoverable coach-facing qualitative data |
| **Custom-metric key clobber** | Non-atomic JSON read-modify-write, fields not disabled while saving (ATHLETE-ROBUSTNESS-6) | 🟠 Medium — intermittent single-value drop on fast blur-to-blur |
| **Custom-number value deleted on typo** | `onChange(null)` on parse failure deletes a saved value (ATHLETE-ROBUSTNESS-8) | 🟠 Medium — silent persisted data loss on a stray character |
| **GPP coach-edit desync** | Athlete copy trusted wholesale once length ≥ planned (ATHLETE-ROBUSTNESS-11) | 🟡 Low — athlete sees stale row name; plan never mutated |
| **Stale-closure auto-promote/PR** | `data` closure lags under rapid tapping (ATHLETE-ROBUSTNESS-7) | 🟡 Low — DB `status` column lags; UI done-state is correct |
| **Bonus-day delete stale closure** | Stale `overview` + double `setDayIndex` (ATHLETE-ROBUSTNESS-5) | 🟡 Low — always lands on a valid (if non-ideal) day |
| **Sentinel no-acknowledge** | No "Got it" terminal state (ATHLETE-ROBUSTNESS-10) | 🟡 Low — no completion signal; does NOT block Finish (binary session status) |
| **UndoToast timer extension** | `onDismiss` fresh-closure re-arm (ATHLETE-ROBUSTNESS-13) | ⚪ Nit — window extends past 4s; delete not lost |

**Strengths worth preserving:** stable upsert key with `max+1` numbering, `chainRef` blur-then-status serialisation, GPP's coalescing `drainQueue`, `ensureLogExercise` legacy-duplicate tolerance, and `runSave` not reloading on transient errors. The fixes below must not regress these.

---

## 7. Recommended fix order

Findings sharing a root cause are grouped so they can be fixed in one change.

### P0 — data loss / corruption / dead-ends (fix first)

1. **Stop the coach review tool destroying logged data.** [COACH-REVIEW-1 / UX-BP-7]
   Carry `row.performed_text`/`row.notes` through `CoachSetEditModal.saveRow`; longer-term make `upsertLoggedSet` patch-only. *Single highest priority — irreversible and fires on a routine status toggle.*

2. **Make the athlete set row unit-aware + guard the ✓ back-fill.** [TYPE-TRANSLATION-3 / UX-BP-3 — shared root cause with TYPE-TRANSLATION-1 / UX-BP-2]
   Thread `unit` into `expandSetLines`/`SetEntryRow`; label "%"/"RPE"; suppress `plannedLoadValue` back-fill for non-`absolute_kg` (reuse the existing `canLogAsPrescribed` guard). This one change fixes the percentage/RPE mislog *and* the `free_text_reps` "kg" mislabel. Also gate `factFetch`/coach Avg-Max on `absolute_kg`. Cover combos.

3. **Turn the `free_text_reps` dead card into an accept/skip row.** [TYPE-TRANSLATION-2 / ATHLETE-ROBUSTNESS-2 / UX-BP-1 — one fix, three reports]
   On empty parse, synthesise the `free_text` merged ✓/✗ row; return `1` in `expectedPlannedSetCount`. This is the direct answer to your free-text complaint.

4. **Flush-on-overwrite for set deletes; `useCallback` the UndoToast handler.** [ATHLETE-ROBUSTNESS-1 + -13 — same subsystem]
   Commit the prior pending delete before storing the new one.

5. **Flush dirty notes on `visibilitychange`/`pagehide` (or debounce-on-type).** [ATHLETE-ROBUSTNESS-3]

### P1 — coach-review correctness & silent-loss edges

6. **GPP rollup fix** — read `planned.exercise.exercise_code`. [COACH-REVIEW-2]
7. **Suppress compliance noise / unit-mislabel on the coach strip** — hide PlanActual for non-quantified units (free_text/other), suppress Avg/Max load axes for non-`absolute_kg`. [COACH-REVIEW-3 + COACH-REVIEW-4 — shared "non-kg unit handling" root]
8. **"Logged but not finished" session signal** — derive from completed exercises. [COACH-REVIEW-5]
9. **Atomic `custom_metrics` write + don't delete on typo** — gated `jsonb` RPC; never `onChange(null)` on parse failure; disable fields while saving. [ATHLETE-ROBUSTNESS-6 + -8 / METRICS-TRANSLATION-6 + -9 — shared custom-metric write path]
10. **Set-vs-accept visual signal** — drop the set-number badge on accept rows, label "Mark done." [UX-BP-6]

### P2 — convention, consistency, density (mechanical / lower-risk)

11. **European date/time sweep** onto `dateUtils` across both surfaces (incl. `formatTimestamp`). [COACH-REVIEW-7 / UX-BP-4]
12. **Coach Log token + `Button`-primitive migration** (leave data-driven colours). [UX-BP-5 / COACH-REVIEW-11]
13. **Touch-target sizing** (RAW buttons, GPP checkbox/inputs, icon buttons). [UX-BP-8]
14. **Text-metric display** — wrap/expand instead of `.slice(0,14)`; comma decimals. [METRICS-TRANSLATION-4 / COACH-REVIEW-9 / UX-BP-10 / METRICS-TRANSLATION-10]
15. **`GroupLogView` → service layer** (API-first). [COACH-REVIEW-8]
16. **Single-source the metric-tracking defaults + align DB default to `true`.** [METRICS-TRANSLATION-1]
17. **Smaller consistency items:** VAS unset-state + step decision [METRICS-TRANSLATION-2/-3]; per-day VAS/custom chips [METRICS-TRANSLATION-8]; GPP mid-block merge [ATHLETE-ROBUSTNESS-11]; substitution confirm/caveat [UX-BP-13 / COACH-REVIEW-10]; chip de-noising + RAW tooltip [UX-BP-9]; day-label helper [UX-BP-12]; sentinel "Got it" [ATHLETE-ROBUSTNESS-10 / UX-BP-11]; custom-metric `value_type` edit/template [METRICS-TRANSLATION-5/-11].

### Backlog (cross-perspective tensions, product judgement)

- **RAW flexibility** (METRICS-TRANSLATION-7): principle #1 says configurable, but Eleiko is a deliberate named standard — **trade-off, leave unless the user wants a custom readiness model.**
- **Metric-vocabulary consolidation** (METRICS-TRANSLATION-12): `metrics.ts`→`metricRegistry.ts` and `localStorage`→`analysis_metrics` (DC-02) — out of the athlete-log lane; track separately. The diverging tonnage definitions are the real risk to address when consolidating.
- **Exercise-scoped coach replies** (COACH-REVIEW-6): latent/unwired on both sides — decide whether to complete or remove the dead badge.

**Cross-perspective tension to note explicitly:** the user's directive "free text should NOT generate a set" must be applied carefully. `free_text`/`other` correctly produce no quantified set; the *fix for `free_text_reps`'s no-parse case* should mirror that — **but the parse-success case (`moderate × 5 × 3`) must keep its structured reps cell** (the coach deliberately quantified reps×sets). Collapsing all `free_text_reps` to a single ✓/✗ would be a regression against coach-flexibility. Fix the *load cell label*, not the existence of reps rows.

---

*Files referenced throughout are absolute under `C:\Users\SimonDarville-GodEne\wl-coach\` (e.g. `src\athlete\v2\components\ExerciseLogCard.tsx`, `src\components\planner\log\CoachSetEditModal.tsx`, `src\lib\trainingLogService.ts`, `src\lib\prescriptionParser.ts`, `src\hooks\useWeekPlans.ts`).*