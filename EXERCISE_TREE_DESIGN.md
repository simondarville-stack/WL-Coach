# Exercise Hierarchy (Parent–Child Trees) — Design

> Status: **DESIGN — awaiting approval to build.**
> Feature: coaches can nest exercises into arbitrary-depth trees (e.g.
> `Snatch › Snatch from hang › Snatch from low hang`). A child's
> reps/tonnage/metrics **roll up into its parent** for analysis and planner
> overviews, while the child is still planned/logged as its own specific
> variation. Improves quantification and keeps the catalogue tidy.

## Decisions (confirmed with the coach)

1. **Parent role — trainable + aggregates.** A parent is a *real* exercise you
   can prescribe and log directly. Its children's work **and** its own direct
   work both count toward the parent's family total. No double-count because
   every logged/planned contribution has exactly one `exercise_id` and is
   counted once under its resolved family bucket.
2. **Tree depth — multi-level (arbitrary).** Requires a proper walk-to-root
   resolver with a **multi-hop cycle guard** (the existing single-hop
   `pr_reference` guard is *insufficient* and must not be copied verbatim).
3. **Rollup scope — analysis + planner overview.** Rollup lives in **one shared
   helper** consumed by the analysis engine *and* the planner summary / print /
   macro surfaces, so every number agrees (non-negotiable #3).
4. **PR reference — auto-suggest parent.** Setting a parent pre-fills the
   existing `pr_reference_exercise_id` to that parent (still editable), so a
   child derives its % off the parent's PR without extra entry. The two links
   stay independent columns.

## Core architecture

### The link: a self-FK on `exercises`
Mirror the existing `pr_reference_exercise_id` precedent exactly.

```sql
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS parent_exercise_id uuid
    REFERENCES exercises(id) ON DELETE SET NULL;

ALTER TABLE exercises
  ADD CONSTRAINT exercises_no_self_parent CHECK (parent_exercise_id <> id);

CREATE INDEX IF NOT EXISTS idx_exercises_parent
  ON exercises(parent_exercise_id) WHERE parent_exercise_id IS NOT NULL;
```

- `ON DELETE SET NULL` — deleting/detaching a parent **orphans children to
  root**, never cascades (children are never destroyed by a parent change).
- A `CHECK` blocks self-parenting; multi-hop cycles (A→B→A) **cannot** be
  expressed in a CHECK and are enforced in the app + an optional trigger (below).
- `owner_id` match (child and parent same coach) is **app-enforced** in the
  picker; RLS is deferred, so we filter candidates and validate on write — same
  posture as every other exercise FK today.
- **No column is added to any plan/log table.** Plans and logs already store
  only `exercise_id` and join live, so re-parenting retroactively re-rolls all
  history (the desired behaviour). Trees are a pure catalogue concept.

Optional hardening (proposed, gated like any migration): a `BEFORE INSERT OR
UPDATE` trigger that walks `parent_exercise_id` and raises on a cycle or an
owner mismatch — closes the bulk-import / API bypass the UI guard can't cover.

### The single source of truth: `src/lib/exerciseHierarchy.ts` (new)
Every rollup goes through this module so the analysis engine and the planner
summaries can never diverge.

```
buildParentIndex(exercises)            -> Map<id, parentId | null>
resolveRootId(id, index)               -> id            // walk to top, visited-set guard
resolveAncestorPath(id, index)         -> id[]          // [self, parent, …, root]
resolveFamilyLabel(id, byId, index)    -> string        // root's name (grouping key)
wouldCreateCycle(childId, candidate, index) -> boolean  // full multi-hop check (picker)
getDescendantIds(id, childrenIndex)    -> Set<id>       // for drop-target guarding & delete
```

The cycle guard uses a `visited` set and bails safely on a loop (returns the
last non-repeating node) so a corrupted row can never infinite-loop a render or
an aggregation pass.

### Rollup target: the family **root**
The `family` grouping resolves each contribution's `exercise_id` to its **root
ancestor**. A trainable parent's own contributions resolve to itself (or to its
own root if it's mid-tree). This is additive: the existing `exercise` (leaf),
`category`, and `movement` dimensions are **unchanged**, so no existing number
moves. Intermediate-level rollup (roll to depth N rather than the root) is a
documented v2 extension the data model already supports — no schema change.

## Where it plugs in (blast radius, by phase)

### Phase 1 — Data + shared helper (no behaviour change yet)
- Migration above (user-applied via the Supabase MCP prompt only).
- `database.types.ts`: add `parent_exercise_id: string | null` to `Exercise`;
  add optional `parent_exercise_id?: string | null` to `ExerciseStub` (default
  null) so optimistic adds don't break tree rendering.
- `exerciseStore.ts`: `select('*')` already carries the new column through; no
  fetch change required. (Ordering column deferred to Phase 4.)
- New `exerciseHierarchy.ts` + **unit tests** (root walk, multi-hop cycle,
  owner filter, descendant set).

### Phase 2 — Analysis rollup (additive `family` dimension)
- `analysis/types.ts`: add `familyRootId: string | null` + `familyRootName:
  string` to `FactRow`; add `'family'` to the `Dimension` union.
- `analysis/factFetch.ts`: select `parent_exercise_id` into `RawExercise`; build
  the parent index once; stamp `familyRootId`/`familyRootName` on **every**
  FactRow — in all three planned branches (combo, set-line, cached-summary) and
  the performed branch and the `(deleted exercise)` fallback. **Order:** combo
  `expandForCounting` runs first, then family resolution per member contribution.
- `analysis/aggregate.ts`: add `dimValues` case `'family'` →
  `[row.familyRootName || row.exerciseName]` (un-parented exercises group under
  themselves). Register in `validate.ts` and the builder `dimensions.ts`.
- Metric policy: `reps/sets/nl/tonnage` SUM cleanly; `maxLoad` = MAX;
  `avgLoad/avgPct1RM` are rep-weighted and only meaningful for a
  movement-coherent family — add a `meta.notes` caveat when a family bucket
  spans multiple `lift_slot`s. Derived movement-scoped metrics
  (`snatchCleanRatio`, `pullPctOfTotal`) are unaffected (they key on `movement`).
- Drill-down: when a `family` cell is drilled, expand into its child exercises
  (`rows:['exercise']` filtered to the family) instead of a single opaque row.
- **Engine tests**: family sum, multi-level walk, combo-member→family, cycle
  safety, `family` == `exercise` when flat.

### Phase 3 — Planner overview rollup (shared helper)
- Add an additive **"by family"** grouping (alongside the existing "by
  category") to `WeekSummaryBox`, `metrics.ts`, `PrintWeek.calculateCategory‑
  Summaries`, and `usePlannerWeekOverview`, all using `exerciseHierarchy.ts`.
  Existing "by category" totals are untouched → no divergence.
- `getExerciseCategoryShade`: optionally shade children as tints of the family
  colour (data-driven colour preserved; never tokenised).

### Phase 4 — Catalogue tree UI (the "drag exercises around" ask)
- **Tree render** in `ExerciseListPanel`: within a category, show parent rows
  with an expand/collapse chevron (reuse the existing `CategorySectionHeader`
  chevron pattern) and indented descendants; per-parent collapse state.
- **Drag-to-reparent** — built on **`react-arborist`** (recommended; the
  CLAUDE.md "no new packages" rule was relaxed on 2026-07-01). It is purpose-
  built for exactly this: drag-to-reparent, reorder, arbitrary-depth nesting
  (matches the multi-level decision), expand/collapse, inline rename, keyboard
  nav, and virtualization out of the box — fastest path to a UX the coach can
  feel and iterate on. Trade-off: it owns the row container (height/indent/
  virtualization); we fully control each node's inner render but not the outer
  list mechanics. Revisit if it fights the compact aesthetic.
  - Render the catalogue as **one unified tree**: `Category → parent exercise →
    child variations`. (Category CRUD — rename/recolour/reorder/add/delete —
    stays in the existing `ExerciseCategoryNav` modal for now; categories appear
    as the tree's top level.)
  - drop an exercise **onto** another row → set that row as `parent_exercise_id`;
  - drop **between** rows → reorder (introduces a nullable
    `exercises.display_order`, falling back to name sort when null);
  - drop **onto a category** node → clear parent + set that category.
  - Drops that would form a cycle (onto own descendant) are rejected — enforced
    with the shared `wouldCreateCycle` / `getDescendantIds` helper.
  - Alternative considered: `@dnd-kit` (headless, more reusable across the app's
    other DnD surfaces) — more build effort before it feels good; rejected for
    v1 in favour of speed-to-feel.
- **`ExerciseForm`**: add a searchable "Parent exercise" picker filtered to
  valid candidates (same owner, non-archived, not `— System`, not self, not a
  descendant — full multi-hop guard). On set, auto-suggest `pr_reference_‑
  exercise_id` = parent when empty. Children may inherit category / lift_slot /
  colour / unit from the parent unless overridden.
- **`ExerciseDetailPanel`**: surface parent → siblings → children explicitly
  (replaces/augments the current "Related (category)" chip row).
- **Bulk import** (`ExerciseBulkImportModal`): add a `parent` column (by code or
  name); **two-pass** import (insert all rows, then resolve parent links);
  export includes the column so the tree round-trips (today it silently
  flattens).

### Phase 5 — Verify
`npm run typecheck` + `npm run build` + `npm test` green between every phase;
manual preview of catalogue tree, an analysis `family` pivot, and a planner
"by family" summary.

## Explicit non-goals / known limitations (v1)
- **Off-plan combos stay a blind spot.** Athlete ad-hoc combos are logged under
  the lead lift with members frozen in `metadata.combo`, which `factFetch` never
  reads. Their members won't roll up. Fixing needs `factFetch` to parse
  `metadata.combo` — deferred, documented, not silently miscounted.
- **Macro targets stay per-node.** `macro_tracked_exercises`
  `UNIQUE(macrocycle_id, exercise_id)` still allows tracking a parent and a
  child separately; planned-vs-target stays per-tracked-node. No family target
  math in v1.
- **Intermediate-level rollup** (roll to depth N, not root) is a v2 extension;
  the schema/helper already support it.
- **Legacy `useAnalysis` dashboard** keeps its category/exercise grouping; the
  `family` grouping is offered only where added, so nothing diverges.
- No table/field is renamed or deleted; legacy combo tables remain.

## Sequencing, safety, versioning
- Branch `feature/exercise-hierarchy` off `main`; no push, no merge.
- Migrations applied **only** via the gated Supabase MCP confirmation prompt.
- Conventional Commits, one logical commit per phase, typecheck+build between.
- Ships as a user-facing feature → **MINOR** bump `0.17.1 → 0.18.0` in the same
  commit before merge.
