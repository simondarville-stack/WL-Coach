import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Athlete, AthletePR } from '../lib/database.types';
import { useAthleteStore } from '../store/athleteStore';
import { getOwnerId } from '../lib/ownerContext';

export function useAthletes() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    athletes,
    setAthletes: storeSetAthletes,
    fetchAthletes: storeFetchAthletes,
    athletesLoading,
  } = useAthleteStore();

  // Delegates to store — single source of truth. Force=true to re-fetch.
  const fetchAthletes = async () => {
    try {
      setLoading(true);
      setError(null);
      await storeFetchAthletes(true);
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
        .eq('owner_id', getOwnerId())
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      const result = data || [];
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
        .eq('owner_id', getOwnerId())
        .order('name');
      if (error) throw error;
      const result = data || [];
      storeSetAthletes(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes');
    }
  };

  const createAthlete = async (athleteData: Omit<Athlete, 'id' | 'created_at' | 'updated_at'>, initialBodyweight?: number): Promise<Athlete> => {
    try {
      const { data, error } = await supabase.from('athletes').insert([{ ...athleteData, owner_id: getOwnerId() }]).select().single();
      if (error) throw error;
      // Atomically create the initial bodyweight entry if provided
      if (initialBodyweight && initialBodyweight > 0) {
        await supabase.from('bodyweight_entries').upsert(
          { athlete_id: data.id, date: new Date().toISOString().split('T')[0], weight_kg: initialBodyweight },
          { onConflict: 'athlete_id,date' },
        );
      }
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save athlete');
      throw err;
    }
  };

  const updateAthlete = async (id: string, athleteData: Partial<Omit<Athlete, 'id' | 'created_at' | 'updated_at'>>) => {
    try {
      const { data: existing } = await supabase.from('athletes').select('owner_id').eq('id', id).single();
      if (existing?.owner_id !== getOwnerId()) throw new Error('Access denied: resource belongs to another environment');
      const { error } = await supabase.from('athletes').update(athleteData).eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save athlete');
      throw err;
    }
  };

  const deleteAthlete = async (id: string) => {
    try {
      const { data: existing } = await supabase.from('athletes').select('owner_id').eq('id', id).single();
      if (existing?.owner_id !== getOwnerId()) throw new Error('Access denied: resource belongs to another environment');
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
    setAthletes: storeSetAthletes,
    loading: loading || athletesLoading,
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
