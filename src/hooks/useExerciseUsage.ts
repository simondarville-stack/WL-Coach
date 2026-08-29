/**
 * useExerciseUsage — how often each catalogue exercise is planned and logged
 * inside a rolling window, for the tree's usage column.
 *
 * One aggregate round trip (the exercise_usage_counts RPC does the grouping
 * server-side); the family rollup is pure and lives in lib/exerciseUsage.
 * Off = no query at all, so the catalogue costs nothing until a coach asks
 * the question.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usageSinceDate, type UsageCounts } from '../lib/exerciseUsage';

interface UsageRow {
  exercise_id: string;
  planned_count: number;
  logged_count: number;
}

/** Last planned / logged date per exercise (ISO, or null for never) — the
 *  prune flow's staleness column. Fetched on demand, not with the counts:
 *  only the prune panel needs it. */
export interface LastUsed {
  lastPlanned: string | null;
  lastLogged: string | null;
}

export async function fetchExerciseLastUsed(
  exerciseIds: string[],
): Promise<Map<string, LastUsed>> {
  const out = new Map<string, LastUsed>();
  if (exerciseIds.length === 0) return out;
  const { data, error } = await supabase.rpc('exercise_last_used', {
    p_exercise_ids: exerciseIds,
  });
  if (error) throw error;
  type Row = { exercise_id: string; last_planned: string | null; last_logged: string | null };
  for (const row of ((data ?? []) as unknown as Row[])) {
    out.set(row.exercise_id, { lastPlanned: row.last_planned, lastLogged: row.last_logged });
  }
  return out;
}

export function useExerciseUsage(weeks: number | null) {
  const [usage, setUsage] = useState<Map<string, UsageCounts>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (weeks == null) { setUsage(new Map()); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('exercise_usage_counts', {
        p_since: usageSinceDate(weeks),
        // Null = every exercise; the catalogue is small enough that scoping by
        // id would only add a round trip's worth of payload.
        p_exercise_ids: null,
      });
      if (rpcError) throw rpcError;
      const map = new Map<string, UsageCounts>();
      for (const row of ((data ?? []) as unknown as UsageRow[])) {
        map.set(row.exercise_id, {
          planned: Number(row.planned_count) || 0,
          logged: Number(row.logged_count) || 0,
        });
      }
      setUsage(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load usage. Check your connection and try again.');
      setUsage(new Map());
    } finally {
      setLoading(false);
    }
  }, [weeks]);

  useEffect(() => { void load(); }, [load]);

  return { usage, usageLoading: loading, usageError: error, reloadUsage: load };
}
