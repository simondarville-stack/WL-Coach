// Data layer for the macro timeline (src/components/planning/MacroTimeline.tsx).
// Fetches macros / phases / macro_weeks for an athlete-or-group scope and
// turns them into per-week TimelineWeek records plus TimelineMarker entries
// for competitions and other events. Pure builders are separated from the
// Supabase fetchers so the strip stays testable and presentation-free.

import { supabase } from './supabase';
import { getOwnerId } from './ownerContext';
import { getMondayOfWeekISO } from './weekUtils';
import { addDaysToISO } from './dateUtils';
import { expandForCounting } from './comboExpansion';
import type {
  MacroCycle,
  MacroPhase,
  MacroWeek,
  MacroCompetition,
  WeekTypeConfig,
  Event,
} from './database.types';

// ── Types ────────────────────────────────────────────────────────────────────

/** One week on the timeline. Weeks outside any macro have macroId = null. */
export interface TimelineWeek {
  /** Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  macroId: string | null;
  macroName: string | null;
  phaseName: string | null;
  /** Phase color as stored by the coach; null → neutral/gap rendering. */
  phaseColor: string | null;
  /** Macro-relative week number (W1…Wn); null for gap weeks. */
  weekNumber: number | null;
  /** Resolved week-type abbreviation ('' = none, '?' = unknown type). */
  typeAbbr: string;
  typeName: string;
  /** Week-type color from the coach's WeekTypeConfig; null when unset/unknown. */
  typeColor: string | null;
  /** True when week_type doesn't match any configured week type. */
  typeWarning: boolean;
  rawWeekType: string | null;
  /** Week-level K target (total reps) from the macro plan. */
  repsTarget: number | null;
  /** Week-level tonnage target (kg) from the macro plan. */
  tonnageTarget: number | null;
  /** Reps programmed in the weekly planner for this week (micro-level plan).
   *  Null when no week plan exists / nothing is programmed. */
  programmedReps: number | null;
  /** Tonnage (kg) programmed in the weekly planner; same semantics. */
  programmedTonnage: number | null;
  /** Coach note on the macro week ('' = none). */
  notes: string;
  /** True for dimmed context weeks outside the anchor macro (macro mode). */
  isContext: boolean;
}

/** A dated marker drawn above the bar: competitions get flags, events dots. */
export interface TimelineMarker {
  id: string;
  kind: 'competition' | 'event';
  /** True for a macro's primary competition — rendered strongest. */
  primary: boolean;
  date: string;
  endDate: string | null;
  title: string;
  color: string | null;
}

