# EMOS Performance Review

**Date:** 18/08/2026 · **Version reviewed:** 0.49.0 (main, acbc3a2) · **Status:** Phases 1–4 shipped in **0.49.2** (18/08/2026).

> **Shipped results:** dashboard + full app boot measured at **77 requests** (was ~350–400 for the dashboard alone, largely sequential); entry bundle **395 kB / 118 kB gzip** (was 3,874 kB / 1,088 kB); planner/dashboard interaction re-renders cut via day-scoped state patches + memoization; FK-index + RLS-initplan migration applied (`20260818190000`). Deferred follow-ups: group-plan sync batching (A7), `fetchFacts` stage-parallelization (A9), copy/paste/template per-row loops (A10, A13), full `React.memo(DayCard)` handler-chain stabilization, MacroExcelIO xlsx dynamic import, permissive-policy consolidation (auth phase).

## Verdict

The slowness is real and it is architectural, not incidental. Three root causes, in order of impact:

1. **A chatty, sequential network layer.** The app issues hundreds of small Supabase queries where a handful of batched ones would do, and most of them run one-after-another (each waits for the previous). The database itself is fast — the largest table holds ~5,300 rows — but every query costs a full HTTP round trip (~50–150 ms desktop, 150–300 ms mobile), and the app pays that toll serially, repeatedly, and on a 60-second timer.
2. **A single 3.87 MB JavaScript bundle** (1.09 MB gzip). Every visitor — including athletes on phones — downloads and parses the entire coach app, two chart libraries, the Excel codec, and a full computer-algebra system before anything renders.
3. **Render architecture that repaints everything on any interaction.** The planner re-renders the whole week on every prescription-cell click; the dashboard repaints the whole board every 60 s. There is no `React.memo` and no `useCallback` anywhere in the planner or dashboard.

Postgres-side issues (missing FK indexes, RLS policy overhead) exist but are **not** what you are feeling — at current data volumes they are milliseconds. They are listed as low-priority housekeeping.

---

## Measurements

### Bundle (vite build, production)

