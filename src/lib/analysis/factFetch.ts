// EMOS Analysis — fact-set construction.
//
// THE ONLY module in the analysis engine that touches Supabase (invariant #6).
// It builds a long-format `FactRow[]` from two never-conflated streams
// (invariant #1):
//   • Planned  — week_plans → planned_exercises → planned_set_lines (+ combo
//     members), SELECT-only; owner-scoped via week_plans.owner_id.
//   • Performed — training_log_sessions → training_log_exercises →
//     training_log_sets; owner-scoped via training_log_sessions.owner_id (the
//     reliable anchor — the child owner_id columns are unbackfilled in prod,
//     REVIEW_PLAN DA-01/02).
//
// Planned↔performed pairing carries the real FK (training_log_exercises
// .planned_exercise_id) so adherence/substitution work downstream (DA match-key).
// Loads are resolved kg / %1RM against the movement's reference max
// (pr_reference_exercise_id ?? the exercise itself); unresolved percentages are
// flagged, never mixed into kg sums (T-02). Week keys are snapped to the nearest
// Monday to tolerate the legacy DST corruption (invariant #4).
//
// The OWL-correct fact construction lives in the PURE `buildFacts` so it is
// unit-testable with fixtures; `fetchFacts` only does the queries.

import { supabase } from '../supabase';
import { getOwnerId } from '../ownerContext';
import { isoMonday, isoAddDays, snapToMonday } from '../dateUtils';
import { parsePrescription, parseComboPrescription } from '../prescriptionParser';
import { expandForCounting } from '../comboExpansion';
import { buildParentIndex, resolveRootId } from '../exerciseHierarchy';
import { resolveScopeWindow, type ResolvedScope } from './scopeResolver';
import type { AnalysisQuery, FactRow } from './types';

// ── raw row shapes (only the columns the engine reads) ──────────────────────

export interface RawExercise {
  id: string;
  name: string;
  category: string;
  color: string | null;
  lift_slot: string | null;
  is_competition_lift: boolean;
  counts_towards_totals: boolean;
  default_unit: string | null;
  pr_reference_exercise_id: string | null;
  parent_exercise_id: string | null;
}

export interface RawWeekPlan {
  id: string;
  week_start: string;
  athlete_id: string | null;
  owner_id: string;
  day_schedule: Record<number, { weekday: number; time: string | null }> | null;
}

export interface RawPlannedExercise {
  id: string;
  weekplan_id: string;
  day_index: number;
  exercise_id: string;
  unit: string | null;
  prescription_raw: string | null;
  summary_total_sets: number | null;
  summary_total_reps: number | null;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
  is_combo: boolean;
}

export interface RawSetLine {
  planned_exercise_id: string;
  sets: number;
  reps: number;
  load_value: number;
  load_max: number | null;
}

export interface RawComboMember {
  planned_exercise_id: string;
  exercise_id: string;
  position: number;
}

export interface RawSession {
  id: string;
  athlete_id: string;
  owner_id: string;
  date: string;
  week_start: string | null;
  day_index: number;
  status: string;
  bodyweight_kg: number | null;
}

/** Off-plan combo descriptor stored on training_log_exercises.metadata.combo.
 *  Members carry a name snapshot; the live exercise (for category/lift_slot/
 *  family) is looked up by exerciseId when it still exists. */
export interface RawLogComboMeta {
  combo?: {
    members?: { exerciseId: string; name: string; color?: string | null; position: number }[];
  } | null;
}

export interface RawLogExercise {
  id: string;
  session_id: string;
  exercise_id: string | null;
  planned_exercise_id: string | null;
  performed_raw: string;
  status: string;
  /** Present for athlete-authored off-plan combos (members live here, not in a
   *  join table). Optional so existing fixtures/rows without it still type. */
  metadata?: RawLogComboMeta | null;
}

export interface RawLogSet {
  log_exercise_id: string;
  performed_load: number | null;
  performed_reps: number | null;
  status: string;
  /** Combo/tuple reps ("2+1") round-trip here; per-member split for rollup. */
  performed_text?: string | null;
}

export interface MacroContext {
  relativeWeek: number | null;
  weekType: string | null;
  macroId: string | null;
  macroName: string | null;
  phaseId: string | null;
  phaseName: string | null;
}

const EMPTY_MACRO: MacroContext = {
  relativeWeek: null,
  weekType: null,
  macroId: null,
  macroName: null,
  phaseId: null,
  phaseName: null,
};

