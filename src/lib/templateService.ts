// Programme template service — pure Supabase data layer for the Weekly
// Designer Dock. No React state, no UI. Hooks wrap these to expose
// loading/error.
//
// API surface:
//   - List + fetch + lifecycle (create / update / delete / duplicate)
//   - "Save from existing": createTemplateFromDay, createTemplateFromWeek
//   - "Apply to plan": applyTemplateDayToPlanDay, applyTemplateToPlan
//
// The apply path mirrors the planned_exercises insert pattern in
// useWeekPlans.addExerciseToDay so positions, combo membership, and
// every per-exercise column round-trip without translation. Until
// useWeekPlans grows a pure-function service layer of its own, the
// insert logic is duplicated here intentionally — see TODO below.

import { supabase } from './supabase';
import { getOwnerId } from './ownerContext';
import type {
  Exercise,
  PlannedExercise,
  PlannedExerciseComboMember,
  ProgramTemplate,
  ProgramTemplateComboMember,
  ProgramTemplateDay,
  ProgramTemplateExercise,
  ProgramTemplateFull,
  ProgramTemplateSummary,
} from './database.types';

// ── Read ─────────────────────────────────────────────────────────────

export async function fetchTemplates(): Promise<ProgramTemplateSummary[]> {
  const { data, error } = await supabase
    .from('program_templates')
    .select('*, days:program_template_days(id, day_index, label)')
    .eq('owner_id', getOwnerId())
    .order('updated_at', { ascending: false });
  if (error) throw error;
  type DayLite = { id: string; day_index: number; label: string };
  type Row = ProgramTemplate & { days: DayLite[] | null };
  return ((data ?? []) as unknown as Row[]).map<ProgramTemplateSummary>(t => {
    const days = (t.days ?? []).slice().sort((a, b) => a.day_index - b.day_index);
    return {
      id: t.id,
      owner_id: t.owner_id,
      name: t.name,
      description: t.description,
      tags: t.tags ?? [],
      created_at: t.created_at,
      updated_at: t.updated_at,
      day_count: days.length,
      days,
    };
  });
}

