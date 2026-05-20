# EMOS Domain Review — 2026-05-20

## Summary

- Findings: 18
- Critical hardcoded OWL assumptions: 7
- OWL-correctness issues: 6
- Nomenclature / grain issues: 5
- Coach-credibility risk: H (elevated to H on two specific items)

## Section A — Hardcoded OWL assumptions

### D-01 — Status sets ('skipped', 'failed') exposed inconsistently
- File: `src/lib/trainingLogModel.ts:18–25`
- Hardcoded: `SESSION_STATUSES` and `EXERCISE_STATUSES` are `['pending', 'in_progress', 'completed', 'skipped']`. Set-level adds `'failed'`. No exercise-level `'skipped'` UI; status `'skipped'` is written nowhere but treated as meaningful by delta logic.
- Coach difference: Distinguish "intentional skip" vs "ran out of time" vs "abandoned mid-set". Pain-management protocols want "modified".
- Configurability: Coach-scoped terminal-state set with defaults. Not per-plan.
- Risk: M · Effort: M

### D-02 — Delta thresholds hardcoded
- File: `src/lib/trainingLogModel.ts:38–41`
- Hardcoded: `DEFAULT_DELTA_THRESHOLDS = { amberMin: 0.70, matchedMin: 0.95 }`.
- Coach difference: Peaking week needs 1.0 matchedMin; base block accepts 0.60.
- Configurability: Per-plan override fallback to coach default.
- Risk: L · Effort: S

### D-03 — Eleiko RAW system baked into schema and code (HIGH)
- File: `src/lib/trainingLogModel.ts:106–143`
- Hardcoded: `ELEIKO_RAW_AXES` — four named pillars (sleep, physical, mood, nutrition), labels, rating descriptions. `ELEIKO_RAW_BANDS` — three score bands with verbatim Eleiko bullets. Column structure on `training_log_sessions` (`raw_sleep`, etc.) hardwires the four pillars.
- Coach difference: Many OWL coaches use POMS, RESTQ-Sport, abbreviated questionnaires, or five-pillar models. Eleiko is commercially specific.
- Configurability: Coach toggle "Eleiko RAW (built-in)" vs "custom axes". Custom axes stored as config (label, ratings, descriptions, direction). Schema change required.
- Risk: H · Effort: L

### D-04 — VAS labelled "pain" with hardcoded 0–10 integer
- File: `src/athlete/v2/components/VasField.tsx:8–10, 30–44`
- Hardcoded: Component comment "0 = no pain, 10 = worst pain imaginable". Slider hardcoded `min=0 max=10 step=1`.
- Coach difference: Many use 0–10 for readiness, motivation, soreness (distinct from pain); 0–5 for youth.
- Configurability: Metrics config carries label and range with anchor labels. Default to current.
- Risk: M · Effort: S

### D-05 — "Eleiko" branding in label
- File: `src/components/planner/log/WeekMetricsSettings.tsx:290–294`
- Hardcoded: "RAW readiness (Eleiko 4-pillar)" — vendor name + pillar count.
- Configurability: Pull from coach-scoped wellbeing tool config (from D-03).
- Risk: L · Effort: S

### D-06 — Bonus day "Extra N" label hardcoded
- File: `src/lib/trainingLogService.ts:424–426`
- Hardcoded: Fallback `Extra ${d - activeDays.length}`. German-language context would prefer "Zusatztraining"/"Nachbereitungseinheit". No bonus day type/purpose field.
- Configurability: Coach-configurable list of bonus day types; configurable default label string.
- Risk: L · Effort: S

### D-07 — Tonnage formula excludes percentage prescriptions (HIGH)
- Files: `src/components/planner/log/LogWeekOverview.tsx:46–60`; `trainingLogModel.ts`
- Hardcoded: Tonnage = `avg_load × total_reps` only for `unit === 'absolute_kg'`. A percentage-heavy week shows silent undercount.
- Coach difference: Most OWL programmes are written in %1RM. Tonnage figures will be wildly wrong.
- Configurability: Resolve %1RM→kg via athlete PR before aggregation (correctness issue, see B-03). "Include warm-up sets" toggle is the actual config.
- Risk: H (silent misrepresentation of training volume) · Effort: M

## Section B — OWL correctness

### D-08 — "Done" semantics structurally ambiguous (HIGH)
- Files: `src/athlete/v2/components/ExerciseLogCard.tsx:134–135, 376–385`; `src/athlete/v2/screens/TodayScreen.tsx:409–420`
- Issue: Three different "done" indicators don't agree:
  1. CheckCircle2 icon in athlete card header (set count)
  2. Exercise-level `status` column read by coach
  3. Delta ratio shown as % chip
