# EMOS — Refactor Roadmap (proposed)

> Derived from [`REVIEW.md`](REVIEW.md). Ordered by **value ÷ effort**. The app
> stays **runnable and verifiable at every step**; each step lists its
> verification and flags whether it changes user-visible behaviour.
> **Nothing here is started until you approve.** Execution is one step at a time:
> state rationale → change → `npm run typecheck` + `npm run build` (+ targeted
> tests) → commit (Conventional Commits) → next.
>
> **Migrations:** none are required by Phases 1–6. Where the eventual security
> work (Phase 3b) involves RLS/auth, migrations are applied **only** via a tool
> that surfaces a per-call approval prompt — never silently.

**Effort legend:** S ≈ <½ day · M ≈ ½–2 days · L ≈ multi-day.

---

## Phase 1 — Correctness & trust *(highest leverage, lowest risk)*

Goal: the numbers a coach programs from are right and guarded by tests. Mostly
internal-logic changes; one behaviour change (flagged).

1. **Math test suite** *(S, no behaviour change).* Add unit tests for
   `xrmUtils` (reps=1 identity, 11-formula average, forward/reverse round-trip,
   anchor exact-hit + inverse-square weighting), `prescriptionParser`
   (`load×reps`⇒sets=1, `load×reps×sets`, comma segments, interval `80-90`,
   reject `loadMax<load`, weighted `avg_load` incl. interval midpoint),
   `comboExpansion` (per-member rep split, "a set is a set" attribution,
   stale-cache live-parse fallback), `computeMetrics`. *Verify:* `npm run test`.
   *This goes first so it pins behaviour before Phase 1.2–1.3 touch it.*

2. **Unit-aware load aggregation** *(M, ⚠ behaviour change — fixes a bug).*
   Thread `unit` through `MetricRow`/`ExerciseRaw` ([`usePlannerWeekOverview.ts`](src/hooks/usePlannerWeekOverview.ts)), extend `computeMetrics`' row shape with `unit`, and gate tonnage/avg/K on `absolute_kg` (percentage/RPE/free-text contribute reps & sets only) — reusing the rule already in [`WeekSummaryBox.addEx`](src/components/planner/WeeklyPlanner.tsx). Add `unit` to the [`useAnalysis.ts:241`](src/hooks/useAnalysis.ts) select and gate `parsePlannedExercise` tonnage/maxLoad. *Verify:* new tests assert a `90%×2×3` week yields 0 kg tonnage and that the planner header now matches `WeekSummaryBox`. ⚠ Coaches who program in % will see corrected (lower) tonnage/avg/K — call this out in the changelog.

3. **De-fork the 1RM table** *(S, no behaviour change).* Delete
   `FORMULAS`/`REVERSE_FORMULAS`/`estimate*` in [`RepMaxCalculator.tsx`](src/components/tools/RepMaxCalculator.tsx); import from `xrmUtils` (export the raw formula maps for the per-formula breakdown). *Verify:* tests from 1.1 now cover the calculator; manual check the tool's output is unchanged.

4. **Split presentation out of `calculations.ts`** *(S, no behaviour change).*
   Extract a pure `rawScoreBand(avg)` classifier; move Tailwind/token mapping to
   the view; keep the 7/10 thresholds as named constants. (These helpers have no
   live consumers — confirm and either rewire or remove with sign-off.)

*Version: MINOR (1.2 is a user-facing correction). Suggested `0.15.0`.*

---

## Phase 2 — Gym-floor data durability

Goal: a set logged on bad connectivity is never silently lost. Proportionate —
**no** general offline-sync engine.

1. **Athlete write drafts** *(M, behaviour-additive).* Extend the
   `prescriptionDraftStore` pattern to set/notes writes: mirror payload to
   localStorage keyed by `(log_exercise_id, set_number)` before
   `upsertLoggedSet`/`updateLogExercise`; clear only on confirmed success;
   surface survivors on `TodayScreen` mount (mirror the coach unsaved-drafts
   banner). *Verify:* simulate a rejected write (offline devtools), reload,
   confirm the value is offered for re-commit.

2. **Flush-on-hide for numeric cells** *(S).* Wire `useAutoCommit` (already used
   for notes) into `SetEntryRow`'s numeric commit so a typed-but-unblurred kg/reps
   commits on `pagehide`/`visibilitychange`. *Verify:* type → background tab →
   confirm write fired.

