import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Athlete, AthletePR } from '../lib/database.types';
import { useAthleteStore } from '../store/athleteStore';

export function useAthletes() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setAthletes: storeSetAthletes } = useAthleteStore();

  const fetchAthletes = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .order('is_active', { ascending: false })
        .order('name');
      if (error) throw error;
      const result = data || [];
      setAthletes(result);
      storeSetAthletes(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes');
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveAthletes = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      const result = data || [];
      setAthletes(result);
      storeSetAthletes(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllAthletes = async () => {
    try {
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .order('name');
      if (error) throw error;
      const result = data || [];
      setAthletes(result);
      storeSetAthletes(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes');
    }
  };

  const createAthlete = async (athleteData: Omit<Athlete, 'id' | 'created_at' | 'updated_at'>): Promise<Athlete> => {
    try {
      const { data, error } = await supabase.from('athletes').insert([athleteData]).select().single();
      if (error) throw error;
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save athlete');
      throw err;
    }
  };

  const updateAthlete = async (id: string, athleteData: Partial<Omit<Athlete, 'id' | 'created_at' | 'updated_at'>>) => {
    try {
      const { error } = await supabase.from('athletes').update(athleteData).eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save athlete');
      throw err;
    }
  };

  const deleteAthlete = async (id: string) => {
    try {
      const { error } = await supabase.from('athletes').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete athlete');
      throw err;
    }
  };

  // --- PR operations ---

  const fetchPRs = async (athleteId: string): Promise<AthletePR[]> => {
    const { data, error } = await supabase
      .from('athlete_prs')
      .select('*')
      .eq('athlete_id', athleteId);
    if (error) throw error;
    return data || [];
  };

  const upsertPR = async (athleteId: string, exerciseId: string, prValueKg: number, prDate: string, existingPRId?: string) => {
    if (existingPRId) {
      const { error } = await supabase
        .from('athlete_prs')
        .update({ pr_value_kg: prValueKg })
        .eq('id', existingPRId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('athlete_prs')
        .insert({ athlete_id: athleteId, exercise_id: exerciseId, pr_value_kg: prValueKg, pr_date: prDate });
      if (error) throw error;
    }
  };

  const deletePR = async (prId: string) => {
    const { error } = await supabase.from('athlete_prs').delete().eq('id', prId);
    if (error) throw error;
  };

  return {
    athletes,
    setAthletes,
    loading,
    error,
    setError,
    fetchAthletes,
    fetchActiveAthletes,
    fetchAllAthletes,
    createAthlete,
    updateAthlete,
    deleteAthlete,
    fetchPRs,
    upsertPR,
    deletePR,
  };
}
