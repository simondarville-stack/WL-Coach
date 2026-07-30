# EMOS — Architectural Review (Phase 0)

> **Status:** Graded review only. **No code has been changed.** This document
> presents evidence-based verdicts across 10 dimensions, a scorecard, the
> highest-leverage fixes, and the decisions judged *correct as-is*. A proposed
> phased roadmap is in [`REFACTOR_ROADMAP.md`](REFACTOR_ROADMAP.md). Await
> approval before any code changes.

## Benchmark

Calibrated to **(b) a club-wide app: one coach plus multiple athletes**, athletes
logging on mobile between sets on poor connectivity. Verdicts are *not* graded
against an enterprise standard; flagged issues are justified by their impact on
*this* app — correctness of the training math, gym-floor data integrity, and
maintainability at club scale. Ceremony that doesn't earn its keep here is
explicitly declined.

Two domain realities weighted above style, per the brief:
1. **Methodology fidelity is the product.** Load/intensity math errors are
   correctness bugs, not cosmetics.
2. **Gym-floor logging.** Latency, offline behaviour, and data-loss risk matter
   more than in a desktop tool.

## Method (how this review was produced)

The codebase (~74k LOC, ~330 files, 99 migrations) was reviewed by a fan-out of
focused reader agents — one per dimension — followed by **adversarial
verification** of every high-severity claim (a second agent tried to *refute*
each), **independent double-tracing** of the five correctness-critical numeric
pipelines, and a **completeness audit** for uncovered subsystems. The author
then independently re-read the crown-jewel math (`prescriptionParser`,
`metrics`, `xrmUtils`, `comboExpansion`), the persistence path
(`useAutoCommit`, `trainingLogService`), the access model (`accessScope`,
`ownerContext`), and spot-verified the two highest-value audit findings (print
pipeline, Excel importer) against source.