/** Raw plan rows for a scope; feed to the builders below. */
export interface TimelineSource {
  macros: MacroCycle[];
  phases: MacroPhase[];
  weeks: MacroWeek[];
  weekTypeConfigs: WeekTypeConfig[];
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

/**
 * Fetch all macros (plus their phases and macro_weeks) visible to the given
 * scope. For an athlete this is their individual macros plus macros of groups
 * they are an active member of; for a group, the group's macros. When both
 * are null but a cycleId is given, just that cycle is fetched (macro page
 * fallback).
 */
export async function fetchTimelineSource(
  athleteId: string | null,
  groupId: string | null,
  cycleId?: string
): Promise<Omit<TimelineSource, 'weekTypeConfigs'>> {
  const ownerId = getOwnerId();
  if (!ownerId) return { macros: [], phases: [], weeks: [] };

  let macrosQuery = supabase
    .from('macrocycles')
    .select('*')
    .eq('owner_id', ownerId);

  if (athleteId) {
    macrosQuery = macrosQuery.or(`athlete_id.eq.${athleteId},group_id.not.is.null`);
  } else if (groupId) {
    macrosQuery = macrosQuery.eq('group_id', groupId);
  } else if (cycleId) {
    macrosQuery = macrosQuery.eq('id', cycleId);
  } else {
    return { macros: [], phases: [], weeks: [] };
  }

  const { data: macrosRaw, error: macrosErr } = await macrosQuery;
  if (macrosErr) throw macrosErr;
  let macros = (macrosRaw as MacroCycle[]) ?? [];

  // Safety net: the anchor cycle must always be present, even when it falls
  // outside the athlete/group scope filter.
  if (cycleId && !macros.some(m => m.id === cycleId)) {
    const { data: anchor } = await supabase
      .from('macrocycles')
      .select('*')
      .eq('id', cycleId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (anchor) macros = [...macros, anchor as MacroCycle];
  }

  // For athletes, keep group macros only for groups the athlete is an
  // active member of.
  if (athleteId) {
    const groupMacros = macros.filter(m => m.group_id);
    if (groupMacros.length > 0) {
      const groupIds = [...new Set(groupMacros.map(m => m.group_id!))];
      const { data: memberships, error: memErr } = await supabase
        .from('group_members')
        .select('group_id')
        .in('group_id', groupIds)
        .eq('athlete_id', athleteId)
        .is('left_at', null);
      if (memErr) throw memErr;
      const memberOf = new Set((memberships || []).map((m: { group_id: string }) => m.group_id));
      macros = macros.filter(m => !m.group_id || memberOf.has(m.group_id));
    }
  }

  const macroIds = macros.map(m => m.id);
  if (macroIds.length === 0) return { macros, phases: [], weeks: [] };

  const [phasesRes, weeksRes] = await Promise.all([
    supabase
      .from('macro_phases')
      .select('*')
      .in('macrocycle_id', macroIds)
      .order('position'),
    supabase
      .from('macro_weeks')
      .select('*')
      .in('macrocycle_id', macroIds)
      .order('week_number'),
  ]);
  if (phasesRes.error) throw phasesRes.error;
  if (weeksRes.error) throw weeksRes.error;

  return {
    macros,
    phases: (phasesRes.data as MacroPhase[]) ?? [],
    weeks: (weeksRes.data as MacroWeek[]) ?? [],
  };
}

/**
 * Resolve athlete IDs for the scope: the athlete itself, or all active
 * members of the group. Used to find which events apply.
 */
export async function resolveScopeAthleteIds(
  athleteId: string | null,
  groupId: string | null
): Promise<string[]> {
  if (athleteId) return [athleteId];
  if (groupId) {
    const { data: members } = await supabase
      .from('group_members')
      .select('athlete_id')
      .eq('group_id', groupId)
      .is('left_at', null);
    return (members || []).map((m: { athlete_id: string }) => m.athlete_id);
  }
  return [];
}

/**
 * Fetch timeline markers overlapping [rangeStart, rangeEnd]:
 * - events attached to the scope's athletes (competitions become flags,
 *   everything else a dot),
 * - macro_competitions of the given macros, merged in by event_id so a
 *   competition registered in both places appears once and carries the
 *   is_primary flag.
 */
export async function fetchTimelineMarkers(
  athleteIds: string[],
  macroIds: string[],
  rangeStart: string,
  rangeEnd: string
): Promise<TimelineMarker[]> {
  const markers = new Map<string, TimelineMarker>();

  if (athleteIds.length > 0) {
    const { data: ea } = await supabase
      .from('event_athletes')
      .select('event_id')
      .in('athlete_id', athleteIds);
    const eventIds = [...new Set((ea || []).map((e: { event_id: string }) => e.event_id))];

    if (eventIds.length > 0) {
      const { data: events } = await supabase
        .from('events')
        .select('id, name, event_date, end_date, event_type, color')
        .in('id', eventIds)
        .order('event_date', { ascending: true });

      for (const ev of (events || []) as Pick<
        Event, 'id' | 'name' | 'event_date' | 'end_date' | 'event_type' | 'color'
      >[]) {
        const end = ev.end_date || ev.event_date;
        if (ev.event_date > rangeEnd || end < rangeStart) continue;
        markers.set(ev.id, {
          id: ev.id,
          kind: ev.event_type === 'competition' ? 'competition' : 'event',
          primary: false,
          date: ev.event_date,
          endDate: ev.end_date && ev.end_date !== ev.event_date ? ev.end_date : null,
          title: ev.name,
          color: ev.color,
        });
      }
    }
  }

  if (macroIds.length > 0) {
    const { data: comps } = await supabase
      .from('macro_competitions')
      .select('id, competition_name, competition_date, is_primary, event_id')
      .in('macrocycle_id', macroIds);

    for (const comp of (comps || []) as Pick<
      MacroCompetition, 'id' | 'competition_name' | 'competition_date' | 'is_primary' | 'event_id'
    >[]) {
      if (comp.competition_date > rangeEnd || comp.competition_date < rangeStart) continue;
      const linked = comp.event_id ? markers.get(comp.event_id) : undefined;
      if (linked) {
        linked.kind = 'competition';
        linked.primary = linked.primary || comp.is_primary;
      } else {
        markers.set(`mc-${comp.id}`, {
          id: `mc-${comp.id}`,
          kind: 'competition',
          primary: comp.is_primary,
          date: comp.competition_date,
          endDate: null,
          title: comp.competition_name,
          color: null,
        });
      }
    }
  }

  return [...markers.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Per-exercise / per-category programmed stats for one week. Load stats
 *  (max/avg, kg) only accumulate from absolute-kg prescriptions. */
export interface ProgrammedStats {
  reps: number;
  /** Highest programmed load (kg). Null when nothing kg-prescribed. */
  maxLoad: number | null;
  /** Rep-weighted average programmed load (kg). Null when nothing
   *  kg-prescribed. */
  avgLoad: number | null;
}

/**
 * Week-programmed volume — what the coach actually wrote into the weekly
 * planner — keyed by week_start. This is the micro-level plan the timeline
 * compares against the macro-level targets (performed-vs-planned is a
 * separate, later concern).
 */
export interface WeeklyProgrammed {
  /** Total programmed reps (combo-expanded, counts_towards_totals only). */
  reps: number;
  /** Programmed tonnage in kg (absolute_kg prescriptions only). */
  tonnage: number;
  /** Heaviest programmed load of the week (kg). */
  maxLoad: number | null;
  /** Rep-weighted average programmed load of the week (kg). */
  avgLoad: number | null;
  /** Programmed stats per exercise. Work on a child variation also credits
   *  every ancestor, so a tracked parent lift includes its variations. */
  byExercise: Map<string, ProgrammedStats>;
  /** Programmed stats per exercise category. */
  byCategory: Map<string, ProgrammedStats>;
}

/** PostgREST `.in()` filters go into the URL — chunk long UUID lists. */
const IN_CHUNK = 150;

async function chunked<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    out.push(...(await fetchChunk(ids.slice(i, i + IN_CHUNK))));
  }
  return out;
}

interface CatalogueExercise {
  id: string;
  parent_exercise_id: string | null;
  category: string;
  counts_towards_totals: boolean;
}

/** Fetch the given exercises plus every ancestor up the parent chain. */
async function fetchExercisesWithAncestors(
  ids: string[]
): Promise<Map<string, CatalogueExercise>> {
  const byId = new Map<string, CatalogueExercise>();
  let pending = [...new Set(ids)];
  // Bounded walk up the parent chain (hierarchies are shallow in practice).
  for (let depth = 0; depth < 6 && pending.length > 0; depth++) {
    const rows = await chunked(pending, async chunk => {
      const { data } = await supabase
        .from('exercises')
        .select('id, parent_exercise_id, category, counts_towards_totals')
        .in('id', chunk);
      return (data ?? []) as CatalogueExercise[];
    });
    rows.forEach(r => byId.set(r.id, r));
    pending = [...new Set(
      rows
        .map(r => r.parent_exercise_id)
        .filter((p): p is string => p != null && !byId.has(p))
    )];
  }
  return byId;
}

/**
 * Aggregate the programmed weekly volume from the weekly planner for the
 * scope over [rangeStart, rangeEnd] (week_start bounds, inclusive).
 *
 * Scope follows the planner's own rule: an athlete counts their individual
 * plans (is_group_plan = false); a group counts the group plan. Combos are
 * expanded into member contributions via expandForCounting (single source
 * of truth), non-counting exercises are excluded from totals, and tonnage
 * only accumulates from absolute-kg prescriptions.
 */
export async function fetchWeeklyProgrammed(
  athleteId: string | null,
  groupId: string | null,
  rangeStart: string,
  rangeEnd: string
): Promise<Map<string, WeeklyProgrammed>> {
  const result = new Map<string, WeeklyProgrammed>();
  if (!athleteId && !groupId) return result;

  let wpQuery = supabase
    .from('week_plans')
    .select('id, week_start')
    .gte('week_start', rangeStart)
    .lte('week_start', rangeEnd);
  if (athleteId) {
    wpQuery = wpQuery.eq('athlete_id', athleteId).eq('is_group_plan', false);
  } else {
    wpQuery = wpQuery.eq('group_id', groupId!).eq('is_group_plan', true);
  }
  const { data: weekPlans } = await wpQuery;
  if (!weekPlans || weekPlans.length === 0) return result;

  const weekStartByWpId = new Map(
    (weekPlans as { id: string; week_start: string }[]).map(wp => [wp.id, wp.week_start])
  );

  type PlannedRow = {
    id: string;
    weekplan_id: string;
    exercise_id: string;
    is_combo: boolean;
    prescription_raw: string | null;
    unit: string | null;
    summary_total_sets: number | null;
    summary_total_reps: number | null;
    summary_highest_load: number | null;
    summary_avg_load: number | null;
  };
  const planned = await chunked([...weekStartByWpId.keys()], async chunk => {
    const { data } = await supabase
      .from('planned_exercises')
      .select('id, weekplan_id, exercise_id, is_combo, prescription_raw, unit, summary_total_sets, summary_total_reps, summary_highest_load, summary_avg_load')
      .in('weekplan_id', chunk);
    return (data ?? []) as PlannedRow[];
  });
  if (planned.length === 0) return result;

  type MemberRow = { planned_exercise_id: string; exercise_id: string; position: number };
  const comboIds = planned.filter(p => p.is_combo).map(p => p.id);
  const memberRows = comboIds.length > 0
    ? await chunked(comboIds, async chunk => {
        const { data } = await supabase
          .from('planned_exercise_combo_members')
          .select('planned_exercise_id, exercise_id, position')
          .in('planned_exercise_id', chunk);
        return (data ?? []) as MemberRow[];
      })
    : [];
  const membersByPe = new Map<string, MemberRow[]>();
  memberRows.forEach(m => {
    const arr = membersByPe.get(m.planned_exercise_id) ?? [];
    arr.push(m);
    membersByPe.set(m.planned_exercise_id, arr);
  });

  const exerciseIds = [
    ...new Set([...planned.map(p => p.exercise_id), ...memberRows.map(m => m.exercise_id)]),
  ];
  const catalogue = await fetchExercisesWithAncestors(exerciseIds);
  const fallbackEx = (id: string): CatalogueExercise => ({
    id, parent_exercise_id: null, category: '', counts_towards_totals: true,
  });
  const exOf = (id: string): CatalogueExercise => catalogue.get(id) ?? fallbackEx(id);

  // weekStart → (exerciseId / category) → running stats.
  // weekAcc uses a single '*' key per week for the week-level load stats.
  const exerciseAcc = new Map<string, Map<string, AccStats>>();
  const categoryAcc = new Map<string, Map<string, AccStats>>();
  const weekAcc = new Map<string, Map<string, AccStats>>();

  for (const row of planned) {
    const weekStart = weekStartByWpId.get(row.weekplan_id);
    if (!weekStart) continue;

    const contributions = expandForCounting(
      {
        exercise_id: row.exercise_id,
        exercise: exOf(row.exercise_id),
        unit: row.unit,
        is_combo: row.is_combo,
        prescription_raw: row.prescription_raw,
        summary_total_sets: row.summary_total_sets,
        summary_total_reps: row.summary_total_reps,
        summary_highest_load: row.summary_highest_load,
        summary_avg_load: row.summary_avg_load,
      },
      membersByPe.get(row.id)?.map(m => ({
        exerciseId: m.exercise_id,
        exercise: exOf(m.exercise_id),
        position: m.position,
      }))
    );

    let week = result.get(weekStart);
    if (!week) {
      week = { reps: 0, tonnage: 0, maxLoad: null, avgLoad: null, byExercise: new Map(), byCategory: new Map() };
      result.set(weekStart, week);
    }

    for (const c of contributions) {
      if (c.exercise.counts_towards_totals === false) continue;
      const reps = c.summary_total_reps;
      if (reps <= 0) continue;

      const isKg = c.unit === 'absolute_kg';
      week.reps += reps;
      if (isKg && c.summary_avg_load != null) {
        week.tonnage += reps * c.summary_avg_load;
      }

      const credit = (acc: AccStats) => {
        acc.reps += reps;
        if (isKg && c.summary_highest_load != null) {
          acc.maxLoad = acc.maxLoad == null
            ? c.summary_highest_load
            : Math.max(acc.maxLoad, c.summary_highest_load);
        }
        if (isKg && c.summary_avg_load != null) {
          acc.loadRepsSum += c.summary_avg_load * reps;
          acc.loadReps += reps;
        }
      };

      credit(accFor(weekAcc, weekStart, '*'));

      // Credit the exercise and every ancestor so parent lifts include the
      // work done via their variations.
      let cursor: CatalogueExercise | undefined = exOf(c.exercise_id);
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        credit(accFor(exerciseAcc, weekStart, cursor.id));
        cursor = cursor.parent_exercise_id ? catalogue.get(cursor.parent_exercise_id) : undefined;
      }

      const category = exOf(c.exercise_id).category;
      if (category) {
        credit(accFor(categoryAcc, weekStart, category));
      }
    }
  }

  // Finalize: derive avg loads, round tonnage.
  for (const [weekStart, week] of result) {
    week.tonnage = Math.round(week.tonnage);
    week.byExercise = finalizeAcc(exerciseAcc.get(weekStart));
    week.byCategory = finalizeAcc(categoryAcc.get(weekStart));
    const weekStats = finalizeAcc(weekAcc.get(weekStart)).get('*');
    week.maxLoad = weekStats?.maxLoad ?? null;
    week.avgLoad = weekStats?.avgLoad ?? null;
  }
  return result;
}

interface AccStats {
  reps: number;
  maxLoad: number | null;
  loadRepsSum: number;
  loadReps: number;
}

function accFor(
  store: Map<string, Map<string, AccStats>>,
  weekStart: string,
  key: string
): AccStats {
  let weekMap = store.get(weekStart);
  if (!weekMap) {
    weekMap = new Map();
    store.set(weekStart, weekMap);
  }
  let acc = weekMap.get(key);
  if (!acc) {
    acc = { reps: 0, maxLoad: null, loadRepsSum: 0, loadReps: 0 };
    weekMap.set(key, acc);
  }
  return acc;
}

function finalizeAcc(weekMap: Map<string, AccStats> | undefined): Map<string, ProgrammedStats> {
  const out = new Map<string, ProgrammedStats>();
  if (!weekMap) return out;
  for (const [key, acc] of weekMap) {
    out.set(key, {
      reps: acc.reps,
      maxLoad: acc.maxLoad,
      avgLoad: acc.loadReps > 0 ? Math.round((acc.loadRepsSum / acc.loadReps) * 10) / 10 : null,
    });
  }
  return out;
}

// ── Pure builders ────────────────────────────────────────────────────────────

function findPhaseForWeek(
  phases: MacroPhase[],
  macroId: string,
  weekNumber: number
): MacroPhase | null {
  return (
    phases.find(
      p =>
        p.macrocycle_id === macroId &&
        weekNumber >= p.start_week_number &&
        weekNumber <= p.end_week_number
    ) ?? null
  );
}

function resolveWeekType(
  abbr: string | null | undefined,
  configs: WeekTypeConfig[]
): { abbr: string; name: string; color: string | null; warning: boolean } {
  if (!abbr) return { abbr: '', name: '', color: null, warning: false };
  const wt =
    configs.find(c => c.abbreviation === abbr) ??
    configs.find(c => c.name.toLowerCase() === abbr.toLowerCase());
  if (!wt) return { abbr: '?', name: abbr, color: null, warning: true };
  return { abbr: wt.abbreviation, name: wt.name, color: wt.color, warning: false };
}

/**
 * Build one TimelineWeek per given Monday. Multiple macros can cover the
 * same week (overlaps, athlete + group); the anchor macro wins, then macros
 * with phases, then individual over group macros.
 */
export function buildTimelineWeeks(
  weekStarts: string[],
  source: TimelineSource,
  anchorMacroId?: string | null
): TimelineWeek[] {
  const { macros, phases, weeks, weekTypeConfigs } = source;
  const macroById = new Map(macros.map(m => [m.id, m]));
  const macroIdsWithPhases = new Set(phases.map(p => p.macrocycle_id));

  const score = (macroId: string) =>
    (macroId === anchorMacroId ? 4 : 0) +
    (macroIdsWithPhases.has(macroId) ? 2 : 0) +
    (macroById.get(macroId)?.group_id ? 0 : 1);

  const weekRowByStart = new Map<string, MacroWeek>();
  for (const w of weeks) {
    if (!macroById.has(w.macrocycle_id)) continue;
    const existing = weekRowByStart.get(w.week_start);
    if (!existing || score(w.macrocycle_id) > score(existing.macrocycle_id)) {
      weekRowByStart.set(w.week_start, w);
    }
  }

  return weekStarts.map(ws => {
    const row = weekRowByStart.get(ws);
    const macro = row ? macroById.get(row.macrocycle_id) : undefined;

    if (!row || !macro) {
      return {
        weekStart: ws,
        macroId: null,
        macroName: null,
        phaseName: null,
        phaseColor: null,
        weekNumber: null,
        typeAbbr: '',
        typeName: '',
        typeColor: null,
        typeWarning: false,
        rawWeekType: null,
        repsTarget: null,
        tonnageTarget: null,
        programmedReps: null,
        programmedTonnage: null,
        notes: '',
        isContext: anchorMacroId != null,
      };
    }

    const phase = findPhaseForWeek(phases, macro.id, row.week_number);
    const type = resolveWeekType(row.week_type, weekTypeConfigs);
    const phaseColor = phase?.color && phase.color.trim() !== '' ? phase.color : null;

    return {
      weekStart: ws,
      macroId: macro.id,
      macroName: macro.name,
      phaseName: phase?.name ?? null,
      phaseColor,
      weekNumber: row.week_number,
      typeAbbr: type.abbr,
      typeName: type.name,
      typeColor: type.color,
      typeWarning: type.warning,
      rawWeekType: row.week_type ?? null,
      repsTarget: row.total_reps_target,
      tonnageTarget: row.tonnage_target,
      programmedReps: null,
      programmedTonnage: null,
      notes: row.notes ?? '',
      isContext: anchorMacroId != null && macro.id !== anchorMacroId,
    };
  });
}

/**
 * Mondays spanning a whole macro plus `contextWeeks` weeks on each side.
 * Returns [] when the macro has no weeks.
 */
export function macroRangeWeekStarts(
  macroId: string,
  weeks: MacroWeek[],
  contextWeeks: number
): string[] {
  const macroWeeks = weeks
    .filter(w => w.macrocycle_id === macroId)
    .sort((a, b) => a.week_number - b.week_number);
  if (macroWeeks.length === 0) return [];

  const first = macroWeeks[0].week_start;
  const last = macroWeeks[macroWeeks.length - 1].week_start;
  const result: string[] = [];
  let cursor = addDaysToISO(first, -contextWeeks * 7);
  const end = addDaysToISO(last, contextWeeks * 7);
  while (cursor <= end) {
    result.push(cursor);
    cursor = addDaysToISO(cursor, 7);
  }
  return result;
}

/** Mondays for a continuous window around a center Monday. */
export function continuousRangeWeekStarts(
  centerWeekStart: string,
  weeksBack: number,
  weeksForward: number
): string[] {
  const center = getMondayOfWeekISO(new Date(centerWeekStart + 'T00:00:00'));
  const result: string[] = [];
  for (let i = -weeksBack; i <= weeksForward; i++) {
    result.push(addDaysToISO(center, i * 7));
  }
  return result;
}