export interface BuildFactsInput {
  athleteIds: string[];
  hostOwnerByAthlete: Record<string, string>;
  athleteNameById: Record<string, string>;
  groupIdsByAthlete: Record<string, string[]>;
  exercisesById: Record<string, RawExercise>;
  /** athleteId → (exerciseId → best PR kg). */
  prBest: Record<string, Record<string, number>>;
  weekPlans: RawWeekPlan[];
  plannedExercises: RawPlannedExercise[];
  setLines: RawSetLine[];
  comboMembers: RawComboMember[];
  sessions: RawSession[];
  logExercises: RawLogExercise[];
  logSets: RawLogSet[];
  /** Resolve macro/relative-week context for a fact. */
  macroContext: (athleteId: string, weekStart: string) => MacroContext;
}

// ── load resolution ───────────────────────────────────────────────────────────

interface ResolvedLoad {
  loadIsKg: boolean;
  loadIsPct: boolean;
  kgLoad: number; // resolved kg used for tonnage (0 when unresolved)
  maxKg: number; // resolved kg ceiling
  pct1rm: number | null; // %1RM vs the reference max
  load: number; // representative load (kg when resolved, else raw value)
}

/**
 * Resolve a prescription load against the exercise's reference max.
 * `rawLoad`/`rawMax` are an interval; the midpoint is used. `unit`:
 *  • absolute_kg → kg; pct1rm derived if a ref max exists.
 *  • percentage  → resolved to kg via the ref max when available, else flagged
 *    unresolved (excluded from kg sums); pct1rm is the raw percentage.
 *  • rpe / free_text* / other → no kg, no pct.
 */
function resolveLoad(
  unit: string | null,
  rawLoad: number,
  rawMax: number | null,
  refMax: number,
): ResolvedLoad {
  const effective = rawMax != null ? (rawLoad + rawMax) / 2 : rawLoad;
  const ceiling = rawMax != null ? Math.max(rawLoad, rawMax) : rawLoad;
  if (unit === 'absolute_kg') {
    return {
      loadIsKg: effective > 0,
      loadIsPct: false,
      kgLoad: effective,
      maxKg: ceiling,
      pct1rm: refMax > 0 && effective > 0 ? (effective / refMax) * 100 : null,
      load: effective,
    };
  }
  if (unit === 'percentage') {
    if (refMax > 0 && effective > 0) {
      return {
        loadIsKg: true,
        loadIsPct: false,
        kgLoad: (effective / 100) * refMax,
        maxKg: (ceiling / 100) * refMax,
        pct1rm: effective,
        load: (effective / 100) * refMax,
      };
    }
    return {
      loadIsKg: false,
      loadIsPct: effective > 0,
      kgLoad: 0,
      maxKg: 0,
      pct1rm: effective > 0 ? effective : null,
      load: effective,
    };
  }
  // rpe / free_text / free_text_reps / other
  return { loadIsKg: false, loadIsPct: false, kgLoad: 0, maxKg: 0, pct1rm: null, load: 0 };
}

function refMaxFor(prBest: BuildFactsInput['prBest'], athleteId: string, ex: RawExercise): number {
  const byEx = prBest[athleteId];
  if (!byEx) return 0;
  const refId = ex.pr_reference_exercise_id ?? ex.id;
  return byEx[refId] ?? 0;
}

/** dayOfWeek (0=Mon..6=Sun) from a calendar date, UTC-consistent. */
function weekdayOf(dateStr: string): number {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  return (d.getUTCDay() + 6) % 7;
}

// ── pure fact construction ─────────────────────────────────────────────────────

/** Drop the transient `refMax` helper field so the object is a clean FactRow
 *  contribution (refMax is only used to derive pct1rm). */
function stripRefMax<T extends { refMax: number }>(ef: T): Omit<T, 'refMax'> {
  const rest = { ...ef };
  delete (rest as { refMax?: number }).refMax;
  return rest;
}