One chunk: `index-*.js` — **3,870 kB minified / 1,087 kB gzip**. Route-level code splitting: none (the only `lazy()` — the athlete print view — is defeated by a static import of the same module in `PlannerModals.tsx`, so Vite can't split it out).

Attribution (share of original source in the bundle):

| Package | Size | Share | Actually needed by |
|---|---|---|---|
| mathjs | 1,851 kB | 18.7% | one `evaluate()` call in the pop-up Calculator tool |
| xlsx | 875 kB | 8.8% | Excel import/export (3 call sites, all user-triggered) |
| recharts | 772 kB | 7.8% | Analysis + planner charts |
| chart.js | 493 kB | 5.0% | one component (`MacroDistributionChart`) — duplicate charting stack |
| App code (all modules) | ~3,800 kB | ~38% | each route needs only its own slice |

### Database

Largest tables: `training_log_sets` 5,331 rows (1.5 MB), `planned_exercises` 2,609 rows, `planned_set_lines` 2,160 rows. Raw query latency is not a bottleneck at this scale; round-trip **count** is.

### Dashboard network cost (from code inspection)

For ~20 athletes / 4 groups: **roughly 350–400 HTTP round trips per load, largely sequential**, re-run every 60 s and on every tab re-focus. At 80 ms RTT the status board takes >10 s to fully populate and an idle dashboard tab issues ~500 queries/minute.

---

## Findings

### A. Network / data layer (highest impact)

**A1. Coach dashboard N+1 storm — `src/hooks/useCoachDashboard.ts:146-222`, `:330-398`, `:459-517`, `:420-443`.**
`loadAthleteStatuses` loops athletes with `for…await`, 6–7 sequential queries each; `resolveCurrentMacro` nests another sequential loop. `loadMacroAlignments` re-walks the same athletes and calls `resolveCurrentMacro` a second time, plus 2 queries per tracked exercise. `loadUpcomingEvents` queries per event; `loadGroupStatuses` 4–6 per group. Only the five top-level loaders are parallelised — everything inside is serial. Re-fired every 60 s and on `visibilitychange` (`useCoachDashboardV2.ts:411-433`).

**A2. Per-athlete enrichment re-downloads shared data — `src/hooks/useCoachDashboardV2.ts:263-279` → `src/hooks/useAnalysis.ts:158-295`.**
`fetchWeeklyAggregates` is 10 queries in 5 sequential stages per athlete, and two of those queries (the full `exercises` catalogue and all `macro_phases`) are identical for every athlete — fetched N times per poll cycle.

**A3. Access scope resolved 4× per dashboard load — `src/lib/accessScope.ts:101-147`.**
Uncached; called from four separate loaders per refresh, each a 3–4 stage waterfall. `fetchAllAthletes` (`useAthletes.ts:52-59`) also bypasses the store's `athletesLoaded` cache, so the waterfall re-runs on every planner mount too (`WeeklyPlanner.tsx:311-313`).

**A4. Planner refetches the world after every write — `WeeklyPlanner.tsx:499-506`, `:539-543` + ~25 call sites.**
Dialog close = fixed 150 ms sleep + full `fetchPlannedExercises` (with `select('*, exercise:exercise_id(*)')` — the full exercise row duplicated per planned row) + combo members. The optimistic-patch helpers that make this unnecessary already exist in `useWeekPlans.ts` (`savePrescription:632`, `saveGppSection:711`, `saveExerciseFeatures:769`) — these paths just don't use them.

**A5. Double fetch on mount / athlete selection — `WeeklyPlanner.tsx:332-337` + `:346-370`.**
An effect rewrites `planSelection` with a new-but-identical object, re-triggering the load effect: picking an athlete costs ~14 round trips and two grid renders instead of ~7 and one. Additionally `focus` + `visibilitychange` both fire on a single alt-tab back (`:404-427`), so every return to the tab fetches everything **twice**.

**A6. Athlete app (mobile) day load is ~10 sequential round trips — `src/lib/trainingLogService.ts:318-344`.**
`planned` and `log` chains are independent but awaited serially; inner queries likewise. On a phone network that is 1.5–3 s before an athlete sees today's session. A correct dependency graph needs ~4 stages.

**A7. Group plan sync: 8–11 sequential round trips per member — `useWeekPlans.ts:1452-1720`.**
15-member group ≈ 150 sequential round trips ≈ ~12 s of blocked UI, with no batching across members and partial-sync on failure.

**A8. Inbox: unbounded full-table scans — `trainingLogService.ts:1302-1451`, `:1465-1470`, `:1719-1722`.**
All athlete messages + all coach messages fetched with no `.limit()`, re-run on focus, on `visibilitychange`, and after **every sent message** (`useThreadChat.ts:285`). Cost grows linearly with account age, forever.

**A9. Analysis `fetchFacts`: 15–17 sequential stages — `src/lib/analysis/factFetch.ts:635-909`.**
Independent queries (`exercises`, `categories`, `athlete_prs`, `general_settings`; planned-chain vs performed-chain) are serialised. ~16×RTT ≈ 1.3 s of pure latency; ~6 stages suffice.

**A10. Sequential per-row loops on copy/paste/template/undo/reorder paths.**
`handleCopyWeek` (`WeeklyPlanner.tsx:1408-1417`): 40-exercise week = 40 sequential reads just to copy. Paste/apply/undo insert one exercise at a time (`:941-956` etc.); `templateService.ts:364-606` same. `DayEditor.tsx:268-273` drag-reorder writes one `update` per row then refetches the whole week — while both a `Promise.all` variant and a single-RPC variant (`normalizePositions`) already exist in `useWeekPlans.ts`.

**A11. Misc query waste.**
Per-cell-edit timeline refetch: dep array keyed on the `macroWeeks` array identity (`MacroCycles.tsx:496-527`); macro paste writes one round trip per (exercise, field) pair (`MacroCycles.tsx:928-941`) though `bulkUpsertTargets` exists; prescription save = 5 sequential round trips incl. a metadata re-read the state already holds (`useWeekPlans.ts:534-600`); week-visibility toggle = 3×N queries (`:839-852`); `general_settings` refetched uncached from ~9 call sites (`useSettings.ts:11-52`); `group_members` queried from 7 places with no shared cache; dead 5-round-trip function `fetchMacroTargetForExercise` (`useMacroCycles.ts:641-692`, no call sites) and a dead `weekTypeConfigs` query whose result is discarded (`usePlannerWeekOverview.ts:499`, state getter dropped at `:137`).

### B. Bundle & loading

**B1. No route-level code splitting — `src/App.tsx:1-39`.** Every module statically imported. Splitting planner / macro / analysis / inbox / athlete app / field app into `React.lazy` routes, and dynamic-importing mathjs (Calculator), xlsx (3 call sites) and the chart components, would cut the initial download by roughly 60–70% and make every deploy's cache-bust far cheaper.

**B2. Defeated lazy chunk.** `PrintWeek` is dynamically imported in `AthletePrintWeek.tsx` but statically imported in `PlannerModals.tsx`, so it can't split (build warning confirms).

**B3. Two chart libraries.** chart.js exists for one component (`MacroDistributionChart`); recharts is used everywhere else. Consolidating on recharts removes ~500 kB of source and the StrictMode workaround noted in `main.tsx` (StrictMode was disabled app-wide because of Chart.js double-mount behaviour).

**B4. Deploy/HTML niceties (small).** Google Fonts stylesheet is render-blocking in `index.html`; no `cache-control: immutable` header for hashed `/assets/*` in `netlify.toml` (Netlify default revalidates each asset).

### C. Planner render architecture

**C1. Any cell click re-renders the entire week — `useWeekPlans.ts:632-655` + `PrescriptionGrid.tsx:317-323`.**
The ±1 steppers commit on every click; `setPlannedExercises` rebuilds the whole `Record<day, exercises[]>` — new arrays even for untouched days — so every day card, row, grid and the week-summary memos (all keyed on `plannedExercises`) re-render per click, on a control designed for rapid clicking.

**C2. Memoisation is absent and currently impossible — `WeekOverview.tsx:144-183`, `WeeklyPlanner.tsx:1836-1859`, `DayCard.tsx:857-920`.**
Zero `React.memo`/`useCallback` in the planner; every card/row prop is a fresh inline closure, fresh array (`presetItems` maps all presets per row per render) or per-render `Map`. Memo can only help after handlers are stabilised.

**C3. Prescription parsing runs per row per render — `DayCard.tsx:201-206` (`computeMetrics`/`expandForCounting`), `:915` (`signMenuItem` parses just to decide a closed menu's entry), `StackedNotation.tsx:97/134/166`.** Hover state at card level (`DayCard.tsx:145`) means mousing across rows re-runs all of it.

**C4. `useDeleteHeld` instantiated per row and per chip — `hooks/useDeleteHeld.ts:3-19`; called at `DayCard.tsx:152`, `PrescriptionGrid.tsx:140`, `ExerciseFeatureControls.tsx:51/402`.**
A 40-row week registers 150+ window keydown/keyup/blur listeners; one Delete press triggers 50+ independent setStates. Should be one provider/shared subscription.

**C5. Day-config drag sets state per `dragover` frame — `WeeklyPlanner.tsx:1298-1309`.** New array + setState at ~30–60 Hz with the full week still mounted behind the modal. (The newer board-level card drag is fine — it commits on drop.)

**C6. Log mode aggregates unmemoized — `LogWeekOverview.tsx:213-276`, `LogModeView.tsx:245-386`.** Week-wide reduces/sorts re-run on every render.

**C7. Broad zustand subscriptions — `WeeklyPlanner.tsx:84`, `:321-322`; `useExercises.ts:12-22` (whole exercise store subscribed by every `DayCard` via `useExercises()` at `DayCard.tsx:138`); `AthleteSelector.tsx:7-10`; `Sidebar.tsx:86`.** Any store write re-renders all subscribers; the exercise-library refocus refresh re-renders every day card.

### D. Dashboard render & polling

**D1. 60 s poll repaints the whole board — `useCoachDashboard.ts:224`, `useCoachDashboardV2.ts:396`, `:441-454`, `StatusBoard.tsx:89-92`.** Fresh arrays/objects each poll invalidate the single memo; zero `React.memo` in `dashboard-v2`; every sparkline re-renders per minute even when nothing changed.

**D2. Three standing 60 s pollers** (sidebar inbox badge — which deliberately keeps polling hidden tabs when desktop notifications are on; field app week; athlete unread badge). Individually cheap and correctly cleaned up; listed so the polling inventory is in one place. No Supabase realtime is used anywhere.

### E. Correctness bugs found in passing

- **In-place `.sort()` mutating React state during render** — `DayCard.tsx:578`, `ExerciseDetail.tsx:114` (all other call sites copy first). Should be `.slice().sort(...)`.
- **Macro paste races itself** — `MacroCycles.tsx:928-941` fires concurrent upserts against the same row from one stale snapshot.
- `useDraggable.ts:103-108` re-subscribes its resize listener on every pointer move (cheap, but wrong).

### F. Postgres housekeeping (low priority now, cheap to do)

From Supabase performance advisors (84 lints):

- **15× `auth_rls_initplan`** (WARN): athlete-facing policies re-evaluate `auth.uid()` per row; fix is wrapping as `(select auth.uid())`. Hot-path tables: `week_plans`, `planned_exercises`, `planned_set_lines`, `training_log_*`, `athlete_prs`, `macro*`.
- **19× `multiple_permissive_policies`** (WARN): overlapping permissive policies (e.g. `training_log_exercises` SELECT has 3) each evaluated per row. Consolidate when the auth phase lands.
- **26× unindexed FKs** (INFO): worth adding on the planner/log join paths (`planned_exercises.exercise_id`, `planned_exercise_combo_members.*`, `training_log_exercises.exercise_id`, …) — one migration, matters as data grows.
- **24× unused-index** notices: ignore for now (beta traffic makes this lint unreliable).

---

## Recommended plan

Each phase is independently shippable; order is by user-felt payoff per unit of risk.

**Phase 1 — cut the network chatter where you feel it daily.**
1. Dashboard: batch per-athlete/per-group loops into set-based `.in()` queries; share one `resolveCurrentMacro` + one access-scope resolution per load; hoist the shared `exercises`/`macro_phases` fetches out of the per-athlete enrichment. Expected: ~400 → ~15 queries, board populates in <1 s, idle cost drops ~95%.
2. Planner: use the existing optimistic-patch helpers instead of `handleRefresh()` on dialog close (drop the 150 ms sleep); fix the `planSelection` double-fetch; dedupe focus/visibility refetch. Expected: athlete switch and dialog close feel immediate.
3. Athlete app: parallelise the day-load chains (~10 → ~4 stages). Expected: 1–2 s faster session open on mobile.

**Phase 2 — bundle.**
4. Route-level `React.lazy` for planner / macro / analysis / inbox / athlete / field; dynamic-import mathjs, xlsx, and chart components; fix the `PrintWeek` static import. Expected: initial JS −60–70%; athletes stop downloading the coach app.
5. (Optional, later) replace chart.js's one component with recharts; restores StrictMode.

**Phase 3 — render architecture (planner first, then dashboard).**
6. Make `setPlannedExercises` patch only the changed day (keep untouched days' array identity), then `useCallback` the handler set and `React.memo` `DayCard`/row/`StackedNotation`. Expected: cell clicks re-render one card, not forty.
7. Replace per-row `useDeleteHeld` with a single provider; guard the day-config `dragover`; memoize log-mode aggregates; move row-hover state down.
8. Dashboard: memo rows/sparklines + stable identities across polls; zustand selector subscriptions for the always-mounted shell components.

**Phase 4 — housekeeping.**
9. Inbox: add windows/limits to thread fetches; count via `head:true`.
10. One migration: FK indexes on hot join paths + `(select auth.uid())` RLS rewrite + policy consolidation.
11. Cache `general_settings` in a store (pattern exists in `exerciseStore`); delete dead code (`fetchMacroTargetForExercise`, dead `weekTypeConfigs` query); fix the two `.sort()`-in-render mutations.

## Not the problem (checked and cleared)

Global CSS (no universal transitions), scroll/mousemove listeners (none unthrottled), observers (all disconnected), timer leaks (none), date formatting in hot loops (none), localStorage in hot paths (draft store writes on commit only, not per keystroke), error logger hot-path cost (in-memory, bounded — though `logError` has no dedupe/throttle for error loops).
