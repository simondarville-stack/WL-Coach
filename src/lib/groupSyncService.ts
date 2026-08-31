/**
 * groupSyncService — the group-plan → athlete-plans sync engine.
 *
 * Grown out of `useWeekPlans.syncGroupPlanToAthletes`, which synced every
 * member with one fixed rule. The Sync wizard needs two things that function
 * couldn't give: a **dry run** (what would this sync do to each athlete,
 * before committing?) and a **per-athlete mode**:
 *
 * - `'update'`  — the historical behaviour. Group-sourced rows are replaced
 *   with a fresh copy; the athlete's individual overrides (source =
 *   'individual') and anything already logged are left alone.
 * - `'overwrite'` — the group plan wins: individual overrides sitting on a
 *   slot the group also trains are replaced too. Logged rows are still
 *   untouchable in every mode — a prescription the athlete has executed is a
 *   record, not a draft (see Data integrity in CLAUDE.md).
 * - `'append'` — nothing existing is replaced or removed; only group
 *   exercises the athlete doesn't have yet are added. Unit labels/times the
 *   athlete already has also win over the group's in this mode.
 *
 * A "slot" is (exercise_id, day_index) — the same key the override check has
 * always used. The pure half (classification + per-mode outcome) lives in
 * `groupSyncModel.ts` so the preview, the execution and the unit tests share
 * one truth.
 */
import { supabase } from './supabase';
import { getOwnerId } from './ownerContext';
import type {
  PlannedExerciseMetadata,
  PlannedSetLine,
} from './database.types';
import { plannedRowLabel } from './plannedRowLabel';
import {
  mergeGroupStructureIntoAthlete,
  seedStructureFromGroup,
  type WeekStructure,
} from './groupPlanSync';
import {
  classifyAthleteRows,
  slotKey,
  type AthleteSyncClassification,
  type ClassifiableAthleteRow,
  type ClassifiableGroupRow,
  type ModeOutcome,
  type SyncMode,
} from './groupSyncModel';

export { outcomeForMode } from './groupSyncModel';
export type { SyncMode, ModeOutcome, AthleteSyncClassification, SyncSlot } from './groupSyncModel';

export interface AthleteSyncPreview extends AthleteSyncClassification {
  athleteId: string;
  athleteName: string;
  planExists: boolean;
}