export function buildFacts(input: BuildFactsInput): FactRow[] {
  const facts: FactRow[] = [];

  // Parent-child rollup: resolve each contribution's exercise up to its family
  // root ONCE (memoised index). Combo expansion runs first (per member), then
  // family resolution per contribution — so a combo member that is itself a
  // child variation folds into its own family, never the combo lead's.
  const parentIndex = buildParentIndex(Object.values(input.exercisesById));
  const familyOf = (
    exId: string | null,
  ): { familyRootId: string | null; familyRootName: string } => {
    if (!exId) return { familyRootId: null, familyRootName: '(deleted exercise)' };
    const rootId = resolveRootId(exId, parentIndex);
    return { familyRootId: rootId, familyRootName: input.exercisesById[rootId]?.name ?? '(deleted exercise)' };
  };

  const setLinesByPe = new Map<string, RawSetLine[]>();
  for (const sl of input.setLines) {
    const arr = setLinesByPe.get(sl.planned_exercise_id) ?? [];
    arr.push(sl);
    setLinesByPe.set(sl.planned_exercise_id, arr);
  }
  const comboMembersByPe = new Map<string, RawComboMember[]>();
  for (const cm of input.comboMembers) {
    const arr = comboMembersByPe.get(cm.planned_exercise_id) ?? [];
    arr.push(cm);
    comboMembersByPe.set(cm.planned_exercise_id, arr);
  }

  const baseRow = (athleteId: string, weekStart: string): Omit<FactRow,
    | 'state' | 'exerciseId' | 'exerciseName' | 'familyRootId' | 'familyRootName'
    | 'category' | 'movement'
    | 'isCompetitionLift' | 'countsTowardsTotals' | 'unit' | 'date' | 'dayIndex'
    | 'dayOfWeek' | 'sets' | 'reps' | 'tonnage' | 'maxLoad' | 'load'
    | 'loadIsKg' | 'loadIsPct' | 'pct1rm' | 'pairKey'> => {
    const m = input.macroContext(athleteId, weekStart);
    return {
      ownerId: input.hostOwnerByAthlete[athleteId] ?? '',
      athleteId,
      athleteName: input.athleteNameById[athleteId] ?? athleteId,
      groupIds: input.groupIdsByAthlete[athleteId] ?? [],
      weekStart,
      weekType: m.weekType,
      macroId: m.macroId,
      macroName: m.macroName,
      phaseId: m.phaseId,
      phaseName: m.phaseName,
      relativeWeek: m.relativeWeek,
    };
  };

  // ── PLANNED stream ──
  const peByWeekPlan = new Map<string, RawPlannedExercise[]>();
  for (const pe of input.plannedExercises) {
    const arr = peByWeekPlan.get(pe.weekplan_id) ?? [];
    arr.push(pe);
    peByWeekPlan.set(pe.weekplan_id, arr);
  }

  for (const wp of input.weekPlans) {
    const athleteId = wp.athlete_id;
    if (!athleteId) continue;
    const weekStart = snapToMonday(wp.week_start);
    const pes = peByWeekPlan.get(wp.id) ?? [];
    for (const pe of pes) {
      const ex = input.exercisesById[pe.exercise_id];
      if (!ex) continue;
      const unit = pe.unit ?? ex.default_unit ?? null;
      const sched = wp.day_schedule?.[pe.day_index];
      const dayOfWeek = sched ? sched.weekday : null;
      const common = {
        ...baseRow(athleteId, weekStart),
        state: 'planned' as const,
        date: null,
        dayIndex: pe.day_index,
        dayOfWeek,
        pairKey: pe.id,
      };

      if (pe.is_combo) {
        // Combos expand to one contribution per member (positional rep split).
        const members = (comboMembersByPe.get(pe.id) ?? [])
          .map((m) => ({
            exerciseId: m.exercise_id,
            exercise: input.exercisesById[m.exercise_id],
            position: m.position,
          }))
          .filter((m) => m.exercise);
        const contributions = expandForCounting(
          {
            exercise_id: pe.exercise_id,
            exercise: ex,
            unit,
            is_combo: true,
            prescription_raw: pe.prescription_raw,
            summary_total_sets: pe.summary_total_sets,
            summary_total_reps: pe.summary_total_reps,
            summary_highest_load: pe.summary_highest_load,
            summary_avg_load: pe.summary_avg_load,
          },
          members,
        );
        for (const c of contributions) {
          const cex = input.exercisesById[c.exercise_id] ?? ex;
          const refMax = refMaxFor(input.prBest, athleteId, cex);
          const res = resolveLoad(unit, c.summary_avg_load ?? 0, c.summary_highest_load, refMax);
          const reps = c.summary_total_reps;
          facts.push({
            ...common,
            exerciseId: cex.id,
            exerciseName: cex.name,
            ...familyOf(cex.id),
            category: cex.category,
            movement: cex.lift_slot,
            isCompetitionLift: cex.is_competition_lift,
            countsTowardsTotals: cex.counts_towards_totals,
            unit,
            sets: c.summary_total_sets,
            reps,
            tonnage: res.kgLoad > 0 ? res.kgLoad * reps : 0,
            maxLoad: res.maxKg,
            load: res.load,
            loadIsKg: res.loadIsKg,
            loadIsPct: res.loadIsPct,
            pct1rm: res.pct1rm,
          });
        }
        continue;
      }

      const refMax = refMaxFor(input.prBest, athleteId, ex);
      const lines = setLinesByPe.get(pe.id) ?? [];
      const exFields = {
        exerciseId: ex.id,
        exerciseName: ex.name,
        ...familyOf(ex.id),
        category: ex.category,
        movement: ex.lift_slot,
        isCompetitionLift: ex.is_competition_lift,
        countsTowardsTotals: ex.counts_towards_totals,
        unit,
      };

      if (lines.length > 0) {
        // Exact: one fact per set-line → tonnage = Σ(load × reps).
        for (const sl of lines) {
          const res = resolveLoad(unit, sl.load_value, sl.load_max, refMax);
          const totalReps = sl.sets * sl.reps;
          facts.push({
            ...common,
            ...exFields,
            sets: sl.sets,
            reps: totalReps,
            tonnage: res.kgLoad > 0 ? res.kgLoad * totalReps : 0,
            maxLoad: res.maxKg,
            load: res.load,
            loadIsKg: res.loadIsKg,
            loadIsPct: res.loadIsPct,
            pct1rm: res.pct1rm,
          });
        }
      } else if (pe.prescription_raw) {
        // Fallback: parse the raw prescription (legacy rows without set lines).
        for (const pl of parsePrescription(pe.prescription_raw)) {
          const res = resolveLoad(unit, pl.load, pl.loadMax, refMax);
          const totalReps = pl.sets * pl.reps;
          facts.push({
            ...common,
            ...exFields,
            sets: pl.sets,
            reps: totalReps,
            tonnage: res.kgLoad > 0 ? res.kgLoad * totalReps : 0,
            maxLoad: res.maxKg,
            load: res.load,
            loadIsKg: res.loadIsKg,
            loadIsPct: res.loadIsPct,
            pct1rm: res.pct1rm,
          });
        }
      } else if ((pe.summary_total_reps ?? 0) > 0) {
        // Last resort: the cached summary.
        const res = resolveLoad(unit, pe.summary_avg_load ?? 0, pe.summary_highest_load, refMax);
        const reps = pe.summary_total_reps ?? 0;
        facts.push({
          ...common,
          ...exFields,
          sets: pe.summary_total_sets ?? 0,
          reps,
          tonnage: res.kgLoad > 0 ? res.kgLoad * reps : 0,
          maxLoad: res.maxKg,
          load: res.load,
          loadIsKg: res.loadIsKg,
          loadIsPct: res.loadIsPct,
          pct1rm: res.pct1rm,
        });
      }
    }
  }

  // ── PERFORMED stream ──
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  const setsByLogEx = new Map<string, RawLogSet[]>();
  for (const ls of input.logSets) {
    const arr = setsByLogEx.get(ls.log_exercise_id) ?? [];
    arr.push(ls);
    setsByLogEx.set(ls.log_exercise_id, arr);
  }

  for (const le of input.logExercises) {
    if (le.status === 'skipped') continue;
    const session = sessionById.get(le.session_id);
    if (!session) continue;
    const athleteId = session.athlete_id;
    const weekStart = snapToMonday(session.week_start ?? isoMonday(session.date));

    // Session-level fields shared by every contribution of this log exercise.
    const sessionCommon = {
      ...baseRow(athleteId, weekStart),
      state: 'performed' as const,
      date: session.date,
      dayIndex: session.day_index,
      dayOfWeek: weekdayOf(session.date),
      pairKey: le.planned_exercise_id,
      unit: 'absolute_kg' as string | null, // performed loads are always kg
      // Denormalise the session's weigh-in onto every contribution so the
      // `bodyweight` metric can average it per (athlete, week/date) cell.
      bodyweight: session.bodyweight_kg ?? null,
    };

    // Exercise-identity fields for a given exercise id (live catalogue lookup),
    // falling back to a name snapshot for a deleted/renamed off-plan member.
    const exFieldsFor = (exId: string | null, snapshotName?: string) => {
      const e = exId ? input.exercisesById[exId] : undefined;
      const fam = e ? familyOf(e.id) : { familyRootId: null, familyRootName: snapshotName ?? '(deleted exercise)' };
      return {
        exerciseId: e?.id ?? exId ?? null,
        exerciseName: e?.name ?? snapshotName ?? '(deleted exercise)',
        familyRootId: fam.familyRootId,
        familyRootName: fam.familyRootName,
        category: e?.category ?? '(uncategorised)',
        movement: e?.lift_slot ?? null,
        isCompetitionLift: e?.is_competition_lift ?? false,
        countsTowardsTotals: e?.counts_towards_totals ?? true,
        refMax: e ? refMaxFor(input.prBest, athleteId, e) : 0,
      };
    };

    const completedSets = (setsByLogEx.get(le.id) ?? []).filter((s) => s.status === 'completed');

    // ── Off-plan combo: one log row whose members live in metadata.combo. Each
    // completed set's tuple reps ("2+1") split positionally across members, so
    // each member's work rolls up to its OWN exercise/category/family — mirrors
    // the planned combo expansion (comboExpansion.ts), "a set is a set". ──
    const members = le.metadata?.combo?.members;
    if (members && members.length >= 2) {
      const ordered = members.slice().sort((a, b) => a.position - b.position);
      for (const s of completedSets) {
        const load = s.performed_load ?? 0;
        const raw = (s.performed_text ?? '').trim();
        // Strip an optional round multiplier "m(a+b)" and scale each member's
        // reps by m (m rounds of the tuple) — Option A: the round still counts
        // as one logged set, only the per-member reps grow.
        const group = raw.match(/^(\d+)\((.+)\)$/);
        const mult = group ? (parseInt(group[1], 10) || 1) : 1;
        const body = group ? group[2] : raw;
        const parts = body.includes('+') ? body.split('+').map((p) => (parseInt(p, 10) || 0) * mult) : null;

        if (!parts) {
          // No per-member tuple (numeric-only entry) — attribute the round to
          // the lead member, as before, rather than fabricating a split.
          const reps = s.performed_reps ?? 0;
          if (reps <= 0) continue;
          const ef = exFieldsFor(ordered[0].exerciseId, ordered[0].name);
          facts.push({
            ...sessionCommon, ...stripRefMax(ef),
            sets: 1, reps,
            tonnage: load > 0 ? load * reps : 0, maxLoad: load, load,
            loadIsKg: load > 0, loadIsPct: false,
            pct1rm: ef.refMax > 0 && load > 0 ? (load / ef.refMax) * 100 : null,
          });
          continue;
        }

        const active = ordered
          .map((m, i) => ({ m, reps: parts[i] ?? 0, ef: exFieldsFor(m.exerciseId, m.name) }))
          .filter((x) => x.reps > 0);
        if (active.length === 0) continue;
        // "A set is a set": the round counts once, on the first counting member.
        const holder = active.find((x) => x.ef.countsTowardsTotals !== false) ?? active[0];
        for (const x of active) {
          facts.push({
            ...sessionCommon, ...stripRefMax(x.ef),
            sets: x === holder ? 1 : 0,
            reps: x.reps,
            tonnage: load > 0 ? load * x.reps : 0, maxLoad: load, load,
            loadIsKg: load > 0, loadIsPct: false,
            pct1rm: x.ef.refMax > 0 && load > 0 ? (load / x.ef.refMax) * 100 : null,
          });
        }
      }
      continue;
    }

    // ── Normal (non-combo) exercise ──
    const ef = exFieldsFor(le.exercise_id, undefined);
    const usableSets = completedSets.filter((s) => (s.performed_reps ?? 0) > 0);
    if (usableSets.length > 0) {
      for (const s of usableSets) {
        const load = s.performed_load ?? 0;
        const reps = s.performed_reps ?? 0;
        facts.push({
          ...sessionCommon, ...stripRefMax(ef),
          sets: 1, reps,
          tonnage: load > 0 ? load * reps : 0, maxLoad: load, load,
          loadIsKg: load > 0, loadIsPct: false,
          pct1rm: ef.refMax > 0 && load > 0 ? (load / ef.refMax) * 100 : null,
        });
      }
    } else if (le.performed_raw) {
      // v1 fallback: parse the performed summary string.
      const parsed = parsePerformedRaw(le.performed_raw);
      if (parsed.reps > 0) {
        facts.push({
          ...sessionCommon, ...stripRefMax(ef),
          sets: parsed.sets, reps: parsed.reps,
          tonnage: parsed.load > 0 ? parsed.load * parsed.reps : 0,
          maxLoad: parsed.load, load: parsed.load,
          loadIsKg: parsed.load > 0, loadIsPct: false,
          pct1rm: ef.refMax > 0 && parsed.load > 0 ? (parsed.load / ef.refMax) * 100 : null,
        });
      }
    }
  }

  return facts;
}

