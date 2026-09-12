# EMOS — Simplification Review

**Date:** 11/09/2026 · **Version reviewed:** 0.108.0 (`61c27d6`) · **Scope:** whole codebase
**Status:** Review only — **no code has been changed.** Every item below is a proposal
awaiting approval.

> Companion to [`REVIEW.md`](REVIEW.md) (architecture/correctness, reviewed at ~74k LOC)
> and [`docs/PERFORMANCE_REVIEW.md`](docs/PERFORMANCE_REVIEW.md) (0.49.0). The codebase has
> since grown to **175k LOC / 645 files**. This review asks a narrower question than either:
> *where has the code accreted duplicate or redundant structure, and what does that cost in
> speed and reliability?*

---

## 1. Method & assumptions

**Assumptions**
- The target is fast, reliable code — not stylistic purity. Findings are ranked by measured
  or mechanically-verified cost, not by taste.
- EMOS is mid-exploration. CLAUDE.md stages principles 1–2 by maturity, so a flagged
  shortcut in a young feature is *not* a finding. Only settled code is held to the full rule.
- Deletion policy respected: nothing here is deleted without your instruction.

**How the findings were produced** — mechanically first, then read:

| Instrument | What it measured |
|---|---|
| Cross-file reference scan (`src` + `scripts` + `verify`) | dead exports, over-exported symbols |
| 12-line normalised block hash | duplicate code across 645 files |
| Loop/`await` AST-ish scan | DB round-trips issued inside loops |
| `vite build` | real chunk sizes, gzip, chunk composition |
| `eslint .` (incl. the repo's own custom rules) | 48 errors, 140 warnings, by rule |
| Per-component hook census | state complexity hotspots |

Every finding below was then **opened and read** to confirm it is real and to check for a
deliberate rationale. Several candidates were discarded at that step — see §6.

---

## 2. Headline

**The domain core and the engine are in good shape; the accretion is at the edges and in the
UI layer.** Type discipline is genuinely strong — 16 `as any` and **zero** `@ts-ignore` in
175k LOC — and `src/kinemos/engine/*` plus `src/lib/*` carry 129 test files / 20.7k lines of
tests. That is not ad-hoc code.

The redundancy is concentrated in five places, and four of them are cheap to fix:

1. **The crown-jewel 1RM math exists twice**, byte-identical, with divergent guards.
2. **Three divergent `describeError` implementations** shadow a better canonical one.
3. **Errors are silently swallowed** on two data-loading paths — a failed fetch renders as
   an empty list with no message and no log.
4. **A second charting library** (chart.js, 69 kB gzip) ships for exactly one component.
5. **One 3,159-line React component** (`KinemosViewer`) holds 59 `useState` hooks, ~8 of
   which are hand-rolled copies of the same "busy + note + progress" triple.

Nothing here is architectural rot. It is the expected residue of fast AI-assisted iteration:
**parallel implementations of concepts that already had a home.**

### Scorecard

| Dimension | Grade | Note |
|---|---|---|
| Type safety | **A** | 0 `@ts-ignore`, 16 `as any` in 175k LOC |
| Engine/domain test coverage | **A−** | 129 files; concentrated where the math lives |
| Domain-module single-sourcing | **C+** | e1RM duplicated; 3 error helpers; 40 components query Supabase directly |
| Bundle discipline | **B** | routes split well; one duplicate chart stack; one dead dependency |
| Network efficiency | **B−** | 13 N+1 write loops remain (some known-deferred) |
| Component size / state | **C** | 3,159-line component; 1,124 `useState` app-wide |
| Dead code | **B−** | 909 LOC orphaned module; 33 dead exports; 87 over-exported |
| Error handling consistency | **C** | 7 empty catches; 134 inline ad-hoc error stringifications |

---

## 3. Tier 1 — Reliability (fix first)

### 1.1 The e1RM formula table exists twice · **`src/lib/xrmUtils.ts` ↔ `src/components/tools/RepMaxCalculator.tsx`**

Both files declare `FORMULAS` and `REVERSE_FORMULAS` — 22 published formulas, **byte-identical**
(`RepMaxCalculator.tsx:7-32`, `xrmUtils.ts:14-39`). The component then re-implements
`estimateAvg1RM` / `estimateWeightAtReps` over its private copy.

This breaks CLAUDE.md principle 2 (*domain logic lives in dedicated modules, not components*)
and principle 3 (*single source of truth per concept*) on the highest-value math in the app.

**It has already diverged.** The library guards its domain, the component does not:

```ts
// xrmUtils.ts                          // RepMaxCalculator.tsx
if (reps <= 0) return 0;                (no guard)
if (reps === 1) return weightKg;        if (reps === 1) return weight;
```

At `reps = 0` the component returns a meaningless average instead of 0; `Brzycki` alone
contributes `w * (36/37)`. Any future correction to a formula must be made in two places or
the calculator and the PR table will silently disagree.

**Fix:** delete both private tables, import `estimate1RM` / `estimateWeightAtReps`.
Net ≈ −44 lines, one source of truth. **Effort: 15 min. Risk: none** (behaviour converges on
the tested path).

### 1.2 Errors swallowed on data-load paths · 7 sites

`eslint` reports 7 `no-empty` errors. Two are genuine silent-failure bugs:

| Site | Effect |
|---|---|
| `src/hooks/useEvents.ts:61` | `catch (error) {}` — a failed events query leaves the list empty, no message, no log |
| `src/components/EventAttemptsModal.tsx:75` | same shape, on attempt/video loading |
| `EventAttemptsModal.tsx:159,182`, `EventOverviewModal.tsx:31` | same |

`useEvents.ts:59` compounds it: `if (!eventsData) return;` inside the `try`, so a null result
also exits silently. On the gym floor this is indistinguishable from "there are no events".

**Not a finding:** `DayEditor.tsx:227` (`catch {}`) is deliberate — the rejection is already
handled by `p.catch(...)` two lines above. Leave it, add a one-word comment if anything.

**Fix:** route these through `logError` + a surfaced message. **Effort: 1 h. Risk: none.**

### 1.3 Three divergent `describeError` implementations · **canonical one already exists**

`src/lib/errorMessage.ts` exports a careful `describeError` that understands PostgREST error
objects *and* maps unique-constraint violations to coach-facing copy
("A category with that name already exists"). Only **16 files** import it. Meanwhile:

| Copy | Missing vs canonical |
|---|---|
| `src/components/planner/log/WeekMetricsSettings.tsx:40` | unique-violation copy |
| `src/components/planner/GppBlockEditor.tsx:23` | unique-violation copy (byte-identical to the above) |
| `src/hooks/useMacroCycles.ts:24` (`errMsg`) | unique-violation copy, `details`, `hint` |

Consequence: trip a duplicate name in those three surfaces and the coach sees
`duplicate key value violates unique constraint "categories_owner_name_unique"` instead of the
plain-language message the app already owns. Plus **134** inline `instanceof Error ? …` sites
across the codebase doing the same job ad hoc.

**Fix:** delete the three copies, import the canonical one (keep the local `console.error`
call — that part is useful). Then sweep the 134 inline sites opportunistically, not as a
big-bang change. **Effort: 30 min for the three; the sweep is background work.**

### 1.4 60 `react-hooks/exhaustive-deps` warnings

Stale-closure risk, concentrated: `MacroCycles.tsx` **10**, `ExerciseLibrary.tsx` 4,
`WeeklyPlanner.tsx` 3, `KinemosViewer.tsx` 3. These are warnings, not proof of a bug — but
`MacroCycles` also holds 39 `useState` in 1,715 lines, which is exactly the profile where a
stale closure hides.

**Recommendation:** triage `MacroCycles`' 10 first; each is a five-minute read. Do not bulk
`--fix` — adding a dep to a badly-shaped effect can turn a silent staleness into a render loop.

---

## 4. Tier 2 — Speed

### 2.1 chart.js ships for one component · **~69 kB gzip on the macro route**

`recharts` is used by **18** files. `chart.js` is used by **2**, and the second is not really a
consumer — `MacroCycles.tsx:37-38` imports it only to `ChartJS.register(...)` the controllers
that `MacroDistributionChart.tsx` needs. So the entire second charting stack exists for **one
component** (436 lines, drawing bar / line / donut). The build confirms it is bundled into the
macro route:

```
dist/assets/MacroCycles-BoQbplqL.js   382.99 kB │ gzip: 120.34 kB   ← contains chart.js
chart.umd.js                                      gzip:  69 kB
```

Every coach opening Macro Cycles downloads a second, entirely redundant charting engine.
Bar/line/donut are all first-class recharts primitives.

**Fix:** port `MacroDistributionChart` to recharts, drop the dependency. The chart is
imperative (`new ChartJS(ctx, …)` × 5) so this is a genuine rewrite of ~400 lines, not a
mechanical swap. **Effort: half a day. Payoff: ~69 kB gzip off the macro route, one less
charting idiom to know.** Flagged as deferred in the 0.49.0 performance review; still open.

### 2.2 `mathjs` is a dead dependency · **18 MB installed, 0 bytes imported**

`mathjs` appears **nowhere** in the source. The only references are two stale comments:

- `src/App.tsx:16` — "…both chart libraries + xlsx + mathjs) shipped as one 3.9 MB"
- `src/lib/formulaEval.ts:12` — "mathjs **is already bundled** for the Calculator"

That second comment is now false and actively misleading: `formulaEval.ts` was hand-rolled to
*avoid* `eval`, and the calculator no longer uses mathjs.

**To be precise: this costs zero bundle bytes today** (nothing imports it, so nothing ships).
The cost is 18 MB of install weight, supply-chain surface, and two comments that will mislead
the next reader.

**Fix:** `npm uninstall mathjs`; correct both comments. **Effort: 10 min. Risk: none.**

### 2.2b `npm ci` is broken — the lockfile is out of sync with `package.json`

Found while removing `mathjs`, and **pre-existing** — it reproduces identically on untouched
`main` at 0.108.0, so it is not a side effect of that removal:

```
$ npm ci
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync.
npm error Missing: esbuild@0.27.7 from lock file
npm error Missing: @esbuild/aix-ppc64@0.27.7 from lock file       (…and ~25 more)
```

`vitest` pulls `esbuild@0.27.7`, which the committed lockfile never recorded. Any pipeline
using `npm ci` — the correct command for CI and for Cloudflare Workers Builds — fails at the
install step. `npm install` papers over it by re-resolving, which is why it has gone unnoticed.

**Fix:** run `npm install` locally and commit the regenerated lockfile (~515 added lines, all
optional platform binaries). Deliberately **not** done as part of 0.108.1 — it would have
buried this batch's reviewable 83-line deletion in unrelated churn, and it is worth landing as
its own commit so the reason is legible in `git log`. **Effort: 2 min. Priority: high** if
anything in your deploy path runs `npm ci`.

### 2.3 Thirteen DB round-trips issued inside loops

Confirmed sites (write loops, one HTTP round trip per row):

| Site | Shape |
|---|---|
| `src/components/planner/DayEditor.tsx:277` | drag-reorder: one `UPDATE` per row, **no error checked at all** |
| `src/lib/templateService.ts:378, 452, 539` | template apply: per-exercise insert + per-combo member fetch |
| `src/hooks/useCombos.ts:113`, `useMacroCycles.ts:605` | per-row insert |
| `src/components/macro/MacroExcelIO.tsx:934`, `ExerciseBulkImportModal.tsx:343,408` | per-row import |
| `src/lib/macroTimelineData.ts:334`, `reviewFeedService.ts:286`, `plannedRowService.ts:310` | per-chunk / per-table |

`DayEditor.handleDragEnd` is the one worth fixing first: dragging a 10-exercise day is 10
sequential round trips (~0.5–3 s on a gym connection) and **every error is discarded** —
a failed reorder silently reverts on the next refresh.

**Caveat — do not "fix" all of these.** Several sequential loops are deliberate. Verify the
constraint before batching any of them.

**Fix:** batch via a single `upsert` where no positional constraint applies; where one does,
keep the loop but check errors. **Effort: 2–4 h for the top three.**

### 2.4 Bundle shape — largely healthy, one note

Route splitting is working (`AthleteApp` 40 kB gzip, `KinemosViewer` 77 kB, `xlsx` isolated at
143 kB, entry 133 kB gzip). The `opencv` chunk is **14.5 MB / 3.9 MB gzip** but is correctly
lazy — it is *not* an entry cost, and CLAUDE.md documents the choice.

**No action proposed.** Flagged only so it is a conscious decision: a coach on gym wifi who
taps an OpenCV assist pays 3.9 MB once. If that is ever reported as "the app froze", the fix
is a progress affordance, not a re-architecture.

---

## 5. Tier 3 — Structural simplification

### 3.1 `KinemosViewer.tsx` — one component, 3,159 lines, 59 `useState`

`export function KinemosViewer()` runs from line 178 to line 3337. It is the single largest
structure in the codebase and the clearest simplification target.

The state is not arbitrary — **~8 of the hooks are the same pattern, hand-rolled 8 times**:

| Concern | State |
|---|---|
| share | `shareBusy`, `shareNote` |
| export | `exporting {done,total}`, `exportNote` |
| talkover | `talkoverBusy`, `talkoverNote` |
| assist | `assist {busy, note}` |
| stabilise | `stabiliseProgress {done,total}`, `stabiliseNote` |
| recentre | `recentreProgress {done,total}`, `recentreNote` |
| lens | `lensBusy`, `lensNote` |
| snapshot / reference / comparison | `snapshotBusy`, `referenceBusy`, `comparisonLoading` |

Every one drives the identical sequence: `setBusy(true); setNote(null);` → `try` → `setNote(msg)`
→ `finally setBusy(false)`.

**Fix (incremental, not a rewrite):**

```ts
// one hook, ~30 lines, replaces ~20 useState
const share = useAsyncTask();      // { busy, note, progress, run(fn), reset() }
await share.run(async (report) => { … report(done, total) … return 'Sent to …'; });
```

Collapses ~20 `useState` to 8 hook calls and makes every async affordance behave identically
(including the `Stop` semantics 0.108.0 just introduced). Then lift the comparison, trends and
lens blocks into sibling components — each already has a clean state boundary.

**Effort: 1 day for the hook + migration. Risk: low, mechanical, one call site at a time.**
This is the highest-leverage item in Tier 3 and it does not require agreeing on a new
architecture.

### 3.2 42 hand-rolled overlays vs the project's own `AdaptiveDialog`

The repo already ships a custom lint rule making this explicit:

> `Hand-rolled overlay. Use AdaptiveDialog from components/ui — it owns the dismissal contract`

**6 errors + 36 warnings = 42 violations.** The decision is made and the primitive exists; the
convergence just hasn't happened. Errors (not yet grandfathered) are in
`AdoptLibraryWizard`, `CatalogueSharingModal`, `DuplicatesPanel`, `ExerciseTree`, `PrunePanel`,
`PrintWeekDesigner`.

Because `AdaptiveDialog` "owns the dismissal contract", each hand-rolled overlay is a place
where Escape / backdrop-click / focus-trap behaviour may quietly differ — a reliability and
consistency issue, not just style.

**Fix:** clear the 6 errors first (they are the un-grandfathered ones), then chip at the 36.
**Effort: ~20 min each.**

### 3.3 `ShareGroupModal` ↔ `ShareAthleteModal` — 87% identical

311 + 308 lines. Normalising the noun ("group"/"athlete") leaves **80 differing lines out of
619**. Four separate duplicate blocks were detected between them (collaborator list, invite
picker, avatar initials, section chrome).

**Fix:** one `ShareTargetModal` parameterised by `{ kind, targetId, targetName, …verbs }`.
Net ≈ −270 lines. **Effort: 2–3 h. Risk: low** — both are self-contained modals.

### 3.4 Orphaned pre-rebuild Analysis module · **REMOVED in 0.108.2**

> **The original estimate here (909 LOC, 5 files) was wrong — it was 1,646 LOC across 13
> files.** The first count came from a symbol-level scan, which only sees what nothing
> *names*. A module-level reachability trace from `src/main.tsx` found the rest: the seven
> `presets/*.tsx` components and `PlannedVsPerformed.tsx` were referenced, but only by
> `QuickAnalyses.tsx`, which was itself dead. The whole cluster was one orphaned subtree.

Removed (every file last touched **02/09/2026**, one day before the rebuilt
`builder/AnalysisModule.tsx` that `App.tsx` actually routes to landed on **03/09/2026**):

| File | LOC | | File | LOC |
|---|---|---|---|---|
| `analysis/PivotBuilder.tsx` | 313 | | `analysis/presets/CompetitionLiftTrends.tsx` | 97 |
| `analysis/PlannedVsPerformed.tsx` | 246 | | `analysis/presets/BodyweightTrend.tsx` | 77 |
| `analysis/IntensityZones.tsx` | 203 | | `analysis/presets/SquatToLiftTransfer.tsx` | 75 |
| `analysis/LiftRatios.tsx` | 184 | | `analysis/presets/TrainingPatterns.tsx` | 60 |
| `analysis/QuickAnalyses.tsx` | 145 | | `analysis/presets/VolumeDistribution.tsx` | 60 |
| `lib/analysisInsights.ts` | 90 | | `analysis/presets/PRTimeline.tsx` | 48 |
| | | | `analysis/presets/ReadinessVsPerformance.tsx` | 48 |

**Then a second cascade.** With those gone, `src/hooks/useAnalysis.ts` (829 lines, 12 exports)
had exactly **one** live consumer: `useCoachDashboardV2` imports
`fetchWeeklyAggregatesForAthletes`. Everything else — `fetchWeeklyAggregates`,
`fetchExerciseTimeSeries`, `fetchIntensityZones`, `fetchLiftRatios`, `fetchBodyweightSeries`,
`fetchPRTimeline`, and the `AnalysisParams` / `IntensityZone` / `LiftRatio` interfaces — served
only the deleted components. (`fetchWeeklyAggregates` looked live to a grep; its one remaining
mention is inside a *comment* in `useCoachDashboardV2`.) The file is now **552 lines** and
exports the one function plus the two interfaces describing its return shape.

**Total removed: 1,923 LOC.** No test referenced any of it — the suite is 1663 tests before
and after.

**This saves zero bundle bytes, and that is expected.** The code was unreachable, so Rollup
was already tree-shaking it: the `AnalysisModule` chunk measures 227.9 kB after versus
227.4 kB before (the difference is the version string). The return here is entirely
maintenance — 1,923 fewer lines to read, grep through, and be misled by. Anyone hunting a bug
in Analysis had five plausible-looking components to rule out first, one of them a 313-line
`PivotBuilder` that has not run since 02/09.

### 3.4b Two registries that are bypassed, not dead — **kept deliberately**

The dead-symbol scan flagged `FEATURE_REGISTRY` (`src/lib/exerciseFeatures.ts`) and
`COPYABLE_TARGET_FIELDS` (`src/lib/macroColumnCopy.ts`). **Neither was deleted, because
neither is really dead** — they are canonical declarations the UI has stopped consulting:

```ts
// src/lib/exerciseFeatures.ts — the registry, exactly where CLAUDE.md wants it
export const FEATURE_REGISTRY: FeatureDefinition[] = [
  { key: 'totalTime', icon: '⏱', label: 'Total time', coachOnly: false },
  { key: 'restTime',  icon: '⏸', label: 'Rest time',  coachOnly: false }, …

// src/components/planner/ExerciseFeatureControls.tsx:215 — the same data, hardcoded
...(features.totalTime == null ? [{ key: 'totalTime', icon: '⏱', label: 'Total time', …
// …and the key union spelled out by hand at lines 203 and 206.
```

Deleting the registry would have cemented the hardcoding and destroyed the better version.
This is the coach-flexibility principle failing quietly: a coach-configurable feature list
exists and the component ignores it.

**Fix (Batch C):** wire `ExerciseFeatureControls` to `FEATURE_REGISTRY`, deriving the key
union from it (`typeof FEATURE_REGISTRY[number]['key']`) instead of restating it twice.
**Effort: ~1 h.** Same question, less sharply, for `COPYABLE_TARGET_FIELDS` vs the partial
field lists inlined across `MacroExcelIO`.

### 3.5 Dead and over-exported symbols · **dead ones removed in 0.108.2**

> **Method note, learned the hard way.** The first scan here read only `.ts`/`.tsx`/`.mjs`.
> But `verify/*.html` — the browser harnesses — import engine modules directly
> (`from '/src/kinemos/engine/tracker.ts'`). Re-running with `.html` included cleared several
> symbols off the dead list that were never dead: `cutTemplateAt`, `blendTemplates`,
> `DEFAULT_ACTIVITY_OPTIONS`, `canvasThumbReader`, `SCAN_MAX_EDGE`, `K1_LIMIT` and others.
> Deleting them would have broken `npm run bench` and the harnesses while leaving
> `npm test`, `tsc` and `vite build` all green. **Any future dead-code sweep must treat
> `verify/*.html` as a root.**

- **33 exported values with zero references anywhere**, including `restorePlannedSet`,
  `fetchInboxUnreadCount`, `fetchAthleteGeneralUnreadCount`, `updateAnalysis`,
  `listDeviceProfiles`, `deleteDeviceProfile`, `getAccessibleGroupIds`,
  `getAccessibleAthleteIds`, `getBreadcrumbs`, `clearBreadcrumbs`,
  `formatPrescriptionDisplay`.
- **87 symbols exported but used only inside their own file** — drop the `export`, and the
  module's real API surface becomes readable.
- **20 `no-unused-vars` lint errors**, which split three ways:
  - **13 are a lint-config gap, not code debt.** They are underscore-prefixed discards
    (`_isDragTarget`, `_oldId`, `_created`, `_c`, `_u`, `_wpId`, `_id` …) written by developers
    who reasonably expected `^_` to mean "intentionally unused" — but `eslint.config.js`
    configures no `varsIgnorePattern` / `argsIgnorePattern` / `caughtErrors`. **One config
    line clears all 13** and makes the convention the code already follows actually hold.
  - 6 are the unread `catch (error)` bindings from §1.2.
  - 1 is `err` in `useWeekPlans.ts:274`.

Two of these deserve a second look rather than deletion:
`getAccessibleGroupIds` / `getAccessibleAthleteIds` are the access-scope helpers. Being dead
may mean a call site was lost, not that they are surplus — worth confirming against the
auth/RLS roadmap before removing.

`formatPrescriptionDisplay` being dead is a *good* sign: it is the inline-string display form
that `DISPLAY_CONVENTIONS.md` forbids. Deleting it removes the temptation.

### 3.6 40 components call Supabase directly

CLAUDE.md principle 2: *"No direct Supabase calls from presentational components."* Worst
offenders by call count: `MacroExcelIO` (10), `ExerciseHistoryChart` (8), `WeeklyPlanner` (7),
`ExerciseBulkImportModal` (7), `ExerciseDetail` (6).

**Recommendation: do not schedule this as a project.** Principle 2 is explicitly staged by
maturity, most of these are in settled code but none is causing a defect today, and a 40-file
refactor is exactly the kind of churn that introduces bugs into working features. Convert
opportunistically — when you are already editing one of these files for another reason.

The exception worth doing deliberately: `ExerciseHistoryChart` and `PRTrackingPanel` query
inside chart components, which couples fetch latency to render. Those two are worth lifting
into hooks.

---

## 6. Judged correct as-is — do not "simplify" these

Findings the instruments flagged and reading dismissed. Recorded so a future sweep does not
re-raise them:

| Flagged | Verdict |
|---|---|
| `useWeekPlans.ts:472` — sequential `await` in a loop | **Correct.** The comment documents that the parallel version raced the `(planned_exercise_id, position)` unique constraint and failed silently. Leave it. |
| `DayEditor.tsx:227` — `catch {}` | **Correct.** Rejection already handled by `p.catch(...)` above. |
| `opencv` 14.5 MB chunk | **Correct.** Lazy-loaded, deliberate, documented. |
| `xlsx` 429 kB chunk | **Correct.** Properly split; user-triggered only. |
| `src/lib/formulaEval.ts` hand-rolled parser | **Correct** — and a good decision. Avoiding `eval`/`new Function` is a security call, not redundancy. Only its stale mathjs comment is wrong. |
| 16 `as any` | **Acceptable** at 175k LOC. Not worth a campaign. |
| `Sparkline`, `TagChip`, `resultToTsv` "unused" | **False positives** — used within their own file. They belong in the over-export list (§3.5), not the dead list. |

---

## 7. Proposed roadmap

Sequenced so the cheap, zero-risk wins land first and nothing blocks on a decision you
haven't made.

### Batch A — mechanical, no behaviour change (~2 h, risk: none) · **SHIPPED in 0.108.1**

> Outcome: lint **48 errors → 14**, typecheck clean, 1663 tests pass. Two deviations from
> the plan below, both deliberate:
> - The e1RM tables could not simply be deleted — `RepMaxCalculator` renders a *per-formula*
>   breakdown and needs the table by name. They moved to `xrmUtils.ts` and are now exported
>   from there; the component imports them. Same outcome (one source of truth), different
>   mechanism than "delete the duplicate".
> - `caughtErrors: 'none'` was rejected in favour of `caughtErrorsIgnorePattern: '^_'`.
>   Silencing every unused `catch` binding would have hidden exactly the swallowed errors
>   this batch was fixing; now a deliberate discard must be written `catch (_e)`.
>
> Also: the empty catches were not uniformly "add a log". Three were deliberate and only
> needed their rationale stated (`DayEditor`, `PlannerDock`, and the degradation in
> `useWeekPlans`); four were real silent failures. The two user-initiated ones in
> `EventAttemptsModal` (add video, delete video) now surface an alert as well as logging —
> previously the button simply did nothing.

1. Delete the duplicate e1RM tables; import from `xrmUtils` (§1.1)
2. `npm uninstall mathjs`; fix the two stale comments (§2.2)
3. Replace the three `describeError` copies with the canonical import (§1.3)
4. Fix the 7 empty catches + the 7 genuinely-unread bindings (§1.2, §3.5)
5. Add `varsIgnorePattern: '^_'` / `caughtErrors: 'none'` to `eslint.config.js` — clears 13
   errors in one line (§3.5)
6. `prefer-const` ×3, `no-useless-catch` ×3 (`useEvents.ts`)

→ **Result: 48 lint errors → 14**, three single-source violations closed, four silent
failures surfaced. The 14 that remain are 8 `no-explicit-any` and the 6 `AdaptiveDialog`
errors (Batch C).

7. `.agents/` added to the eslint ignores — `training-log-review.workflow.js` (25 kB,
   git-tracked) fails to parse (`'return' outside of function`) and was linted on every run
   for nothing. Per CLAUDE.md the 2025 review team is retired and archived under
   `docs/history/agents/`; the file itself was left in place rather than moved, since
   relocating a tracked artifact is your call.

### Batch B — **SHIPPED in 0.108.2** (items 6–7); item 8 declined

6. ✅ Deleted the orphaned Analysis module — **1,923 LOC**, not the 909 estimated (§3.4).
7. ✅ Removed 34 dead declarations across 19 files, plus 4 follow-on unused imports the
   compiler surfaced. **Two flagged symbols were deliberately kept** — `FEATURE_REGISTRY`
   and `COPYABLE_TARGET_FIELDS` are bypassed registries, not dead code (§3.4b). The five
   unused joined-row types in `database.types.ts` were also kept: that file is a schema
   mirror, and unused join shapes are its purpose, not debris.

   The two access-scope helpers flagged for confirmation (`getAccessibleGroupIds`,
   `getAccessibleAthleteIds`) **were** removed — reading them settled it. They are one-line
   `Array.from((await resolve…).keys())` wrappers over `resolveGroupAccess` /
   `resolveAthleteAccess`, both of which are live. Nothing lost a call site; any caller
   needing ids calls the resolver.

8. ❌ **Declined: dropping `export` from the file-local symbols.** Recommend striking it
   from the roadmap. The real count is **378**, not 87 (84 values + 294 types), across ~165
   files. It buys no speed and no reliability: TypeScript erases the types entirely, and the
   values are already effectively module-scoped. Against that, it is a 378-line diff that
   makes `git blame` worse on 165 files, carries real risk of a mechanical slip, and fights
   the grain of a codebase in a fuzzy front end where modules are actively gaining
   consumers. The one concrete upside considered — fewer
   `react-refresh/only-export-components` warnings — evaporated on measurement: only **6**
   of the 84 values are in `.tsx` files at all.

   Worth doing opportunistically when a module is already being edited. Not worth a project.
   Say so if you want it done anyway and I will.

### Batch C — **SHIPPED in 0.108.3**

9. ✅ `useAsyncTask` (`src/kinemos/hooks/useAsyncTask.ts`, 14 tests) replaces **seven**
   hand-rolled busy/note pairs — not the ~8 estimated, and not ~20 `useState`: the honest
   count is **12** removed (59 → 47). `snapshotBusy`, `referenceBusy` and
   `comparisonLoading` were deliberately left alone — they are lone booleans with no note
   that route errors elsewhere, so they are not instances of this pattern and wrapping them
   would only add indirection. The hook also guards something no copy did: a superseded
   run's progress, note and busy-clear are dropped.
10. ✅ `ShareTargetModal` replaces `ShareAthleteModal` + `ShareGroupModal`: 619 → 380 lines,
    and it uses `AdaptiveDialog`, so both files left the legacy-overlay list too.
11. ✅ Four of the six `AdaptiveDialog` errors converted (`AdoptLibraryWizard`,
    `CatalogueSharingModal`, `DuplicatesPanel`, `PrunePanel` — all the same
    `fixed inset-0` + own-chrome shape, so `panel="bare"` fit as-is).
    **The other two were false positives and were exempted with a stated reason, not
    converted:**
    - `ExerciseTree:543` is the ghost that follows the cursor during a drag —
      `pointerEvents: 'none'`, no dismissal contract. A focus trap here would be a bug.
    - `PrintWeekDesigner:425` is the scrim behind the options *drawer*, which is an inline
      sidebar on a wide viewport and only slides over on a narrow one. `AdaptiveDialog`'s
      sidebar mode is right-edge and renders its own backdrop, so adopting it means
      restructuring both layouts inside a print surface. Worth doing against a real print
      check rather than blind — left as a follow-up.
12. ✅ The `DayEditor` reorder turned out **not** to need a better loop. The component is
    *passed* a `reorderExercises` service prop, declared in `DayEditorProps` and never
    destructured, so it had silently re-implemented it worse — sequentially, discarding
    every error, while `useWeekPlans.reorderExercises` already did the same work in
    parallel. It now calls the service.

    That exposed the actual bug: **`reorderExercises` swallowed its errors, which made its
    callers' recovery dead code.** `WeeklyPlanner:570` has always written
    `.catch(() => handleRefresh())` against it and that catch had never once run — a failed
    drag kept showing the new order until something else refetched. The service throws now,
    so both call sites recover.

Also shipped: **`FEATURE_REGISTRY` is wired up** (§3.4b). `ExerciseFeatureControls` derives
its "+" menu from the registry instead of restating every icon and label inline, and the
numeric-key union — previously spelled out twice by hand — is derived as `NumericFeatureKey`.
`Record<keyof ExerciseFeatures, …>` now makes TypeScript *require* a seed for every registry
entry, so the two cannot drift again. Three tests pin the registry's shape.

> Lint 14 errors → **8**, all `no-explicit-any` and none in Batch C's scope. 1680 tests pass
> (17 new). One regression was caught rather than shipped: passing `assist` as an inline
> object literal gave `CalibrationPanel` a new prop identity every render and re-rendered it
> on every frame step — `KinemosViewer.renders.test.tsx` failed, and the prop is memoised now.

### Batch D — deliberate projects (schedule separately)

13. Port `MacroDistributionChart` to recharts; drop chart.js (§2.1) — ~half a day, 69 kB gzip
14. Triage `MacroCycles`' 10 `exhaustive-deps` warnings (§1.4)
15. The remaining 36 `AdaptiveDialog` warnings — opportunistic

### Explicitly *not* recommended

- The 40-file Supabase-in-components refactor (§3.6) — churn without a defect to show for it
- Bulk `eslint --fix` on `exhaustive-deps` — can convert staleness into render loops
- Any rewrite of `src/kinemos/engine/*` — it is the best-tested code in the repo

---

## 8. What this does not cover

- **Runtime profiling.** All performance findings here are static (bundle composition, round-trip
  counts). No flame graph was captured; if the planner *feels* slow, measure before acting.
- **SQL/index health.** Covered in `docs/PERFORMANCE_REVIEW.md`; not re-verified.
- **The 87 over-exported symbols** are counted, not individually listed — the scan is
  reproducible from §1 if you want the full inventory.
- **Correctness of the training math** beyond the duplication in §1.1 — that is `REVIEW.md`'s
  remit and was not re-audited.
