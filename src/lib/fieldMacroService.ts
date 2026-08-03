/**
 * Coach-facing macro overview for the Fieldcoach surface.
 *
 * The athlete's macro view (`athleteMacroService`) is deliberately number-free —
 * rhythm only, "the loads stay with the coach". This is the other half: the
 * coach standing on the gym floor IS the numbers audience, so this adds the
 * tracked exercises and their per-week targets, and it accepts a **group**
 * scope, which the athlete service has no reason to.
 *
 * Read-only by construction: nothing here writes.
 *
 * NOTE on scoping: deliberately no `owner_id` filter on `macrocycles`. The
 * field athlete list includes SHARED athletes, whose macros are owned by the
 * host coach — an owner filter would silently blank the macro for exactly those
 * athletes. The athlete_id / group_id boundary is the correct one.
 */
import { supabase } from './supabase';
import { addDaysToISO } from './dateUtils';
import { findPhaseForWeek } from './macroPhases';
import { athleteMacroScopeFilter } from './plannerMacro';
import { fetchTimelineMarkers, resolveScopeAthleteIds, type TimelineMarker } from './macroTimelineData';
import type {
  Exercise,
  MacroCycle,
  MacroPhase,
  MacroTarget,
  MacroWeek,
  WeekTypeConfig,
} from './database.types';

export type FieldMacroScope =
  | { type: 'athlete'; id: string }
  | { type: 'group'; id: string };

export interface FieldMacroExercise {
  trackedExerciseId: string;
  exerciseId: string;
  name: string;
  code: string | null;
  color: string | null;
  category: string | null;
  referenceKg: number | null;
}

export interface FieldMacroTarget {
  max: number | null;
  repsAtMax: number | null;
  setsAtMax: number | null;
  avg: number | null;
  reps: number | null;
  note: string | null;
}

export interface FieldMacroWeek {
  id: string;
  weekNumber: number;
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  /** Sunday, YYYY-MM-DD. */
  weekEnd: string;
  weekType: string;
  weekTypeName: string | null;
  weekTypeColor: string | null;
  notes: string;
  totalRepsTarget: number | null;
  tonnageTarget: number | null;
  avgIntensityTarget: number | null;
  /** Resolved through the week-number range on `macro_phases` — `macro_weeks`
   *  has no `phase_id` (dropped in 0.28.0; reading it returned null always). */
  phase: MacroPhase | null;
  events: TimelineMarker[];
  /** trackedExerciseId → target. Absent key = nothing prescribed. */
  targets: Record<string, FieldMacroTarget>;
}

export interface FieldMacro {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isGroupMacro: boolean;
  phases: MacroPhase[];
  exercises: FieldMacroExercise[];
  weeks: FieldMacroWeek[];
}

