# Cloud run summary — Training Log review fixes

**Branch:** `feature/review/2026-06-10-cloud` (off `feature/review/2026-06-10`)
**Date:** 2026-06-11
**Version bump:** 0.10.3 → 0.10.4 (patch)

Implemented the code-only P1/P2 findings from
`review/findings/training-log-review.md` that do **not** require a Supabase
migration or schema change. Each item was committed granularly; typecheck and
the vitest suite were run after each group, and a production build at the end.

## Verification (final)

- `npm run typecheck` — **pass**
- `npm test` — **138 passed (13 files)** when run with Supabase env vars set
  (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). Two analysis test files
  (`engine.test.ts`, `builderState.test.ts`) fail to *import* on a bare
  environment because `src/lib/supabase.ts` throws when those vars are unset —
  this is a **pre-existing environment issue, not caused by this work** (the
  same files fail on the untouched base branch). All other suites pass without
  env vars.
- `npm run build` — **pass** (no malformed Tailwind arbitrary-value classes;
  diffs re-read for preserved handlers/titles).

## Done

| Finding(s) | Item | Commit |
|---|---|---|
| COACH-REVIEW-2 | GPP day-total rollup now reads `planned.exercise.exercise_code` (widened `computeExerciseSummary` signature); GPP work counts again. | `ad24103` |
| COACH-REVIEW-3 | Suppress the misleading "Sets —/1 Reps —/0" Plan/Did strip for non-quantified units (`free_text` / `other` / `rpe`) via `isQuantifiedUnit`. | `ad24103` |
| COACH-REVIEW-4 | Suppress Avg/Max kg axes for non-`absolute_kg` units (`isAbsoluteLoadUnit`), per-row **and** in the Day-total weighted mean (percentage no longer compared as kg). | `ad24103` |
| COACH-REVIEW-5 | New shared `hasLoggedWork(DayLog)` (session completed OR ≥1 exercise done); drives the Sessions stat and a distinct "logged (not finished)" day-dot state. | `d661297` |
| COACH-REVIEW-7 / UX-BP-4 | European date/time sweep onto `dateUtils` (new `formatWeekday`, `formatWeekdayDateShort/Long`, `formatTime24`, `formatDateTimeShort`) across SessionHeader, SessionPreview, WeekScreen, WeekNavigator, LogDayCard, LogModeView, logFormatUtils, ProfileScreen, PRDetailScreen, CoachThreadScreen, TodayScreen. | `30d1c4a` |
| COACH-REVIEW-8 | Extracted GroupLogView's inline supabase query into `fetchGroupSyncStatus` in `trainingLogService` (API-first). | `b6354d0` |
| METRICS-4 / COACH-REVIEW-9 / UX-BP-10 / METRICS-10 | Text metric cells wrap instead of `.slice(0,14)`; numeric metric + average cells use comma decimals (`formatDecimalComma`). | `a60b619` |
| METRICS-1 | Deduped the 4 copies of the metric-tracking default into one exported `METRIC_TRACKING_DEFAULTS` (code only — DB default change deferred, needs migration). | `2a87d7c` |
| UX-BP-9 | Combo chip now only renders when the member-dot list is absent; added a RAW-score explanatory tooltip (coach + athlete). | `cc5c550` |
| UX-BP-12 | Centralised the unlabeled day-slot label on the data layer's `defaultSlotLabel` (0-based), aligning TodayScreen and GroupViewerScreen. | `70addde` |
| UX-BP-8 | Raised athlete touch targets: RAW buttons `h-8→h-10`, GPP done checkbox 24→36px, Substitute/set-delete icon hit boxes ~28→36px, persistent borders on GPP inputs. | `5c0b8c0` |
| UX-BP-5 / COACH-REVIEW-11 | Off-brand blue chrome → Button primitive + accent tokens: LogCommentsThread Send, WeekMetricsSettings Add/Cancel, LogExerciseRow edit/delete icons (ghost/danger), focus borders, prescription info banner, metric links. | `2552d70` |

### Tests added
- `src/components/planner/log/__tests__/logSummary.test.ts` — GPP rollup, unit helpers, percentage load suppression.
- `src/lib/__tests__/trainingLogModel.test.ts` — `hasLoggedWork`.
- `src/lib/__tests__/dateUtils.test.ts` — extended for the new weekday/time helpers.
- `src/lib/__tests__/logFormatUtils.test.ts` — `formatDecimalComma`, `formatTimestamp`.

## Partial

- **UX-BP-5 / COACH-REVIEW-11** — completed the unambiguous, high-signal part:
  every hand-rolled `bg-blue-600` button → Button primitive, and the blue
  focus/hover/link tells → accent/danger tokens. The **broader gray-palette
  sweep** (`bg-white` / `bg-gray-50` / `text-gray-*` / `border-gray-*`
  literals across LogWeekOverview, LogDayCard, LogExerciseRow,
  CoachSetEditModal, WeekMetricsSettings) was intentionally **left as a larger
  follow-up pass**: it is hundreds of class changes whose visual correctness
  can't be verified in a headless run, and the `border-[color:var()]` hint
  gotcha makes silent regressions easy. Data-driven colours were left
  untouched throughout.

## Skipped (per task instructions / require migration)

- **ROBUSTNESS-6 / -8, METRICS-TRANSLATION-6** — atomic `custom_metrics` /
  `metadata` write needs a gated jsonb **RPC / migration**. Out of scope
  (cannot apply migrations unattended).
- **METRICS-1 DB default change** — aligning `track_raw` / `track_bodyweight`
  column defaults to `true` needs a migration. Did the **code-side dedupe
  only**; documented the remaining DB contradiction in the new constant's
  doc-comment.
- **METRICS-TRANSLATION-5 / -7 / -11 / -12** — backlog / design (value_type
  edit, RAW configurability, group templates, vocabulary consolidation).
- **UX-BP-6** (set-vs-accept redesign), **UX-BP-13** (substitution confirm),
  **ATHLETE-ROBUSTNESS-10 / -11** — design-sensitive, left untouched.

## Notes / conservative choices

- `defaultSlotLabel` kept the data layer's existing **0-based** base (matching
  `active_days` / `day_labels` keys) rather than flipping the whole app to
  1-based, which would have changed every athlete-facing day label. This
  aligned the outlier (GroupViewerScreen `idx + 1`) to the rest.
- The delete icon buttons use the design system's `danger` Button variant
  (subtle white bg + red border/icon), as the review explicitly recommends —
  a deliberate, documented destructive treatment rather than the old
  near-invisible gray-on-hover-red icon.
- `package-lock.json` root version left at its existing value (already out of
  sync historically; the running app reads `package.json`).