3. **Client request timeout + bounded retry** *(S).* Wrap the Supabase client
   fetch with an `AbortController` timeout + 2 backoff retries so a hung gym-wifi
   request fails fast instead of pinning the row's `busy` flag. *Verify:* throttle
   to offline, confirm the row recovers rather than spins.

4. **Louder failed-write affordance** *(S).* Replace the transient red banner
   with a persistent "N unsaved — tap to retry" tied to the queued drafts.

5. *(Optional, defer unless wanted)* **Minimal service worker** caching the app
   shell + current day's plan for offline open. *Flag: adds a PWA build step.*

*Version: MINOR. Suggested `0.16.0`.*

---

## Phase 3 — Security envelope

### 3a — Immediate, cheap *(do regardless of the auth decision)*

1. **Scope athlete `ProfilePicker` by `owner_id`** *(S, ⚠ behaviour change).*
   Filter the athlete/group fetch in [`AuthContext.tsx:60`](src/athlete/v2/lib/AuthContext.tsx) to the relevant coach (via the share-link/group owner or a coach-config owner id) so an athlete device can never enumerate or log against another coach's athletes. ⚠ With one coach today this is invisible; it closes the hole before multi-coach. *Verify:* picker shows only the scoped athletes.
2. **Document the security envelope** *(S).* State in `README.md` that the build
   is safe only for a single trusted club behind a private URL, and that RLS/auth
   is the gated prerequisite for any wider exposure.

### 3b — Real isolation *(gated decision — needs your go-ahead; involves migrations)*

3. Move off the bare anon key to Supabase Auth (even anonymous / magic-link
   sessions), then switch on the **already-written** per-athlete `auth.uid()` RLS
   policies (migration `20260412…` is the blueprint) and add coach-side policies
   keyed on `owner_id`/`accessScope`. *This is the only part that touches the DB;
   present as a trade-off proposal with a migration plan before doing it.*

*Version: 3a → PATCH (`0.16.x`); 3b → MINOR + explicit approval.*

---

## Phase 4 — Analytics unification

Goal: one tonnage definition; dashboard and `/analysis` never disagree.

1. **Fix `counts_towards_totals` omission** *(S, ⚠ behaviour change — fixes a bug).*
   Make `useAnalysis.parsePlannedExercise` (and its query) honour
   `counts_towards_totals` so dashboard planned-volume/compliance excludes
   non-counting accessories like the canonical engine. *Verify:* a plan with a
   non-counting accessory shows equal planned reps on dashboard and `/analysis`.
2. **Point the dashboard at the canonical engine** *(M).* Replace
   `useCoachDashboardV2`'s `fetchWeeklyAggregates` with `runAnalysisQuery`
   (week-grouped reps/tonnage/compliance). *Verify:* add a test asserting the two
   surfaces return equal totals for the same athlete/week.
3. **Flag the dead analysis tree** *(S, sign-off required).* `QuickAnalyses`,
   `PivotBuilder`, `PlannedVsPerformed`, the `presets/`, and the now-unused
   `useAnalysis` fetchers are unreachable (the live route is `AnalysisModule`).
   Per house rules, **list them for explicit deletion approval** — do not delete
   unprompted. Removing them also retires the live hardcoded-lift-ratio path.

*Version: MINOR. Suggested next minor.*

---

## Phase 5 — State coherence

1. **Exercise/category stale-list bug** *(S, ⚠ behaviour change — fixes a bug).*
   Add a `force` flag to the `exerciseStore` fetch actions (mirror
   `athleteStore.fetchAthletes(force)`), and have `ExerciseLibrary` mutations
   force-refetch or patch the store. *Verify:* create an exercise → it appears
   without reload.
2. **`general_settings` as one observable store** *(M).* Promote to a single
   Zustand store; delete the 5+ per-hook copies and the dashboard duplicate.
   *Verify:* edit a setting in one screen → another open screen reflects it.
3. **Reactive (or documented) coach switch** *(S).* Make active-coach changes
   invalidate owner-scoped caches, or document the remount requirement as the one
   defined invalidation point.
4. *(Defer)* Batch the dashboard per-athlete N+1 reads into `.in()` queries only
   if athlete count grows enough to be felt.

*Version: PATCH/MINOR depending on the settings-store scope.*

---

## Phase 6 — Code quality, tooling & dependencies

1. **`describeError` sweep** *(S, ⚠ UX improvement).* Replace
   `e instanceof Error ? e.message : String(e)` with `describeError(e)` across
   error displays, prioritising `TodayScreen`/`WeekScreen`/`AddTrainingSheet`/
   `ExercisePicker` so athletes see real Supabase text, not `[object Object]`.
