# EMOS Codebase Cleanup Plan

**Branch**: `chore/cleanup-2026-05-15`
**Base**: `main` @ `504540b`
**Date**: 2026-05-15
**Depth**: Conservative + duplicate consolidation
**Status**: Awaiting approval

This plan is derived from three parallel scans (dead files, unused
exports/imports, duplicates/debris) plus manual cross-verification via
`grep -rn` against `src/`. Every dead-file claim was double-checked: the
listed files have zero non-self imports across `src/`.

Per `CLAUDE.md`:
- Analysis (`src/components/analysis/*`) and Training Log
  (`src/components/training-log/*`) stay. They're UI-hidden but the code
  is preserved for future reactivation.
- The string "EMOS" is untouchable.
- No Supabase migrations are applied by this plan.
- Branding (`Branding/`, `public/`) is out of scope.

The plan is grouped into **A → D** in increasing order of judgement and
risk. Approval is per-phase; you can green-light A only, A+B, A+B+C, etc.

---

## Phase A — Mechanical deletions (zero behavior change)

Pure removal of code/files with no live consumers. Verified by grep.

### A1. Delete unreferenced source files (13 files, ~1.7k LOC)

Each has been confirmed to have zero `import` references in `src/`.

| # | Path | LOC | Note |
|---|------|-----|------|
| 1 | `src/components/BodyweightPopup.tsx` | ~80 | Superseded by inline UI in dashboard |
| 2 | `src/components/MediaInputModal.tsx` | ~150 | Orphan; only `ExerciseFormModal` handles media now |
| 3 | `src/components/Settings.tsx` | ~120 | Replaced by `GeneralSettings.tsx`; the only "Settings" import is `Settings as GearIcon` from `lucide-react` |
| 4 | `src/athlete/components/LoginPage.tsx` | ~110 | Athlete login was never wired up; AthleteApp uses route guards |
| 5 | `src/hooks/useShiftHeld.ts` | ~30 | No consumers |
| 6 | `src/store/weekStore.ts` | ~60 | Weekly state lives in `WeeklyPlanner` + `useWeekPlans` now |
| 7 | `src/lib/kValue.ts` | ~80 | Math helper with no callers |
| 8 | `src/components/planner/PlannerToolbar.tsx` | ~140 | Replaced by `PlannerControlPanel` |
| 9 | `src/components/planner/RecoveryStrip.tsx` | ~90 | UI element removed in a prior iteration |
| 10 | `src/components/planner/WeekSummary.tsx` | ~120 | Replaced by inline summary inside `WeeklyPlanner` |
| 11 | `src/components/planner/useMacroContext.ts` | ~70 | The active `MacroContext` is loaded inline in `WeeklyPlanner.tsx`; this hook variant is unused |
| 12 | `src/components/macro/MacroPhaseModal.tsx` | ~180 | Phase editing happens inline in `MacroTableV2` |
| 13 | `src/components/macro/MacroTable.tsx` | 325 | V1; superseded by `MacroTableV2.tsx`. Only V2 is imported (by `MacroCycles.tsx` and `GeneralSettings.tsx`) |

### A2. Delete iteration-debris files

| Path | Size | Note |
|------|------|------|
| `src/components/files.zip` | 28K | Archive sitting inside source tree |
| `src/components/sidebar-navigation-spec.md` | 11K | Spec doc inside source tree |
| `src/components/macro/EMOS_MACRO_TABLE_FIXES.md` | 10K | Iteration notes inside source tree |
| `files.zip` (repo root) | 18K | Root-level zip with no callers |
| `charts.png` (repo root) | 95K | Loose image, not referenced |

`src/styles/README.md` (756 B) is **kept** — it's a legitimate
folder-level style guide.

### A3. Remove unused imports in `src/App.tsx`

Lines 14 and 17 import `TrainingLogPage` and `AnalysisPage` but their
routes redirect to `/dashboard` (lines 173–174). The imports go nowhere.

The route redirects themselves stay — they exist intentionally so old
bookmarks don't 404.

```diff
- import { TrainingLogPage } from './components/training-log/TrainingLogPage';
- import { AnalysisPage } from './components/analysis/AnalysisPage';
```

### A4. Remove clearly-unused file-level named imports (11 files)