export interface GroupSyncPreview {
  groupExerciseCount: number;
  athletes: AthleteSyncPreview[];
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

interface GroupPlanData {
  structure: WeekStructure;
  hostOwnerId: string;
  exercises: GroupExerciseRow[];
  setLinesByExId: Map<string, PlannedSetLine[]>;
  comboMembersByExId: Map<string, { exercise_id: string; position: number }[]>;
}

interface GroupExerciseRow {
  id: string;
  exercise_id: string;
  day_index: number;
  position: number;
  unit: string | null;
  prescription_raw: string | null;
  notes: string | null;
  variation_note: string | null;
  display_name: string | null;
  summary_total_sets: number | null;
  summary_total_reps: number | null;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
  is_combo: boolean;
  combo_notation: string | null;
  combo_color: string | null;
  metadata: PlannedExerciseMetadata | null;
  exercise: { name: string } | null;
}

const normalizePositions = async (weekPlanId: string): Promise<void> => {
  const { error } = await supabase.rpc('normalize_planned_exercise_positions', {
    p_weekplan_id: weekPlanId,
    p_day_index: null,
  });
  if (error) throw error;
};

const rowLabel = (row: { display_name: string | null; is_combo: boolean; combo_notation: string | null; exercise: { name: string } | null }) =>
  plannedRowLabel(
    { display_name: row.display_name, is_combo: row.is_combo, combo_notation: row.combo_notation },
    { exerciseName: row.exercise?.name },
  );

/**
 * Everything the sync needs from the GROUP side, fetched once.
 * Normalises the group plan's own positions first — the copies are written in
 * one batch insert per athlete, so a positional tie in the source would come
 * out in a different (id-random) order for each athlete.
 */
async function fetchGroupPlanData(groupPlanId: string): Promise<GroupPlanData> {
  const { data: meta, error: metaError } = await supabase
    .from('week_plans')
    .select('owner_id, active_days, day_labels, day_display_order, day_schedule')
    .eq('id', groupPlanId)
    .single();
  if (metaError) throw metaError;

  await normalizePositions(groupPlanId);

  const { data: exercises, error: exError } = await supabase
    .from('planned_exercises')
    .select('*, exercise:exercises(name)')
    .eq('weekplan_id', groupPlanId)
    .order('day_index')
    .order('position');
  if (exError) throw exError;
  const groupExercises = (exercises ?? []) as unknown as GroupExerciseRow[];

  const groupExIds = groupExercises.map(e => e.id);
  const { data: setLinesData } = groupExIds.length > 0
    ? await supabase.from('planned_set_lines').select('*').in('planned_exercise_id', groupExIds)
    : { data: [] as PlannedSetLine[] };
  const setLinesByExId = new Map<string, PlannedSetLine[]>();
  ((setLinesData ?? []) as unknown as PlannedSetLine[]).forEach(l => {
    const arr = setLinesByExId.get(l.planned_exercise_id) || [];
    arr.push(l);
    setLinesByExId.set(l.planned_exercise_id, arr);
  });

  const comboIds = groupExercises.filter(e => e.is_combo).map(e => e.id);
  const { data: comboMembers } = comboIds.length > 0
    ? await supabase
        .from('planned_exercise_combo_members')
        .select('planned_exercise_id, exercise_id, position')
        .in('planned_exercise_id', comboIds)
    : { data: [] };
  const comboMembersByExId = new Map<string, { exercise_id: string; position: number }[]>();
  (comboMembers || []).forEach((m: { planned_exercise_id: string; exercise_id: string; position: number }) => {
    const arr = comboMembersByExId.get(m.planned_exercise_id) || [];
    arr.push({ exercise_id: m.exercise_id, position: m.position });
    comboMembersByExId.set(m.planned_exercise_id, arr);
  });

  return {
    structure: {
      active_days: meta?.active_days ?? [],
      day_labels: meta?.day_labels ?? null,
      day_display_order: meta?.day_display_order ?? null,
      day_schedule: meta?.day_schedule ?? null,
    },
    hostOwnerId: meta?.owner_id ?? getOwnerId(),
    exercises: groupExercises,
    setLinesByExId,
    comboMembersByExId,
  };
}

interface MemberInfo {
  athleteId: string;
  athleteName: string;
  ownerId: string;
}

/** Active members of the group, each with their own host coach's owner_id. */
async function fetchMembers(groupId: string, hostOwnerId: string): Promise<MemberInfo[]> {
  const { data: members, error } = await supabase
    .from('group_members')
    .select('athlete_id')
    .eq('group_id', groupId)
    .is('left_at', null);
  if (error) throw error;
  const athleteIds = (members || []).map(m => m.athlete_id);
  if (athleteIds.length === 0) return [];

  const { data: athleteRows, error: athErr } = await supabase
    .from('athletes')
    .select('id, name, owner_id')
    .in('id', athleteIds);
  if (athErr) throw athErr;
  const byId = new Map((athleteRows || []).map((a: { id: string; name: string; owner_id: string }) => [a.id, a]));

  return athleteIds.map(id => {
    const a = byId.get(id);
    return {
      athleteId: id,
      athleteName: a?.name ?? 'Unknown athlete',
      // Falls back to the group host only if the athlete row lacks an owner.
      ownerId: a?.owner_id ?? hostOwnerId,
    };
  });
}

interface AthletePlanRows {
  planId: string | null;
  rows: ClassifiableAthleteRow[];
  loggedRowIds: Set<string>;
}

/** Batched fetch of every member's plan + rows + logged refs for the week. */
async function fetchAthletePlans(
  athleteIds: string[],
  weekStart: string,
): Promise<Map<string, AthletePlanRows>> {
  const result = new Map<string, AthletePlanRows>();
  athleteIds.forEach(id => result.set(id, { planId: null, rows: [], loggedRowIds: new Set() }));
  if (athleteIds.length === 0) return result;

  const { data: plans, error: planErr } = await supabase
    .from('week_plans')
    .select('id, athlete_id')
    .in('athlete_id', athleteIds)
    .eq('week_start', weekStart);
  if (planErr) throw planErr;
  const planIdToAthlete = new Map<string, string>();
  (plans || []).forEach((p: { id: string; athlete_id: string | null }) => {
    if (!p.athlete_id) return;
    result.get(p.athlete_id)!.planId = p.id;
    planIdToAthlete.set(p.id, p.athlete_id);
  });
  const planIds = [...planIdToAthlete.keys()];
  if (planIds.length === 0) return result;

  const { data: exRows, error: exErr } = await supabase
    .from('planned_exercises')
    .select('id, weekplan_id, exercise_id, day_index, source, display_name, is_combo, combo_notation, exercise:exercises(name)')
    .in('weekplan_id', planIds);
  if (exErr) throw exErr;
  const allRowIds: string[] = [];
  (exRows || []).forEach(r => {
    const row = r as unknown as {
      id: string; weekplan_id: string; exercise_id: string; day_index: number;
      source: 'group' | 'individual' | null; display_name: string | null;
      is_combo: boolean; combo_notation: string | null; exercise: { name: string } | null;
    };
    allRowIds.push(row.id);
    const athleteId = planIdToAthlete.get(row.weekplan_id);
    if (!athleteId) return;
    result.get(athleteId)!.rows.push({
      id: row.id,
      exercise_id: row.exercise_id,
      day_index: row.day_index,
      source: row.source,
      label: rowLabel(row),
    });
  });

  if (allRowIds.length > 0) {
    const { data: loggedRefs, error: logErr } = await supabase
      .from('training_log_exercises')
      .select('planned_exercise_id')
      .in('planned_exercise_id', allRowIds);
    if (logErr) throw logErr;
    const loggedIds = new Set(
      ((loggedRefs || []) as { planned_exercise_id: string | null }[])
        .map(r => r.planned_exercise_id)
        .filter((id): id is string => !!id),
    );
    for (const entry of result.values()) {
      entry.rows.forEach(r => { if (loggedIds.has(r.id)) entry.loggedRowIds.add(r.id); });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Preview (dry run)
// ---------------------------------------------------------------------------

export async function computeGroupSyncPreview(
  groupPlanId: string,
  groupId: string,
  weekStart: string,
): Promise<GroupSyncPreview> {
  const groupData = await fetchGroupPlanData(groupPlanId);
  const members = await fetchMembers(groupId, groupData.hostOwnerId);
  const plans = await fetchAthletePlans(members.map(m => m.athleteId), weekStart);

  const groupRows: ClassifiableGroupRow[] = groupData.exercises.map(e => ({
    exercise_id: e.exercise_id,
    day_index: e.day_index,
    label: rowLabel(e),
  }));

  const athletes: AthleteSyncPreview[] = members.map(m => {
    const plan = plans.get(m.athleteId)!;
    const classification = classifyAthleteRows(groupRows, plan.rows, plan.loggedRowIds);
    return {
      athleteId: m.athleteId,
      athleteName: m.athleteName,
      planExists: plan.planId !== null,
      ...classification,
    };
  });

  return { groupExerciseCount: groupData.exercises.length, athletes };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface AthleteSyncSelection {
  athleteId: string;
  mode: SyncMode;
}

export interface AthleteSyncResult extends ModeOutcome {
  athleteId: string;
  athleteName: string;
  mode: SyncMode;
}

/**
 * Run the sync for the selected athletes. Re-reads each athlete's current
 * rows rather than trusting a (possibly stale) preview — last-write-wins on
 * whatever is in the database at execution time.
 *
 * `onProgress(done, total)` fires after each athlete for wizard feedback.
 */
export async function executeGroupSync(
  groupPlanId: string,
  groupId: string,
  weekStart: string,
  selections: AthleteSyncSelection[],
  onProgress?: (done: number, total: number) => void,
): Promise<AthleteSyncResult[]> {
  const groupData = await fetchGroupPlanData(groupPlanId);
  const members = await fetchMembers(groupId, groupData.hostOwnerId);
  const memberById = new Map(members.map(m => [m.athleteId, m]));

  // Only sync athletes that are (still) active members of the group.
  const targets = selections.filter(s => memberById.has(s.athleteId));
  const results: AthleteSyncResult[] = [];

  let done = 0;
  for (const target of targets) {
    const member = memberById.get(target.athleteId)!;
    const outcome = await syncOneAthlete(groupPlanId, weekStart, groupData, member, target.mode);
    results.push({ athleteId: member.athleteId, athleteName: member.athleteName, mode: target.mode, ...outcome });
    done += 1;
    onProgress?.(done, targets.length);
  }
  if (targets.length > 0) await stampGroupPlanSynced(groupPlanId);
  return results;
}

/**
 * Historical entry point: sync every active member with the default
 * ('update') semantics — what the pre-wizard Sync button did.
 */
export async function syncGroupPlanToAllAthletes(
  groupPlanId: string,
  groupId: string,
  weekStart: string,
): Promise<void> {
  const groupData = await fetchGroupPlanData(groupPlanId);
  const members = await fetchMembers(groupId, groupData.hostOwnerId);
  for (const member of members) {
    await syncOneAthlete(groupPlanId, weekStart, groupData, member, 'update');
  }
  if (members.length > 0) await stampGroupPlanSynced(groupPlanId);
}

/**
 * Record who synced this group plan, and when, on the GROUP plan row — the
 * banner shows it as "Last synced 2h ago by Coach A" so a co-coach sees the
 * plan has already gone out before syncing over a colleague's run.
 *
 * Non-fatal by design: the stamp is context, not data, and it must not fail
 * the sync on a database where the 20260831 last-synced migration hasn't
 * been applied yet.
 */
async function stampGroupPlanSynced(groupPlanId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('week_plans')
      .update({
        last_synced_at: new Date().toISOString(),
        last_synced_by_coach_id: getOwnerId(),
      })
      .eq('id', groupPlanId);
    if (error) throw error;
  } catch (err) {
    console.warn('[groupSync] could not stamp last_synced_at on the group plan', err);
  }
}

async function syncOneAthlete(
  groupPlanId: string,
  weekStart: string,
  groupData: GroupPlanData,
  member: MemberInfo,
  mode: SyncMode,
): Promise<ModeOutcome> {
  const { structure: groupStructure, exercises: groupExercises, setLinesByExId, comboMembersByExId } = groupData;

  // 1. Get or create the athlete's week plan. Not filtered by owner_id: the
  // (athlete_id, week_start) unique index guarantees at most one individual
  // plan per athlete per week regardless of owner, and filtering by owner
  // misses a plan owned by the athlete's host when a co-coach syncs.
  const { data: existingPlan } = await supabase
    .from('week_plans')
    .select('id')
    .eq('athlete_id', member.athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();

  let athletePlanId: string;
  if (existingPlan) {
    athletePlanId = existingPlan.id;
  } else {
    // Born with the GROUP's rhythm, not the column default [1,2,3,4,5].
    const seed = seedStructureFromGroup(groupStructure);
    const { data: newPlan, error: createError } = await supabase
      .from('week_plans')
      .insert([{
        week_start: weekStart,
        athlete_id: member.athleteId,
        group_id: null,
        is_group_plan: false,
        owner_id: member.ownerId,
        source_group_plan_id: groupPlanId,
        ...(seed ? {
          active_days: seed.active_days,
          day_labels: seed.day_labels,
          day_schedule: seed.day_schedule,
          ...(seed.day_display_order ? { day_display_order: seed.day_display_order } : {}),
        } : {}),
      }])
      .select('id')
      .single();
    if (createError) {
      if (createError.code === '23505') {
        // Race: created between check and insert — fetch it.
        const { data: racePlan } = await supabase
          .from('week_plans')
          .select('id')
          .eq('athlete_id', member.athleteId)
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

  // 2. Merge the group's unit structure. Unconditional and idempotent — the
  // group owns the identity of the units it trains (rename propagation),
  // except in append mode where the athlete's own labels/times win.
  const { data: athletePlanMeta } = await supabase
    .from('week_plans')
    .select('active_days, day_labels, day_display_order, day_schedule')
    .eq('id', athletePlanId)
    .single();

  const merged = mergeGroupStructureIntoAthlete(
    groupStructure,
    {
      active_days: athletePlanMeta?.active_days ?? [],
      day_labels: athletePlanMeta?.day_labels ?? null,
      day_display_order: athletePlanMeta?.day_display_order ?? null,
      day_schedule: athletePlanMeta?.day_schedule ?? null,
    },
    { athleteWins: mode === 'append' },
  );

  await supabase.from('week_plans').update({
    active_days: merged.active_days,
    day_labels: merged.day_labels,
    day_schedule: merged.day_schedule,
    ...(merged.day_display_order ? { day_display_order: merged.day_display_order } : {}),
    source_group_plan_id: groupPlanId,
  }).eq('id', athletePlanId);

  // 3. Classify the athlete's current rows against the group plan.
  const { data: athleteExsData } = await supabase
    .from('planned_exercises')
    .select('id, exercise_id, day_index, source')
    .eq('weekplan_id', athletePlanId);
  const athleteRows = (athleteExsData || []) as {
    id: string; exercise_id: string; day_index: number; source: 'group' | 'individual' | null;
  }[];

  const athleteRowIds = athleteRows.map(r => r.id);
  const loggedRowIds = new Set<string>();
  if (athleteRowIds.length > 0) {
    const { data: loggedRefs } = await supabase
      .from('training_log_exercises')
      .select('planned_exercise_id')
      .in('planned_exercise_id', athleteRowIds);
    ((loggedRefs || []) as { planned_exercise_id: string | null }[]).forEach(r => {
      if (r.planned_exercise_id) loggedRowIds.add(r.planned_exercise_id);
    });
  }

  const groupKeys = new Set(groupExercises.map(e => slotKey(e.exercise_id, e.day_index)));
  const loggedKeys = new Set<string>();
  const unloggedIndividualKeys = new Set<string>();
  for (const row of athleteRows) {
    const key = slotKey(row.exercise_id, row.day_index);
    if (loggedRowIds.has(row.id)) loggedKeys.add(key);
    else if (row.source === 'individual') unloggedIndividualKeys.add(key);
  }
  const anyRowKeys = new Set(athleteRows.map(r => slotKey(r.exercise_id, r.day_index)));

  // 4. Decide deletions per mode. Logged rows are never deleted, in any mode.
  //    - update:    unlogged group-sourced rows (the historical rule).
  //    - overwrite: those, plus unlogged individual rows on slots the group
  //                 trains — the group plan wins over the coach's per-athlete
  //                 edit, which is the point of the mode.
  //    - append:    nothing.
  const toDelete = mode === 'append' ? [] : athleteRows.filter(row => {
    if (loggedRowIds.has(row.id)) return false;
    if (row.source === 'group') return true;
    if (mode === 'overwrite' && row.source === 'individual') {
      return groupKeys.has(slotKey(row.exercise_id, row.day_index));
    }
    return false;
  }).map(row => row.id);

  let overwritten = 0;
  if (mode === 'overwrite') {
    overwritten = athleteRows.filter(row =>
      !loggedRowIds.has(row.id) &&
      row.source === 'individual' &&
      groupKeys.has(slotKey(row.exercise_id, row.day_index)),
    ).length;
  }

  if (toDelete.length > 0) {
    await supabase.from('planned_set_lines').delete().in('planned_exercise_id', toDelete);
    await supabase.from('planned_exercises').delete().in('id', toDelete);
  }

  // 5. Decide which group rows to copy in.
  //    - update:    skip logged slots and (still-present) individual overrides.
  //    - overwrite: skip only logged slots (the overrides are gone).
  //    - append:    skip any slot the athlete has at all.
  const exsToCopy = groupExercises.filter(ex => {
    const key = slotKey(ex.exercise_id, ex.day_index);
    if (loggedKeys.has(key)) return false;
    if (mode === 'append') return !anyRowKeys.has(key);
    if (mode === 'update') return !unloggedIndividualKeys.has(key);
    return true; // overwrite
  });

  if (exsToCopy.length > 0) {
    // metadata and variation_note must round-trip: metadata holds GPP rows
    // (metadata.gpp) and IMAGE/VIDEO captions (metadata.description);
    // variation_note carries the coach's per-row tweak text.
    const { data: insertedExs, error: insError } = await supabase
      .from('planned_exercises')
      .insert(exsToCopy.map(ex => exerciseInsertPayload(ex, athletePlanId)))
      .select('id');
    if (insError) throw insError;

    // Set lines carry the FULL prescription shape: sets_max/reps_max (ranges),
    // load_cmp (≥ ≈ ≤) and notes included — the old copy dropped those.
    const allSetLines: Array<Partial<PlannedSetLine> & { planned_exercise_id: string }> = [];
    const allComboMembers: { planned_exercise_id: string; exercise_id: string; position: number }[] = [];
    (insertedExs || []).forEach((newEx, idx) => {
      const srcEx = exsToCopy[idx];
      for (const l of setLinesByExId.get(srcEx.id) || []) {
        allSetLines.push(setLineInsertPayload(l, newEx.id));
      }
      if (srcEx.is_combo) {
        for (const m of comboMembersByExId.get(srcEx.id) || []) {
          allComboMembers.push({ planned_exercise_id: newEx.id, exercise_id: m.exercise_id, position: m.position });
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

  // 6. Renumber densely — the merge mixes position sequences from the group
  // copy, kept overrides and logged-protected rows, which can tie. One atomic
  // statement, a no-op when already dense.
  await normalizePositions(athletePlanId);

  // Outcome accounting for the result summary.
  const addedKeys = exsToCopy.filter(ex => !anyRowKeys.has(slotKey(ex.exercise_id, ex.day_index))).length;
  const staleRemoved = mode === 'append' ? 0 : athleteRows.filter(row =>
    row.source === 'group' && !loggedRowIds.has(row.id) &&
    !groupKeys.has(slotKey(row.exercise_id, row.day_index)),
  ).length;
  return {
    added: addedKeys,
    replaced: exsToCopy.length - addedKeys - overwritten,
    overwritten,
    keptPinned: mode === 'overwrite' ? 0 : groupExercises.filter(ex => {
      const key = slotKey(ex.exercise_id, ex.day_index);
      return unloggedIndividualKeys.has(key) && !loggedKeys.has(key);
    }).length,
    keptLogged: groupExercises.filter(ex => loggedKeys.has(slotKey(ex.exercise_id, ex.day_index))).length,
    removed: staleRemoved,
  };
}

// ---------------------------------------------------------------------------
// Copy payloads — shared by the bulk sync and the single-row revert so the
// two paths can never drift on which columns a group copy carries.
// ---------------------------------------------------------------------------

/** The copyable columns of a group planned_exercise, as an insert payload. */
function exerciseInsertPayload(ex: GroupExerciseRow, weekplanId: string) {
  return {
    weekplan_id: weekplanId,
    exercise_id: ex.exercise_id,
    day_index: ex.day_index,
    position: ex.position,
    unit: ex.unit,
    prescription_raw: ex.prescription_raw,
    notes: ex.notes,
    variation_note: ex.variation_note ?? null,
    display_name: ex.display_name ?? null,
    summary_total_sets: ex.summary_total_sets,
    summary_total_reps: ex.summary_total_reps,
    summary_highest_load: ex.summary_highest_load,
    summary_avg_load: ex.summary_avg_load,
    is_combo: ex.is_combo,
    combo_notation: ex.combo_notation,
    combo_color: ex.combo_color,
    // planned_exercises.metadata is NOT NULL with default '{}'::jsonb —
    // coerce a missing source to {} rather than violating the constraint.
    metadata: (ex.metadata ?? {}) as PlannedExerciseMetadata,
    source: 'group' as const,
  };
}

/** Full-shape set-line copy: ranges, soft-load comparator and notes included. */
function setLineInsertPayload(l: PlannedSetLine, plannedExerciseId: string) {
  return {
    planned_exercise_id: plannedExerciseId,
    sets: l.sets,
    sets_max: l.sets_max ?? null,
    reps: l.reps,
    reps_max: l.reps_max ?? null,
    reps_text: l.reps_text ?? null,
    load_value: l.load_value,
    load_max: l.load_max ?? null,
    load_cmp: l.load_cmp ?? null,
    position: l.position,
    notes: l.notes ?? null,
  };
}

// ---------------------------------------------------------------------------
// Revert one row to the group version
// ---------------------------------------------------------------------------

export type RevertResult =
  /** Replaced with a fresh copy of the group plan's current row. */
  | 'reverted'
  /** Slot no longer in the group plan; removed on explicit request. */
  | 'removed'
  /** The athlete has logged against it — protected, nothing changed. */
  | 'logged'
  /** Slot no longer in the group plan; caller should confirm removal. */
  | 'not-in-group'
  /** The plan isn't linked to a group plan — nothing to revert to. */
  | 'no-group-plan';

/**
 * Drop one individual override and take the group plan's current version of
 * the same slot — the single-row counterpart of an 'overwrite' sync.
 *
 * The copy lands at the athlete's OWN position (revert the content, keep the
 * layout) with source='group', so the next sync treats it as a group row
 * again. Same protection rule as the sync: a logged row is a record, never
 * replaced. When the group plan no longer trains this slot, the honest revert
 * is removal — returned as 'not-in-group' first so the caller can confirm,
 * then executed with `removeIfMissing`.
 */
export async function revertRowToGroup(
  plannedExerciseId: string,
  opts: { removeIfMissing?: boolean } = {},
): Promise<RevertResult> {
  const { data: row, error: rowErr } = await supabase
    .from('planned_exercises')
    .select('id, weekplan_id, exercise_id, day_index, position')
    .eq('id', plannedExerciseId)
    .single();
  if (rowErr) throw rowErr;

  const { data: plan, error: planErr } = await supabase
    .from('week_plans')
    .select('source_group_plan_id')
    .eq('id', row.weekplan_id)
    .single();
  if (planErr) throw planErr;
  const groupPlanId = plan?.source_group_plan_id;
  if (!groupPlanId) return 'no-group-plan';

  const { data: logRefs, error: logErr } = await supabase
    .from('training_log_exercises')
    .select('id')
    .eq('planned_exercise_id', plannedExerciseId)
    .limit(1);
  if (logErr) throw logErr;
  if ((logRefs || []).length > 0) return 'logged';

  const { data: groupRows, error: gErr } = await supabase
    .from('planned_exercises')
    .select('*')
    .eq('weekplan_id', groupPlanId)
    .eq('exercise_id', row.exercise_id)
    .eq('day_index', row.day_index)
    .order('position')
    .limit(1);
  if (gErr) throw gErr;
  const groupEx = ((groupRows || []) as unknown as GroupExerciseRow[])[0];

  if (!groupEx) {
    if (!opts.removeIfMissing) return 'not-in-group';
    await supabase.from('planned_set_lines').delete().eq('planned_exercise_id', plannedExerciseId);
    const { error: delErr } = await supabase.from('planned_exercises').delete().eq('id', plannedExerciseId);
    if (delErr) throw delErr;
    await normalizePositions(row.weekplan_id);
    return 'removed';
  }

  const { data: setLines } = await supabase
    .from('planned_set_lines')
    .select('*')
    .eq('planned_exercise_id', groupEx.id)
    .order('position');
  const { data: comboMembers } = groupEx.is_combo
    ? await supabase
        .from('planned_exercise_combo_members')
        .select('exercise_id, position')
        .eq('planned_exercise_id', groupEx.id)
    : { data: [] };

  await supabase.from('planned_set_lines').delete().eq('planned_exercise_id', plannedExerciseId);
  const { error: delErr } = await supabase.from('planned_exercises').delete().eq('id', plannedExerciseId);
  if (delErr) throw delErr;

  const { data: inserted, error: insErr } = await supabase
    .from('planned_exercises')
    .insert([{ ...exerciseInsertPayload(groupEx, row.weekplan_id), position: row.position }])
    .select('id')
    .single();
  if (insErr) throw insErr;

  const lines = ((setLines || []) as unknown as PlannedSetLine[]).map(l => setLineInsertPayload(l, inserted.id));
  if (lines.length > 0) {
    const { error } = await supabase.from('planned_set_lines').insert(lines);
    if (error) throw error;
  }
  const members = (comboMembers || []) as { exercise_id: string; position: number }[];
  if (members.length > 0) {
    const { error } = await supabase.from('planned_exercise_combo_members').insert(
      members.map(m => ({ planned_exercise_id: inserted.id, exercise_id: m.exercise_id, position: m.position })),
    );
    if (error) throw error;
  }

  await normalizePositions(row.weekplan_id);
  return 'reverted';
}