- "Log as prescribed" sets exercise status = completed atomically. Individual set taps don't update exercise status. "Done" button can set status = completed without verifying any set was completed.
- Athlete card uses set counts; coach badge uses status column — these can diverge.
- OWL contract: Exercise status `completed` when all planned sets have terminal status (completed OR skipped) covering planned set count. Auto-promote; keep explicit Mark-complete for free-text/GPP.
- Risk: H (coach sees "Done" for sessions where athletes did 1/5 sets) · Effort: M

### D-09 — `failed` status invisible to athlete
- Files: `src/athlete/v2/components/SetEntryRow.tsx:141–152`; `src/lib/trainingLogModel.ts:24`
- Issue: Type includes `'failed'`. UI exposes only ✓ (completed) and ✗ (skipped). No athlete affordance for "missed lift".
- OWL: Failed snatch at 80kg ≠ skipped snatch. Miss-rate data is important for technical diagnosis.
- Options: (a) Remove `failed` from type, model misses as `miss_count` column; or (b) add third button. Domain decision.
- Risk: M · Effort: S (domain) / M (implementation)

### D-10 — Combo log grain collapses per-position data (HIGH)
- Files: `src/athlete/v2/components/ExerciseLogCard.tsx:81–127`; `src/lib/trainingLogService.ts:286–291`
- Issue: Combo (e.g. "5 sets of 2 Snatch + 1 OHS") logged as single `training_log_exercise`. No way to record Snatch portion at 90kg×2 and OHS at 90kg×1. If coach prescribes different loads per component, no field exists. `computeDelta` runs against `summary_total_reps` (sum across positions) — athlete who skipped the OHS but did 3 snatches shows green.
- OWL: Per-component data essential for peaking cycles. Coaches need to know technical quality of each lift in a complex.
- Configurability: Coach-scoped "log combos as single unit" vs "log combos per-position" (default current).
- Risk: H · Effort: L (schema + UI change)

### D-11 — Tonnage aggregates across movement categories
- Files: `src/lib/trainingLogModel.ts:61–77`; `src/components/planner/log/LogWeekOverview.tsx:63–79`
- Issue: 5×3 Snatch at 90% + 5×5 Back Squat at 80% → tonnage summed into single "Tonnage" number. OWL coaches never mix snatch and squat tonnage.
- OWL: Snatch tonnage = technical volume signal. Squat tonnage = structural loading. Distinct meanings.
- Configurability: Break down by exercise category (coach-configured, not hardcoded). Or toggle "total / by category".
- Risk: M · Effort: M

### D-12 — Percentage prescriptions never resolved to kg (HIGH)
- Files: `src/components/planner/log/LogWeekOverview.tsx:56–59`; `src/lib/trainingLogModel.ts:61–77`
- Issue: When `unit === 'percentage'`, planned/performed summaries show 0. StackedNotation renders `80%` without kg annotation even though `athlete_prs` is available.
- OWL: Most prescriptions are in %1RM. Coach prescribing 5×1@85% who sees "100% reps done" cannot tell if athlete hit the right weight.
- Configurability: Coach setting "display resolved kg alongside %". Requires `athlete_prs` lookup at render or materialised column.
- Risk: H (majority of OWL prescriptions are %1RM) · Effort: M

### D-13 — Technique rating 1–5 with no scale definition
- Files: `src/components/planner/log/LogExerciseRow.tsx:351–354`; `src/lib/database.types.ts:418`
- Issue: `technique_rating: number | null` displayed as "tech N/5". No definition of 1 vs 5. Field only renderable on coach side; athlete has no input affordance.
- Configurability: Coach-defined scale labels or drop the integer for free-text technique note (what most coaches use).
- Risk: L (display-only placeholder) · Effort: S

## Section C — Nomenclature and labels

### D-14 — "Avg / K" label undefined
- File: `src/components/planner/log/LogWeekOverview.tsx:216–219`
- Issue: Fifth stat cell labelled "Avg / K". Not standard OWL abbreviation. Intent: "average kg/rep" (Intensitätsdurchschnitt).
- Change: "Avg load" or "Avg kg/rep" or "Mean intensity". Source from config string for single change.
- Risk: L · Effort: S

### D-15 — sRPE column shown but never entered
- File: `src/components/planner/log/LogDayCard.tsx:115–117`
- Issue: Coach day card shows `session.session_rpe` as "sRPE". Athlete app explicitly omits RPE (intentional decision per comment). Column exists in SessionPatch + database.types.ts but no athlete UI.
- OWL: Session RPE (Foster CR-10) is one of the most validated training load proxies. Always-empty column is misleading.
- Options: Add to per-week metrics config toggles, OR remove from coach view.
- Risk: M (coaches relying on sRPE will distrust the log) · Effort: S

