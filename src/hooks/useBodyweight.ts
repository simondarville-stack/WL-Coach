/**
 * useBodyweight — fetch, upsert, update, and remove bodyweight entries
 * for a single athlete.
 *
 * Cleanup note: fetchEntries is wrapped in useCallback with a stable
 * athleteId dependency. Callers that invoke it inside a useEffect should
 * guard with isMounted / AbortController if state updates after unmount
 * become a concern. Currently the consumer (BodyweightPopup) does:
 *   useEffect(() => { fetchEntries(); }, [fetchEntries]);
 * which is safe as long as the component is unmounted promptly on close.
 */
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { BodyweightEntry } from '../lib/database.types';

export function useBodyweight(athleteId: string) {
  const [entries, setEntries] = useState<BodyweightEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('bodyweight_entries')
        .select('*')
        .eq('athlete_id', athleteId)
        .order('date', { ascending: true });
      setEntries(data || []);
    } finally {
      setLoading(false);
    }
  }, [athleteId]);

  const upsert = useCallback(async (date: string, weight_kg: number) => {
    await supabase.from('bodyweight_entries').upsert(
      { athlete_id: athleteId, date, weight_kg },
      { onConflict: 'athlete_id,date' },
    );
    await fetchEntries();
  }, [athleteId, fetchEntries]);

  const update = useCallback(async (id: string, weight_kg: number) => {
    await supabase.from('bodyweight_entries').update({ weight_kg }).eq('id', id);
    await fetchEntries();
  }, [fetchEntries]);

  const remove = useCallback(async (id: string) => {
    await supabase.from('bodyweight_entries').delete().eq('id', id);
    await fetchEntries();
  }, [fetchEntries]);

  return { entries, loading, fetchEntries, upsert, update, remove };
}