/** Parse a legacy performed_raw summary into totals (kg). */
function parsePerformedRaw(raw: string): { reps: number; sets: number; load: number } {
  if (!raw) return { reps: 0, sets: 0, load: 0 };
  const lines = parsePrescription(raw);
  if (lines.length > 0) {
    return {
      reps: lines.reduce((s, l) => s + l.reps * l.sets, 0),
      sets: lines.reduce((s, l) => s + l.sets, 0),
      load: Math.max(...lines.map((l) => l.load)),
    };
  }
  const combo = parseComboPrescription(raw);
  if (combo.length > 0) {
    return {
      // Round multiplier scales reps, not the set count (Option A).
      reps: combo.reduce((s, l) => s + l.totalReps * l.sets * (l.multiplier ?? 1), 0),
      sets: combo.reduce((s, l) => s + l.sets, 0),
      load: Math.max(...combo.map((l) => l.load)),
    };
  }
  return { reps: 0, sets: 0, load: 0 };
}

// ── async fetch (Supabase) ─────────────────────────────────────────────────────

type MacroRowLite = {
  id: string;
  start_date: string;
  end_date: string;
  athlete_id: string | null;
  group_id: string | null;
};

export interface FetchFactsResult {
  facts: FactRow[];
  window: ResolvedScope;
  athleteLabels: Record<string, string>;
  groupLabels: Record<string, string>;
  athleteBodyweight: Record<string, number>;
  intensityZones: Array<{ zone: string; min: number; max: number }> | undefined;
  dimensionColors: Record<string, Record<string, string>>;
}