2. **Honest insert typing** *(S).* Type insert payloads against the existing
   hand-written Insert types; delete the misleading "run supabase gen types"
   eslint-disable comments.
3. **Date-formatting bugs** *(S, ⚠ fixes US-format bugs).* Route
   `toLocaleDateString(undefined,…)` / bare `.toLocaleDateString()` sites
   (`CoachInbox`, `BodyweightHistoryDialog`, `TemplatesPage`, `WeeklyPlanner:1885`)
   through `dateUtils`. (The `en-GB` month-name sites are lower priority.)
4. **Macro-context hook** *(M).* Extract the duplicated macro-table fetching
   (`WeeklyPlanner`/`PlannerControlPanel`/`ExerciseDetail`) into one hook —
   resolves the file-top TODO and the SSOT drift; also moves a coach-write out of
   a presentational component.
5. **Bundle & deps** *(M).* `manualChunks` (react/router, recharts, supabase) +
   `React.lazy` the heavy routes (Analysis, Macro, xlsx/calculator tooling) to
   break the 3.3 MB monolith for the mobile path; pick **one** chart library
   (migrate the 2 `chart.js` macro files to recharts); drop or lazy-load `mathjs`.
6. **CI + bundler parity** *(S).* One-file GitHub Actions workflow (typecheck +
   lint + test); add `npm run test` to a pre-push hook; pin vite/vitest to one
   major so tests and production share a bundler.

*Version: PATCH (chore/refactor), unless lazy-loading changes are bundled with a
feature.*

---

## Phase 7 — Newly-surfaced edge issues *(address opportunistically)*

- **[MED] Macro Excel percent→kg rounding** — make
  [`MacroExcelIO.resolvePercentage`](src/components/macro/MacroExcelIO.tsx) honour the coach rounding increment (reuse the planner's resolver). *Fixes a SSOT + coach-flexibility divergence; ⚠ changes imported target loads.*
- **[MED] Combo reps stale-on-member-edit** — recompute
  `computePrescriptionSummary` in [`useWeekPlans.updateComboExercise`](src/hooks/useWeekPlans.ts) when the member list changes, so cached and live combo reps agree. *Fixes a real count divergence.*
- **[MED] Print per-category average** — derive the printed category average
  from the canonical rep-weighted definition instead of an unweighted mean
  ([`PrintWeek.tsx:176`](src/components/planner/PrintWeek.tsx)). *Consistency with on-screen.*
- **[MED] `xlsx` CVE** — `xlsx@0.18.5` has unfixed HIGH advisories and parses
  untrusted uploads; evaluate the SheetJS CDN build or a maintained fork, and at
  minimum lazy-load it. *Trade-off proposal before swapping a dependency.*
- **[MED] `error_logs` privacy** — add owner scoping (or redact breadcrumb
  labels/actor names) so error telemetry isn't cross-tenant-readable. *Pairs with
  Phase 3.*
- **[LOW] iCal export** — stable per-event UIDs, `TZID`/UTC on timed events,
  RFC-5545 line folding ([`icalExport.ts`](src/lib/icalExport.ts)).
- **[LOW] `parseSegment`** — handle/flag >3-part malformed segments instead of
  silently dropping the line.
- **[LOW] Inbox shared-thread audit** — confirm co-coach attribution and
  `markMessagesRead` semantics for shared threads.

---

## Deliverable 4 — README

`README.md` is currently a Bolt badge only. As part of executing the roadmap
(naturally alongside Phase 3a's security note), replace it with: stack, setup
(env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional
`VITE_COACH_GATE`), run/build/test commands, an architecture overview
(service layer ↔ hooks ↔ components; the analysis engine; planned-vs-performed),
the deployment/security envelope, and the versioning convention.

---

## Suggested sequencing

```
Phase 1 (correctness + tests)      ──►  ship 0.15.0
Phase 2 (durability)               ──►  ship 0.16.0
Phase 3a (picker scope + docs)     ──►  ship 0.16.x      [3b gated separately]
Phase 4 (analytics unification)    ──►  ship next minor
Phase 5 (state coherence)
Phase 6 (quality/tooling/deps)
Phase 7 (edge issues, opportunistic)
```

Phases 1–3a are the high-value, low-risk core and could reasonably be the agreed
near-term scope; Phases 4–7 follow as capacity allows. Each phase is independent
and leaves the app fully runnable.