### D-16 — Exercise-level comments invisible to athlete (HIGH)
- Files: `src/athlete/v2/screens/TodayScreen.tsx:775–784`; `src/athlete/v2/components/AthleteCommentsThread.tsx`; `src/components/planner/log/LogDayCard.tsx:64`
- Issue: Athlete session-level thread filters `!m.exercise_id`. Exercise-level coach messages pass to `LogExerciseRow` for the coach but no athlete-facing surface exists. Athlete can post session messages but cannot see or respond to coach exercise-scoped messages.
- OWL: Per-exercise grain is correct for coaching (note on the Snatch attached to the Snatch row). The missing piece is athlete-side rendering.
- Risk: H (coach feedback on a specific lift is invisible to athlete) · Effort: S

### D-17 — Label inconsistency for athlete-added exercises
- Files: `src/components/planner/log/LogDayCard.tsx:157`; `src/components/planner/log/LogModeView.tsx:246`; `src/athlete/v2/components/SessionPreview.tsx:130`
- Issue: Coach uses "Added by athlete"; athlete uses "Added by you". No canonical name in configurable store. Coach wanting to rename (e.g. "Selbsttraining") has no hook.
- Change: Coach-scoped string.
- Risk: L · Effort: S

### D-18 — No read-tracking on messages (HIGH)
- Files: `src/lib/database.types.ts:445–452`; `src/lib/trainingLogService.ts:810–818`
- Issue: `TrainingLogMessage` has no `read_at`, `read_by`, no acknowledgement field. Coach has no unread indicator; athlete cannot see when coach replied. Both operate blind about whether the other has seen messages.
- OWL: Coaching feedback loops require knowing whether messages were seen. Without this, coaches will abandon the comment feature.
- Configurability: `read_at` per message per recipient. Whether single timestamp or join table is data-reviewer decision.
- Risk: H · Effort: M

## Cross-perspective tensions

**Tension 1 — Two "done" sources.** Athlete sees "done" from set-count completeness. Coach sees "done" from `log.status === 'completed'`. These can disagree: athlete who manually ticked 5/5 sets shows CheckCircle but NOT coach "Done" badge unless they also tapped "Done" button separately.

**Tension 2 — Tonnage excludes the main lifts.** Percentage-prescribed exercises (competition lifts) excluded from tonnage because of `unit === 'absolute_kg'` guard. Most accessory-only tonnage misrepresented as full week load.

**Tension 3 — sRPE column exists but is never filled.** Schema has it, coach view renders it, athlete app omits input. Always-empty column is misleading rather than cleanly absent.

**Tension 4 — Combo logs single-unit but presented as multi-component.** Athlete card header lists combo members with colour dots (multi-component promise). Actual set rows are single-unit (data contract). Visual promise and data contract conflict.

## Priority recommendations

1. **D-08 (done semantics)** — Canonicalise to one source. CheckCircle2 (athlete) and "Done" badge (coach) must derive from same value. Recommend exercise `status` as canonical, auto-promote on terminal-state coverage, keep manual Mark-complete for free-text/GPP. Resolves user's stated concern.

2. **D-16 (exercise comments invisible to athlete)** — High-risk gap for the feedback loop central to remote coaching. Fix is small (compact thread in ExerciseLogCard mirroring coach side). Service function and data model already support it.

3. **D-18 (no read-tracking)** — Without acknowledgement, trust erodes in the comment feature. Minimum: `coach_read_at`/`athlete_read_at` on `training_log_messages` or last-read timestamp per session per role.

4. **D-12 (% → kg resolution)** — Until log can resolve `80% × 5` to actual kg using athlete's PR, "Plan vs Did" is half-useful for competition lifts. Medium-effort, transforms the log's value.

5. **D-03 (Eleiko hardcoded)** — If EMOS targets coaches using own questionnaires (common at national federation level), four-pillar/three-score must be lifted out. Most invasive flexibility issue. If EMOS targets only Eleiko-users, accept and close.

6. **D-10 (combo log grain)** — Critical for correct technical analysis. Schema change required (per-position rows). Medium-effort refactor but data loss is unrecoverable once athlete has logged.

## Open questions

Q1. Is Eleiko RAW the only wellbeing framework EMOS needs, or coaches should define own axes?
Q2. `failed` at set level: "athlete missed lift" only, or also "aborted mid-attempt"? UI differs.
Q3. sRPE: permanent omission or P7 deferral? Drives whether to remove or add input.
Q4. Combo log grain: single row + free-text notes, or per-component rows? Drives schema design.
Q5. Tonnage: warm-up sets excluded? How does system identify warm-up — flag, threshold relative to top weight, or not at all?
Q6. Comment read-tracking: per-session last-read timestamp (simple) or per-message receipt (precise)?