export async function fetchTemplateFull(id: string): Promise<ProgramTemplateFull | null> {
  const { data, error } = await supabase
    .from('program_templates')
    .select(`
      *,
      days:program_template_days (
        *,
        exercises:program_template_exercises (
          *,
          exercise:exercise_id(*),
          combo_members:program_template_combo_members (
            *,
            exercise:exercise_id(*)
          )
        )
      )
    `)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Supabase nested ordering is best done client-side here.
  type RawDay = ProgramTemplateDay & {
    exercises: (ProgramTemplateExercise & {
      exercise: Exercise;
      combo_members: (ProgramTemplateComboMember & { exercise: Exercise })[];
    })[];
  };
  const raw = data as unknown as ProgramTemplate & { days: RawDay[] };
  const days = (raw.days ?? [])
    .slice()
    .sort((a, b) => a.day_index - b.day_index)
    .map(d => ({
      ...d,
      exercises: (d.exercises ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(ex => ({
          ...ex,
          combo_members: (ex.combo_members ?? []).slice().sort((a, b) => a.position - b.position),
        })),
    }));

  return {
    id: raw.id,
    owner_id: raw.owner_id,
    name: raw.name,
    description: raw.description,
    tags: raw.tags ?? [],
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    days,
  } as unknown as ProgramTemplateFull;
}

// ── Lifecycle ────────────────────────────────────────────────────────

export async function createTemplate(input: {
  name: string;
  description?: string | null;
  tags?: string[];
}): Promise<ProgramTemplate> {
  const { data, error } = await supabase
    .from('program_templates')
    .insert([{
      owner_id: getOwnerId(),
      name: input.name,
      description: input.description ?? null,
      tags: input.tags ?? [],
    }])
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ProgramTemplate;
}

export async function updateTemplate(
  id: string,
  patch: { name?: string; description?: string | null; tags?: string[] },
): Promise<void> {
  const { error } = await supabase
    .from('program_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTemplate(id: string): Promise<void> {
  // ON DELETE CASCADE on FK chains removes days / exercises / combo_members.
  const { error } = await supabase.from('program_templates').delete().eq('id', id);
  if (error) throw error;
}

export async function duplicateTemplate(id: string, newName?: string): Promise<ProgramTemplate> {
  const source = await fetchTemplateFull(id);
  if (!source) throw new Error('Template not found');
  const copy = await createTemplate({
    name: newName ?? `${source.name} (copy)`,
    description: source.description,
    tags: source.tags,
  });
  for (const day of source.days) {
    const newDay = await insertTemplateDay(copy.id, day.day_index, day.label);
    for (const ex of day.exercises) {
      const newEx = await insertTemplateExercise(newDay.id, {
        exercise_id: ex.exercise_id,
        position: ex.position,
        unit: ex.unit,
        prescription_raw: ex.prescription_raw,
        notes: ex.notes,
        variation_note: ex.variation_note,
        is_combo: ex.is_combo,
        combo_notation: ex.combo_notation,
        combo_color: ex.combo_color,
      });
      if (ex.is_combo && ex.combo_members?.length) {
        for (const m of ex.combo_members) {
          await insertTemplateComboMember(newEx.id, m.exercise_id, m.position);
        }
      }
    }
  }
  return copy;
}

// ── Editor primitives (used by /templates editor) ────────────────────

export async function insertTemplateDay(
  templateId: string,
  dayIndex: number,
  label: string,
): Promise<ProgramTemplateDay> {
  const { data, error } = await supabase
    .from('program_template_days')
    .insert([{ template_id: templateId, day_index: dayIndex, label }])
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ProgramTemplateDay;
}

export async function deleteTemplateDay(dayId: string): Promise<void> {
  const { error } = await supabase.from('program_template_days').delete().eq('id', dayId);
  if (error) throw error;
}

export async function updateTemplateDay(
  dayId: string,
  patch: { label?: string; day_index?: number },
): Promise<void> {
  const { error } = await supabase
    .from('program_template_days')
    .update(patch)
    .eq('id', dayId);
  if (error) throw error;
}

export async function insertTemplateExercise(
  templateDayId: string,
  input: Omit<ProgramTemplateExercise, 'id' | 'template_day_id' | 'created_at' | 'updated_at'>,
): Promise<ProgramTemplateExercise> {
  const { data, error } = await supabase
    .from('program_template_exercises')
    .insert([{ template_day_id: templateDayId, ...input }])
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ProgramTemplateExercise;
}

export async function deleteTemplateExercise(id: string): Promise<void> {
  const { error } = await supabase.from('program_template_exercises').delete().eq('id', id);
  if (error) throw error;
}

export async function updateTemplateExercise(
  id: string,
  patch: Partial<Omit<ProgramTemplateExercise, 'id' | 'template_day_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const { error } = await supabase
    .from('program_template_exercises')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Reorder template days within a template. Two-pass to dodge the
 * UNIQUE(template_id, day_index) constraint without needing a
 * transactional RPC: bump every row to a high offset first, then
 * assign final consecutive day_index values starting at 1.
 */
export async function reorderTemplateDays(orderedDayIds: string[]): Promise<void> {
  const OFFSET = 10000;
  for (let i = 0; i < orderedDayIds.length; i++) {
    await updateTemplateDay(orderedDayIds[i], { day_index: OFFSET + i });
  }
  for (let i = 0; i < orderedDayIds.length; i++) {
    await updateTemplateDay(orderedDayIds[i], { day_index: i + 1 });
  }
}

/**
 * Reorder exercises within a single template day. position has no
 * uniqueness constraint, so a straight sequence works.
 */
export async function reorderTemplateExercises(orderedExerciseIds: string[]): Promise<void> {
  for (let i = 0; i < orderedExerciseIds.length; i++) {
    await updateTemplateExercise(orderedExerciseIds[i], { position: i });
  }
}

/**
 * Move a template exercise to a different template day, placing it
 * at the given position. Used by cross-day drag-and-drop in the editor.
 */
export async function moveTemplateExercise(
  exerciseId: string,
  targetDayId: string,
  position: number,
): Promise<void> {
  const { error } = await supabase
    .from('program_template_exercises')
    .update({ template_day_id: targetDayId, position, updated_at: new Date().toISOString() })
    .eq('id', exerciseId);
  if (error) throw error;
}

export async function insertTemplateComboMember(
  templateExerciseId: string,
  exerciseId: string,
  position: number,
): Promise<void> {
  const { error } = await supabase
    .from('program_template_combo_members')
    .insert([{ template_exercise_id: templateExerciseId, exercise_id: exerciseId, position }]);
  if (error) throw error;
}

// ── Save-from-existing ───────────────────────────────────────────────

/**
 * Build a single-day template from one weekplan day. Verbatim copy:
 * prescriptions, units, notes, combos all preserved.
 */
export async function createTemplateFromDay(
  weekPlanId: string,
  dayIndex: number,
  name: string,
  opts?: { description?: string | null; tags?: string[]; dayLabel?: string },
): Promise<ProgramTemplate> {
  const { data: srcExercises, error: srcErr } = await supabase
    .from('planned_exercises')
    .select('*')
    .eq('weekplan_id', weekPlanId)
    .eq('day_index', dayIndex)
    .order('position');
  if (srcErr) throw srcErr;
  const srcRows = (srcExercises ?? []) as unknown as PlannedExercise[];

  const template = await createTemplate({
    name,
    description: opts?.description ?? null,
    tags: opts?.tags,
  });
  const day = await insertTemplateDay(template.id, 1, opts?.dayLabel ?? 'Day 1');

  for (const ex of srcRows) {
    const newEx = await insertTemplateExercise(day.id, {
      exercise_id: ex.exercise_id,
      position: ex.position,
      unit: ex.unit,
      prescription_raw: ex.prescription_raw,
      notes: ex.notes,
      variation_note: ex.variation_note,
      is_combo: ex.is_combo,
      combo_notation: ex.combo_notation,
      combo_color: ex.combo_color,
    });
    if (ex.is_combo) {
      const { data: members, error: memErr } = await supabase
        .from('planned_exercise_combo_members')
        .select('*')
        .eq('planned_exercise_id', ex.id)
        .order('position');
      if (memErr) throw memErr;
      const memberRows = (members ?? []) as unknown as PlannedExerciseComboMember[];
      for (const m of memberRows) {
        await insertTemplateComboMember(newEx.id, m.exercise_id, m.position);
      }
    }
  }
  return template;
}

/**
 * Build a multi-day template from a whole week. Active-days-only:
 * the day_index in the template is the source day_index (preserves
 * coach's ordering choices for the source week).
 */
export async function createTemplateFromWeek(
  weekPlanId: string,
  name: string,
  opts?: {
    description?: string | null;
    tags?: string[];
    dayLabels?: Record<number, string> | null;
    includeDays?: number[];
  },
): Promise<ProgramTemplate> {
  const { data: srcExercises, error: srcErr } = await supabase
    .from('planned_exercises')
    .select('*')
    .eq('weekplan_id', weekPlanId)
    .order('day_index')
    .order('position');
  if (srcErr) throw srcErr;
  const srcRows = (srcExercises ?? []) as unknown as PlannedExercise[];

  const byDay = new Map<number, PlannedExercise[]>();
  for (const ex of srcRows) {
    if (opts?.includeDays && !opts.includeDays.includes(ex.day_index)) continue;
    if (!byDay.has(ex.day_index)) byDay.set(ex.day_index, []);
    byDay.get(ex.day_index)!.push(ex);
  }

  const template = await createTemplate({
    name,
    description: opts?.description ?? null,
    tags: opts?.tags,
  });

  const sortedDayIndices = Array.from(byDay.keys()).sort((a, b) => a - b);
  let templateDayIdx = 1;
  for (const srcDayIndex of sortedDayIndices) {
    const label = opts?.dayLabels?.[srcDayIndex] ?? `Day ${templateDayIdx}`;
    const day = await insertTemplateDay(template.id, templateDayIdx, label);
    templateDayIdx += 1;

    for (const ex of byDay.get(srcDayIndex)!) {
      const newEx = await insertTemplateExercise(day.id, {
        exercise_id: ex.exercise_id,
        position: ex.position,
        unit: ex.unit,
        prescription_raw: ex.prescription_raw,
        notes: ex.notes,
        variation_note: ex.variation_note,
        is_combo: ex.is_combo,
        combo_notation: ex.combo_notation,
        combo_color: ex.combo_color,
      });
      if (ex.is_combo) {
        const { data: members, error: memErr } = await supabase
          .from('planned_exercise_combo_members')
          .select('*')
          .eq('planned_exercise_id', ex.id)
          .order('position');
        if (memErr) throw memErr;
        const memberRows = (members ?? []) as unknown as PlannedExerciseComboMember[];
        for (const m of memberRows) {
          await insertTemplateComboMember(newEx.id, m.exercise_id, m.position);
        }
      }
    }
  }
  return template;
}

// ── Apply to plan ────────────────────────────────────────────────────

/**
 * Copy one template day's exercises into a real weekplan day.
 * Appends by default; replace=true clears the destination day first.
 *
 * TODO: when useWeekPlans grows a pure-function service layer, this
 * insert logic should call into it rather than duplicate the column
 * list. Today the duplication is intentional to keep this commit
 * scoped.
 */
export async function applyTemplateDayToPlanDay(
  templateDayId: string,
  weekPlanId: string,
  targetDayIndex: number,
  opts?: { replace?: boolean },
): Promise<void> {
  const { data: dayData, error: dayErr } = await supabase
    .from('program_template_days')
    .select(`
      *,
      exercises:program_template_exercises (
        *,
        combo_members:program_template_combo_members (*)
      )
    `)
    .eq('id', templateDayId)
    .single();
  if (dayErr) throw dayErr;

  type DayWithExercises = ProgramTemplateDay & {
    exercises: (ProgramTemplateExercise & {
      combo_members: { exercise_id: string; position: number }[];
    })[];
  };
  const day = dayData as unknown as DayWithExercises;
  const sortedExercises = (day.exercises ?? []).slice().sort((a, b) => a.position - b.position);

  if (opts?.replace) {
    const { data: existing, error: exErr } = await supabase
      .from('planned_exercises')
      .select('id')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', targetDayIndex);
    if (exErr) throw exErr;
    const ids = ((existing ?? []) as unknown as { id: string }[]).map(r => r.id);
    if (ids.length > 0) {
      await supabase.from('planned_set_lines').delete().in('planned_exercise_id', ids);
      await supabase.from('planned_exercises').delete().in('id', ids);
    }
  }

  // Compute base position after any clearing.
  const { count, error: countErr } = await supabase
    .from('planned_exercises')
    .select('id', { count: 'exact', head: true })
    .eq('weekplan_id', weekPlanId)
    .eq('day_index', targetDayIndex);
  if (countErr) throw countErr;
  let nextPosition = count ?? 0;

  for (const ex of sortedExercises) {
    const { data: inserted, error: insErr } = await supabase
      .from('planned_exercises')
      .insert([{
        weekplan_id: weekPlanId,
        day_index: targetDayIndex,
        exercise_id: ex.exercise_id,
        position: nextPosition,
        unit: ex.unit,
        summary_total_sets: 0,
        summary_total_reps: 0,
        summary_highest_load: null,
        summary_avg_load: null,
        prescription_raw: ex.prescription_raw,
        notes: ex.notes,
        variation_note: ex.variation_note,
        is_combo: ex.is_combo,
        combo_notation: ex.combo_notation,
        combo_color: ex.combo_color,
        source: null,
      }])
      .select('id')
      .single();
    if (insErr) throw insErr;
    const newPlannedId = (inserted as unknown as { id: string }).id;
    nextPosition += 1;

    if (ex.is_combo && ex.combo_members?.length) {
      const rows = ex.combo_members
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(m => ({
          planned_exercise_id: newPlannedId,
          exercise_id: m.exercise_id,
          position: m.position,
        }));
      const { error: memErr } = await supabase
        .from('planned_exercise_combo_members')
        .insert(rows);
      if (memErr) throw memErr;
    }
  }
}

/**
 * Apply a multi-day template with an explicit mapping from template
 * day_index → target weekplan day_index. Entries whose target is null
 * are skipped. Each mapped pair runs through applyTemplateDayToPlanDay
 * so behaviour is identical to per-day drops.
 */
export async function applyTemplateToPlan(
  templateId: string,
  weekPlanId: string,
  mapping: Record<number, number | null>,
  opts?: { replace?: boolean },
): Promise<void> {
  const template = await fetchTemplateFull(templateId);
  if (!template) throw new Error('Template not found');

  for (const day of template.days) {
    const targetDayIndex = mapping[day.day_index];
    if (targetDayIndex == null) continue;
    await applyTemplateDayToPlanDay(day.id, weekPlanId, targetDayIndex, opts);
  }
}