export async function fetchFacts(query: AnalysisQuery, now?: string): Promise<FetchFactsResult> {
  // 1. Resolve subject athletes (explicit + via groups).
  const groupIds = query.subjects.groups;
  let athleteIds = [...query.subjects.athletes];
  if (groupIds.length > 0) {
    const { data: gm } = await supabase
      .from('group_members')
      .select('athlete_id, group_id, left_at')
      .in('group_id', groupIds)
      .is('left_at', null);
    for (const r of (gm ?? []) as Array<{ athlete_id: string }>) athleteIds.push(r.athlete_id);
  }
  athleteIds = [...new Set(athleteIds)];

  // 2. Resolve macro window first (factFetch supplies the macrocycle to the
  //    pure scope resolver, keeping that resolver DB-free).
  let macroRow: MacroRowLite | null = null;
  if (query.scope.mode === 'macro') {
    const { data } = await supabase
      .from('macrocycles')
      .select('id, start_date, end_date, athlete_id, group_id, owner_id')
      .eq('id', query.scope.macroId)
      .maybeSingle();
    macroRow = (data as MacroRowLite | null) ?? null;
    // If no subjects were chosen, default to the macro's own athlete/group.
    if (athleteIds.length === 0 && macroRow) {
      if (macroRow.athlete_id) athleteIds = [macroRow.athlete_id];
      else if (macroRow.group_id) {
        const { data: gm } = await supabase
          .from('group_members')
          .select('athlete_id, left_at')
          .eq('group_id', macroRow.group_id)
          .is('left_at', null);
        athleteIds = [...new Set((gm ?? []).map((r: { athlete_id: string }) => r.athlete_id))];
      }
    }
  }
  const window = resolveScopeWindow(query.scope, { now, macro: macroRow });

  const empty: FetchFactsResult = {
    facts: [],
    window,
    athleteLabels: {},
    groupLabels: {},
    athleteBodyweight: {},
    intensityZones: undefined,
    dimensionColors: {},
  };
  if (athleteIds.length === 0) return empty;

  // 3. Athletes + host owners + labels.
  const { data: athleteRows } = await supabase
    .from('athletes')
    .select('id, name, owner_id, bodyweight')
    .in('id', athleteIds);
  const athletes = (athleteRows ?? []) as Array<{ id: string; name: string; owner_id: string; bodyweight: number | null }>;
  const hostOwnerByAthlete: Record<string, string> = {};
  const athleteNameById: Record<string, string> = {};
  const athleteBodyweight: Record<string, number> = {}; // keyed by (unique) display label
  // Disambiguate identical names so two athletes never merge into one dimension
  // value, and bodyweight keyed by label stays 1:1 (same-name collision fix).
  const nameCounts: Record<string, number> = {};
  for (const a of athletes) nameCounts[a.name] = (nameCounts[a.name] ?? 0) + 1;
  const dupSeen: Record<string, number> = {};
  for (const a of athletes) {
    hostOwnerByAthlete[a.id] = a.owner_id;
    let label = a.name;
    if (nameCounts[a.name] > 1) {
      dupSeen[a.name] = (dupSeen[a.name] ?? 0) + 1;
      label = `${a.name} (${dupSeen[a.name]})`;
    }
    athleteNameById[a.id] = label;
    if (a.bodyweight) athleteBodyweight[label] = a.bodyweight;
  }
  const fallbackOwner = getOwnerId();
  for (const id of athleteIds) if (!hostOwnerByAthlete[id]) hostOwnerByAthlete[id] = fallbackOwner;
  const hostOwners = [...new Set(Object.values(hostOwnerByAthlete))];

  // 4. Group memberships (for the `group` dimension) + labels.
  const groupIdsByAthlete: Record<string, string[]> = {};
  const { data: allMemberships } = await supabase
    .from('group_members')
    .select('athlete_id, group_id, left_at')
    .in('athlete_id', athleteIds)
    .is('left_at', null);
  const memberGroupIds = new Set<string>();
  for (const r of (allMemberships ?? []) as Array<{ athlete_id: string; group_id: string }>) {
    (groupIdsByAthlete[r.athlete_id] ??= []).push(r.group_id);
    memberGroupIds.add(r.group_id);
  }
  const groupLabels: Record<string, string> = {};
  if (memberGroupIds.size > 0) {
    const { data: groups } = await supabase
      .from('training_groups')
      .select('id, name')
      .in('id', [...memberGroupIds]);
    for (const g of (groups ?? []) as Array<{ id: string; name: string }>) groupLabels[g.id] = g.name;
  }

  // 5. Exercises (host-owned) + PR bests.
  const { data: exRows } = await supabase
    .from('exercises')
    .select('id, name, category, color, lift_slot, is_competition_lift, counts_towards_totals, default_unit, pr_reference_exercise_id, parent_exercise_id')
    .in('owner_id', hostOwners);
  const exercisesById: Record<string, RawExercise> = {};
  const exerciseColors: Record<string, string> = {}; // name → colour (for chart series)
  for (const e of (exRows ?? []) as RawExercise[]) {
    exercisesById[e.id] = e;
    if (e.color) exerciseColors[e.name] = e.color;
  }

  // Category colours (per-coach `categories` table).
  const categoryColors: Record<string, string> = {};
  const { data: catRows } = await supabase
    .from('categories')
    .select('name, color')
    .in('owner_id', hostOwners);
  for (const c of (catRows ?? []) as Array<{ name: string; color: string | null }>) {
    if (c.color) categoryColors[c.name] = c.color;
  }

  const { data: prRows } = await supabase
    .from('athlete_prs')
    .select('athlete_id, exercise_id, pr_value_kg')
    .in('athlete_id', athleteIds);
  const prBest: Record<string, Record<string, number>> = {};
  for (const p of (prRows ?? []) as Array<{ athlete_id: string; exercise_id: string; pr_value_kg: number | null }>) {
    if (!p.pr_value_kg) continue;
    const byEx = (prBest[p.athlete_id] ??= {});
    byEx[p.exercise_id] = Math.max(byEx[p.exercise_id] ?? 0, p.pr_value_kg);
  }

  // 6. Macro context (cycles + weeks + phases) for relativeWeek/weekType/macro/meso.
  const athleteGroupIds = [...memberGroupIds];
  const macroFilter = athleteGroupIds.length
    ? `athlete_id.in.(${athleteIds.join(',')}),group_id.in.(${athleteGroupIds.join(',')})`
    : `athlete_id.in.(${athleteIds.join(',')})`;
  const { data: cycleRows } = await supabase
    .from('macrocycles')
    .select('id, name, athlete_id, group_id, owner_id')
    .in('owner_id', hostOwners)
    .or(macroFilter);
  const cycles = (cycleRows ?? []) as Array<{ id: string; name: string; athlete_id: string | null; group_id: string | null }>;
  const cycleIds = cycles.map((c) => c.id);
  const cycleById = new Map(cycles.map((c) => [c.id, c]));

  const macroWeekByCycleStart = new Map<string, { week_number: number; week_type: string; week_type_text: string; phase_id: string | null }>();
  const phaseById = new Map<string, { name: string }>();
  const phaseColors: Record<string, string> = {}; // phase name → colour
  if (cycleIds.length > 0) {
    const [{ data: mwRows }, { data: phaseRows }] = await Promise.all([
      supabase
        .from('macro_weeks')
        .select('macrocycle_id, week_start, week_number, week_type, week_type_text, phase_id')
        .in('macrocycle_id', cycleIds),
      supabase.from('macro_phases').select('id, name, color').in('macrocycle_id', cycleIds),
    ]);
    for (const mw of (mwRows ?? []) as Array<{ macrocycle_id: string; week_start: string; week_number: number; week_type: string; week_type_text: string; phase_id: string | null }>) {
      macroWeekByCycleStart.set(`${mw.macrocycle_id}:${snapToMonday(mw.week_start)}`, mw);
    }
    for (const p of (phaseRows ?? []) as Array<{ id: string; name: string; color: string | null }>) {
      phaseById.set(p.id, p);
      if (p.color && p.name) phaseColors[p.name] = p.color;
    }
  }

  // Per-athlete cycles: individual macro + any group macro for the athlete's groups.
  const cyclesByAthlete: Record<string, typeof cycles> = {};
  for (const id of athleteIds) {
    const groups = new Set(groupIdsByAthlete[id] ?? []);
    cyclesByAthlete[id] = cycles.filter(
      (c) => c.athlete_id === id || (c.group_id != null && groups.has(c.group_id)),
    );
  }
  const macroContext = (athleteId: string, weekStart: string): MacroContext => {
    for (const c of cyclesByAthlete[athleteId] ?? []) {
      const mw = macroWeekByCycleStart.get(`${c.id}:${weekStart}`);
      if (mw) {
        return {
          relativeWeek: mw.week_number,
          weekType: mw.week_type_text || mw.week_type || null,
          macroId: c.id,
          macroName: cycleById.get(c.id)?.name ?? null,
          phaseId: mw.phase_id,
          phaseName: mw.phase_id ? phaseById.get(mw.phase_id)?.name ?? null : null,
        };
      }
    }
    return EMPTY_MACRO;
  };

  // 7. Planned stream rows.
  const { data: wpRows } = await supabase
    .from('week_plans')
    .select('id, week_start, athlete_id, owner_id, day_schedule')
    .in('owner_id', hostOwners)
    .in('athlete_id', athleteIds)
    // Widen by 3 days each side: a week_start stored off-by-a-few-days (legacy
    // DST corruption) snaps back into range, and the snap radius is covered.
    .gte('week_start', isoAddDays(isoMonday(window.from), -3))
    .lte('week_start', isoAddDays(window.to, 3));
  const weekPlans = (wpRows ?? []) as RawWeekPlan[];
  const weekPlanIds = weekPlans.map((w) => w.id);

  let plannedExercises: RawPlannedExercise[] = [];
  let setLines: RawSetLine[] = [];
  let comboMembers: RawComboMember[] = [];
  if (weekPlanIds.length > 0) {
    const { data: peRows } = await supabase
      .from('planned_exercises')
      .select('id, weekplan_id, day_index, exercise_id, unit, prescription_raw, summary_total_sets, summary_total_reps, summary_highest_load, summary_avg_load, is_combo')
      .in('weekplan_id', weekPlanIds);
    plannedExercises = (peRows ?? []) as RawPlannedExercise[];
    const peIds = plannedExercises.map((p) => p.id);
    if (peIds.length > 0) {
      const [{ data: slRows }, { data: cmRows }] = await Promise.all([
        supabase
          .from('planned_set_lines')
          .select('planned_exercise_id, sets, reps, load_value, load_max')
          .in('planned_exercise_id', peIds),
        supabase
          .from('planned_exercise_combo_members')
          .select('planned_exercise_id, exercise_id, position')
          .in('planned_exercise_id', peIds),
      ]);
      setLines = (slRows ?? []) as RawSetLine[];
      comboMembers = (cmRows ?? []) as RawComboMember[];
    }
  }

  // 8. Performed stream rows.
  const { data: sessionRows } = await supabase
    .from('training_log_sessions')
    .select('id, athlete_id, owner_id, date, week_start, day_index, status, bodyweight_kg')
    .in('athlete_id', athleteIds)
    .neq('status', 'planned')
    .gte('date', window.from)
    .lte('date', window.to);
  const sessions = (sessionRows ?? []) as RawSession[];
  const sessionIds = sessions.map((s) => s.id);

  let logExercises: RawLogExercise[] = [];
  let logSets: RawLogSet[] = [];
  if (sessionIds.length > 0) {
    const { data: leRows } = await supabase
      .from('training_log_exercises')
      .select('id, session_id, exercise_id, planned_exercise_id, performed_raw, status, metadata')
      .in('session_id', sessionIds);
    logExercises = (leRows ?? []) as RawLogExercise[];
    const leIds = logExercises.map((l) => l.id);
    if (leIds.length > 0) {
      const { data: lsRows } = await supabase
        .from('training_log_sets')
        .select('log_exercise_id, performed_load, performed_reps, status, performed_text')
        .in('log_exercise_id', leIds);
      logSets = (lsRows ?? []) as RawLogSet[];
    }
  }

  // 9. Intensity-zone config + week-type colours (host owner's general_settings).
  const { data: gsRows } = await supabase
    .from('general_settings')
    .select('owner_id, intensity_zones, week_types')
    .in('owner_id', hostOwners);
  const gs = (gsRows ?? []) as Array<{
    owner_id: string;
    intensity_zones: Array<{ zone: string; min: number; max: number }> | null;
    week_types: Array<{ name: string; abbreviation: string; color: string }> | null;
  }>;
  const intensityZones = gs.find((g) => g.intensity_zones)?.intensity_zones ?? undefined;
  const weekTypeColors: Record<string, string> = {};
  for (const wt of gs.find((g) => g.week_types)?.week_types ?? []) {
    if (wt.color) {
      // macroContext exposes weekType as week_type_text||abbreviation, so key both.
      if (wt.name) weekTypeColors[wt.name] = wt.color;
      if (wt.abbreviation) weekTypeColors[wt.abbreviation] = wt.color;
    }
  }

  // Coach-assigned colours per dimension value (data-driven; CLAUDE.md sanctioned).
  const dimensionColors: Record<string, Record<string, string>> = {
    exercise: exerciseColors,
    // Family labels are the root exercise's name, so the root's colour applies.
    family: exerciseColors,
    category: categoryColors,
    meso: phaseColors,
    weekType: weekTypeColors,
  };

  const facts = buildFacts({
    athleteIds,
    hostOwnerByAthlete,
    athleteNameById,
    groupIdsByAthlete,
    exercisesById,
    prBest,
    weekPlans,
    plannedExercises,
    setLines,
    comboMembers,
    sessions,
    logExercises,
    logSets,
    macroContext,
  });

  return { facts, window, athleteLabels: athleteNameById, groupLabels, athleteBodyweight, intensityZones, dimensionColors };
}
