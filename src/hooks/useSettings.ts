import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type { GeneralSettings } from '../lib/database.types';

// Module-level per-owner cache. general_settings is one row per owner that
// only changes from the Settings page, yet ~9 surfaces (planner, macro,
// templates, dashboard, review table, …) refetched it on every mount. The
// cache turns those into zero round trips per navigation; updateSettings
// writes through it, and the Settings editor passes { force: true } so it
// always shows the authoritative row. In-flight dedupe keeps two surfaces
// mounting in the same tick down to one request.
const settingsCache = new Map<string, GeneralSettings | null>();
const settingsInflight = new Map<string, Promise<GeneralSettings | null>>();

async function fetchOrCreateSettingsRow(ownerId: string): Promise<GeneralSettings | null> {
  const { data, error } = await supabase
    .from('general_settings')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: newSettings, error: insertError } = await supabase
    .from('general_settings')
    .insert({
      raw_enabled: true,
      raw_average_days: 7,
      grid_load_increment: 5,
      grid_click_increment: 1,
      owner_id: ownerId,
    })
    .select()
    .single();
  if (insertError) throw insertError;
  return newSettings;
}

export function useSettings() {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchSettings = async (opts: { force?: boolean } = {}) => {
    const ownerId = getOwnerId();
    try {
      setLoading(true);
      if (!opts.force && settingsCache.has(ownerId)) {
        setSettings(settingsCache.get(ownerId) ?? null);
        return;
      }
      let inflight = settingsInflight.get(ownerId);
      if (!inflight || opts.force) {
        inflight = fetchOrCreateSettingsRow(ownerId);
        settingsInflight.set(ownerId, inflight);
        void inflight.catch(() => {}).then(() => settingsInflight.delete(ownerId));
      }
      const row = await inflight;
      settingsCache.set(ownerId, row);
      setSettings(row);
    } catch {
      // Swallowed, as before: surfaces tolerate null settings.
    } finally {
      setLoading(false);
    }
  };

  const fetchSettingsSilent = async (): Promise<GeneralSettings | null> => {
    const ownerId = getOwnerId();
    if (settingsCache.has(ownerId)) {
      const cached = settingsCache.get(ownerId) ?? null;
      setSettings(cached);
      return cached;
    }
    const { data } = await supabase
      .from('general_settings')
      .select('*')
      .eq('owner_id', ownerId)
      .maybeSingle();
    // Only cache a real row: the silent path doesn't create defaults, and
    // caching its null would stop fetchSettings from ever creating them.
    if (data) settingsCache.set(ownerId, data);
    setSettings(data);
    return data;
  };

  const updateSettings = async (id: string, updates: Partial<Omit<GeneralSettings, 'id' | 'created_at' | 'updated_at'>>) => {
    const ownerId = getOwnerId();
    try {
      setSaving(true);
      const { error } = await supabase
        .from('general_settings')
        .update(updates)
        .eq('id', id)
        .eq('owner_id', ownerId);
      if (error) throw error;
      setSettings(prev => {
        const next = prev ? { ...prev, ...updates } : prev;
        if (next) settingsCache.set(ownerId, next as GeneralSettings);
        return next;
      });
    } catch (error) {
      console.error('[useSettings] updateSettings error:', error);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  return { settings, setSettings, loading, saving, fetchSettings, fetchSettingsSilent, updateSettings };
}
