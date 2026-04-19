import { supabase } from './supabase';
import { getMondayOfWeekISO } from './weekUtils';
import type { MacroPhaseBarCell, MacroPhaseBarEvent } from '../components/planning/MacroPhaseBar';
import type {
  Macrocycle,
  MacroPhase,
  MacroWeek,
  WeekTypeConfig,
  Event,
} from './database.types';

/** Neutral gap color for weeks without a macro. */
const GAP_COLOR = 'var(--color-bg-secondary)';

export interface MacroPhaseBarSource {
  /** All macros the athlete has (can be >1 for cross-macro views). */
  macros: Pick<Macrocycle, 'id' | 'name'>[];
  /** All phases across all macros in `macros`. */
  phases: MacroPhase[];
  /** All macro_weeks rows across all macros in `macros`. */
  weeks: MacroWeek[];
  /** Coach-defined week type config list (from GeneralSettings.week_types). */
  weekTypeConfigs: WeekTypeConfig[];
}

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
): { abbr: string; name: string } {
  if (!abbr) return { abbr: '', name: '' };
  const wt =
    configs.find(c => c.abbreviation === abbr) ??
    configs.find(c => c.name.toLowerCase() === abbr.toLowerCase());
  // Strict: only render types that exist in the coach's config.
  // Unknown values (stale data, invalid input) render as empty so the
  // cell stays clean. Raw value is still visible in the tooltip
  // because we preserve it in typeName when the config doesn't match.
  if (!wt) return { abbr: '', name: '' };
  return {
    abbr: wt.abbreviation,
    name: wt.name,
  };
}

/**
 * Given a chronological list of week_start dates (Mondays), return one
 * MacroPhaseBarCell per week. Weeks that fall inside a macro get the
 * macro's phase color + label "W{n}". Weeks outside any macro get a
 * gap cell (null phase, neutral color, empty label).
 *
 * Used by the weekly planner overview where the visible range may
 * span multiple macros or include gap weeks.
 */
export function buildCellsForWeekRange(
  weekStarts: string[],
  source: MacroPhaseBarSource
): MacroPhaseBarCell[] {
  const { macros, phases, weeks, weekTypeConfigs } = source;

  return weekStarts.map(ws => {
    const weekRow = weeks.find(w => w.week_start === ws);
    const macro = weekRow
      ? macros.find(m => m.id === weekRow.macrocycle_id)
      : null;

    if (!weekRow || !macro) {
      return {
        weekStart: ws,
        phase: null,
        color: GAP_COLOR,
        typeAbbr: '',
        typeName: '',
        macroId: null,
        macroName: null,
        label: '',
      };
    }

    const phase = findPhaseForWeek(phases, macro.id, weekRow.week_number);
    const type = resolveWeekType(weekRow.week_type, weekTypeConfigs);

    return {
      weekStart: ws,
      phase: phase?.name ?? null,
      color: phase?.color ?? GAP_COLOR,
      typeAbbr: type.abbr,
      typeName: type.name,
      macroId: macro.id,
      macroName: macro.name,
      label: `W${weekRow.week_number}`,
    };
  });
}

/**
 * Build cells for a single macro from its first to last week.
 * Used by the weekly planner detail view, which locks to one macro.
 */
export function buildCellsForSingleMacro(
  macro: Pick<Macrocycle, 'id' | 'name'>,
  source: MacroPhaseBarSource
): MacroPhaseBarCell[] {
  const macroWeeks = source.weeks
    .filter(w => w.macrocycle_id === macro.id)
    .sort((a, b) => a.week_number - b.week_number);

  if (macroWeeks.length === 0) return [];

  const weekStarts = macroWeeks.map(w => w.week_start);
  return buildCellsForWeekRange(weekStarts, {
    ...source,
    macros: [macro],
  });
}

// ── Event helpers ─────────────────────────────────────────────────────────────

/**
 * Day-of-week index for our bar: Monday = 0, Sunday = 6.
 * JS getDay() returns Sunday = 0, Monday = 1, etc.
 */
function dayIndexFromDate(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  return (d.getDay() + 6) % 7;
}

/**
 * Convert a raw event row to the MacroPhaseBarEvent shape.
 * Point vs range is inferred from whether end_date is set and differs
 * from event_date.
 */
export function convertEventToPhaseBarEvent(
  event: Pick<Event, 'id' | 'name' | 'event_date' | 'end_date'>
): MacroPhaseBarEvent {
  const startMonday = getMondayOfWeekISO(new Date(event.event_date + 'T00:00:00'));
  const startDay = dayIndexFromDate(event.event_date);

  if (!event.end_date || event.end_date === event.event_date) {
    return {
      id: event.id,
      kind: 'point',
      weekStart: startMonday,
      day: startDay,
      title: event.name,
    };
  }

  const endMonday = getMondayOfWeekISO(new Date(event.end_date + 'T00:00:00'));
  const endDay = dayIndexFromDate(event.end_date);

  return {
    id: event.id,
    kind: 'range',
    startWeekStart: startMonday,
    startDay,
    endWeekStart: endMonday,
    endDay,
    title: event.name,
  };
}

/**
 * Resolve athlete IDs given either an athlete or group. Returns []
 * if neither is given. For groups, returns all currently-active member
 * ids (left_at is null).
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
 * Fetch all events attached to the given athlete IDs that overlap
 * the given date range (inclusive). Returns already-converted
 * MacroPhaseBarEvent objects, deduplicated by id.
 *
 * An event is considered to overlap the range [rangeStart, rangeEnd] if
 * its start ≤ rangeEnd AND its end ≥ rangeStart, where end defaults
 * to event_date when end_date is null.
 */
export async function fetchMacroPhaseBarEvents(
  athleteIds: string[],
  rangeStart: string,
  rangeEnd: string
): Promise<MacroPhaseBarEvent[]> {
  if (athleteIds.length === 0) return [];

  const { data: ea } = await supabase
    .from('event_athletes')
    .select('event_id')
    .in('athlete_id', athleteIds);

  const eventIds = [...new Set((ea || []).map((e: { event_id: string }) => e.event_id))];
  if (eventIds.length === 0) return [];

  const { data: events } = await supabase
    .from('events')
    .select('id, name, event_date, end_date, event_type, color')
    .in('id', eventIds)
    .order('event_date', { ascending: true });

  return (events || [])
    .filter((ev: Pick<Event, 'event_date' | 'end_date'>) => {
      const start = ev.event_date;
      const end = ev.end_date || ev.event_date;
      return start <= rangeEnd && end >= rangeStart;
    })
    .map((ev: Event) => convertEventToPhaseBarEvent(ev));
}
