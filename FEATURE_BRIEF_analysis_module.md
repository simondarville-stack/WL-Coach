# FEATURE BRIEF — Analysis Module (EMOS)

**Status:** Plan-only. L-scope. Requires REVIEW_PLAN sign-off before any code.
**Type:** `feat` · **Scope:** `L` · **Backlog item:** #4
**Version impact:** minor (`0.2.0 → 0.3.0`) on first shippable phase.

---

## 0. One-line intent

A configurable analysis tab that treats every chart, pivot table, and saved report as a
rendering of a single serializable query over EMOS's planned/performed data — slicing by
athlete, group, exercise, category, intensity zone, and time (date range OR macro OR rolling
window), with full planned-vs-performed duality.

---

## 1. Architectural invariants (must hold)

- [ ] **Planned/performed separation** — never conflate prescribed and executed. `state` is a
      first-class query axis: `planned | performed | both | delta | adherence`.
- [ ] **Coach-configurability** — metrics, derived metrics, intensity zones, and presets are
      runtime config read from a registry, NOT hardcoded.
- [ ] **Abstract slot addressing** — time grouping and relative-time alignment use
      `week_start + day_index`; never derive calendar dates by `weekStart + (dayIndex-1)`.
- [ ] **DST safety** — all week-key arithmetic uses UTC-consistent methods.
- [ ] **`owner_id` scoping** — every fact query is owner-scoped.
- [ ] **API-first separation** — all aggregation lives behind a data-layer service
      (`runAnalysisQuery(config)`); the React client never aggregates raw rows directly.

---

## 2. Core abstraction — the `AnalysisQuery` config

The single source of truth. A pivot table, a chart, and a saved view are all renderings of this
object. It MUST be fully serializable (it becomes a saved view row later).

```ts
interface AnalysisQuery {
  scope:
    | { mode: 'dateRange'; from: ISODate; to: ISODate }
    | { mode: 'macro'; macroId: string }
    | { mode: 'rolling'; windowDays: number; anchor?: ISODate };

  subjects: {
    athletes: string[];          // athlete ids
    groups: string[];            // group ids
    normalization: 'none' | 'perAthleteMean' | 'sinclair' | 'perBodyweight';
  };

  filters: Array<{ dimension: Dimension; op: 'in' | 'between' | 'eq'; values: unknown[] }>;

  rows: Dimension[];             // pivot row dimensions
  cols: Array<Dimension | 'state'>;  // pivot col dimensions (or planned/performed split)

  measures: Array<{
    metricId: string;            // resolved against the Metric Registry
    agg: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinct' | 'ratio';
    state: 'planned' | 'performed' | 'both' | 'delta' | 'adherence';
  }>;

  viz: {
    type: 'table' | 'line' | 'bar' | 'stackedBar' | 'groupedBar' | 'scatter' | 'heatmap' | 'radar';
    xAxis?: Dimension;
    series?: Dimension | 'state';
    yAxis?: string;              // metricId
    overlay?: { mode: 'periodOverPeriod' | 'none'; comparePeriod?: AnalysisQuery['scope'] };
  };
}

type Dimension =
  | 'athlete' | 'group' | 'exercise' | 'category'      // K1–K10
  | 'movement' | 'weekType' | 'intensityZone'
  | 'day' | 'week' | 'macro' | 'meso' | 'dayOfWeek'
  | 'relativeWeek'                                       // macro-aligned week index
  | `custom:${string}`;                                 // custom exercise metric / day-card input
```

---

## 3. Metric Registry (the "metrics in Settings" surface)

A single registry object is the source of truth for everything aggregatable. Settings renders it;
the query builder reads from it. Coaches can add **derived metrics** (composed of base metrics).

```ts
interface MetricDef {
  id: string;
  label: string;
  unit: string;                          // 'kg', 'reps', 'AU', '%', 'ratio'
  kind: 'base' | 'derived';
  appliesToState: ('planned' | 'performed')[];
  // base: how to extract from a fact row; derived: formula over other metric ids
  compute: BaseExtractor | DerivedFormula;
  defaultAgg: AnalysisQuery['measures'][number]['agg'];
}
```

