import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { GeneralSettings } from '../lib/database.types';

export function useSettings() {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('general_settings')
        .select('*')
        .maybeSingle();
      if (error) throw error;

      if (!data) {
        const { data: newSettings, error: insertError } = await supabase
          .from('general_settings')
          .insert({
            raw_enabled: true,
            raw_average_days: 7,
            grid_load_increment: 5,
            grid_click_increment: 1,
          })
          .select()
          .single();
        if (insertError) throw insertError;
        setSettings(newSettings);
      } else {
        setSettings(data);
      }
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const fetchSettingsSilent = async (): Promise<GeneralSettings | null> => {
    const { data } = await supabase
      .from('general_settings')
      .select('*')
      .maybeSingle();
    setSettings(data);
    return data;
  };

  const updateSettings = async (id: string, updates: Partial<Omit<GeneralSettings, 'id' | 'created_at' | 'updated_at'>>) => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from('general_settings')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
      setSettings(prev => prev ? { ...prev, ...updates } : prev);
    } catch (error) {
      throw error;
    } finally {
      setSaving(false);
    }
  };

  return { settings, setSettings, loading, saving, fetchSettings, fetchSettingsSilent, updateSettings };
}
