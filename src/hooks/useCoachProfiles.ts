import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { CoachProfile } from '../lib/database.types';

export function useCoachProfiles() {
  const [loading, setLoading] = useState(false);

  const fetchCoaches = async (): Promise<CoachProfile[]> => {
    const { data, error } = await supabase
      .from('coach_profiles')
      .select('*')
      .order('name');
    if (error) throw error;
    return data || [];
  };

  const createCoach = async (profile: {
    name: string;
    email?: string;
    club_name?: string;
  }): Promise<CoachProfile> => {
    const { data, error } = await supabase
      .from('coach_profiles')
      .insert([profile])
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const updateCoach = async (
    id: string,
    updates: Partial<CoachProfile>,
  ): Promise<void> => {
    const { error } = await supabase
      .from('coach_profiles')
      .update(updates)
      .eq('id', id);
    if (error) throw error;
  };

  const deleteCoach = async (id: string): Promise<void> => {
    // CASCADE will delete all owned data!
    const { error } = await supabase
      .from('coach_profiles')
      .delete()
      .eq('id', id);
    if (error) throw error;
  };

  return { loading, fetchCoaches, createCoach, updateCoach, deleteCoach };
}