The verification layer materially changed several findings — those corrections
are noted inline and in [§ What verification changed](#what-verification-changed).

---

## Headline

**The domain core is a genuine strength; the gaps are at the edges.** The load
math, prescription model, combo expansion, PR/e1RM engine, the new analysis
engine, planned-vs-performed separation, and the `owner_id`/`accessScope` schema
are careful, documented, single-source, and extensible — this is *not* an
ad-hoc app. The real risks cluster in five places:

1. **One real methodology bug:** `computeMetrics` counts percentage-prescribed
   loads as kilograms, so the planner header / day cards / dashboard show
   inflated, self-contradicting tonnage for any coach who programs in % (a
   first-class OWL unit).
2. **Security is advisory only:** no RLS, the public anon key ships with the
   client, every table is `FOR ALL TO anon USING(true)`. Fine for one trusted
   coach behind a private URL; **critical** the moment the URL is shared or a
   second coach exists.
3. **Gym-floor data loss:** a failed athlete set-write on bad connectivity is
   silently dropped (no queue, no retry, no local mirror) — the exact scenario
   the app is built for.
4. **The analytics rebuild is unfinished:** a clean new engine coexists with the
   older `useAnalysis` engine that still drives the coach dashboard and counts
   differently — two numbers for the same week.
5. **The crown-jewel math is untested**, and one published-formula table is
   forked verbatim into a second file.

None of these require a rewrite. Every one is a targeted, verifiable fix that
builds on patterns the team already uses correctly elsewhere.

---

## Dimension verdicts

### 1. Overall architecture & separation of concerns — **Acceptable** (Effort Med / Value Med)

**Evidence.** A real service/domain layer exists and is good: the analysis
engine exposes a single boundary ([`runAnalysisQuery.ts:28`](src/lib/analysis/runAnalysisQuery.ts) — validate → owner-scoped fetch → aggregate; the client never sees `FactRow[]`), with a documented invariant that `factFetch` is the only Supabase-touching module ([`analysis/index.ts`](src/lib/analysis/index.ts)). `trainingLogService.ts` is the sole data-access path for the athlete app and Log mode, and the athlete tree honours it. Domain math lives in pure lib modules.

The weakness is the **older coach planning surface**: ~20 presentational
components import `supabase` directly. Most are reads, but a few are
coach-authored *writes* from presentational components — notably
[`ExerciseDetail.tsx:257`](src/components/planner/ExerciseDetail.tsx) updating `planned_exercises` directly, and [`WeeklyPlanner.tsx:361`](src/components/planner/WeeklyPlanner.tsx) issuing raw macro joins inline (no `macroService` exists). Three analysis preset components break the engine's own invariant #6.

**Reasoning.** Methodology math and the mobile logging path — the two things
that matter most — sit behind clean boundaries. Entanglement is quarantined to
the legacy planner and is mostly read-shaped. Because there's no RLS, every
direct `supabase.from` on a *root* table is also a place a forgotten `owner_id`
filter becomes a cross-tenant leak — so API-first here is partly a safety
concern, not just tidiness.

**Recommendation.** Do **not** do a big-bang planner refactor. Targeted moves:
move the `planned_exercises` writes out of `ExerciseDetail`/`DayEditor` into
`useWeekPlans` or a small `plannedExerciseService`; pull `WeeklyPlanner`'s macro
joins into a `macroContextService`; route the 3 preset metadata lookups through
`factFetch`; relocate `GroupViewerScreen.loadGroupWeekPlan` into the service.

> **Verified (high):** "no RLS + anon key ⇒ every direct root-table call-site
> owns its own scoping" — **upheld, high.** RLS is enabled but uniformly
> permissive (`TO anon USING(true)`); root tables carry `owner_id` but Postgres
> never scopes by it. Confirmed real cross-tenant leak surface given coach
> sharing is live.

### 2. Training-domain model — **Needs improvement** (Effort Med / Value High)

**Evidence.** The model is impressively considered: `planned_set_lines`
(structured prescription with interval `load_max`, combo `reps_text` tuples),
a clean closed `DefaultUnit` union, fully separate planned vs performed tables,
combo-as-wrapper counting ([`comboExpansion.ts:107`](src/lib/comboExpansion.ts)), and an 11-formula + inverse-square multi-anchor PR engine ([`xrmUtils.ts`](src/lib/xrmUtils.ts)). Hardcoded `week_type`/category CHECK constraints were *correctly dropped* in favour of coach-configurable JSON/per-coach tables.

The material flaw is **unit-blind load aggregation**: `computeMetrics` receives
rows with no `unit` field and does `tonnage += avg*r` / `max` unconditionally
([`metrics.ts:92`](src/lib/metrics.ts)). Because `parsePrescription` strips `%`, a `90%` prescription persists `summary_avg_load = 90`, which then counts as 90 kg.

**Reasoning.** RPE-omission on the athlete side (column retained) and
tempo-via-notes are *deliberate, defensible* product calls for this club — not
gaps. The decisive issue is correctness: a percentage-programming coach gets a
week "Tonnage"/"Max"/"Avg"/"K" that folds percent numbers in as kilograms.

**Recommendation.** Make load aggregation unit-aware everywhere, using the
already-correct [`WeekSummaryBox.addEx`](src/components/planner/WeeklyPlanner.tsx) gate (`unit === 'absolute_kg'`) as the single rule. Thread `unit` through `MetricRow`/`computeMetrics`/the `useAnalysis` query. Lower priority: move the K band & metric roster toward `general_settings`.

> **Verified:** The "%-as-kg" claim was **upheld for percentage, refuted for
> RPE** (RPE is correctly stored as `null` and contributes nothing) and
> **refuted for `max`** (both paths compute `max` identically). Net: the *real*
> visible divergence is tonnage/avg/K, on the percentage path only — sharper and
> more accurate than the original claim. A separate claim that the Analysis
> module's compliance/intensity charts are also wrong was **largely refuted**
> (UI compliance is reps-based; intensity zones read performed loads).

### 3. Calculation & programming logic — **Acceptable** (Effort Low / Value Med)

**Evidence.** The math is correct and centralised in the hot paths. Tonnage
reconstruction is exact (`avg` is a rep-weighted mean, so `avg×reps = Σ(load×reps)`); `computePrescriptionSummary` is a true single source shared by the save path and the counting fallback; combos expand through one decoder; percentage↔kg conversion and rounding are correct; the multi-anchor 1RM model is sound. Brzycki/Adams singularities (r=37/50) are unreachable (rep counts clamp 1–10).

Two **house-rule** violations: [`RepMaxCalculator.tsx:7`](src/components/tools/RepMaxCalculator.tsx) re-declares the entire 11-formula table verbatim instead of importing `xrmUtils` (the exact "don't fork it" anti-pattern), and [`calculations.ts:15`](src/lib/calculations.ts) bakes Tailwind classes + RAW thresholds into "pure" functions.

**Recommendation.** Import the formulas from `xrmUtils` (delete the fork); split
`calculations.ts` presentation helpers out of the pure module. Optional: unify
the two K storage representations.

> **Verified (double-traced):** 1RM forward/reverse formulas are exact inverses
> (max round-trip error 1.4e-14); the double-check found a **fourth** "implied
> 1RM" definition the first tracer missed ([`ExerciseDetailPanel.tsx:101`](src/components/exercise-library/ExerciseDetailPanel.tsx)) — strengthening the inconsistency finding. The RepMaxCalculator copies already differ in a `targetReps<=0` guard, so drift is not hypothetical.

### 4. State management — **Needs improvement** (Effort Med / Value High)

**Evidence.** Server state lives in three uncoordinated tiers: a thin Zustand
layer (active coach, athletes, exercises), per-hook `useState` caches, and
direct reads in dashboard hooks. Concrete bug: [`exerciseStore.ts:44`](src/store/exerciseStore.ts) early-returns when already loaded and has **no force path**, so after creating/editing an exercise, `await fetchExercises()` is a no-op and the list is stale until reload ([`ExerciseLibrary.tsx:66`](src/components/exercise-library/ExerciseLibrary.tsx)). `general_settings` (a documented singleton) is independently re-fetched by 5+ consumers plus a duplicate in the dashboard, so editing settings in one screen doesn't propagate. The dashboard fires 6+ sequential reads *per athlete* (N+1).

**Reasoning.** Adequate today (tiny data, one editor at a time), and the careful
write-path code (`writeChainRef`, `prescriptionDraftStore`) should **not** be
churned. But the dimension question is single-source-of-truth + multi-athlete
readiness, and the honest answer is no: the same entity is cached in 2–3
disconnected places and the one cache with a guard can't be invalidated.

**Recommendation.** (1) Fix the exercise/category staleness now (add a `force`
flag / patch the store on mutation) — a real bug. (2) Promote `general_settings`
to one observable store. (3) Make active-coach changes reactive (or document the
remount requirement). (4) Before multi-coach ships, a thin shared week-plan
cache. Defer a full query-library (React Query/SWR) unless the dashboard N+1
becomes a felt latency problem.

> **Verified:** exercise-library staleness **upheld** (down-scoped to med once
> the shared-athlete edge case is accounted for). The "more Zustand is the next
> phase" plan is directionally right but the highest-value move is a *keyed
> cache with invalidation*, not simply more global state.

### 5. Data model & parameterisation — **Acceptable** (Effort Med / Value Med)

**Evidence.** The coach-opinion knobs are genuinely config: `general_settings`
carries `week_types`, `intensity_zones`, `lift_ratio_targets`, phase presets,
grid/percent increments, compliance/low-intensity thresholds; `dashboardFlagSettings`
parameterises attention thresholds; the live analysis engine even lets coaches
define **their own metrics**. External published standards (Eleiko RAW,
Prilepin) are correctly hardcoded as data — forcing those into config would be
unearned ceremony.

Gaps: there's **no GeneralSettings UI** to edit `intensity_zones`/`lift_ratio_targets`
(columns + read-path exist, but a coach can't reach them); two preset components
hardcode zone/target tables; `metrics.ts` and `metricRegistry.ts` run **two
parallel metric vocabularies** the code itself flags as not-yet-consolidated;
dead duplicate RAW thresholds linger in `calculations.ts`.

**Recommendation.** Add the missing settings UI for zones/ratios (cheapest way
to deliver the "coach overrides zones" promise); delete the dead duplicates;
track the `metrics.ts → metricRegistry.ts` consolidation as explicit debt.

### 6. Persistence, sync & offline — **Needs improvement** (Effort Med / Value High)

**Evidence.** *Online* persistence is well-engineered: per-set `upsert ON
CONFLICT (log_exercise_id, set_number)` (constraint verified live), per-row
write serialization, server-maintained `updated_at` (true last-write-wins),
`ensureLogExercise` defensive read tolerating historic dup rows, and a
localStorage **draft safety net** on the coach prescription path
([`prescriptionDraftStore.ts`](src/lib/prescriptionDraftStore.ts)). `useAutoCommit` correctly flushes notes on `pagehide`/`visibilitychange`.

The gap is **offline durability on the athlete side**. A failed set write
([`SetEntryRow.tsx:177`](src/athlete/v2/components/SetEntryRow.tsx) → `upsertLoggedSet`) lives only in React state — **no localStorage mirror, no retry, no queue**. On network error, `runSave` deliberately keeps optimistic state without reloading ([`TodayScreen.tsx:287`](src/athlete/v2/screens/TodayScreen.tsx)) but never re-queues, so locking the phone or unmounting after a failed save loses the set. Numeric cells have no flush-on-hide (only notes do). No service worker / PWA. No request timeout on the client.

**Recommendation (proportionate — not a sync engine).** (1) Extend the
`prescriptionDraftStore` pattern to athlete set/notes writes (mirror-before /
clear-on-confirm, surface survivors on mount). (2) Add flush-on-hide to numeric
cells (reuse `useAutoCommit`). (3) App-level fetch timeout + bounded retry. (4)
Make the failed-write signal louder than a thin banner. (5) *Optional:* a minimal
service worker caching the shell + current day. **Do not** build CRDT/general
offline-sync — granular last-write-wins suffices here.

> **Verified (high):** silent set-loss on failed-write-then-teardown **upheld,
> high** — bounded to one set's typed values, conditional on the
> failure→teardown sequence, but routinely hit on gym wifi.

### 7. Multi-user & coach–athlete model — **Acceptable only under a strict condition** (Effort Med / Value High)

**Evidence.** The *model* is well-built and auth-ready: `owner_id` on every root
table (NOT NULL, backfilled, indexed, FK), and `accessScope` correctly resolves
effective roles across ownership + direct shares + group cascade with graceful
degradation. The team is honest about the deferral ("deterrence, not security").

But isolation is **entirely advisory**: the client ships the public anon key and
never authenticates; every table is `FOR ALL TO anon USING(true) WITH CHECK(true)`
(254 such occurrences across 38 migrations). Three sharp consequences: (a) the
athlete app lists **every active athlete in the database** with no owner filter
([`AuthContext.tsx:60`](src/athlete/v2/lib/AuthContext.tsx)) — so once a second coach exists, any athlete device can select and log against any coach's athletes; (b) anyone with the URL has full read/write/**delete** on all clubs' data; (c) the coach gate is a bundle-inlined string + localStorage flag. The per-athlete `auth.uid()` RLS policies (migration `20260412`) are **dead** — no code authenticates.

**Reasoning.** For *one* coach behind a private URL, the deferral is defensible
and the team is candid. But against the club-wide benchmark, the residual risk
is real the instant the URL is shared or a second coach joins.

**Recommendation.** Keep the `owner_id`/`accessScope` architecture — it's right.
Two low-ceremony steps materially reduce risk *without* full auth: (1) **immediate
& cheap** — scope the athlete `ProfilePicker` fetch by the relevant coach's
`owner_id` so cross-coach enumeration is impossible even today; (2) **before any
URL sharing** — stop relying on the anon key alone (Supabase Auth, even
anonymous/magic-link sessions, which lets the dead `20260412` RLS be switched
on; or a real server-side secret). Full per-row RLS is the eventual target (the
`20260412` migration is the blueprint) and can stay deferred while tenant count
is one. **Document explicitly** that the current build is safe only for a single
trusted club behind a private URL.

> **Verified:** "anon full read/write/delete on all data" — **upheld, severity
> RAISED to critical.** "Athlete app enumerates all athletes" — **upheld**, but
> down-scoped to **med** (latent: nil blast radius with one coach, real the
> moment a second joins). Verdict is "Acceptable" *conditioned on the
> single-trusted-club deployment*; treat as **Replace/critical** for any broader
> exposure.

### 8. Performance tracking & visualisation — **Needs improvement** (Effort Med / Value High)

**Evidence.** The new `lib/analysis` engine is genuinely good — a long-format
`FactRow` model, owner-scoped, reusing the canonical prescription/combo logic,
never conflating planned vs performed, with tonnage = Σ(load×reps) at set-line
granularity and percentage loads correctly excluded when unresolved. Subtotals
re-bucket from facts (non-additive aggregates stay correct).

But the **rebuild is unfinished**: the older `useAnalysis.ts` engine still drives
the coach dashboard ([`useCoachDashboardV2.ts:264`](src/hooks/useCoachDashboardV2.ts)) and (a) never reads `counts_towards_totals`, so it counts non-counting accessories the canonical engine and planner exclude, and (b) folds percentage loads into kg tonnage. So the dashboard and `/analysis` can report different numbers for the same week. A third tonnage definition lives in `metrics.computeMetrics`. The entire `QuickAnalyses`/`PivotBuilder`/presets tree is dead code still shipping the fork. `chart.js` + `recharts` both ship (chart.js confined to 2 macro files).

**Recommendation.** Point the dashboard at the canonical engine (or at minimum
add a test asserting dashboard == `/analysis` for the same week); fix the
`counts_towards_totals` omission; flag the dead analysis tree for deletion (per
house rules, with sign-off); retire `chart.js` when the macro charts are next
touched.

> **Verified:** the `counts_towards_totals` omission inflating dashboard
> planned-volume / deflating compliance is **upheld, med** (live path). A
> separate claim that rep-weighting makes dashboard vs engine tonnage diverge
> was **refuted** with an algebraic proof (they're identical for kg;
> divergence is only the units/scale issue when `refMax≠100`).

### 9. Code quality — **Acceptable** (Effort Med / Value Med–High)

**Evidence.** Load-bearing code is disciplined: `trainingLogService` is a clean,
well-commented single entry point; `errorLogger` is production-grade (never-throw,
bounded breadcrumbs, decoupled actor resolver). The "god components"
(`WeeklyPlanner` 1930 LOC, `TodayScreen` 1351) are large-but-coherent
*orchestrators* that delegate to hooks/children — **not** rewrite candidates per
CLAUDE.md's debris test.

Bounded weaknesses: insert payloads typed `: any` with a misleading "run supabase
gen types" eslint-disable (the types are hand-written, no such workflow exists);
`describeError` (the helper that prevents `[object Object]` on Supabase errors)
is used in ~3 of ~17 sites — including **not** on `TodayScreen`, the most-used
mobile screen; ~10 components format dates outside `dateUtils`, two with genuine
US-format bugs (`toLocaleDateString(undefined,…)` / bare calls); one confirmed
dead function (`restorePlannedSet`).

**Recommendation.** Type the inserts honestly (delete the false eslint-disable
comments); sweep error displays to `describeError` (prioritise the mobile logging
path); route the bare/`undefined`-locale date calls through `dateUtils`; extract
macro-context loading into one hook. **Don't** rewrite the god components.

> **Verified:** the scary claim — "misspelled column silently no-ops, risking
> lost athlete data" — was **refuted**: PostgREST returns an error on unknown
> columns and every call site `throw`s, so a typo fails loudly at runtime. Real
> issue is only loss of *compile-time* field checking → **low**, not high.

### 10. Build, tooling, dependencies & testing — **Needs improvement** (Effort Med / Value High)

**Evidence.** Baseline is solid: strict tsconfig, ESLint, husky + commitlint,
vitest, version provenance injected at build, and a genuinely excellent analysis
engine test. But the **crown-jewel math has zero coverage** — no test imports
`xrmUtils`, `prescriptionParser`, `comboExpansion`, `metrics`, or
`restCalculation`; the analysis test injects *pre-parsed* fixtures, bypassing the
parser. The 1RM table is forked verbatim. Tests run on `vitest 4` → `vite 8`
(rolldown) while the app ships on `vite 5.4` (bundler skew). Pre-commit is
`tsc`-only — no test/lint gate, no CI. Single 3.3 MB bundle (936 KB gzip), no
`manualChunks`, zero `React.lazy`. `mathjs` (15 MB) pulled in for a 4-function
calculator.

**Recommendation (top priority).** (1) Add the smallest math-protecting suite
(~30 assertions over `xrmUtils`/`prescriptionParser`/`comboExpansion`/`metrics`).
(2) De-fork `RepMaxCalculator`. (3) `manualChunks` + lazy-load heavy routes
(Analysis, Macro, xlsx tooling) for the mobile path. (4) Pick one chart library;
drop/lazy-load `mathjs`. (5) Pin vite/vitest to one major. (6) One-file GitHub
Actions CI (typecheck + lint + test) + `npm run test` on pre-push.

> **Verified (both high):** the 1RM fork and the total absence of math tests are
> **upheld, high**. These are the lowest-effort/highest-value de-risking items.

---

## What verification changed

The adversarial + double-check layers were not ceremony — they moved real
numbers:

| Original claim | Verification outcome |
|---|---|
| `computeMetrics` counts % **and RPE** as kg; `max` differs screen-vs-print | RPE **refuted** (stored null); `max` **refuted** (identical both paths). Real bug narrowed to **tonnage/avg/K, % only**. |
| Anon key ⇒ full data access | **Upheld, raised to critical.** |
| Athlete app enumerates all athletes ⇒ cross-coach logging | **Upheld**, down-scoped to **med** (latent until 2nd coach). |
| Dashboard vs `/analysis` tonnage diverges (rep-weighting) | **Refuted** by algebra; the *real* divergence is `counts_towards_totals` + %-scale. |
| `: any` inserts ⇒ silent column drop ⇒ lost data | **Refuted**; PostgREST throws, loss is compile-time checking only (**low**). |
| Print pipeline reimplements tonnage *and* avg, can disagree | Author re-check: tonnage is **gated & rep-weighted** (matches); only the **per-category average** is unweighted → **med**, not high. |
| 1RM tracer found 3 implied-1RM definitions | Double-check found a **4th** ([`ExerciseDetailPanel.tsx:101`](src/components/exercise-library/ExerciseDetailPanel.tsx)). |
| Hardcoded lift-ratio targets are in *dead* components only | Double-check: also **live** via `PlannedVsPerformed` → `QuickAnalyses` → coach-facing insight text. |

---

## Newly-surfaced issues (completeness audit)

Outside the 10 dimensions, the audit found — and the author spot-verified the
top two:

- **[MED, verified] Macro Excel importer forks percent→kg rounding.**
  [`MacroExcelIO.tsx:80`](src/components/macro/MacroExcelIO.tsx) hardcodes `Math.round(pr*pct/100)` (nearest whole kg), ignoring the coach-configured rounding increment the interactive resolver honours. Same OWL concept, two answers + a hardcoding violation, on an untested write-path for coach macro targets.
- **[MED, verified — down from HIGH] Print pipeline parallel metrics.**
  [`PrintWeek.tsx:176`](src/components/planner/PrintWeek.tsx) computes per-category *average load* as an **unweighted** mean of exercise averages (`avgLoad += summary_avg_load; /loadCount`), diverging from the rep-weighted on-screen definition. (Weekly tonnage there **is** unit-gated and rep-weighted — it matches.) A SSOT/consistency issue on the artifact handed to athletes.
- **[MED] `xlsx@0.18.5`** has 2 unfixed HIGH advisories (prototype pollution, ReDoS) and parses untrusted `.xlsx` uploads — a real surface now that co-coach sharing is live.
- **[MED] `error_logs` privacy.** Anon-readable across the deployment, storing click-breadcrumb labels, actor display names, user-agents — cross-tenant PII leak if more than one club shares the project.
- **[LOW] iCal export defects.** Non-unique UIDs (`Date.now()`), no `TZID` on timed events, no RFC-5545 line folding — duplicate/duplicating calendar entries and timezone ambiguity for travelling athletes.
- **[LOW] Inbox/messaging** (1071-LOC `CoachInbox`, 60 s unread poller) untested; co-coach shared-thread attribution & `markMessagesRead` semantics unverified.
- **[LOW, verified] `parseSegment` silently drops malformed segments** with >3 `×`-parts (`80x5x3x2` → whole line vanishes from totals, no feedback).
- **[MED] Combo reps divergence on member edit.** `updateComboExercise` ([`useWeekPlans.ts:870`](src/hooks/useWeekPlans.ts)) re-saves a combo's member list **without** recomputing `summary_total_reps`, so the cached per-row count (sums all tuple parts) and the live `expandForCounting` (drops parts with no member) disagree after a normal membership edit.

---

## Scorecard

| # | Dimension | Verdict | Effort | Value |
|---|-----------|---------|:------:|:-----:|
| 1 | Overall architecture & separation | **Acceptable** | Med | Med |
| 2 | Training-domain model | **Needs improvement** | Med | **High** |
| 3 | Calculation & programming logic | **Acceptable** | Low | Med |
| 4 | State management | **Needs improvement** | Med | **High** |
| 5 | Data model & parameterisation | **Acceptable** | Med | Med |
| 6 | Persistence, sync & offline | **Needs improvement** | Med | **High** |
| 7 | Multi-user & coach–athlete model | **Acceptable** *(critical if URL shared / multi-coach)* | Med | **High** |
| 8 | Performance tracking & visualisation | **Needs improvement** | Med | **High** |
| 9 | Code quality | **Acceptable** | Med | Med–High |
| 10 | Build, tooling, dependencies & testing | **Needs improvement** | Med | **High** |

No dimension rates *Best practice* outright, and none rates *Replace* — the
honest summary is **"a strong core with edge-gaps"**: several dimensions are
*Acceptable with a clear, cheap path to good*, four *Need improvement* in
well-scoped ways. The only *Replace*-grade concern is conditional: the security
posture, **if** the deployment ever moves beyond one trusted club.

---

## The 3–5 highest-leverage fixes (ranked by value ÷ effort)

1. **Unit-aware load aggregation in `computeMetrics`** *(Effort Low–Med, Value High).*
   Thread `unit` through `MetricRow`/`computeMetrics`/the `useAnalysis` query and
   gate tonnage/avg/K on `absolute_kg`, reusing the already-correct
   `WeekSummaryBox.addEx` rule. Fixes a real, visible methodology bug for any
   %-programming coach and removes a self-contradiction between surfaces. Single
   well-scoped change (4 of 5 surfaces already gate correctly).

2. **Test the crown-jewel math + de-fork the 1RM table** *(Effort Low–Med, Value High).*
   ~30 assertions over `xrmUtils`, `prescriptionParser`, `comboExpansion`,
   `metrics`; delete the duplicated formula table in `RepMaxCalculator` and import
   `xrmUtils`. Locks in the product's core value at trivial cost; the tests then
   cover the calculator too.

3. **Athlete set-logging durability** *(Effort Med, Value High).*
   Extend the existing `prescriptionDraftStore` pattern to set/notes writes,
   add flush-on-hide to numeric cells, add a client fetch timeout + bounded
   retry, and a louder "unsaved — tap to retry" affordance. Closes the gym-floor
   silent-data-loss window the app exists to serve.

4. **Close the cross-coach data hole + document the security envelope** *(Effort Low for the picker scope, Value High).*
   Scope the athlete `ProfilePicker` query by `owner_id` (cheap, immediate), and
   write down explicitly that the current build is safe only for one trusted club
   behind a private URL — with RLS/auth as the gated next step before any sharing.

5. **Finish the analytics unification** *(Effort Med, Value High).*
   Point the coach dashboard at the canonical `runAnalysisQuery` (or add a test
   asserting dashboard == `/analysis`), fix the `counts_towards_totals` omission
   in `useAnalysis`, and flag the dead analysis tree for deletion. One tonnage
   definition, one set of numbers.

*(Honourable mention, very low effort: fix the `exerciseStore` stale-list bug
and sweep `describeError` onto the mobile path — both are small and user-visible.)*

---

## Correct as-is — do **not** churn these

These are good decisions; changing them would be regression or wasted motion.

- **The analysis engine boundary & fact model** — single `runAnalysisQuery`
  entry point, client never aggregates, `factFetch` isolates Supabase, tonnage =
  Σ(load×reps) at set-line granularity, planned/performed never conflated.
- **`trainingLogService` as the sole data-access path** for the athlete app and
  Log mode, with its documented race/constraint comments.
- **Pure-lib domain math** — `prescriptionParser`, `comboExpansion`'s "a set is a
  set" model, the `xrmUtils` 11-formula + inverse-square anchor blend, `prTable`
  history-as-source-of-truth with a rebuildable cache.
- **Planned-vs-performed separation** — distinct tables; plan edits preserve any
  `planned_exercise` that has been logged against; logs never mutate the plan.
- **`owner_id` schema discipline** — NOT NULL, backfilled, indexed, FK; the
  correct RLS-ready foundation. **`accessScope`** as the single source for
  sharing/role resolution with graceful degradation.
- **Gym-floor durability that already exists** — `prescriptionDraftStore`
  (mirror-before/clear-on-confirm), per-row `writeChainRef`,
  `upsert ON CONFLICT (log_exercise_id, set_number)`, `ensureLogExercise`'s
  defensive read, `useAutoCommit`'s `pagehide`/`visibilitychange` flush for notes.
- **Coach-flexibility done right** — free-string `week_type`/`PhaseType` (old
  enums deprecated/dropped), per-coach categories, `general_settings` knobs,
  `dashboardFlagSettings`, coach-defined analysis metrics. **Eleiko RAW &
  Prilepin correctly kept as constants** (external standards, not coach opinion).
- **Tooling baseline** — strict tsconfig, husky + commitlint (Conventional
  Commits), version provenance, the analysis engine test, lean dependency set.
- **The "god components" are not rewrite candidates** — they're coherent
  orchestrators per the debris-to-logic test; extract incrementally if at all.

---

## Recommendation

Proceed to the phased roadmap in [`REFACTOR_ROADMAP.md`](REFACTOR_ROADMAP.md),
which orders these by value-to-effort and keeps the app runnable and verifiable
at every step. **No code changes until the roadmap is approved.**