These are mechanical — ESLint already flags them. No behavioral effect.

| File | Unused name(s) |
|------|----------------|
| `src/components/Events.tsx` | `Calendar` |
| `src/components/Sidebar.tsx` | `LineChart`, `ClipboardList` |
| `src/components/exercise-library/ExerciseCategoryNav.tsx` | `ColorDot` |
| `src/components/exercise-library/ExerciseDetailPanel.tsx` | `getOwnerId` |
| `src/components/macro/MacroCycleToolbar.tsx` | `MacroCompetition` |
| `src/components/planner/DayCard.tsx` | `SentinelType` |
| `src/components/planner/DayEditor.tsx` | `SentinelType` |
| `src/components/planner/ExerciseDetail.tsx` | `SentinelType` |
| `src/components/planner/PrintWeek.tsx` | `formatUnit` |
| `src/components/planner/WeeklyPlanner.tsx` | `User` |
| `src/components/training-log/SessionHistory.tsx` | `toLocalISO` |
| `src/hooks/useCoachProfiles.ts` | `setLoading` (state declared but never updated) |

**Phase A total**: ~1.9k LOC removed, ~190K disk freed, zero functional
change. Verified by running `npm run typecheck` and `npm run build`
after.

---

## Phase B — Duplicate consolidation (small refactor, low risk)

### B1. Consolidate date utilities

Two parallel suites currently exist:

- `src/lib/dateUtils.ts` (canonical) — `getMondayOfWeek`,
  `formatDateShort`, `formatDateToDDMMYYYY`, etc.
- `src/athlete/lib/dateHelpers.ts` (athlete-scoped duplicate) —
  `getMonday`, `formatDate`, `formatDateShort`. Logic is the same as
  `lib/dateUtils.ts` modulo a `setHours(0,0,0,0)` in `getMonday`.
- `src/hooks/useAnalysis.ts` has a local `getMonday(dateStr: string)`
  at line 73 — a UTC string variant.

