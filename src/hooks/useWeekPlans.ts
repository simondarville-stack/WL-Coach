// TODO: Consider splitting into useWeekPlanData (loading) and useWeekPlanMutations (writes)
import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type {
  Athlete,
  AthletePR,
  ComboMemberEntry,
  DefaultUnit,
  Exercise,
  PlannedExercise,
  PlannedExerciseMetadata,
  PlannedSetLine,
  TrainingGroup,
  WeekPlan,
} from '../lib/database.types';
import { DAYS_OF_WEEK } from '../lib/constants';
import { parsePrescription, parseComboPrescription, computePrescriptionSummary } from '../lib/prescriptionParser';
import { recordPrescriptionDraft, clearPrescriptionDraft } from '../lib/prescriptionDraftStore';

export interface PlanSelection {
  type: 'individual' | 'group';
  athlete: Athlete | null;
  group: TrainingGroup | null;
}

export function useWeekPlans() {
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<Record<number, (PlannedExercise & { exercise: Exercise })[]>>({});
  // Per-exercise write chain: serializes prescription DB writes so a burst of
  // rapid clicks persists in click order (never out-of-order, which would leave
  // a stale value as the final state).
  const writeChainRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const [comboMembers, setComboMembers] = useState<Record<string, ComboMemberEntry[]>>({});
  const [athletePRs, setAthletePRs] = useState<AthletePR[]>([]);
  const [macroWeekTarget, setMacroWeekTarget] = useState<number | null>(null);
  const [macroWeekTypeText, setMacroWeekTypeText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrCreateWeekPlan = async (selectedDate: string, planSelection: PlanSelection): Promise<WeekPlan | null> => {
    const { type, athlete, group } = planSelection;
    if (!athlete && !group) return null;

    try {
      setLoading(true);
      setError(null);

      // For an individual or group plan, athlete_id or group_id is the
      // access boundary — those rows are unique per (target, week_start),
      // so we don't need an owner_id filter. Dropping it is what lets a
      // co-coach see the host's existing plan instead of trying to insert
      // their own duplicate.
      let query = supabase
        .from('week_plans')
        .select('*')
        .eq('week_start', selectedDate);

      if (type === 'individual' && athlete) {
        query = query.eq('athlete_id', athlete.id).is('group_id', null);
      } else if (type === 'group' && group) {
        query = query.eq('group_id', group.id).is('athlete_id', null);
      }

      const { data: existingPlan, error: searchError } = await query.maybeSingle();
      if (searchError) throw searchError;

      let plan = existingPlan;
      if (!plan) {
        // Write under the target's host coach, not the active coach. For
        // unshared athletes this equals getOwnerId(); for shared ones it
        // points at the host so both coaches edit the same row.
        const hostOwnerId =
          (type === 'individual' && athlete ? athlete.owner_id : null) ??
          (type === 'group' && group ? group.owner_id : null) ??
          getOwnerId();
        const insertData: Record<string, unknown> = {
          week_start: selectedDate,
          is_group_plan: type === 'group',
          owner_id: hostOwnerId,
          last_edited_by_coach_id: getOwnerId(),
        };

        if (type === 'individual' && athlete) {
          insertData.athlete_id = athlete.id;
          insertData.group_id = null;
        } else if (type === 'group' && group) {
          insertData.group_id = group.id;
          insertData.athlete_id = null;
        }

        const { data: newPlan, error: createError } = await supabase
          .from('week_plans')
          .insert([insertData])
          .select()
          .single();

        if (createError) {
          if (createError.code === '23505') {
            const { data: retryPlan, error: retryError } = await query.maybeSingle();
            if (retryError) throw retryError;
            if (retryPlan) {
              plan = retryPlan;
            } else {
              throw createError;
            }
          } else {
            throw createError;
          }
        } else {
          plan = newPlan;
        }
      }

      setWeekPlan(plan);
      return plan;
    } catch (err) {
      const msg = (err as { message?: string })?.message || 'Failed to load week plan';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const fetchPlannedExercises = async (weekPlanId: string, dayLabels?: Record<number, string> | null) => {
    try {
      const { data, error } = await supabase
        .from('planned_exercises')
        .select(`*, exercise:exercise_id(*)`)
        .eq('weekplan_id', weekPlanId)
        .order('day_index')
        .order('position');
      if (error) throw error;

      const grouped: Record<number, (PlannedExercise & { exercise: Exercise })[]> = {};

      if (dayLabels) {
        Object.keys(dayLabels).forEach(key => {
          grouped[parseInt(key)] = [];
        });
      } else {
        DAYS_OF_WEEK.forEach(day => {
          grouped[day.index] = [];
        });
      }

      const rows = (data ?? []) as unknown as Array<PlannedExercise & { exercise: Exercise }>;
      rows.forEach(item => {
        if (!grouped[item.day_index]) {
          grouped[item.day_index] = [];
        }
        grouped[item.day_index].push(item);
      });

      setPlannedExercises(grouped);

      // Load combo members for any is_combo exercises
      const comboExs = rows.filter(e => e.is_combo);
      if (comboExs.length > 0) {
        const { data: members } = await supabase
          .from('planned_exercise_combo_members')
          .select('*, exercise:exercise_id(*)')
          .in('planned_exercise_id', comboExs.map(e => e.id))
          .order('position');
        const membersMap: Record<string, ComboMemberEntry[]> = {};
        type MemberRow = { planned_exercise_id: string; exercise_id: string; position: number; exercise: Exercise };
        ((members || []) as unknown as MemberRow[]).forEach(m => {
          if (!membersMap[m.planned_exercise_id]) membersMap[m.planned_exercise_id] = [];
          membersMap[m.planned_exercise_id].push({
            exerciseId: m.exercise_id,
            exercise: m.exercise,
            position: m.position,
          });
        });
        setComboMembers(membersMap);
      } else {
        setComboMembers({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load planned exercises');
    }
  };

  // Kept for backward compat — combo members are now loaded in fetchPlannedExercises
  const fetchWeekCombos = async (_weekPlanId: string) => { /* no-op */ };

  const fetchMacroWeekTarget = async (athleteId: string, selectedDate: string) => {
    try {
      const { data: macrocycles, error: macroError } = await supabase
        .from('macrocycles')
        .select('id, start_date, end_date')
        .eq('athlete_id', athleteId)
        .lte('start_date', selectedDate)
        .gte('end_date', selectedDate);

      if (macroError) throw macroError;

      if (!macrocycles || macrocycles.length === 0) {
        setMacroWeekTarget(null);
        return;
      }

      const { data: macroWeeks, error: weekError } = await supabase
        .from('macro_weeks')
        .select('id, total_reps_target, week_type_text')
        .eq('macrocycle_id', macrocycles[0].id)
        .lte('week_start', selectedDate)
        .gte('week_start', new Date(new Date(selectedDate).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('week_start', { ascending: false })
        .limit(1);

      const macroWeek = macroWeeks && macroWeeks.length > 0 ? macroWeeks[0] : null;
      if (weekError) throw weekError;

      setMacroWeekTarget(macroWeek?.total_reps_target || null);
      setMacroWeekTypeText(macroWeek?.week_type_text || null);
    } catch (err) {
      setMacroWeekTarget(null);
      setMacroWeekTypeText(null);
    }
  };

  const fetchAthletePRs = async (athleteId: string) => {
    try {
      const { data, error } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('athlete_id', athleteId);
      if (error) throw error;
      setAthletePRs(data || []);
    } catch (err) {
      setAthletePRs([]);
    }
  };

  const deletePlannedExercise = async (id: string) => {
    try {
      const { error } = await supabase.from('planned_exercises').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete exercise');
      throw err;
    }
  };

  /**
   * Delete the entire week's prescription (all planned exercises) EXCEPT any
   * planned exercise an athlete has already logged against. Logged elements —
   * and the training_log_* rows that reference them — are left untouched, so
   * the planned-vs-performed record for completed training stays intact.
   * Returns how many were deleted vs. kept.
   */
  const deleteWeekPrescription = async (
    weekPlanId: string,
  ): Promise<{ deleted: number; kept: number }> => {
    const { data: planned, error: planErr } = await supabase
      .from('planned_exercises')
      .select('id')
      .eq('weekplan_id', weekPlanId);
    if (planErr) throw planErr;
    const allIds = (planned ?? []).map((p: { id: string }) => p.id);
    if (allIds.length === 0) return { deleted: 0, kept: 0 };

    // Planned exercises that have been logged against — keep these.
    const { data: logged, error: logErr } = await supabase
      .from('training_log_exercises')
      .select('planned_exercise_id')
      .in('planned_exercise_id', allIds);
    if (logErr) throw logErr;
    const loggedIds = new Set(
      (logged ?? [])
        .map((l: { planned_exercise_id: string | null }) => l.planned_exercise_id)
        .filter((id): id is string => !!id),
    );

    const toDelete = allIds.filter(id => !loggedIds.has(id));
    if (toDelete.length === 0) return { deleted: 0, kept: allIds.length };

    // Clear children explicitly (cascade-safe), then the planned exercises.
    await supabase.from('planned_set_lines').delete().in('planned_exercise_id', toDelete);
    await supabase.from('planned_exercise_combo_members').delete().in('planned_exercise_id', toDelete);
    const { error: delErr } = await supabase.from('planned_exercises').delete().in('id', toDelete);
    if (delErr) throw delErr;

    return { deleted: toDelete.length, kept: allIds.length - toDelete.length };
  };

  const updateWeekPlan = async (id: string, updates: Partial<WeekPlan>) => {
    try {
      // No owner_id pre-check: co-coaches editing a shared athlete's week
      // plan need to be able to update the host's row. The athlete-list
      // filter (athleteStore.athletes) is the access gate — if a coach
      // can see the week plan in the UI they can edit it. Real isolation
      // will come with RLS in the auth phase.
      const { error } = await supabase
        .from('week_plans')
        .update({ ...updates, last_edited_by_coach_id: getOwnerId() })
        .eq('id', id);
      if (error) throw error;
      setWeekPlan(prev => prev ? { ...prev, ...updates } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update week plan');
      throw err;
    }
  };

  const reorderExercises = async (_weekPlanId: string, orderedIds: string[]) => {
    await Promise.all(
      orderedIds.map((id, i) => supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', id))
    );
  };

  const moveExercise = async (
    weekPlanId: string,
    exerciseId: string,
    fromDayIndex: number,
    toDayIndex: number,
  ) => {
    const { data: toExercises } = await supabase
      .from('planned_exercises')
      .select('id')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', toDayIndex);

    const newToPosition = (toExercises?.length ?? 0) + 1;

    await supabase
      .from('planned_exercises')
      .update({ day_index: toDayIndex, position: newToPosition })
      .eq('id', exerciseId);

    await Promise.all([
      normalizePositions(weekPlanId, fromDayIndex),
      normalizePositions(weekPlanId, toDayIndex),
    ]);
  };

  /** Reorder one exercise within its day so it lands at `targetIndex` (0-based)
   *  relative to the existing siblings, shifting others. Used after a cross-day
   *  drop to honour the visual drop position instead of always appending. */
  const reorderInDay = async (
    weekPlanId: string,
    dayIndex: number,
    exerciseId: string,
    targetIndex: number,
  ) => {
    const { data } = await supabase
      .from('planned_exercises')
      .select('id, position')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', dayIndex)
      .order('position');
    if (!data) return;
    const ids = data.map(d => d.id);
    const currentIdx = ids.indexOf(exerciseId);
    if (currentIdx < 0) return;
    ids.splice(currentIdx, 1);
    const clamped = Math.max(0, Math.min(ids.length, targetIndex));
    ids.splice(clamped, 0, exerciseId);
    await Promise.all(
      ids.map((id, i) => supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', id)),
    );
  };

  const normalizePositions = async (weekPlanId: string, dayIndex: number) => {
    const { data: exData } = await supabase
      .from('planned_exercises')
      .select('id, position')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', dayIndex)
      .order('position');

    const items = (exData || []).sort((a, b) => a.position - b.position);
    await Promise.all(
      items.map((item, i) => supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', item.id))
    );
  };

  // --- Set line operations ---

  const fetchSetLines = async (plannedExerciseId: string): Promise<PlannedSetLine[]> => {
    const { data, error } = await supabase
      .from('planned_set_lines')
      .select('*')
      .eq('planned_exercise_id', plannedExerciseId)
      .order('position');
    if (error) throw error;
    return data || [];
  };

  const addSetLine = async (
    plannedExerciseId: string,
    position: number,
  ): Promise<PlannedSetLine> => {
    const { data, error } = await supabase
      .from('planned_set_lines')
      .insert([{ planned_exercise_id: plannedExerciseId, sets: 3, reps: 3, load_value: 0, position }])
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const deleteSetLine = async (lineId: string): Promise<void> => {
    const { error } = await supabase.from('planned_set_lines').delete().eq('id', lineId);
    if (error) throw error;
  };

  const normalizeSetLinePositions = async (lines: PlannedSetLine[]): Promise<void> => {
    await Promise.all(
      lines
        .map((line, i) => ({ line, newPos: i + 1 }))
        .filter(({ line, newPos }) => line.position !== newPos)
        .map(({ line, newPos }) => supabase.from('planned_set_lines').update({ position: newPos }).eq('id', line.id))
    );
  };

  const saveSetLinesWithSummary = async (
    plannedExerciseId: string,
    setLines: PlannedSetLine[],
  ): Promise<void> => {
    await Promise.all(
      setLines.map(line =>
        supabase
          .from('planned_set_lines')
          .update({ sets: line.sets, reps: line.reps, load_value: line.load_value })
          .eq('id', line.id)
      )
    );

    const total_sets = setLines.reduce((sum, l) => sum + l.sets, 0);
    const total_reps = setLines.reduce((sum, l) => sum + l.sets * l.reps, 0);
    const highest_load = setLines.length > 0 ? Math.max(...setLines.map(l => l.load_value)) : null;
    const weighted = setLines.reduce((sum, l) => sum + l.load_value * l.sets * l.reps, 0);
    const avg_load = total_reps > 0 ? weighted / total_reps : null;

    await supabase
      .from('planned_exercises')
      .update({ summary_total_sets: total_sets, summary_total_reps: total_reps, summary_highest_load: highest_load, summary_avg_load: avg_load })
      .eq('id', plannedExerciseId);
  };

  // Locate an exercise's display name and day within the currently loaded
  // week so a draft can be labelled in the restore banner.
  const findExerciseContext = (
    plannedExId: string,
  ): { name: string; dayIndex: number | null; weekPlanId: string | null } => {
    for (const [dayIdx, list] of Object.entries(plannedExercises)) {
      const ex = list.find(e => e.id === plannedExId);
      if (ex) return { name: ex.exercise?.name ?? 'Exercise', dayIndex: Number(dayIdx), weekPlanId: weekPlan?.id ?? null };
    }
    return { name: 'Exercise', dayIndex: null, weekPlanId: weekPlan?.id ?? null };
  };

  // Internal: replace an exercise's set lines with `lines` (positions 1..n).
  //
  // Uses upsert-on-conflict + tail-delete instead of delete-all + insert. The
  // old pattern was not atomic: a burst of overlapping writes for the same
  // exercise could interleave as delete/delete/insert/insert, and the second
  // insert collided on the (planned_exercise_id, position) unique constraint
  // (Postgres 23505). Upserting on that exact constraint converges the rows
  // last-write-wins instead of throwing, so the crash can't happen even if the
  // per-exercise serialization in savePrescription is bypassed (e.g. a second
  // tab editing the same exercise). The tail-delete trims any rows left over
  // when the new prescription has fewer lines than the old one.
  //
  // Every line carries the full column set (reps_text/load_max defaulted to
  // null) so an upsert UPDATE always overwrites a row's previous shape — e.g.
  // a line that used to be a combo member won't keep a stale reps_text.
  const replaceSetLines = async (
    plannedExId: string,
    lines: Array<Record<string, unknown>>,
  ): Promise<void> => {
    if (lines.length > 0) {
      const { error: upsertError } = await supabase
        .from('planned_set_lines')
        .upsert(lines, { onConflict: 'planned_exercise_id,position' });
      if (upsertError) throw upsertError;
    }
    const { error: trimError } = await supabase
      .from('planned_set_lines')
      .delete()
      .eq('planned_exercise_id', plannedExId)
      .gt('position', lines.length);
    if (trimError) throw trimError;
  };

  // Internal: performs the actual Supabase writes for a prescription. Wrapped
  // by savePrescription, which adds local-draft safety around it.
  const writePrescription = async (
    plannedExId: string,
    data: { prescription: string; unit: DefaultUnit; isCombo?: boolean },
  ): Promise<void> => {
    const { prescription, unit, isCombo } = data;
    const isFreeText = unit === 'free_text';
    const isOtherUnit = unit === 'other';
    const isFreeTextReps = unit === 'free_text_reps';
    const isNonNumeric = isFreeText || isOtherUnit;

    // Summary (sets/reps/loads) is computed by the single shared helper so the
    // stored cache always matches what the counting layer would derive.
    const summary = computePrescriptionSummary(prescription, unit, !!isCombo);
    const summaryUpdate = {
      prescription_raw: prescription,
      unit,
      summary_total_sets: summary.total_sets,
      summary_total_reps: summary.total_reps,
      summary_highest_load: summary.highest_load,
      summary_avg_load: summary.avg_load,
    };

    if (isCombo) {
      const parsed = parseComboPrescription(prescription);
      const lines = parsed.map((line, idx) => ({
        planned_exercise_id: plannedExId,
        sets: line.sets,
        reps: line.totalReps,
        reps_text: line.repsText,
        load_value: line.load,
        load_max: line.loadMax ?? null,
        position: idx + 1,
      }));
      await replaceSetLines(plannedExId, lines);
      await supabase.from('planned_exercises').update(summaryUpdate).eq('id', plannedExId);
      return;
    }

    const parsed = isNonNumeric ? [] : parsePrescription(prescription);
    const hasNumericLines = parsed.length > 0 && !isNonNumeric && !isFreeTextReps;
    const lines = hasNumericLines
      ? parsed.map((line, idx) => ({
          planned_exercise_id: plannedExId,
          sets: line.sets,
          reps: line.reps,
          reps_text: null,
          load_value: line.load,
          load_max: line.loadMax ?? null,
          position: idx + 1,
        }))
      : [];
    await replaceSetLines(plannedExId, lines);
    await supabase.from('planned_exercises').update(summaryUpdate).eq('id', plannedExId);
    // Promote group-sourced exercise to individual when coach edits it
    await supabase.from('planned_exercises').update({ source: 'individual' }).eq('id', plannedExId).eq('source', 'group');
  };

  // Public entry point for persisting a prescription. Mirrors the edit to a
  // localStorage draft BEFORE the destructive write so a dropped connection
  // mid-save can't lose the coach's typing, then clears the draft only after
  // the write fully succeeds. A surviving draft therefore always means "this
  // edit was never confirmed saved" — surfaced on next load for restore.
  const savePrescription = async (
    plannedExId: string,
    data: { prescription: string; unit: DefaultUnit; isCombo?: boolean },
  ): Promise<void> => {
    const ctx = findExerciseContext(plannedExId);
    const draftWeekPlanId = weekPlan?.id ?? ctx.weekPlanId;
    if (draftWeekPlanId) {
      recordPrescriptionDraft({
        plannedExId,
        weekPlanId: draftWeekPlanId,
        exerciseName: ctx.name,
        dayIndex: ctx.dayIndex,
        prescription: data.prescription,
        unit: data.unit,
        isCombo: !!data.isCombo,
        updatedAt: Date.now(),
      });
    }
    // Optimistic + immediate: patch the in-memory row so summaries/totals
    // update live without a full refetch (which would remount the grid mid-edit
    // and revert keystrokes). The grid suppresses the prescription_raw echo
    // (sentRawsRef), so this never remounts it. Same computePrescriptionSummary
    // the write path uses, so the cached summary stays consistent.
    const summary = computePrescriptionSummary(data.prescription, data.unit, !!data.isCombo);
    setPlannedExercises(prev => {
      let changed = false;
      const next: Record<number, (PlannedExercise & { exercise: Exercise })[]> = {};
      for (const key of Object.keys(prev)) {
        const day = Number(key);
        next[day] = prev[day].map(ex => {
          if (ex.id !== plannedExId) return ex;
          changed = true;
          return {
            ...ex,
            prescription_raw: data.prescription,
            unit: data.unit,
            summary_total_sets: summary.total_sets,
            summary_total_reps: summary.total_reps,
            summary_highest_load: summary.highest_load,
            summary_avg_load: summary.avg_load,
          };
        });
      }
      return changed ? next : prev;
    });

    // Serialize the DB write per exercise: chain after any in-flight write so a
    // burst of clicks persists strictly in order. Returning the chained promise
    // keeps flushAndClose's await covering the whole pending chain, and lets
    // callers .catch() to resync on failure.
    const prevWrite = writeChainRef.current.get(plannedExId) ?? Promise.resolve();
    const run = () => writePrescription(plannedExId, data).then(() => clearPrescriptionDraft(plannedExId));
    const nextWrite = prevWrite.then(run, run);
    writeChainRef.current.set(plannedExId, nextWrite);
    await nextWrite;
  };

  const saveNotes = async (plannedExId: string, notes: string): Promise<void> => {
    const { error } = await supabase
      .from('planned_exercises')
      .update({ notes: notes.trim() || null })
      .eq('id', plannedExId);
    if (error) throw error;
    // Promote group-sourced exercise to individual when coach edits it
    await supabase.from('planned_exercises').update({ source: 'individual' }).eq('id', plannedExId).eq('source', 'group');
  };

  /**
   * Persist a GPP block payload on a planned_exercise row. The whole
   * GppSection replaces metadata.gpp; other metadata keys are left
   * untouched so future structured-content sentinels can share the bag.
   */
  const saveGppSection = async (
    plannedExId: string,
    gpp: import('../lib/database.types').GppSection,
  ): Promise<void> => {
    const { data: row, error: rErr } = await supabase
      .from('planned_exercises')
      .select('metadata')
      .eq('id', plannedExId)
      .single();
    if (rErr) throw rErr;
    const current = ((row as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>;
    const next = { ...current, gpp };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
    const update: any = { metadata: next };
    const { error } = await supabase
      .from('planned_exercises')
      .update(update)
      .eq('id', plannedExId);
    if (error) throw error;
    await supabase.from('planned_exercises').update({ source: 'individual' } as never).eq('id', plannedExId).eq('source', 'group');
  };

  /**
   * Persist a caption for an IMAGE / VIDEO sentinel on metadata.description.
   * Empty / whitespace-only strings clear the key so the JSON stays tidy.
   */
  const saveMediaDescription = async (
    plannedExId: string,
    description: string,
  ): Promise<void> => {
    const { data: row, error: rErr } = await supabase
      .from('planned_exercises')
      .select('metadata')
      .eq('id', plannedExId)
      .single();
    if (rErr) throw rErr;
    const current = ((row as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>;
    const next = { ...current };
    const trimmed = description.trim();
    if (trimmed) next.description = trimmed; else delete next.description;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
    const update: any = { metadata: next };
    const { error } = await supabase
      .from('planned_exercises')
      .update(update)
      .eq('id', plannedExId);
    if (error) throw error;
  };

  const fetchOtherDayPrescriptions = async (
    weekplanId: string,
    exerciseId: string,
    excludeId: string,
  ): Promise<{ dayIndex: number; prescriptionRaw: string | null; totalSets: number | null; totalReps: number | null }[]> => {
    const { data, error } = await supabase
      .from('planned_exercises')
      .select('day_index, prescription_raw, summary_total_sets, summary_total_reps')
      .eq('weekplan_id', weekplanId)
      .eq('exercise_id', exerciseId)
      .neq('id', excludeId);
    if (error) throw error;
    return (data || []).map(ex => ({
      dayIndex: ex.day_index,
      prescriptionRaw: ex.prescription_raw,
      totalSets: ex.summary_total_sets,
      totalReps: ex.summary_total_reps,
    }));
  };

  // --- Day-level exercise operations (used by DayColumn) ---

  const addExerciseToDay = async (
    weekPlanId: string,
    dayIndex: number,
    exerciseId: string,
    position: number,
    unit: DefaultUnit,
    extras?: {
      prescription_raw?: string | null;
      notes?: string | null;
      variation_note?: string | null;
      summary_total_sets?: number;
      summary_total_reps?: number;
      summary_highest_load?: number | null;
      summary_avg_load?: number | null;
      is_combo?: boolean;
      combo_notation?: string | null;
      combo_color?: string | null;
      source?: 'group' | 'individual' | null;
      /** Free-form payload. Currently carries GPP sections, sentinel
       *  descriptions, etc. — needs to round-trip on copy or the new row
       *  loses everything that lived under metadata.* (e.g. metadata.gpp). */
      metadata?: import('../lib/database.types').PlannedExerciseMetadata;
    },
  ): Promise<PlannedExercise & { id: string }> => {
    const { data, error } = await supabase
      .from('planned_exercises')
      .insert([{
        weekplan_id: weekPlanId,
        day_index: dayIndex,
        exercise_id: exerciseId,
        position,
        unit,
        summary_total_sets: extras?.summary_total_sets ?? 0,
        summary_total_reps: extras?.summary_total_reps ?? 0,
        summary_highest_load: extras?.summary_highest_load ?? null,
        summary_avg_load: extras?.summary_avg_load ?? null,
        prescription_raw: extras?.prescription_raw ?? null,
        notes: extras?.notes ?? null,
        variation_note: extras?.variation_note ?? null,
        is_combo: extras?.is_combo ?? false,
        combo_notation: extras?.combo_notation ?? null,
        combo_color: extras?.combo_color ?? null,
        source: extras?.source ?? null,
        // Only set metadata explicitly when a payload is supplied (copy
        // path). Otherwise let the DB default ('{}') stand — passing null
        // would violate the NOT NULL constraint on planned_exercises.metadata.
        ...(extras?.metadata != null ? { metadata: extras.metadata } : {}),
      }])
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const copyExerciseWithSetLines = async (
    sourceEx: PlannedExercise,
    weekPlanId: string,
    dayIndex: number,
    position: number,
  ): Promise<string> => {
    const newEx = await addExerciseToDay(weekPlanId, dayIndex, sourceEx.exercise_id, position, sourceEx.unit as DefaultUnit, {
      prescription_raw: sourceEx.prescription_raw,
      notes: sourceEx.notes,
      variation_note: sourceEx.variation_note,
      summary_total_sets: sourceEx.summary_total_sets ?? 0,
      summary_total_reps: sourceEx.summary_total_reps ?? 0,
      summary_highest_load: sourceEx.summary_highest_load,
      summary_avg_load: sourceEx.summary_avg_load,
      is_combo: sourceEx.is_combo,
      combo_notation: sourceEx.combo_notation,
      combo_color: sourceEx.combo_color,
      metadata: sourceEx.metadata as PlannedExerciseMetadata | undefined,
    });

    if (sourceEx.prescription_raw) {
      const { data: setLines } = await supabase
        .from('planned_set_lines')
        .select('*')
        .eq('planned_exercise_id', sourceEx.id);

      if (setLines && setLines.length > 0) {
        const { error: copyLinesError } = await supabase.from('planned_set_lines').insert(
          setLines.map(line => ({
            planned_exercise_id: newEx.id,
            sets: line.sets,
            reps: line.reps,
            reps_text: line.reps_text ?? null,
            load_value: line.load_value,
            load_max: line.load_max ?? null,
            position: line.position,
          }))
        );
        if (copyLinesError) throw copyLinesError;
      }
    }

    // Copy combo members if this is a combo exercise
    if (sourceEx.is_combo) {
      const { data: members } = await supabase
        .from('planned_exercise_combo_members')
        .select('exercise_id, position')
        .eq('planned_exercise_id', sourceEx.id)
        .order('position');

      if (members && members.length > 0) {
        const { error: copyMembersError } = await supabase.from('planned_exercise_combo_members').insert(
          members.map((m: { exercise_id: string; position: number }) => ({
            planned_exercise_id: newEx.id,
            exercise_id: m.exercise_id,
            position: m.position,
          }))
        );
        if (copyMembersError) throw copyMembersError;
      }
    }

    return newEx.id;
  };

  const createComboExercise = async (
    weekPlanId: string,
    dayIndex: number,
    position: number,
    data: {
      exercises: { exercise: Exercise; position: number }[];
      unit: DefaultUnit;
      comboName: string;
      color: string;
    },
  ): Promise<void> => {
    const autoNotation = data.exercises.map(e => e.exercise.name).join(' + ');
    const { data: comboEx, error } = await supabase
      .from('planned_exercises')
      .insert({
        weekplan_id: weekPlanId,
        day_index: dayIndex,
        exercise_id: data.exercises[0].exercise.id,
        position,
        unit: data.unit,
        is_combo: true,
        combo_notation: data.comboName || autoNotation,
        combo_color: data.color,
        summary_total_sets: 0,
        summary_total_reps: 0,
      })
      .select()
      .single();
    if (error) throw error;

    if (data.exercises.length > 0) {
      const { error: membersError } = await supabase.from('planned_exercise_combo_members').insert(
        data.exercises.map(part => ({
          planned_exercise_id: comboEx.id,
          exercise_id: part.exercise.id,
          position: part.position,
        }))
      );
      if (membersError) throw membersError;
    }
  };

  // Swap the exercise on a single (non-combo) planned exercise. Keeps
  // prescription, notes, unit, sets, etc. — just updates the exercise_id.
  const swapPlannedExercise = async (plannedExerciseId: string, newExerciseId: string): Promise<void> => {
    const { error } = await supabase
      .from('planned_exercises')
      .update({ exercise_id: newExerciseId })
      .eq('id', plannedExerciseId);
    if (error) throw error;
  };

  // Re-save a combo's member list and metadata in place. Preserves the row's
  // prescription, notes, unit, day/position, but updates the exercises that
  // make up the combo, plus name/color/unit chosen in the editor.
  const updateComboExercise = async (
    plannedExerciseId: string,
    data: {
      exercises: { exercise: Exercise; position: number }[];
      unit: DefaultUnit;
      comboName: string;
      color: string;
    },
  ): Promise<void> => {
    if (data.exercises.length === 0) return;
    const autoNotation = data.exercises.map(e => e.exercise.name).join(' + ');

    const { error: updateErr } = await supabase
      .from('planned_exercises')
      .update({
        exercise_id: data.exercises[0].exercise.id,
        unit: data.unit,
        combo_notation: data.comboName || autoNotation,
        combo_color: data.color,
      })
      .eq('id', plannedExerciseId);
    if (updateErr) throw updateErr;

    const { error: deleteErr } = await supabase
      .from('planned_exercise_combo_members')
      .delete()
      .eq('planned_exercise_id', plannedExerciseId);
    if (deleteErr) throw deleteErr;

    const { error: insertErr } = await supabase
      .from('planned_exercise_combo_members')
      .insert(
        data.exercises.map(part => ({
          planned_exercise_id: plannedExerciseId,
          exercise_id: part.exercise.id,
          position: part.position,
        }))
      );
    if (insertErr) throw insertErr;
  };

  const copyDayExercises = async (
    sourceExercises: PlannedExercise[],
    targetWeekPlanId: string,
    targetDayIndex: number,
    basePosition: number,
  ): Promise<void> => {
    for (let i = 0; i < sourceExercises.length; i++) {
      await copyExerciseWithSetLines(sourceExercises[i], targetWeekPlanId, targetDayIndex, basePosition + i);
    }
  };

  /** Re-insert a frozen snapshot (taken by the canvas, a template, etc.) into
   *  a week plan's day. Mirrors copyExerciseWithSetLines but reads from an
   *  in-memory blob rather than another Supabase row — so the canvas can drop
   *  items back without round-tripping to the original planned_exercise row,
   *  which may have been deleted in the meantime. */
  const insertExerciseSnapshot = async (
    snapshot: {
      exercise_id: string;
      unit: string;
      prescription_raw: string | null;
      notes: string | null;
      variation_note: string | null;
      summary_total_sets: number;
      summary_total_reps: number;
      summary_highest_load: number | null;
      summary_avg_load: number | null;
      is_combo: boolean;
      combo_notation: string | null;
      combo_color: string | null;
      metadata: Record<string, unknown> | null;
      set_lines: {
        sets: number;
        reps: number;
        reps_text: string | null;
        load_value: number;
        load_max: number | null;
        position: number;
      }[];
      combo_members: { exercise_id: string; position: number }[];
    },
    weekPlanId: string,
    dayIndex: number,
    position: number,
    extras?: { source?: 'group' | 'individual' | null },
  ): Promise<string> => {
    const newEx = await addExerciseToDay(
      weekPlanId,
      dayIndex,
      snapshot.exercise_id,
      position,
      snapshot.unit as DefaultUnit,
      {
        prescription_raw: snapshot.prescription_raw,
        notes: snapshot.notes,
        variation_note: snapshot.variation_note,
        summary_total_sets: snapshot.summary_total_sets,
        summary_total_reps: snapshot.summary_total_reps,
        summary_highest_load: snapshot.summary_highest_load,
        summary_avg_load: snapshot.summary_avg_load,
        is_combo: snapshot.is_combo,
        combo_notation: snapshot.combo_notation,
        combo_color: snapshot.combo_color,
        metadata: snapshot.metadata as PlannedExerciseMetadata | undefined,
        source: extras?.source ?? null,
      },
    );

    if (snapshot.set_lines.length > 0) {
      const { error: linesErr } = await supabase.from('planned_set_lines').insert(
        snapshot.set_lines.map(line => ({
          planned_exercise_id: newEx.id,
          sets: line.sets,
          reps: line.reps,
          reps_text: line.reps_text,
          load_value: line.load_value,
          load_max: line.load_max,
          position: line.position,
        })),
      );
      if (linesErr) throw linesErr;
    }

    if (snapshot.is_combo && snapshot.combo_members.length > 0) {
      const { error: membersErr } = await supabase.from('planned_exercise_combo_members').insert(
        snapshot.combo_members.map(m => ({
          planned_exercise_id: newEx.id,
          exercise_id: m.exercise_id,
          position: m.position,
        })),
      );
      if (membersErr) throw membersErr;
    }

    return newEx.id;
  };

  const deleteDayExercises = async (exerciseIds: string[]): Promise<void> => {
    if (exerciseIds.length === 0) return;
    const { error: delLinesError } = await supabase.from('planned_set_lines').delete().in('planned_exercise_id', exerciseIds);
    if (delLinesError) throw delLinesError;
    const { error: delExError } = await supabase.from('planned_exercises').delete().in('id', exerciseIds);
    if (delExError) throw delExError;
  };

  const fetchExercisesForDay = async (weekPlanId: string, dayIndex: number): Promise<PlannedExercise[]> => {
    const { data, error } = await supabase
      .from('planned_exercises')
      .select('*')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', dayIndex)
      .order('position');
    if (error) throw error;
    return data || [];
  };

  const updateItemPosition = async (_table: 'planned_exercises', id: string, position: number): Promise<void> => {
    await supabase.from('planned_exercises').update({ position }).eq('id', id);
  };

  const fetchExerciseByCode = async (code: string): Promise<Exercise | null> => {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .eq('exercise_code', code)
      .maybeSingle();
    return data || null;
  };

  const fetchPlannedExerciseById = async (id: string): Promise<PlannedExercise | null> => {
    const { data } = await supabase
      .from('planned_exercises')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return data || null;
  };

  const fetchWeekPlanForAthlete = async (athleteId: string, weekStart: string): Promise<WeekPlan | null> => {
    // No owner_id filter: athlete_id is the access boundary and a shared
    // athlete's plan is owned by the host coach. Co-coaches must read the
    // host's row, not look for one under their own id.
    const { data, error } = await supabase
      .from('week_plans')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  const fetchWeekPlanForGroup = async (groupId: string, weekStart: string): Promise<WeekPlan | null> => {
    const { data, error } = await supabase
      .from('week_plans')
      .select('*')
      .eq('group_id', groupId)
      .is('athlete_id', null)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  const fetchPlannedExercisesFlat = async (weekPlanId: string): Promise<(PlannedExercise & { exercise: Exercise })[]> => {
    const { data, error } = await supabase
      .from('planned_exercises')
      .select(`*, exercise:exercises(*)`)
      .eq('weekplan_id', weekPlanId)
      .order('day_index')
      .order('position');
    if (error) throw error;
    return (data ?? []) as unknown as (PlannedExercise & { exercise: Exercise })[];
  };

  /**
   * Sync a group week plan to all active members of the group.
   * For each athlete, existing `source='group'` exercises are replaced with
   * a fresh copy from the group plan. Exercises the athlete has individually
   * overridden (`source='individual'`) are left untouched.
   */
  const syncGroupPlanToAthletes = async (groupPlanId: string, groupId: string, weekStart: string): Promise<void> => {
    // 0. Fetch group plan metadata (active_days, day_labels, day_schedule)
    // These define which training units exist in the group plan — we must merge them into each
    // athlete plan so that units like "Extra" are visible even if not previously in the athlete's plan.
    const { data: groupPlanMeta, error: metaError } = await supabase
      .from('week_plans')
      .select('owner_id, active_days, day_labels, day_schedule')
      .eq('id', groupPlanId)
      .single();
    if (metaError) throw metaError;
    const groupActiveDays: number[] = groupPlanMeta?.active_days ?? [];
    const groupDayLabels: Record<string, string> = groupPlanMeta?.day_labels ?? {};
    const groupDaySchedule: Record<string, { weekday: number; time: string | null }> = groupPlanMeta?.day_schedule ?? {};

    // The group plan's own owner_id is the group's host coach. Used only as a
    // fallback owner for member athletes whose own owner can't be resolved
    // (see ownerByAthleteId below) — never as the active (possibly co-coach)
    // owner, which is what previously caused cross-owner duplicate-key aborts.
    const hostOwnerId: string = groupPlanMeta?.owner_id ?? getOwnerId();

    // 1. Fetch group plan exercises
    const { data: groupExercises, error: exError } = await supabase
      .from('planned_exercises')
      .select('*')
      .eq('weekplan_id', groupPlanId)
      .order('day_index')
      .order('position');
    if (exError) throw exError;

    // 2. Fetch group plan set lines
    const groupExIds = (groupExercises || []).map(e => e.id);
    const { data: groupSetLinesData } = groupExIds.length > 0
      ? await supabase.from('planned_set_lines').select('*').in('planned_exercise_id', groupExIds)
      : { data: [] as PlannedSetLine[] };
    const groupSetLines = (groupSetLinesData ?? []) as unknown as PlannedSetLine[];
    const setLinesByExId = new Map<string, PlannedSetLine[]>();
    groupSetLines.forEach(l => {
      const arr = setLinesByExId.get(l.planned_exercise_id) || [];
      arr.push(l);
      setLinesByExId.set(l.planned_exercise_id, arr);
    });

    // 2b. Fetch combo members for group combos. Without these, combo
    // exercises arrive on athletes as a header with no member rows — the
    // notation renders but the per-member colour dots and the per-member
    // PR lookup both break.
    const groupComboIds = (groupExercises || []).filter(e => e.is_combo).map(e => e.id);
    const { data: groupComboMembers } = groupComboIds.length > 0
      ? await supabase
          .from('planned_exercise_combo_members')
          .select('planned_exercise_id, exercise_id, position')
          .in('planned_exercise_id', groupComboIds)
      : { data: [] };
    const comboMembersByExId = new Map<string, { exercise_id: string; position: number }[]>();
    (groupComboMembers || []).forEach((m: { planned_exercise_id: string; exercise_id: string; position: number }) => {
      const arr = comboMembersByExId.get(m.planned_exercise_id) || [];
      arr.push({ exercise_id: m.exercise_id, position: m.position });
      comboMembersByExId.set(m.planned_exercise_id, arr);
    });

    // 3. Fetch group members (active only)
    const { data: members, error: memError } = await supabase
      .from('group_members')
      .select('athlete_id')
      .eq('group_id', groupId)
      .is('left_at', null);
    if (memError) throw memError;

    // Each athlete's plan lives under THAT athlete's host coach, which may
    // differ from the group's host: a co-edited group (e.g. a competition
    // squad shared between two coaches) can contain athletes owned by
    // different coaches. Resolve each member's owner so a new plan is created
    // under the correct host — creating it under the wrong owner collides
    // with the (athlete_id, week_start) unique index and aborts the sync.
    const memberAthleteIds = (members || []).map(m => m.athlete_id);
    const ownerByAthleteId = new Map<string, string>();
    if (memberAthleteIds.length > 0) {
      const { data: athleteRows, error: athErr } = await supabase
        .from('athletes')
        .select('id, owner_id')
        .in('id', memberAthleteIds);
      if (athErr) throw athErr;
      (athleteRows || []).forEach((a: { id: string; owner_id: string }) => ownerByAthleteId.set(a.id, a.owner_id));
    }

    for (const member of members || []) {
      const athleteId = member.athlete_id;
      // Owner of THIS athlete's plan. Falls back to the group host, then the
      // active coach, only if the athlete row somehow lacks an owner.
      const athleteOwnerId: string = ownerByAthleteId.get(athleteId) ?? hostOwnerId;

      // 4a. Get or create athlete's week plan.
      // Do NOT filter by owner_id (or group_id) here: the (athlete_id,
      // week_start) unique index guarantees at most one individual plan per
      // athlete per week regardless of owner, so we must find ANY existing
      // plan first. Filtering by owner misses a plan owned by the athlete's
      // host (≠ the active coach when syncing a shared/co-edited group) and
      // would trigger a duplicate-key insert that aborts the whole sync.
      const { data: existingPlan } = await supabase
        .from('week_plans')
        .select('id')
        .eq('athlete_id', athleteId)
        .eq('week_start', weekStart)
        .maybeSingle();

      let athletePlanId: string;
      if (existingPlan) {
        athletePlanId = existingPlan.id;
      } else {
        const { data: newPlan, error: createError } = await supabase
          .from('week_plans')
          .insert([{ week_start: weekStart, athlete_id: athleteId, group_id: null, is_group_plan: false, owner_id: athleteOwnerId }])
          .select('id')
          .single();
        if (createError) {
          if (createError.code === '23505') {
            // Race condition: plan was created between our check and insert — fetch it
            const { data: racePlan } = await supabase
              .from('week_plans')
              .select('id')
              .eq('athlete_id', athleteId)
              .eq('week_start', weekStart)
              .maybeSingle();
            if (!racePlan) throw createError;
            athletePlanId = racePlan.id;
          } else {
            throw createError;
          }
        } else {
          athletePlanId = newPlan.id;
        }
      }

      // 4b. Merge group plan structure into athlete plan.
      // Fetch athlete's current active_days/labels/schedule so we can merge without overwriting their data.
      const { data: athletePlanMeta } = await supabase
        .from('week_plans')
        .select('active_days, day_labels, day_schedule')
        .eq('id', athletePlanId)
        .single();
      const athleteActiveDays: number[] = athletePlanMeta?.active_days ?? [];
      const athleteDayLabels: Record<string, string> = athletePlanMeta?.day_labels ?? {};
      const athleteDaySchedule: Record<string, { weekday: number; time: string | null }> = athletePlanMeta?.day_schedule ?? {};

      // Add any group training units the athlete plan doesn't already have
      const newDays = groupActiveDays.filter(d => !athleteActiveDays.includes(d));
      if (newDays.length > 0) {
        const mergedActiveDays = [...athleteActiveDays, ...newDays];
        const mergedLabels = { ...athleteDayLabels };
        const mergedSchedule = { ...athleteDaySchedule };
        for (const d of newDays) {
          const key = String(d);
          if (groupDayLabels[key]) mergedLabels[key] = groupDayLabels[key];
          if (groupDaySchedule[key]) mergedSchedule[key] = groupDaySchedule[key];
        }
        await supabase.from('week_plans').update({
          active_days: mergedActiveDays,
          day_labels: mergedLabels,
          day_schedule: mergedSchedule,
          source_group_plan_id: groupPlanId,
        }).eq('id', athletePlanId);
      } else {
        // No new units — still track source group plan
        await supabase.from('week_plans').update({ source_group_plan_id: groupPlanId }).eq('id', athletePlanId);
      }

      // 4c. Decide which existing group-sourced exercises to delete.
      // We preserve any planned_exercise the athlete has already logged
      // against — wiping it would (a) orphan the log via ON DELETE SET
      // NULL on training_log_exercises.planned_exercise_id and (b) destroy
      // the prescription the athlete actually executed. "Logged" =
      // training_log_exercises row exists; the athlete app only inserts
      // those when the athlete saves a set or marks the exercise done.
      const { data: existingGroupExs } = await supabase
        .from('planned_exercises')
        .select('id, exercise_id, day_index')
        .eq('weekplan_id', athletePlanId)
        .eq('source', 'group');
      const existingGroupRows = (existingGroupExs || []) as {
        id: string;
        exercise_id: string;
        day_index: number;
      }[];
      const existingGroupIds = existingGroupRows.map(e => e.id);

      const protectedIds = new Set<string>();
      if (existingGroupIds.length > 0) {
        const { data: loggedRefs } = await supabase
          .from('training_log_exercises')
          .select('planned_exercise_id')
          .in('planned_exercise_id', existingGroupIds);
        ((loggedRefs || []) as { planned_exercise_id: string | null }[]).forEach(r => {
          if (r.planned_exercise_id) protectedIds.add(r.planned_exercise_id);
        });
      }

      // Keyed by (exercise_id:day_index) so we can also skip re-inserting
      // a fresh copy of a slot the athlete already worked through.
      const protectedKeys = new Set(
        existingGroupRows
          .filter(e => protectedIds.has(e.id))
          .map(e => `${e.exercise_id}:${e.day_index}`)
      );

      const toDelete = existingGroupRows
        .filter(e => !protectedIds.has(e.id))
        .map(e => e.id);
      if (toDelete.length > 0) {
        await supabase.from('planned_set_lines').delete().in('planned_exercise_id', toDelete);
        await supabase.from('planned_exercises').delete().in('id', toDelete);
      }

      // 4d. Insert copies of group exercises, skipping any that have an
      // individual override OR a logged-protected counterpart from 4c.
      const { data: individualExs } = await supabase
        .from('planned_exercises')
        .select('exercise_id, day_index')
        .eq('weekplan_id', athletePlanId)
        .eq('source', 'individual');
      const individualOverrides = new Set(
        (individualExs || []).map((e: { exercise_id: string; day_index: number }) => `${e.exercise_id}:${e.day_index}`)
      );

      // Collect exercises to copy (excluding individual overrides and
      // already-logged group slots we just kept in place).
      const exsToCopy = (groupExercises || []).filter(
        ex =>
          !individualOverrides.has(`${ex.exercise_id}:${ex.day_index}`) &&
          !protectedKeys.has(`${ex.exercise_id}:${ex.day_index}`)
      );

      if (exsToCopy.length > 0) {
        // Batch insert all exercises at once; track source group ex id per inserted row via order.
        // metadata and variation_note must round-trip: metadata holds GPP rows
        // (metadata.gpp) and IMAGE/VIDEO captions (metadata.description), and
        // variation_note carries the coach's per-row tweak text. Omitting them
        // here is what caused GPP rows to disappear on synced athletes.
        const { data: insertedExs, error: insError } = await supabase
          .from('planned_exercises')
          .insert(exsToCopy.map(ex => ({
            weekplan_id: athletePlanId,
            exercise_id: ex.exercise_id,
            day_index: ex.day_index,
            position: ex.position,
            unit: ex.unit,
            prescription_raw: ex.prescription_raw,
            notes: ex.notes,
            variation_note: ex.variation_note ?? null,
            summary_total_sets: ex.summary_total_sets,
            summary_total_reps: ex.summary_total_reps,
            summary_highest_load: ex.summary_highest_load,
            summary_avg_load: ex.summary_avg_load,
            is_combo: ex.is_combo,
            combo_notation: ex.combo_notation,
            combo_color: ex.combo_color,
            // planned_exercises.metadata is NOT NULL with default '{}'::jsonb,
            // so coerce a missing/null source to {} rather than violating
            // the constraint.
            metadata: (ex.metadata ?? {}) as PlannedExerciseMetadata,
            source: 'group' as const,
          })))
          .select('id');
        if (insError) throw insError;

        // Batch insert all set lines for all newly inserted exercises
        type SetLineRow = { sets: number; reps: number; reps_text: string | null; load_value: number; load_max: number | null; position: number };
        const allSetLines: Array<SetLineRow & { planned_exercise_id: string }> = [];
        // Batch insert combo-member rows for any combo exercises we copied.
        // Without these, the athlete's plan sees a combo header pointing at a
        // single exercise_id (the lead lift) with no member list — combo
        // notation renders but per-member features (PR lookup, colour dots,
        // resolver) break.
        const allComboMembers: { planned_exercise_id: string; exercise_id: string; position: number }[] = [];
        (insertedExs || []).forEach((newEx, idx) => {
          const srcEx = exsToCopy[idx];
          const lines: SetLineRow[] = setLinesByExId.get(srcEx.id) || [];
          for (const l of lines) {
            allSetLines.push({
              planned_exercise_id: newEx.id,
              sets: l.sets,
              reps: l.reps,
              reps_text: l.reps_text ?? null,
              load_value: l.load_value,
              load_max: l.load_max ?? null,
              position: l.position,
            });
          }
          if (srcEx.is_combo) {
            const members = comboMembersByExId.get(srcEx.id) || [];
            for (const m of members) {
              allComboMembers.push({
                planned_exercise_id: newEx.id,
                exercise_id: m.exercise_id,
                position: m.position,
              });
            }
          }
        });
        if (allSetLines.length > 0) {
          const { error: linesError } = await supabase.from('planned_set_lines').insert(allSetLines);
          if (linesError) throw linesError;
        }
        if (allComboMembers.length > 0) {
          const { error: membersError } = await supabase
            .from('planned_exercise_combo_members')
            .insert(allComboMembers);
          if (membersError) throw membersError;
        }
      }
    }
  };

  /**
   * Promote a group-sourced exercise to an individual override.
   * The exercise will no longer be replaced on next group plan sync.
   */
  const promoteToIndividual = async (plannedExerciseId: string): Promise<void> => {
    const { error } = await supabase
      .from('planned_exercises')
      .update({ source: 'individual' })
      .eq('id', plannedExerciseId);
    if (error) throw error;
  };

  return {
    weekPlan,
    setWeekPlan,
    plannedExercises,
    setPlannedExercises,
    comboMembers,
    setComboMembers,
    athletePRs,
    setAthletePRs,
    macroWeekTarget,
    setMacroWeekTarget,
    macroWeekTypeText,
    setMacroWeekTypeText,
    loading,
    error,
    setError,
    fetchOrCreateWeekPlan,
    fetchPlannedExercises,
    fetchWeekCombos,
    fetchMacroWeekTarget,
    fetchAthletePRs,
    deletePlannedExercise,
    deleteWeekPrescription,
    updateWeekPlan,
    reorderExercises,
    moveExercise,
    reorderInDay,
    normalizePositions,
    fetchSetLines,
    addSetLine,
    deleteSetLine,
    normalizeSetLinePositions,
    saveSetLinesWithSummary,
    savePrescription,
    saveNotes,
    saveGppSection,
    saveMediaDescription,
    fetchOtherDayPrescriptions,
    addExerciseToDay,
    copyExerciseWithSetLines,
    copyDayExercises,
    insertExerciseSnapshot,
    deleteDayExercises,
    fetchExercisesForDay,
    updateItemPosition,
    fetchExerciseByCode,
    fetchPlannedExerciseById,
    fetchWeekPlanForAthlete,
    fetchWeekPlanForGroup,
    fetchPlannedExercisesFlat,
    createComboExercise,
    swapPlannedExercise,
    updateComboExercise,
    syncGroupPlanToAthletes,
    promoteToIndividual,
  };
}
