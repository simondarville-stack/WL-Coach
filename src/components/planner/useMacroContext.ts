import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { MacroContext } from './WeeklyPlanner';

// Supabase join result — the generated types don't include joined fields
type MacroWeekWithJoin = {
  id: string;
  macrocycle_id: string;
  week_number: number;
  week_type: string | null;
  week_type_text: string | null;
  total_reps_target: number | null;
  macrocycles: { id: string; name: string } | null;
};

export function useMacroContext() {
  const [macroContext, setMacroContext] = useState<MacroContext | null>(null);

  async function loadMacroContext(athleteId: string, selectedDate: string) {
    try {
      const { data: mwRaw } = await supabase
        .from('macro_weeks')
        .select(`
          id, macrocycle_id, week_number, week_type, week_type_text, total_reps_target,
          macrocycles!inner(id, athlete_id, start_date, end_date, name)
        `)
        .eq('macrocycles.athlete_id', athleteId)
        .eq('week_start', selectedDate)
        .lte('macrocycles.start_date', selectedDate)
        .gte('macrocycles.end_date', selectedDate)
        .limit(1)
        .maybeSingle();

      const mw = mwRaw as MacroWeekWithJoin | null;
      if (!mw) { setMacroContext(null); return; }

      const macro = mw.macrocycles;

      const [phaseResult, countResult] = await Promise.all([
        supabase
          .from('macro_phases')
          .select('name, color')
          .eq('macrocycle_id', mw.macrocycle_id)
          .lte('start_week_number', mw.week_number)
          .gte('end_week_number', mw.week_number)
          .maybeSingle(),
        supabase
          .from('macro_weeks')
          .select('id', { count: 'exact', head: true })
          .eq('macrocycle_id', mw.macrocycle_id),
      ]);

      setMacroContext({
        macroId: mw.macrocycle_id,
        macroName: macro?.name ?? 'Macrocycle',
        weekType: mw.week_type,
        weekTypeText: mw.week_type_text,
        weekNumber: mw.week_number,
        totalWeeks: countResult.count ?? 0,
        phaseName: phaseResult.data?.name ?? null,
        phaseColor: phaseResult.data?.color ?? null,
        totalRepsTarget: mw.total_reps_target,
      });
    } catch {
      setMacroContext(null);
    }
  }

  return { macroContext, setMacroContext, loadMacroContext };
}