**Plan**:
1. Move/merge functions from `src/athlete/lib/dateHelpers.ts` into
   `src/lib/dateUtils.ts` (keep the `setHours(0,0,0,0)` normalization,
   it's strictly more correct).
2. Add `getMondayOfWeekUTC(dateStr: string): string` to
   `src/lib/dateUtils.ts` for the analysis use case.
3. Update imports in athlete components to use `src/lib/dateUtils.ts`.
4. Replace the local `getMonday` in `useAnalysis.ts` with the shared
   `getMondayOfWeekUTC`.
5. Delete `src/athlete/lib/dateHelpers.ts`.

Estimated touches: ~6 files. `useAnalysis.ts` is hidden-module code, but
this is a swap inside the file, not a deletion — safe.

### B2. (deferred to Phase C) Move `MacroContext` interface

`MacroContext` is defined in
`src/components/planner/WeeklyPlanner.tsx:38–48` and imported back from
that file by `src/components/planner/useMacroContext.ts` (which Phase A
deletes anyway). After A1, only the planner uses it.

**Recommendation**: leave it where it is. No consumer outside
`WeeklyPlanner.tsx` after Phase A. Listed here only so we don't loop
back on it.

---

## Phase C — Repo-root documentation (your call)

There are **17 large iteration-note `.md` files** at the repo root,
totalling ~290K. They look like prompts/spec drafts from earlier
vibe-coding sessions — none are linked from `README.md` or `CLAUDE.md`.

Sample of the first lines confirms it: e.g. `WINWOTA_CODEBASE_CLEANUP.md`
opens with "Full codebase audit: remove dead code... Work on a new
branch: `chore/codebase-cleanup`" — i.e. it's an earlier prompt for the
very task we're doing now.

| File | Size | Looks like |
|------|------|------------|
| `EMOS_PLANNER_5E.md` | 19K | Prompt/spec draft |
| `PLANNER_COMPREHENSIVE_FIX.md` | 14K | Iteration notes |
| `PLANNER_REBUILD_PROMPT.md` | 16K | Prompt |
| `PRODUCT_DOCUMENTATION.md` | 26K | **Possibly canonical product doc** |
| `WINWOTA_1RM_CALCULATOR.md` | 10K | Iteration notes |
| `WINWOTA_ANALYSIS_PROMPT.md` | 16K | Prompt |
| `WINWOTA_CODEBASE_CLEANUP.md` | 14K | Prompt (this very task, earlier) |
| `WINWOTA_COMPACT_FIX.md` | 14K | Iteration notes |
| `WINWOTA_DAY_ASSIGNMENT.md` | 26K | Iteration notes |
| `WINWOTA_INTEGRATION_TEST.md` | 12K | Test plan draft |
| `WINWOTA_INTERVAL_LOADS.md` | 20K | Iteration notes |
| `WINWOTA_MACRO_GROUPS_TEMPLATES.md` | 27K | Iteration notes |
| `WINWOTA_METRICS_AND_GROUPS.md` | 31K | Iteration notes |
| `WINWOTA_PHASE1_MULTICOACH.md` | 24K | Iteration notes |
| `WINWOTA_SLOT_FIX.md` | 9K | Iteration notes |
| `WINWOTA_SLOT_FIX2.md` | 11K | Iteration notes |
| `WINWOTA_VISUAL_POLISH.md` | 14K | Iteration notes |

**Recommendation**:
- **Delete** all 16 `WINWOTA_*.md`, `EMOS_PLANNER_5E.md`,
  `PLANNER_*.md` (vibe-coding session prompts; git history preserves
  them).
- **Inspect** `PRODUCT_DOCUMENTATION.md` (26K) before deciding — it may
  contain canonical product context worth keeping or moving to a
  `docs/` folder.

`CLAUDE.md`, `README.md`, `REVIEW_PLAN.md` (63K, output of the prior
synthesizer review) all stay.

This phase is **optional**. If you'd rather keep the iteration notes
for historical context, we move them to `docs/archives/` instead — no
loss either way.

---

## Phase D — Deferred (not in this round)

Items intentionally **not** in this cleanup:

- **~50 unused local variables** (catch-block `error` vars, unused
  setState setters, destructured `_*` params). These are scattered
  across many files and most are no-op noise. Best handled as a
  separate ESLint `--fix` pass, with the project's preferred
  `_`-prefix convention. Flagging some setters as suspicious because
  they imply dead state (e.g. `setMacroWeeks` in `MacroCycles.tsx:45`,
  `setTrackedExercises` line 47, `setTargets` line 49) — worth a
  follow-up look.
- **Forward-looking TODOs** in file headers (`useWeekPlans.ts:1`,
  `useAnalysis.ts:1`, `useMacroCycles.ts:1`,
  `PrintWeekCompact.tsx:1`, `WeeklyPlanner.tsx:1`,
  `ExerciseDetail.tsx:1`, `SessionView.tsx:1`). These document future
  refactors and aren't stale.
- **Hidden-module unused code** in `analysis/` and `training-log/`.
  Touching anything beyond unused imports inside their files would
  contradict CLAUDE.md.
- **`useCoachDashboard` vs `useCoachDashboardV2`**. V2 wraps V1
  intentionally; this is a legit layering pattern, not duplication.
- **Supabase-generated type drift**
  (`database.types.ts`, the ~40 TS errors in `useWeekPlans.ts`,
  `kValue.ts`, `templateService.ts`). The generated types are stale
  vs runtime queries — fixing this requires regenerating types from
  the live DB schema, which is a Supabase task, not a cleanup task.
- **npm dependency pruning**. All deps actively imported.

---

## Verification plan (run between each phase)

```bash
npm run typecheck   # must not regress (baseline has DB-type errors only)
npm run build       # must succeed
```

If either fails after a phase, the phase is reverted (one commit per
phase, so `git revert HEAD` is enough).

## Commit shape

- `chore(cleanup): remove dead source files (A1)`
- `chore(cleanup): remove iteration-debris artifacts (A2)`
- `chore(cleanup): drop unused imports (A3+A4)`
- `refactor(date): consolidate date utilities into lib/dateUtils (B1)`
- `chore(docs): remove stale root iteration notes (C)` *(only if approved)*

## Out of scope (per CLAUDE.md)

- No changes under `Branding/`, `public/`, or the EMOS string.
- No Supabase migrations.
- No deletions of Analysis or Training Log modules.
- No new tests, no abstractions, no behavioral changes.
