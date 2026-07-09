// Data layer for the macro timeline (src/components/planning/MacroTimeline.tsx).
// Fetches macros / phases / macro_weeks for an athlete-or-group scope and
// turns them into per-week TimelineWeek records plus TimelineMarker entries
// for competitions and other events. Pure builders are separated from the
// Supabase fetchers so the strip stays testable and presentation-free.

import { supabase } from './supabase';
import { getOwnerId } from './ownerContext';
import { getMondayOfWeekISO } from './weekUtils';
import { addDaysToISO } from './dateUtils';
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
