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

  const createDefaultSettings = async (ownerId: string): Promise<void> => {
    const { error } = await supabase.from('general_settings').insert({
      owner_id: ownerId,
      raw_enabled: true,
      raw_average_days: 7,
      grid_load_increment: 5,
      grid_click_increment: 1,
    });
    if (error) throw error;
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
    // Atomically create default settings for this coach
    await createDefaultSettings(data.id);
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
