/**
 * useMacroTemplates — CRUD for saved macro templates + applying a
 * materialized template onto a freshly created cycle.
 */
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type { MacroTemplateMode, MacroTemplatePayload, MacroTemplateRow, MaterializedTemplate } from '../lib/macroTemplate';

export function useMacroTemplates() {
  const [templates, setTemplates] = useState<MacroTemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = async (): Promise<MacroTemplateRow[]> => {
    try {
      const { data, error } = await supabase
        .from('macro_templates')
        .select('*')
        .eq('owner_id', getOwnerId())
        .order('name');
      if (error) throw error;
      const rows = (data ?? []) as unknown as MacroTemplateRow[];
      setTemplates(rows);
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
      return [];
    }
  };

  const createTemplate = async (
    name: string,
    mode: MacroTemplateMode,
    weekCount: number,
    payload: MacroTemplatePayload,
  ): Promise<MacroTemplateRow> => {
    const { data, error } = await supabase
      .from('macro_templates')
      .insert({ owner_id: getOwnerId(), name, mode, week_count: weekCount, payload })
      .select()
      .single();
    if (error) {
      setError(error.message);
      throw error;
    }
    const row = data as unknown as MacroTemplateRow;
    setTemplates(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
    return row;
  };

  const deleteTemplate = async (id: string): Promise<void> => {
    const { error } = await supabase.from('macro_templates').delete().eq('id', id);
    if (error) {
      setError(error.message);
      throw error;
    }
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  /**
   * Write a materialized template into an existing (freshly created) cycle:
   * week types/labels/Σreps onto the cycle's weeks, phases, tracked exercises
   * (with references) and all target cells. Week numbers beyond the cycle's
   * length are ignored; the caller refetches cycle data afterwards.
   */
  const applyTemplate = async (macrocycleId: string, mat: MaterializedTemplate): Promise<void> => {
    // 1. Week updates by week_number
    const { data: weeks, error: wErr } = await supabase
      .from('macro_weeks')
      .select('id, week_number')
      .eq('macrocycle_id', macrocycleId);
    if (wErr) throw wErr;
    const weekIdByNumber = new Map((weeks ?? []).map(w => [w.week_number, w.id]));

    await Promise.all(mat.weeks.map(async w => {
      const id = weekIdByNumber.get(w.week_number);
      if (!id) return;
      const { error } = await supabase
        .from('macro_weeks')
        .update({
          week_type: w.week_type,
          week_type_text: w.week_type_text,
          total_reps_target: w.total_reps_target,
        })
        .eq('id', id);
      if (error) throw error;
    }));

    // 2. Phases (clamped to the cycle length)
    const maxWeek = Math.max(0, ...(weeks ?? []).map(w => w.week_number));
    const phaseRows = mat.phases
      .filter(p => p.start_week_number <= maxWeek)
      .map(p => ({
        ...p,
        end_week_number: Math.min(p.end_week_number, maxWeek),
        macrocycle_id: macrocycleId,
        owner_id: getOwnerId(),
      }));
    if (phaseRows.length > 0) {
      const { error } = await supabase.from('macro_phases').insert(phaseRows);
      if (error) throw error;
    }

    // 3. Tracked exercises (with references)
    if (mat.exercises.length > 0) {
      const { data: teRows, error: teErr } = await supabase
        .from('macro_tracked_exercises')
        .insert(mat.exercises.map(ex => ({
          macrocycle_id: macrocycleId,
          exercise_id: ex.exercise_id,
          position: ex.position,
          reference_kg: ex.reference_kg,
        })))
        .select('id, exercise_id');
      if (teErr) throw teErr;
      const teIdByExercise = new Map((teRows ?? []).map(r => [r.exercise_id, r.id]));

      // 4. Targets
      const targetRows = mat.targets
        .map(t => {
          const weekId = weekIdByNumber.get(t.week_number);
          const teId = teIdByExercise.get(t.exercise_id);
          if (!weekId || !teId) return null;
          return { macro_week_id: weekId, tracked_exercise_id: teId, ...t.fields };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (targetRows.length > 0) {
        // Uniform keys per request (PostgREST): normalize to the full field set
        const normalized = targetRows.map(r => ({
          macro_week_id: r.macro_week_id,
          tracked_exercise_id: r.tracked_exercise_id,
          target_max: r.target_max ?? null,
          target_avg: r.target_avg ?? null,
          target_reps: r.target_reps ?? null,
          target_reps_at_max: r.target_reps_at_max ?? null,
          target_sets_at_max: r.target_sets_at_max ?? null,
          note: r.note ?? null,
        }));
        const { error } = await supabase.from('macro_targets').insert(normalized);
        if (error) throw error;
      }
    }
  };

  return { templates, error, setError, fetchTemplates, createTemplate, deleteTemplate, applyTemplate };
}
