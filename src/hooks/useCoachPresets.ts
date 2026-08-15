/**
 * useCoachPresets — data layer for # prescription presets (coach_presets).
 *
 * A preset is a coach-built template: optional prescription in the canonical
 * grammar, optional exercise features, optional row badge. Applied from the
 * planner's add-exercise search (#Name) or a row's + menu; the apply logic
 * itself lives with the planner (savePrescription / saveExerciseFeatures /
 * savePresetTag) — this hook only owns the preset collection.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type { CoachPreset, DefaultUnit } from '../lib/database.types';
import type { ExerciseFeatures } from '../lib/exerciseFeatures';

export interface CoachPresetInput {
  name: string;
  color: string;
  show_badge: boolean;
  prescription_raw: string | null;
  unit: DefaultUnit | null;
  features: ExerciseFeatures;
}

export function useCoachPresets() {
  const [presets, setPresets] = useState<CoachPreset[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('coach_presets')
        .select('*')
        .eq('owner_id', getOwnerId())
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      setPresets((data ?? []) as CoachPreset[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchPresets(); }, [fetchPresets]);

  const createPreset = useCallback(async (input?: Partial<CoachPresetInput>): Promise<CoachPreset> => {
    const row = {
      owner_id: getOwnerId(),
      name: input?.name ?? 'New',
      color: input?.color ?? '#185FA5',
      show_badge: input?.show_badge ?? true,
      prescription_raw: input?.prescription_raw ?? null,
      unit: input?.unit ?? null,
      features: input?.features ?? {},
    };
    const { data, error } = await supabase
      .from('coach_presets')
      .insert([row])
      .select()
      .single();
    if (error) throw error;
    const created = data as CoachPreset;
    setPresets(prev => [...prev, created]);
    return created;
  }, []);

  const updatePreset = useCallback(async (id: string, patch: Partial<CoachPresetInput>): Promise<void> => {
    // Optimistic — the manager edits inline and the list must not flicker.
    setPresets(prev => prev.map(p => p.id === id ? { ...p, ...patch } as CoachPreset : p));
    const { error } = await supabase
      .from('coach_presets')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      await fetchPresets();
      throw error;
    }
  }, [fetchPresets]);

  const deletePreset = useCallback(async (id: string): Promise<void> => {
    setPresets(prev => prev.filter(p => p.id !== id));
    const { error } = await supabase.from('coach_presets').delete().eq('id', id);
    if (error) {
      await fetchPresets();
      throw error;
    }
  }, [fetchPresets]);

  return { presets, loading, fetchPresets, createPreset, updatePreset, deletePreset };
}
