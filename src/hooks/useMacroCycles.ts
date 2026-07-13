// TODO: Consider splitting into useMacroCycleData (read) and useMacroCycleMutations (write/phase ops)
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import { addDaysToISO } from '../lib/dateUtils';
import type { MacroCycle, MacroWeek, MacroTrackedExerciseWithExercise, MacroTarget, MacroPhase, MacroCompetition } from '../lib/database.types';

/** Discriminated union identifying who a macrocycle belongs to */
export type MacroOwnerTarget = { type: 'athlete'; id: string } | { type: 'group'; id: string };

export interface MacroActuals {
  totalReps: number;
  avgWeight: number;
  maxWeight: number;
  repsAtMax: number;
  setsAtMax: number;
}

// weekId → exerciseId → actuals
export type MacroActualsMap = Record<string, Record<string, MacroActuals>>;

function errMsg(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  if (err instanceof Error) return err.message;
  return fallback;
}

export function useMacroCycles() {
  const [macrocycles, setMacrocycles] = useState<MacroCycle[]>([]);
  const [macroWeeks, setMacroWeeks] = useState<MacroWeek[]>([]);
  const [trackedExercises, setTrackedExercises] = useState<MacroTrackedExerciseWithExercise[]>([]);
  const [targets, setTargets] = useState<MacroTarget[]>([]);
  const [phases, setPhases] = useState<MacroPhase[]>([]);
  const [competitions, setCompetitions] = useState<MacroCompetition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMacrocycles = async (
    target: MacroOwnerTarget | string, // string for backwards compatibility
  ) => {
    try {
      // Support legacy string call (athleteId)
      const resolved: MacroOwnerTarget = typeof target === 'string'
        ? { type: 'athlete', id: target }
        : target;

      // No owner_id filter: athlete_id / group_id is the access boundary,
      // and a shared athlete's (or group's) macrocycle is owned by the
      // host coach. Filtering on the active coach's id would hide it from
      // a co-coach. Same pattern as week_plans reads.
      let query = supabase.from('macrocycles').select('*');

      if (resolved.type === 'athlete') {
        query = query.eq('athlete_id', resolved.id);
      } else {
        query = query.eq('group_id', resolved.id);
      }

      const { data, error } = await query.order('start_date', { ascending: false });
      if (error) throw error;
      setMacrocycles(data || []);
    } catch (err) {
      setError(errMsg(err, 'Failed to load macrocycles'));
    }
  };

  const createMacrocycle = async (
    targetOrAthleteId: MacroOwnerTarget | string,
    name: string,
    startDate: string,
    endDate: string,
    weekInserts: Array<{ macrocycle_id: string; week_start: string; week_number: number; week_type: string; week_type_text: string; notes: string }>,
  ): Promise<MacroCycle> => {
    try {
      setLoading(true);

      // Support legacy string call (athleteId)
      const resolved: MacroOwnerTarget = typeof targetOrAthleteId === 'string'
        ? { type: 'athlete', id: targetOrAthleteId }
        : targetOrAthleteId;

      const insertData = {
        name,
        start_date: startDate,
        end_date: endDate,
        owner_id: getOwnerId(),
        ...(resolved.type === 'athlete'
          ? { athlete_id: resolved.id, group_id: null }
          : { athlete_id: null, group_id: resolved.id }
        ),
      };

      const { data: macrocycle, error: macroError } = await supabase
        .from('macrocycles')
        .insert(insertData)
        .select()
        .single();
      if (macroError) throw macroError;

      const weeksWithId = weekInserts.map(w => ({ ...w, macrocycle_id: macrocycle.id }));
      const { error: weeksError } = await supabase.from('macro_weeks').insert(weeksWithId);
      if (weeksError) throw weeksError;

      // Add to local state so the list and the URL->cycle sync (which looks the
      // new id up in `macrocycles`) can find it immediately. Without this the
      // freshly-created cycle isn't in state, navigate('/macrocycles/:id')
      // resolves to nothing, and the create appears to do nothing even though
      // the row was inserted. Keep the fetch order (start_date descending).
      setMacrocycles(prev =>
        [macrocycle, ...prev].sort((a, b) =>
          a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0,
        ),
      );

      return macrocycle;
    } catch (err) {
      setError(errMsg(err, 'Failed to create macrocycle'));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updateMacrocycle = async (id: string, updates: Partial<Pick<MacroCycle, 'name' | 'start_date' | 'end_date'>>) => {
    try {
      setLoading(true);
      const { error } = await supabase.from('macrocycles').update(updates).eq('id', id);
      if (error) throw error;
      setMacrocycles(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
    } catch (err) {
      setError(errMsg(err, 'Failed to update macrocycle'));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /** Persist per-macro table view config. Quiet: no loading flag (fires on
   *  collapse/metric clicks), non-throwing (a failed layout save must never
   *  break the interaction that triggered it). */
  const updateMacrocycleLayout = async (id: string, layout: import('../lib/database.types').MacroTableLayout | null) => {
    setMacrocycles(prev => prev.map(m => m.id === id ? { ...m, table_layout: layout } : m));
    try {
      const { error } = await supabase.from('macrocycles').update({ table_layout: layout }).eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(errMsg(err, 'Failed to save table layout'));
    }
  };

  const deleteMacrocycle = async (id: string) => {
    try {
      setLoading(true);
      const { data: existing } = await supabase.from('macrocycles').select('owner_id').eq('id', id).single();
      if (existing?.owner_id !== getOwnerId()) throw new Error('Access denied: resource belongs to another environment');
      const { error } = await supabase.from('macrocycles').delete().eq('id', id);
      if (error) throw error;
      setMacrocycles(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      setError(errMsg(err, 'Failed to delete macrocycle'));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const fetchMacroWeeks = async (macrocycleId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('macro_weeks')
        .select('*')
        .eq('macrocycle_id', macrocycleId)
        .order('week_number');
      if (error) throw error;
      setMacroWeeks(data || []);
    } catch (err) {
      setError(errMsg(err, 'Failed to load weeks'));
    } finally {
      setLoading(false);
    }
  };

  const updateMacroWeek = async (id: string, updates: Partial<MacroWeek>) => {
    // Optimistic: update UI immediately, rollback on error
    const original = macroWeeks.find(w => w.id === id);
    setMacroWeeks(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w));
    try {
      const { error } = await supabase.from('macro_weeks').update(updates).eq('id', id);
      if (error) throw error;
    } catch (err) {
      if (original) setMacroWeeks(prev => prev.map(w => w.id === id ? original : w));
      setError(errMsg(err, 'Failed to update week'));
      throw err;
    }
  };

  const swapMacroWeeks = async (weekId1: string, weekId2: string) => {
    const w1 = macroWeeks.find(w => w.id === weekId1);
    const w2 = macroWeeks.find(w => w.id === weekId2);
    if (!w1 || !w2) return;
    try {
      // Swap only CONTENT — general targets + exercise targets.
      // week_number, week_start, week_type, week_type_text, notes all stay fixed.

      // --- 1. Swap general week fields ---
      const w1Updates = {
        total_reps_target: w2.total_reps_target ?? null,
        tonnage_target: (w2 as MacroWeek & { tonnage_target?: number | null }).tonnage_target ?? null,
        avg_intensity_target: (w2 as MacroWeek & { avg_intensity_target?: number | null }).avg_intensity_target ?? null,
      };
      const w2Updates = {
        total_reps_target: w1.total_reps_target ?? null,
        tonnage_target: (w1 as MacroWeek & { tonnage_target?: number | null }).tonnage_target ?? null,
        avg_intensity_target: (w1 as MacroWeek & { avg_intensity_target?: number | null }).avg_intensity_target ?? null,
      };
      // Optimistic: swap week-level state immediately so the row visually moves at once
      setMacroWeeks(prev => prev.map(w => {
        if (w.id === weekId1) return { ...w, ...w1Updates };
        if (w.id === weekId2) return { ...w, ...w2Updates };
        return w;
      }));
      // Also optimistically swap targets
      setTargets(prev => {
        const targetFields2 = ['target_max', 'target_reps_at_max', 'target_sets_at_max', 'target_reps', 'target_avg'] as const;
        return prev.map(t => {
          if (t.macro_week_id === weekId1) {
            const pair = prev.find(t2 => t2.macro_week_id === weekId2 && t2.tracked_exercise_id === t.tracked_exercise_id);
            return pair
              ? { ...t, ...Object.fromEntries(targetFields2.map(f => [f, pair[f]])) }
              : { ...t, ...Object.fromEntries(targetFields2.map(f => [f, null])) };
          }
          if (t.macro_week_id === weekId2) {
            const pair = prev.find(t2 => t2.macro_week_id === weekId1 && t2.tracked_exercise_id === t.tracked_exercise_id);
            return pair
              ? { ...t, ...Object.fromEntries(targetFields2.map(f => [f, pair[f]])) }
              : { ...t, ...Object.fromEntries(targetFields2.map(f => [f, null])) };
          }
          return t;
        });
      });

      const [{ error: ge1 }, { error: ge2 }] = await Promise.all([
        supabase.from('macro_weeks').update(w1Updates).eq('id', weekId1),
        supabase.from('macro_weeks').update(w2Updates).eq('id', weekId2),
      ]);
      if (ge1) throw ge1;
      if (ge2) throw ge2;

      // --- 2. Swap exercise targets ---
      const targetFields = ['target_max', 'target_reps_at_max', 'target_sets_at_max', 'target_reps', 'target_avg'] as const;
      const weekTargets1 = targets.filter(t => t.macro_week_id === weekId1);
      const weekTargets2 = targets.filter(t => t.macro_week_id === weekId2);
      const allTeIds = new Set([
        ...weekTargets1.map(t => t.tracked_exercise_id),
        ...weekTargets2.map(t => t.tracked_exercise_id),
      ]);

      // Snapshot values BEFORE any writes
      const swaps = Array.from(allTeIds).map(teId => {
        const t1 = weekTargets1.find(t => t.tracked_exercise_id === teId);
        const t2 = weekTargets2.find(t => t.tracked_exercise_id === teId);
        const vals1 = Object.fromEntries(targetFields.map(f => [f, t1?.[f] ?? null]));
        const vals2 = Object.fromEntries(targetFields.map(f => [f, t2?.[f] ?? null]));
        return { teId, vals1, vals2, t1, t2 };
      });

      await Promise.all(swaps.flatMap(({ teId, vals1, vals2, t1, t2 }) => {
        // Supabase query builders are PromiseLike, not strict Promise.
        const writes: PromiseLike<unknown>[] = [];
        if (t1) writes.push(supabase.from('macro_targets').update(vals2).eq('id', t1.id));
        if (t2) writes.push(supabase.from('macro_targets').update(vals1).eq('id', t2.id));
        if (!t1 && t2) writes.push(supabase.from('macro_targets').upsert(
          { macro_week_id: weekId1, tracked_exercise_id: teId, ...vals2 },
          { onConflict: 'macro_week_id,tracked_exercise_id' },
        ));
        if (!t2 && t1) writes.push(supabase.from('macro_targets').upsert(
          { macro_week_id: weekId2, tracked_exercise_id: teId, ...vals1 },
          { onConflict: 'macro_week_id,tracked_exercise_id' },
        ));
        return writes;
      }));

      // Re-fetch targets for both weeks to reconcile IDs for any newly inserted rows
      const { data: fresh } = await supabase
        .from('macro_targets').select('*').in('macro_week_id', [weekId1, weekId2]);
      if (fresh) {
        setTargets(prev => [
          ...prev.filter(t => t.macro_week_id !== weekId1 && t.macro_week_id !== weekId2),
          ...fresh,
        ]);
      }
    } catch (err) {
      setError(errMsg(err, 'Failed to swap weeks'));
      throw err;
    }
  };

  const fetchTrackedExercises = async (macrocycleId: string) => {
    try {
      const { data, error } = await supabase
        .from('macro_tracked_exercises')
        .select(`*, exercise:exercises(*)`)
        .eq('macrocycle_id', macrocycleId)
        .order('position');
      if (error) throw error;
      setTrackedExercises((data ?? []) as unknown as MacroTrackedExerciseWithExercise[]);
    } catch (err) {
      setError(errMsg(err, 'Failed to load tracked exercises'));
    }
  };

  const addTrackedExercise = async (macrocycleId: string, exerciseId: string, position: number) => {
    try {
      const { error } = await supabase
        .from('macro_tracked_exercises')
        .insert({ macrocycle_id: macrocycleId, exercise_id: exerciseId, position });
      if (error) throw error;
    } catch (err) {
      setError(errMsg(err, 'Failed to add tracked exercise'));
      throw err;
    }
  };

  const swapTrackedExercisePositions = async (id1: string, newPos1: number, id2: string, newPos2: number) => {
    try {
      const { error: e1 } = await supabase
        .from('macro_tracked_exercises')
        .update({ position: newPos1 })
        .eq('id', id1);
      const { error: e2 } = await supabase
        .from('macro_tracked_exercises')
        .update({ position: newPos2 })
        .eq('id', id2);
      if (e1 || e2) throw e1 || e2;
    } catch (err) {
      setError(errMsg(err, 'Failed to move tracked exercise'));
      throw err;
    }
  };

  const removeTrackedExercise = async (id: string) => {
    try {
      const { error } = await supabase.from('macro_tracked_exercises').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(errMsg(err, 'Failed to remove tracked exercise'));
      throw err;
    }
  };

  const reorderTrackedExercise = async (id: string, newPosition: number) => {
    const { error } = await supabase
      .from('macro_tracked_exercises')
      .update({ position: newPosition })
      .eq('id', id);
    if (error) throw error;
  };

  const fetchTargets = async (weekIds: string[]) => {
    try {
      const { data, error } = await supabase
        .from('macro_targets')
        .select('*')
        .in('macro_week_id', weekIds);
      if (error) throw error;
      setTargets(data || []);
    } catch (err) {
      setError(errMsg(err, 'Failed to load targets'));
    }
  };

  const upsertTarget = async (
    weekId: string,
    trackedExId: string,
    field: keyof MacroTarget,
    numValue: number | null,
    existingTarget?: MacroTarget,
  ): Promise<MacroTarget | null> => {
    try {
      if (existingTarget) {
        // Optimistic: patch ONLY this field inside the functional updater.
        // Spreading the (possibly stale) existingTarget snapshot instead would
        // make two concurrent single-field writes to the same row clobber each
        // other in local state (e.g. Ctrl+drag in the chart writes max + avg).
        setTargets(prev => prev.map(t => t.id === existingTarget.id ? { ...t, [field]: numValue } : t));
        const { error } = await supabase
          .from('macro_targets')
          .update({ [field]: numValue })
          .eq('id', existingTarget.id);
        if (error) {
          // Roll back only this field — sibling fields may have been updated
          // by concurrent writes that succeeded.
          setTargets(prev => prev.map(t => t.id === existingTarget.id ? { ...t, [field]: existingTarget[field] } : t));
          throw error;
        }
        return { ...existingTarget, [field]: numValue };
      } else {
        // Row may not exist yet — use true DB upsert so concurrent calls don't conflict
        const { data, error } = await supabase
          .from('macro_targets')
          .upsert(
            { macro_week_id: weekId, tracked_exercise_id: trackedExId, [field]: numValue },
            { onConflict: 'macro_week_id,tracked_exercise_id' },
          )
          .select()
          .single();
        if (error) throw error;
        setTargets(prev => {
          const exists = prev.find(t => t.id === data.id);
          return exists
            ? prev.map(t => t.id === data.id ? data : t)
            : [...prev, data];
        });
        return data;
      }
    } catch (err) {
      setError(errMsg(err, 'Failed to update target'));
      throw err;
    }
  };

  // ─── Fill guide bulk operations ────────────────────────────────────────────
  // One fill can touch dozens of cells; these write in a handful of requests
  // instead of one per cell, and return the affected rows so the caller can
  // build an undo snapshot.

  const bulkUpsertTargets = async (
    rows: Array<{
      macro_week_id: string;
      tracked_exercise_id: string;
      fields: Partial<MacroTarget>;
    }>,
  ): Promise<MacroTarget[]> => {
    if (rows.length === 0) return [];
    try {
      // PostgREST bulk upsert requires uniform keys per request — group rows
      // by field signature (a fill writes a uniform set; undo restores full
      // rows, also uniform).
      const groups = new Map<string, typeof rows>();
      for (const row of rows) {
        const sig = Object.keys(row.fields).sort().join(',');
        const list = groups.get(sig) ?? [];
        list.push(row);
        groups.set(sig, list);
      }
      const returned: MacroTarget[] = [];
      for (const group of groups.values()) {
        const payload = group.map(r => ({
          macro_week_id: r.macro_week_id,
          tracked_exercise_id: r.tracked_exercise_id,
          ...r.fields,
        }));
        const { data, error } = await supabase
          .from('macro_targets')
          .upsert(payload, { onConflict: 'macro_week_id,tracked_exercise_id' })
          .select();
        if (error) throw error;
        returned.push(...(data ?? []));
      }
      setTargets(prev => {
        const byId = new Map(prev.map(t => [t.id, t]));
        for (const row of returned) byId.set(row.id, row);
        return Array.from(byId.values());
      });
      return returned;
    } catch (err) {
      setError(errMsg(err, 'Failed to write targets'));
      throw err;
    }
  };

  const bulkDeleteTargets = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    try {
      const { error } = await supabase.from('macro_targets').delete().in('id', ids);
      if (error) throw error;
      setTargets(prev => prev.filter(t => !ids.includes(t.id)));
    } catch (err) {
      setError(errMsg(err, 'Failed to delete targets'));
      throw err;
    }
  };

  const bulkUpdateWeeks = async (
    updates: Array<{ id: string } & Partial<Pick<MacroWeek, 'week_type' | 'week_type_text' | 'total_reps_target'>>>,
  ): Promise<void> => {
    if (updates.length === 0) return;
    const originals = macroWeeks.filter(w => updates.some(u => u.id === w.id));
    setMacroWeeks(prev => prev.map(w => {
      const u = updates.find(x => x.id === w.id);
      return u ? { ...w, ...u } : w;
    }));
    try {
      await Promise.all(updates.map(async ({ id, ...fields }) => {
        const { error } = await supabase.from('macro_weeks').update(fields).eq('id', id);
        if (error) throw error;
      }));
    } catch (err) {
      setMacroWeeks(prev => prev.map(w => originals.find(o => o.id === w.id) ?? w));
      setError(errMsg(err, 'Failed to update weeks'));
      throw err;
    }
  };

  /** Persist a tracked exercise's reference load (for %-anchored fills). */
  const updateTrackedExerciseReference = async (id: string, referenceKg: number | null): Promise<void> => {
    const original = trackedExercises.find(te => te.id === id);
    setTrackedExercises(prev => prev.map(te => te.id === id ? { ...te, reference_kg: referenceKg } : te));
    try {
      const { error } = await supabase
        .from('macro_tracked_exercises')
        .update({ reference_kg: referenceKg })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      if (original) setTrackedExercises(prev => prev.map(te => te.id === id ? original : te));
      setError(errMsg(err, 'Failed to update reference'));
      throw err;
    }
  };

  interface MacroTargetForExercise {
    target_reps: number | null;
    target_avg: number | null;
    target_max: number | null;
    target_reps_at_max: number | null;
    target_sets_at_max: number | null;
  }

  const fetchMacroTargetForExercise = async (
    weekplanId: string,
    exerciseId: string,
  ): Promise<MacroTargetForExercise | null> => {
    try {
      const { data: weekPlan } = await supabase
        .from('week_plans')
        .select('week_start, athlete_id')
        .eq('id', weekplanId)
        .maybeSingle();

      if (!weekPlan) return null;

      const { data: macrocycle } = await supabase
        .from('macrocycles')
        .select('id')
        .eq('is_active', true)
        .eq('athlete_id', weekPlan.athlete_id ?? '')
        .maybeSingle();

      if (!macrocycle) return null;

      const { data: macroWeek } = await supabase
        .from('macro_weeks')
        .select('id')
        .eq('macrocycle_id', macrocycle.id)
        .eq('week_start', weekPlan.week_start)
        .maybeSingle();

      if (!macroWeek) return null;

      const { data: trackedExercise } = await supabase
        .from('macro_tracked_exercises')
        .select('id')
        .eq('macrocycle_id', macrocycle.id)
        .eq('exercise_id', exerciseId)
        .maybeSingle();

      if (!trackedExercise) return null;

      const { data: target } = await supabase
        .from('macro_targets')
        .select('target_reps, target_avg, target_max, target_reps_at_max, target_sets_at_max')
        .eq('macro_week_id', macroWeek.id)
        .eq('tracked_exercise_id', trackedExercise.id)
        .maybeSingle();

      return target || null;
    } catch (err) {
      return null;
    }
  };

  interface MacroValidationData {
    macroTargets: Record<string, {
      id: string; macro_week_id: string; tracked_exercise_id: string; exercise_id: string;
      target_reps: number | null; target_avg: number | null; target_max: number | null;
      target_reps_at_max: number | null; target_sets_at_max: number | null;
    }>;
    trackedExercises: import('../lib/database.types').Exercise[];
  }

  const fetchMacroValidationData = async (
    athleteId: string,
    weekStart: string,
  ): Promise<MacroValidationData> => {
    // Owner scope: verify macrocycle belongs to this owner before querying macro_weeks
    const { data: macroWeeks, error: macroError } = await supabase
      .from('macro_weeks')
      .select(`id, macrocycle_id, week_start, macrocycles!inner(athlete_id, owner_id, start_date, end_date)`)
      .eq('macrocycles.athlete_id', athleteId)
      .eq('macrocycles.owner_id', getOwnerId())
      .lte('week_start', weekStart)
      .gte('week_start', new Date(new Date(weekStart).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .lte('macrocycles.start_date', weekStart)
      .gte('macrocycles.end_date', weekStart)
      .order('week_start', { ascending: false })
      .limit(1);

    if (macroError) throw macroError;
    if (!macroWeeks || macroWeeks.length === 0) return { macroTargets: {}, trackedExercises: [] };

    const macroWeek = macroWeeks[0];

    const { data: trackedExercisesData } = await supabase
      .from('macro_tracked_exercises')
      .select('id, exercise_id, exercises(*)')
      .eq('macrocycle_id', macroWeek.macrocycle_id)
      .order('position');

    type TrackedExerciseRow = { id: string; exercise_id: string; exercises: import('../lib/database.types').Exercise | null };
    const typedTrackedData = (trackedExercisesData || []) as unknown as TrackedExerciseRow[];
    const exercises = typedTrackedData.map(item => item.exercises).filter((e): e is import('../lib/database.types').Exercise => e !== null);

    const { data: targetsData } = await supabase
      .from('macro_targets')
      .select('*')
      .eq('macro_week_id', macroWeek.id);

    const trackedExerciseMap: Record<string, string> = {};
    typedTrackedData.forEach(te => { trackedExerciseMap[te.exercise_id] = te.id; });

    const targetsMap: MacroValidationData['macroTargets'] = {};
    (targetsData || []).forEach(target => {
      const trackedEx = typedTrackedData.find(te => te.id === target.tracked_exercise_id);
      if (trackedEx) {
        targetsMap[trackedEx.exercise_id] = { ...target, exercise_id: trackedEx.exercise_id };
      }
    });

    return { macroTargets: targetsMap, trackedExercises: exercises };
  };

  // --- Cycle extend / trim ---

  const extendCycle = async (cycleId: string, lastWeekNumber: number, lastWeekStart: string, newEndDate: string, defaultWeekType: string): Promise<void> => {
    const newStart = new Date(lastWeekStart);
    newStart.setDate(newStart.getDate() + 7);
    const startISO = newStart.toISOString().slice(0, 10);
    // Build weeks from startISO to newEndDate
    const weeks: { week_start: string; week_number: number; week_type: string; week_type_text: string; notes: string; macrocycle_id: string }[] = [];
    const d = new Date(startISO + 'T00:00:00');
    const end = new Date(newEndDate + 'T00:00:00');
    let weekNum = lastWeekNumber + 1;
    while (d <= end) {
      weeks.push({
        macrocycle_id: cycleId,
        week_start: d.toISOString().slice(0, 10),
        week_number: weekNum++,
        week_type: defaultWeekType,
        week_type_text: '',
        notes: '',
      });
      d.setDate(d.getDate() + 7);
    }
    if (weeks.length > 0) {
      const { error } = await supabase.from('macro_weeks').insert(weeks);
      if (error) throw error;
    }
  };

  const trimCycle = async (cycleId: string, newEndDate: string): Promise<void> => {
    const { error } = await supabase
      .from('macro_weeks')
      .delete()
      .eq('macrocycle_id', cycleId)
      .gt('week_start', newEndDate);
    if (error) throw error;
  };

  /**
   * Slide every macro week's Monday by `shiftDays` (always a multiple of 7).
   * Used when a cycle's START date is edited: the whole cycle moves in time,
   * preserving week structure, types, notes and targets (never renumbers).
   * Optimistic with rollback, mirroring bulkUpdateWeeks.
   */
  const shiftMacroWeeks = async (cycleId: string, shiftDays: number): Promise<void> => {
    if (shiftDays === 0) return;
    const affected = macroWeeks.filter(w => w.macrocycle_id === cycleId);
    if (affected.length === 0) return;
    const originals = affected.map(w => ({ id: w.id, week_start: w.week_start }));
    setMacroWeeks(prev => prev.map(w =>
      w.macrocycle_id === cycleId ? { ...w, week_start: addDaysToISO(w.week_start, shiftDays) } : w,
    ));
    try {
      await Promise.all(originals.map(async o => {
        const { error } = await supabase
          .from('macro_weeks')
          .update({ week_start: addDaysToISO(o.week_start, shiftDays) })
          .eq('id', o.id);
        if (error) throw error;
      }));
    } catch (err) {
      setMacroWeeks(prev => prev.map(w => {
        const o = originals.find(x => x.id === w.id);
        return o ? { ...w, week_start: o.week_start } : w;
      }));
      setError(errMsg(err, 'Failed to shift weeks'));
      throw err;
    }
  };

  // --- Phase operations ---

  const fetchPhases = async (macrocycleId: string) => {
    try {
      const { data, error } = await supabase
        .from('macro_phases')
        .select('*')
        .eq('macrocycle_id', macrocycleId)
        .eq('owner_id', getOwnerId())
        .order('position');
      if (error) throw error;
      setPhases(data || []);
    } catch (err) {
      setError(errMsg(err, 'Failed to load phases'));
    }
  };

  const createPhase = async (phase: Omit<MacroPhase, 'id' | 'created_at' | 'updated_at' | 'owner_id'>): Promise<MacroPhase> => {
    try {
      const phaseWithOwner = { ...phase, owner_id: getOwnerId() };
      const { data, error } = await supabase
        .from('macro_phases')
        .insert(phaseWithOwner)
        .select()
        .single();
      if (error) throw error;
      setPhases(prev => [...prev, data].sort((a, b) => a.position - b.position));
      return data;
    } catch (err) {
      setError(errMsg(err, 'Failed to create phase'));
      throw err;
    }
  };

  const updatePhase = async (id: string, updates: Partial<MacroPhase>) => {
    try {
      const { error } = await supabase.from('macro_phases').update(updates).eq('id', id);
      if (error) throw error;
      setPhases(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    } catch (err) {
      setError(errMsg(err, 'Failed to update phase'));
      throw err;
    }
  };

  const deletePhase = async (id: string) => {
    try {
      const { error } = await supabase.from('macro_phases').delete().eq('id', id);
      if (error) throw error;
      setPhases(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      setError(errMsg(err, 'Failed to delete phase'));
      throw err;
    }
  };

  // --- Competition operations ---

  const fetchCompetitions = async (macrocycleId: string) => {
    try {
      const { data, error } = await supabase
        .from('macro_competitions')
        .select('*')
        .eq('macrocycle_id', macrocycleId)
        .eq('owner_id', getOwnerId())
        .order('competition_date');
      if (error) throw error;
      setCompetitions(data || []);
    } catch (err) {
      setError(errMsg(err, 'Failed to load competitions'));
    }
  };

  const createCompetition = async (comp: Omit<MacroCompetition, 'id' | 'created_at' | 'owner_id'>): Promise<MacroCompetition> => {
    try {
      const compWithOwner = { ...comp, owner_id: getOwnerId() };
      const { data, error } = await supabase
        .from('macro_competitions')
        .insert(compWithOwner)
        .select()
        .single();
      if (error) throw error;
      setCompetitions(prev => [...prev, data].sort((a, b) => a.competition_date.localeCompare(b.competition_date)));
      return data;
    } catch (err) {
      setError(errMsg(err, 'Failed to create competition'));
      throw err;
    }
  };

  const updateCompetition = async (id: string, updates: Partial<Pick<MacroCompetition, 'competition_name' | 'competition_date' | 'is_primary'>>) => {
    try {
      const { error } = await supabase.from('macro_competitions').update(updates).eq('id', id);
      if (error) throw error;
      setCompetitions(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    } catch (err) {
      setError(errMsg(err, 'Failed to update competition'));
      throw err;
    }
  };

  const deleteCompetition = async (id: string) => {
    try {
      const { error } = await supabase.from('macro_competitions').delete().eq('id', id);
      if (error) throw error;
      setCompetitions(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      setError(errMsg(err, 'Failed to delete competition'));
      throw err;
    }
  };

  // --- Actuals computation across full macro ---

  /**
   * Fetch actuals for a single athlete over the macro's date range.
   * Extracted from fetchMacroActuals for reuse in group aggregation.
   */
  const fetchActualsForAthlete = async (
    athleteId: string,
    macroWeeksData: MacroWeek[],
    trackedExercisesData: MacroTrackedExerciseWithExercise[],
  ): Promise<MacroActualsMap> => {
    if (macroWeeksData.length === 0 || trackedExercisesData.length === 0) return {};

    const startDate = macroWeeksData[0].week_start;
    const lastWeek = macroWeeksData[macroWeeksData.length - 1];
    const endDate = new Date(lastWeek.week_start);
    endDate.setDate(endDate.getDate() + 6);
    const endDateISO = endDate.toISOString().split('T')[0];

    try {
      const { data: weekPlans } = await supabase
        .from('week_plans')
        .select('id, week_start')
        .eq('athlete_id', athleteId)
        .eq('is_group_plan', false)
        .gte('week_start', startDate)
        .lte('week_start', endDateISO);

      if (!weekPlans || weekPlans.length === 0) return {};

      const weekPlanIds = weekPlans.map(wp => wp.id);

      const { data: plannedExercises } = await supabase
        .from('planned_exercises')
        .select('weekplan_id, exercise_id, unit, summary_total_reps, summary_avg_load, summary_highest_load, prescription_raw')
        .in('weekplan_id', weekPlanIds);

      const { data: combos } = await supabase
        .from('planned_combos')
        .select('id, weekplan_id, unit')
        .in('weekplan_id', weekPlanIds);

      const comboIds = (combos || []).map(c => c.id);

      type ComboItemRow = { planned_combo_id: string; exercise_id: string; position: number };
      type ComboSetLineRow = { planned_combo_id: string; sets: number; reps_tuple_text: string; load_value: number };

      // Wrap the conditional in async helpers so each branch returns a
      // uniform Promise<Row[]>; Promise.all can't reconcile a Supabase
      // builder with a Promise.resolve in a single conditional without
      // tripping its overload resolution.
      const fetchComboItems = async (): Promise<ComboItemRow[]> => {
        if (comboIds.length === 0) return [];
        const { data } = await supabase
          .from('planned_combo_items')
          .select('planned_combo_id, exercise_id, position')
          .in('planned_combo_id', comboIds);
        return (data ?? []) as unknown as ComboItemRow[];
      };
      const fetchComboSetLines = async (): Promise<ComboSetLineRow[]> => {
        if (comboIds.length === 0) return [];
        // planned_combo_set_lines isn't in the generated database.types yet;
        // cast the client to avoid the table-name overload check.
        const { data } = await (supabase as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              in: (col: string, vals: string[]) => Promise<{ data: ComboSetLineRow[] | null }>;
            };
          };
        })
          .from('planned_combo_set_lines')
          .select('planned_combo_id, sets, reps_tuple_text, load_value')
          .in('planned_combo_id', comboIds);
        return (data ?? []) as ComboSetLineRow[];
      };
      const [comboItems, comboSetLines] = await Promise.all([fetchComboItems(), fetchComboSetLines()]);

      const weekStartToWpId = new Map<string, string>();
      weekPlans.forEach(wp => weekStartToWpId.set(wp.week_start, wp.id));

      const result: MacroActualsMap = {};
      const trackedExIds = trackedExercisesData.map(te => te.exercise_id);

      for (const macroWeek of macroWeeksData) {
        const wpId = weekStartToWpId.get(macroWeek.week_start);
        if (!wpId) continue;

        const weekExercises = (plannedExercises || []).filter(pe => pe.weekplan_id === wpId);
        const weekCombos = (combos || []).filter(c => c.weekplan_id === wpId);
        const weekComboIds = new Set(weekCombos.map(c => c.id));
        const weekComboItems = (comboItems || []).filter(ci => weekComboIds.has(ci.planned_combo_id));
        const weekComboSetLines = (comboSetLines || []).filter(csl => weekComboIds.has(csl.planned_combo_id));

        result[macroWeek.id] = {};

        for (const exerciseId of trackedExIds) {
          let totalReps = 0;
          let totalWeightedReps = 0;
          let maxWeight = 0;
          const allSets: { weight: number; reps: number; sets: number }[] = [];

          weekExercises.filter(pe => pe.exercise_id === exerciseId).forEach(pe => {
            totalReps += pe.summary_total_reps || 0;
            if (pe.unit === 'absolute_kg' && pe.summary_avg_load) {
              totalWeightedReps += pe.summary_avg_load * (pe.summary_total_reps || 0);
            }
            if (pe.prescription_raw && pe.unit === 'absolute_kg') {
              pe.prescription_raw.split(',').forEach((seg: string) => {
                const m = seg.trim().match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+)(?:\s*[x×]\s*(\d+))?/i);
                if (m) {
                  const w = parseFloat(m[1]);
                  const r = parseInt(m[2], 10);
                  const s = m[3] ? parseInt(m[3], 10) : 1;
                  allSets.push({ weight: w, reps: r, sets: s });
                  if (w > maxWeight) maxWeight = w;
                }
              });
            }
          });

          weekComboItems.filter(ci => ci.exercise_id === exerciseId).forEach(ci => {
            const combo = weekCombos.find(c => c.id === ci.planned_combo_id);
            if (!combo || combo.unit !== 'absolute_kg') return;
            weekComboSetLines.filter(csl => csl.planned_combo_id === ci.planned_combo_id).forEach(line => {
              const repsTuple = line.reps_tuple_text.split('+').map((r: string) => parseInt(r.trim(), 10));
              const repsForEx = repsTuple[ci.position - 1] || 0;
              const weight = line.load_value || 0;
              const sets = line.sets || 1;
              const lineReps = repsForEx * sets;
              totalReps += lineReps;
              if (weight > 0) {
                totalWeightedReps += weight * lineReps;
                allSets.push({ weight, reps: repsForEx, sets });
                if (weight > maxWeight) maxWeight = weight;
              }
            });
          });

          let repsAtMax = 0;
          let setsAtMax = 0;
          if (maxWeight > 0) {
            allSets.forEach(s => {
              if (s.weight === maxWeight) {
                if (s.reps > repsAtMax) repsAtMax = s.reps;
                setsAtMax += s.sets;
              }
            });
          }

          const avgWeight = totalReps > 0 ? Math.round((totalWeightedReps / totalReps) * 10) / 10 : 0;
          result[macroWeek.id][exerciseId] = { totalReps, avgWeight, maxWeight, repsAtMax, setsAtMax };
        }
      }

      return result;
    } catch {
      return {};
    }
  };

  /**
   * Average the MacroActualsMap values across multiple members.
   * For each week+exercise combination, average the numeric values.
   * If a member has no data for a week, treat as 0.
   */
  const averageActuals = (
    allActuals: MacroActualsMap[],
    macroWeeksData: MacroWeek[],
    trackedExercisesData: MacroTrackedExerciseWithExercise[],
  ): MacroActualsMap => {
    if (allActuals.length === 0) return {};
    const count = allActuals.length;
    const result: MacroActualsMap = {};

    for (const week of macroWeeksData) {
      result[week.id] = {};
      for (const te of trackedExercisesData) {
        const exerciseId = te.exercise_id;
        let totalReps = 0;
        let avgWeight = 0;
        let maxWeight = 0;
        let repsAtMax = 0;
        let setsAtMax = 0;

        for (const memberActuals of allActuals) {
          const a = memberActuals[week.id]?.[exerciseId];
          totalReps += a?.totalReps ?? 0;
          avgWeight += a?.avgWeight ?? 0;
          maxWeight += a?.maxWeight ?? 0;
          repsAtMax += a?.repsAtMax ?? 0;
          setsAtMax += a?.setsAtMax ?? 0;
        }

        result[week.id][exerciseId] = {
          totalReps: Math.round(totalReps / count),
          avgWeight: Math.round((avgWeight / count) * 10) / 10,
          maxWeight: Math.round(maxWeight / count),
          repsAtMax: Math.round(repsAtMax / count),
          setsAtMax: Math.round(setsAtMax / count),
        };
      }
    }

    return result;
  };

  const fetchMacroActuals = async (
    targetOrAthleteId: { type: 'athlete'; id: string } | { type: 'group'; id: string } | string,
    macroWeeksData: MacroWeek[],
    trackedExercisesData: MacroTrackedExerciseWithExercise[],
  ): Promise<MacroActualsMap> => {
    if (macroWeeksData.length === 0 || trackedExercisesData.length === 0) return {};

    // Support legacy string call (athleteId)
    if (typeof targetOrAthleteId === 'string') {
      return fetchActualsForAthlete(targetOrAthleteId, macroWeeksData, trackedExercisesData);
    }

    if (targetOrAthleteId.type === 'athlete') {
      return fetchActualsForAthlete(targetOrAthleteId.id, macroWeeksData, trackedExercisesData);
    }

    // Group: fetch members, aggregate actuals across all members
    const { data: members } = await supabase
      .from('group_members')
      .select('athlete_id')
      .eq('group_id', targetOrAthleteId.id)
      .is('left_at', null);

    if (!members?.length) return {};

    const allActuals: MacroActualsMap[] = [];
    for (const m of members) {
      const a = await fetchActualsForAthlete(m.athlete_id, macroWeeksData, trackedExercisesData);
      allActuals.push(a);
    }

    return averageActuals(allActuals, macroWeeksData, trackedExercisesData);
  };

  return {
    macrocycles,
    setMacrocycles,
    macroWeeks,
    setMacroWeeks,
    trackedExercises,
    setTrackedExercises,
    targets,
    setTargets,
    phases,
    setPhases,
    competitions,
    setCompetitions,
    loading,
    error,
    setError,
    fetchMacrocycles,
    createMacrocycle,
    deleteMacrocycle,
    fetchMacroWeeks,
    updateMacroWeek,
    swapMacroWeeks,
    fetchTrackedExercises,
    addTrackedExercise,
    swapTrackedExercisePositions,
    removeTrackedExercise,
    reorderTrackedExercise,
    updateMacrocycleLayout,
    fetchTargets,
    upsertTarget,
    bulkUpsertTargets,
    bulkDeleteTargets,
    bulkUpdateWeeks,
    updateTrackedExerciseReference,
    fetchMacroTargetForExercise,
    fetchMacroValidationData,
    fetchPhases,
    createPhase,
    updatePhase,
    deletePhase,
    fetchCompetitions,
    createCompetition,
    updateCompetition,
    deleteCompetition,
    fetchMacroActuals,
    fetchActualsForAthlete,
    updateMacrocycle,
    extendCycle,
    trimCycle,
    shiftMacroWeeks,
  };
}