Seed with: `volume` (tonnage = sets×reps×load), `nl` (number of lifts), `avgLoad`,
`avgPct1RM`, `maxLoad`, `sets`, `reps`, `stress` (sport-specific model, backlog #2).
Derived examples to seed as demonstrations: `snatchCleanRatio`, `pullPctOfTotal`.

Settings tab requirement: a read/edit view listing every metric, its formula, unit, and
planned/performed applicability, with add/edit/delete for derived metrics.

---

## 4. Feature set (phased — do NOT build all at once)

### Phase 0 — Engine (no UI, no schema change)
- Metric Registry + seed metrics.
- `AnalysisQuery` schema + validator.
- `runAnalysisQuery(config)` service: scope resolver (3 modes), owner-scoped fact fetch
  (planned + performed → long-format fact set), dimension grouping, measure aggregation,
  state handling (planned/performed/both/delta/adherence).
- Dev harness/test only. **Aggregation strategy: in-memory behind the service interface**
  (so a future SQL-view/RPC swap is invisible to the client). Flag if you disagree before coding.

### Phase 1 — Pivot table builder
- UI to compose rows / cols / measures / filters / scope.
- Planned/performed as a selectable col axis.
- Drill-down: expand a cell to underlying sessions/exercises.

### Phase 2 — Chart builder + presets
- Chart types per `viz.type`.
- Seed presets (each = a saved `AnalysisQuery`): planned vs performed, lift ratios,
  intensity-zone distribution, competition-lift trend, weekly stress curve.

### Phase 3 — Lifter & group comparison
- Multi-subject selection (athletes + groups).
- **Normalization modes**: none / per-athlete mean / Sinclair / per-bodyweight
  (group comparison is misleading without this — make it explicit in the UI).
- **Relative-time alignment**: align to macro week 1 (uses slot addressing).
- **Period-over-period overlay**: ghost series for previous macro/period.

### Phase 4 — Saved views + export
- Persist `AnalysisQuery` as a named saved view (owner-scoped). *(Requires one table — flag
  as a schema change needing sign-off; do NOT run unattended.)*
- Export: CSV/Excel (ties to backlog #11), PNG/SVG of charts, compact print layout (#14).

### Phase 5 — Monitoring + intelligence layer
- **ACWR** (7d acute ÷ 28d chronic), flag >1.5 / <0.8.
- **Monotony & strain** (Foster).
- **Category distribution: target (planned) vs actual (performed)** across K1–K10.
- **Adherence dashboard**: % sessions completed, % prescribed volume hit, missed sessions.
- **Anomaly flags**: rules engine (performed Δ planned > threshold → flag).
- **Annotation layer**: coach notes pinned to dates on charts.
- **Per-exercise deep dive** + est-1RM trendline (linear regression + projection).
- **PR / competition timeline overlay** (links to #4 calendar, `athlete_prs`).

---

## 5. Open decisions (resolve in REVIEW_PLAN before Phase 0)

1. Aggregation strategy: in-memory (recommended for v1) vs SQL views vs hybrid.
2. Does Phase 4 saved-views table get sign-off now, or stay in-memory/localStorage until later?
3. Default normalization for group comparison: `perAthleteMean` vs `sinclair`.
4. Which 5 presets ship in Phase 2.

---

## 6. Review workflow

The four specialist reviewer lenses (UX, Engineering, Domain/OWL, Data) each write to
`review/findings/analysis/<role>.md`; the synthesizer produces `REVIEW_PLAN_analysis_module.md`
matching the brief's Phase 0–5, with the four open decisions surfaced for human sign-off, every
architectural invariant checked against the real codebase, and any schema-touching step
explicitly flagged and gated.

**Hard constraints**: no DB schema/migration changes proposed without an explicit sign-off gate;
honour planned/performed separation, coach-configurability, slot addressing, DST safety,
owner_id scoping, and the API-first service boundary. Do not write implementation code until
`REVIEW_PLAN_analysis_module.md` is approved.