const num = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** Every macro in scope, oldest first. Returns [] when there is none. */
export async function fetchFieldMacros(scope: FieldMacroScope): Promise<FieldMacro[]> {
  // 1. Macros in scope.
  let macroQuery = supabase.from('macrocycles').select('*').order('start_date');
  if (scope.type === 'athlete') {
    macroQuery = macroQuery.or(await athleteMacroScopeFilter(scope.id));
  } else {
    macroQuery = macroQuery.eq('group_id', scope.id);
  }
  const { data: macroRows, error: macroErr } = await macroQuery;
  if (macroErr) throw macroErr;

  const macros = (macroRows ?? []) as MacroCycle[];
  if (macros.length === 0) return [];
  const macroIds = macros.map(m => m.id);

  // 2. Structure + prescription, one round trip each.
  const [weeksRes, phasesRes, trackedRes] = await Promise.all([
    supabase.from('macro_weeks').select('*').in('macrocycle_id', macroIds).order('week_number'),
    supabase.from('macro_phases').select('*').in('macrocycle_id', macroIds).order('position'),
    supabase
      .from('macro_tracked_exercises')
      .select('*, exercise:exercises(*)')
      .in('macrocycle_id', macroIds)
      .order('position'),
  ]);
  if (weeksRes.error) throw weeksRes.error;
  if (phasesRes.error) throw phasesRes.error;
  if (trackedRes.error) throw trackedRes.error;

  const allWeeks = (weeksRes.data ?? []) as MacroWeek[];
  const allPhases = (phasesRes.data ?? []) as MacroPhase[];
  type TrackedRow = {
    id: string; macrocycle_id: string; exercise_id: string;
    reference_kg: number | string | null; exercise: Exercise;
  };
  const allTracked = (trackedRes.data ?? []) as unknown as TrackedRow[];

  const weekIds = allWeeks.map(w => w.id);
  const { data: targetRows } = weekIds.length > 0
    ? await supabase.from('macro_targets').select('*').in('macro_week_id', weekIds)
    : { data: [] as MacroTarget[] };
  const targets = (targetRows ?? []) as MacroTarget[];

  // 3. Week-type names/colours belong to the macro's OWNER, so resolve per
  //    owner — a coach can be looking at a shared athlete's macro.
  const ownerIds = [...new Set(macros.map(m => m.owner_id))];
  const { data: settingsRows } = await supabase
    .from('general_settings')
    .select('owner_id, week_types')
    .in('owner_id', ownerIds);
  const weekTypesByOwner = new Map<string, WeekTypeConfig[]>(
    ((settingsRows ?? []) as { owner_id: string; week_types: WeekTypeConfig[] | null }[])
      .map(r => [r.owner_id, r.week_types ?? []]),
  );

  // 4. Events over the whole span, bucketed per week below.
  let events: TimelineMarker[] = [];
  if (allWeeks.length > 0) {
    const athleteIds = await resolveScopeAthleteIds(
      scope.type === 'athlete' ? scope.id : null,
      scope.type === 'group' ? scope.id : null,
    );
    const minStart = allWeeks.reduce((a, w) => (w.week_start < a ? w.week_start : a), allWeeks[0].week_start);
    const maxEnd = addDaysToISO(
      allWeeks.reduce((a, w) => (w.week_start > a ? w.week_start : a), allWeeks[0].week_start), 6);
    events = await fetchTimelineMarkers(athleteIds, macroIds, minStart, maxEnd);
  }

  const targetsByWeek = new Map<string, MacroTarget[]>();
  for (const t of targets) {
    const list = targetsByWeek.get(t.macro_week_id) ?? [];
    list.push(t);
    targetsByWeek.set(t.macro_week_id, list);
  }

  return macros.map(macro => {
    const weekTypes = weekTypesByOwner.get(macro.owner_id) ?? [];
    const phases = allPhases.filter(p => p.macrocycle_id === macro.id);
    const exercises: FieldMacroExercise[] = allTracked
      .filter(te => te.macrocycle_id === macro.id)
      .map(te => ({
        trackedExerciseId: te.id,
        exerciseId: te.exercise_id,
        name: te.exercise?.name ?? '(unknown)',
        code: te.exercise?.exercise_code ?? null,
        color: te.exercise?.color ?? null,
        category: te.exercise?.category ?? null,
        referenceKg: num(te.reference_kg),
      }));

    const weeks = allWeeks
      .filter(w => w.macrocycle_id === macro.id)
      .map<FieldMacroWeek>(w => {
        const weekEnd = addDaysToISO(w.week_start, 6);
        const cfg = resolveWeekType(w.week_type, weekTypes);
        const byTracked: Record<string, FieldMacroTarget> = {};
        for (const t of targetsByWeek.get(w.id) ?? []) {
          // Skip an entirely empty row — it should not draw a line.
          if (t.target_max == null && t.target_avg == null && t.target_reps == null && !t.note?.trim()) continue;
          byTracked[t.tracked_exercise_id] = {
            max: num(t.target_max),
            repsAtMax: t.target_reps_at_max,
            setsAtMax: t.target_sets_at_max,
            avg: num(t.target_avg),
            reps: t.target_reps,
            note: t.note,
          };
        }
        return {
          id: w.id,
          weekNumber: w.week_number,
          weekStart: w.week_start,
          weekEnd,
          weekType: w.week_type ?? '',
          weekTypeName: cfg?.name ?? null,
          weekTypeColor: cfg?.color ?? null,
          notes: w.notes ?? '',
          totalRepsTarget: w.total_reps_target ?? null,
          tonnageTarget: num(w.tonnage_target),
          avgIntensityTarget: num(w.avg_intensity_target),
          phase: findPhaseForWeek(phases, macro.id, w.week_number),
          events: events.filter(e => e.date <= weekEnd && (e.endDate ?? e.date) >= w.week_start),
          targets: byTracked,
        };
      });

    return {
      id: macro.id,
      name: macro.name,
      startDate: macro.start_date,
      endDate: macro.end_date,
      isGroupMacro: !!macro.group_id,
      phases,
      exercises,
      weeks,
    };
  });
}

/** Match a stored week_type against the coach's configured types. Mirrors
 *  `getWeekTypeColor` — abbreviation first, then a case-insensitive name. */
function resolveWeekType(weekType: string | null, weekTypes: WeekTypeConfig[]): WeekTypeConfig | null {
  if (!weekType) return null;
  return weekTypes.find(
    t => t.abbreviation === weekType || t.name.toLowerCase() === weekType.toLowerCase(),
  ) ?? null;
}
