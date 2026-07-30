/**
 * Athlete-facing macro overview.
 *
 * The coach's macro is a numbers surface — per-exercise max/avg targets, Σreps,
 * tonnage. The athlete gets the *rhythm* only: which training weeks exist, when
 * they run, what type each week is, the phase it belongs to, the coach's week
 * note and the events in range. That is what an athlete needs to plan life
 * around the training; the loads stay with the coach.
 *
 * Scoped by athlete id (own macros + macros of groups they are an active member
 * of), never by owner context — the athlete app has no active coach.
 *
 * Read-only by construction: planned data is coach-authored (see CLAUDE.md,
 * "Data integrity"). Nothing here writes.
 */
import { supabase } from './supabase';
import { addDaysToISO } from './dateUtils';
import { findPhaseForWeek } from './macroPhases';
import type { MacroCycle, MacroPhase, MacroWeek, WeekTypeConfig } from './database.types';

/** One week as the athlete sees it — no targets, no loads. */
export interface AthleteMacroWeek {
  id: string;
  weekNumber: number;
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  /** Sunday, YYYY-MM-DD. */
  weekEnd: string;
  /** Raw week_type value; '' when the coach hasn't typed the week. */
  weekType: string;
  /** Resolved from the coach's week-type settings; null when unknown. */
  weekTypeName: string | null;
  weekTypeColor: string | null;
  notes: string;
  /** Phase covering this week number, or null when it falls in a free week.
   *  Resolved through `lib/macroPhases` — phases claim a week-number range. */
  phase: MacroPhase | null;
  events: AthleteMacroEvent[];
}

export interface AthleteMacroEvent {
  id: string;
  name: string;
  eventType: string;
  date: string;
  endDate: string | null;
  color: string | null;
  /** True for the macro's target competition. */
  primary: boolean;
}

export interface AthleteMacro {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** True when this macro comes from a training group rather than the athlete. */
  isGroupMacro: boolean;
  phases: MacroPhase[];
  weeks: AthleteMacroWeek[];
}

/**
 * Every macro visible to this athlete, oldest first, with its weeks, phases and
 * the events overlapping them. Returns [] when the athlete has no macro.
 */
export async function fetchAthleteMacros(athleteId: string): Promise<AthleteMacro[]> {
  // 1. Scope: the athlete's own macros + macros of groups they still belong to.
  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('athlete_id', athleteId)
    .is('left_at', null);
  const groupIds = [...new Set(((memberships ?? []) as { group_id: string }[]).map(m => m.group_id))];

  const orFilter = groupIds.length > 0
    ? `athlete_id.eq.${athleteId},group_id.in.(${groupIds.join(',')})`
    : `athlete_id.eq.${athleteId}`;

  const { data: macroRows, error: macroErr } = await supabase
    .from('macrocycles')
    .select('*')
    .or(orFilter)
    .order('start_date');
  if (macroErr) throw macroErr;

  const macros = (macroRows ?? []) as MacroCycle[];
  if (macros.length === 0) return [];
  const macroIds = macros.map(m => m.id);

  // 2. Structure: weeks + phases for all of them in one round trip each.
  const [weeksRes, phasesRes] = await Promise.all([
    supabase.from('macro_weeks').select('*').in('macrocycle_id', macroIds).order('week_number'),
    supabase.from('macro_phases').select('*').in('macrocycle_id', macroIds).order('position'),
  ]);
  if (weeksRes.error) throw weeksRes.error;
  if (phasesRes.error) throw phasesRes.error;
  const allWeeks = (weeksRes.data ?? []) as MacroWeek[];
  const allPhases = (phasesRes.data ?? []) as MacroPhase[];

  // 3. Week-type names/colours are the coach's settings, so resolve per owner —
  //    an athlete can legitimately see two coaches' macros (own + group).
  const ownerIds = [...new Set(macros.map(m => m.owner_id))];
  const { data: settingsRows } = await supabase
    .from('general_settings')
    .select('owner_id, week_types')
    .in('owner_id', ownerIds);
  const weekTypesByOwner = new Map<string, WeekTypeConfig[]>(
    ((settingsRows ?? []) as { owner_id: string; week_types: WeekTypeConfig[] | null }[])
      .map(r => [r.owner_id, r.week_types ?? []]),
  );

  // 4. Events attached to this athlete. Bucketed into weeks below.
  const events = await fetchAthleteEvents(athleteId);
  const primaryEventIds = new Set(macros.map(m => m.primary_event_id).filter((id): id is string => !!id));

  return macros.map(macro => {
    const weekTypes = weekTypesByOwner.get(macro.owner_id) ?? [];
    const phases = allPhases.filter(p => p.macrocycle_id === macro.id);
    const weeks = allWeeks
      .filter(w => w.macrocycle_id === macro.id)
      .map<AthleteMacroWeek>(w => {
        const weekEnd = addDaysToISO(w.week_start, 6);
        const cfg = resolveWeekType(w.week_type, weekTypes);
        return {
          id: w.id,
          weekNumber: w.week_number,
          weekStart: w.week_start,
          weekEnd,
          weekType: w.week_type ?? '',
          weekTypeName: cfg?.name ?? null,
          weekTypeColor: cfg?.color ?? null,
          notes: w.notes ?? '',
          phase: findPhaseForWeek(phases, macro.id, w.week_number),
          // An event overlaps the week when its span intersects Mon–Sun.
          events: events
            .filter(e => e.date <= weekEnd && (e.endDate ?? e.date) >= w.week_start)
            .map(e => ({ ...e, primary: primaryEventIds.has(e.id) })),
        };
      });

    return {
      id: macro.id,
      name: macro.name,
      startDate: macro.start_date,
      endDate: macro.end_date,
      isGroupMacro: !!macro.group_id,
      phases,
      weeks,
    };
  });
}

/** Events this athlete is attached to, oldest first. */
async function fetchAthleteEvents(athleteId: string): Promise<Omit<AthleteMacroEvent, 'primary'>[]> {
  const { data: links } = await supabase
    .from('event_athletes')
    .select('event_id')
    .eq('athlete_id', athleteId);
  const eventIds = [...new Set(((links ?? []) as { event_id: string }[]).map(l => l.event_id))];
  if (eventIds.length === 0) return [];

  const { data: rows } = await supabase
    .from('events')
    .select('id, name, event_date, end_date, event_type, color')
    .in('id', eventIds)
    .order('event_date');

  type Row = { id: string; name: string; event_date: string; end_date: string | null; event_type: string; color: string | null };
  return ((rows ?? []) as Row[]).map(e => ({
    id: e.id,
    name: e.name,
    eventType: e.event_type,
    date: e.event_date,
    endDate: e.end_date && e.end_date !== e.event_date ? e.end_date : null,
    color: e.color,
  }));
}

/** Match a stored week_type against the coach's configured types. Mirrors
 *  `getWeekTypeColor` — abbreviation first, then a case-insensitive name. */
function resolveWeekType(weekType: string | null, weekTypes: WeekTypeConfig[]): WeekTypeConfig | null {
  if (!weekType) return null;
  return weekTypes.find(
    t => t.abbreviation === weekType || t.name.toLowerCase() === weekType.toLowerCase(),
  ) ?? null;
}
