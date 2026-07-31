/**
 * plannerMacro — resolves which macro week covers a Weekly Planner selection.
 *
 * Single source of truth for the planner's macro context: the timeline
 * header, control panel ΣR target, category table, day editor and exercise
 * detail all hang off the result.
 *
 * Scoping mirrors the athlete app (`athleteMacroService.fetchAthleteMacros`):
 * - Group selection → the group's macro (`macrocycles.group_id`).
 * - Individual athlete → the athlete's own macro first, falling back to a
 *   macro of a training group they are an active member of.
 */
import { supabase } from './supabase';

export interface ResolvedMacroWeek {
  weekId: string;
  macroId: string;
  macroName: string;
  /** True when the macro belongs to a training group rather than the athlete. */
  isGroupMacro: boolean;
  weekNumber: number;
  weekType: string;
  weekTypeText: string | null;
  totalRepsTarget: number | null;
  notes: string;
}

interface MacroWeekRow {
  id: string;
  macrocycle_id: string;
  week_number: number;
  week_type: string | null;
  week_type_text: string | null;
  total_reps_target: number | null;
  notes: string | null;
  macrocycles: {
    id: string;
    name: string;
    athlete_id: string | null;
    group_id: string | null;
  } | null;
}

/**
 * PostgREST OR-filter over `macrocycles` rows for an individual athlete:
 * their own macros plus macros of training groups they are an active member
 * of. Apply with `.or(filter)` (or `.or(filter, { referencedTable })` on an
 * embedded join).
 */
export async function athleteMacroScopeFilter(athleteId: string): Promise<string> {
  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('athlete_id', athleteId)
    .is('left_at', null);
  const groupIds = [...new Set(((memberships ?? []) as { group_id: string }[]).map(m => m.group_id))];
  return groupIds.length > 0
    ? `athlete_id.eq.${athleteId},group_id.in.(${groupIds.join(',')})`
    : `athlete_id.eq.${athleteId}`;
}

export async function resolveMacroWeek(
  athleteId: string | null,
  groupId: string | null,
  weekStart: string,
): Promise<ResolvedMacroWeek | null> {
  let query = supabase
    .from('macro_weeks')
    .select(`
      id, macrocycle_id, week_number, week_type, week_type_text, total_reps_target, notes,
      macrocycles!inner(id, name, athlete_id, group_id, start_date, end_date)
    `)
    .eq('week_start', weekStart)
    .lte('macrocycles.start_date', weekStart)
    .gte('macrocycles.end_date', weekStart);

  if (groupId) {
    query = query.eq('macrocycles.group_id', groupId);
  } else if (athleteId) {
    query = query.or(await athleteMacroScopeFilter(athleteId), { referencedTable: 'macrocycles' });
  } else {
    return null;
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as MacroWeekRow[];
  if (rows.length === 0) return null;

  // An athlete's own macro wins over one inherited from a group.
  const row = rows.find(r => r.macrocycles?.athlete_id != null) ?? rows[0];
  return {
    weekId: row.id,
    macroId: row.macrocycle_id,
    macroName: row.macrocycles?.name ?? 'Macrocycle',
    isGroupMacro: row.macrocycles?.athlete_id == null,
    weekNumber: row.week_number,
    weekType: row.week_type ?? '',
    weekTypeText: row.week_type_text,
    totalRepsTarget: row.total_reps_target,
    notes: row.notes ?? '',
  };
}

/**
 * A macro target's top set expressed in canonical prescription grammar
 * (`load × reps × sets`; sets omitted when 1) so it can be rendered with
 * `StackedNotation` — the same visual as the planned prescription next to it.
 * Returns null when the target has no max component.
 */
export function targetMaxRaw(
  max: number | string | null,
  repsAtMax: number | null,
  setsAtMax: number | null,
): string | null {
  if (max == null) return null;
  if (repsAtMax == null) return String(max);
  return `${max}x${repsAtMax}${setsAtMax != null && setsAtMax > 1 ? `x${setsAtMax}` : ''}`;
}
