// TODO: Consider extracting parsePlannedExercise and parsePerformedRaw into src/lib/calculations.ts
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import { parsePrescription, parseComboPrescription } from '../lib/prescriptionParser';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnalysisParams {
  athleteId: string;
  startDate: string;
  endDate: string;
  exerciseFilter?: string[];
  categoryFilter?: string[];
}

export interface ExerciseBreakdown {
  exerciseId: string;
  exerciseName: string;
  category: string;
  color: string;
  plannedSets: number;
  plannedReps: number;
  plannedMaxLoad: number;
  plannedAvgLoad: number;
  performedSets: number;
  performedReps: number;
  performedTonnage: number;
  performedMaxLoad: number;
  performedAvgLoad: number;
}

export interface WeeklyAggregate {
  weekStart: string;
  weekNumber: number;
  weekType: string | null;
  phaseName: string | null;
  phaseColor: string | null;
  totalRepsTarget: number | null;
  plannedSets: number;
  plannedReps: number;
  plannedTonnage: number;
  plannedExerciseCount: number;
  performedSets: number;
  performedReps: number;
  performedTonnage: number;
  performedExerciseCount: number;
  skippedExercises: number;
  complianceReps: number;
  complianceTonnage: number;
  exerciseBreakdowns: ExerciseBreakdown[];
  rawTotal: number | null;
  sessionRpe: number | null;
  avgBodyweight: number | null;
}

export interface IntensityZone {
  zone: string;
  reps: number;
  percentage: number;
}

export interface LiftRatio {
  name: string;
  value: number;
  target: string;
  targetMin: number;
  targetMax: number;
  color: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  const diff = d.getUTCDate() + (day === 0 ? -6 : 1 - day);
  d.setUTCDate(diff);
  return d.toISOString().slice(0, 10);
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function parsePerformedRaw(raw: string): { reps: number; sets: number; load: number } {
  if (!raw) return { reps: 0, sets: 0, load: 0 };
  const lines = parsePrescription(raw);
  if (lines.length > 0) {
    const totalReps = lines.reduce((s, l) => s + l.reps * l.sets, 0);
    const totalSets = lines.reduce((s, l) => s + l.sets, 0);
    const maxLoad = Math.max(...lines.map(l => l.load));
    return { reps: totalReps, sets: totalSets, load: maxLoad };
  }
  // Try combo
  const combo = parseComboPrescription(raw);
  if (combo.length > 0) {
    const totalReps = combo.reduce((s, l) => s + l.totalReps * l.sets, 0);
    const totalSets = combo.reduce((s, l) => s + l.sets, 0);
    const maxLoad = Math.max(...combo.map(l => l.load));
    return { reps: totalReps, sets: totalSets, load: maxLoad };
  }
  return { reps: 0, sets: 0, load: 0 };
}

function parsePlannedExercise(pe: {
  prescription_raw: string | null;
  summary_total_sets: number | null;
  summary_total_reps: number | null;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
  is_combo: boolean;
}): { sets: number; reps: number; maxLoad: number; avgLoad: number; tonnage: number } {
  // Prefer summary fields
  const sets = pe.summary_total_sets ?? 0;
  const reps = pe.summary_total_reps ?? 0;
  const maxLoad = pe.summary_highest_load ?? 0;
  const avgLoad = pe.summary_avg_load ?? 0;
  const tonnage = reps * avgLoad;
  if (sets > 0 || reps > 0) return { sets, reps, maxLoad, avgLoad, tonnage };

  // Fall back to parsing prescription_raw
  if (pe.prescription_raw) {
    const parser = pe.is_combo ? parseComboPrescription : parsePrescription;
    if (pe.is_combo) {
      const lines = parseComboPrescription(pe.prescription_raw);
      if (lines.length > 0) {
        const totalSets = lines.reduce((s, l) => s + l.sets, 0);
        const totalReps = lines.reduce((s, l) => s + l.totalReps * l.sets, 0);
        const mxLoad = Math.max(...lines.map(l => l.loadMax ?? l.load));
        const effectiveLC = (l: typeof lines[0]) => l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load;
        const avgL = lines.reduce((s, l) => s + effectiveLC(l) * l.sets, 0) / (totalSets || 1);
        return { sets: totalSets, reps: totalReps, maxLoad: mxLoad, avgLoad: avgL, tonnage: totalReps * avgL };
      }
    } else {
      const lines = parsePrescription(pe.prescription_raw);
      if (lines.length > 0) {
        const totalSets = lines.reduce((s, l) => s + l.sets, 0);
        const totalReps = lines.reduce((s, l) => s + l.reps * l.sets, 0);
        const mxLoad = Math.max(...lines.map(l => l.loadMax ?? l.load));
        const effectiveL = (l: typeof lines[0]) => l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load;
        const avgL = lines.reduce((s, l) => s + effectiveL(l) * l.sets, 0) / (totalSets || 1);
        return { sets: totalSets, reps: totalReps, maxLoad: mxLoad, avgLoad: avgL, tonnage: totalReps * avgL };
      }
    }
  }
  return { sets: 0, reps: 0, maxLoad: 0, avgLoad: 0, tonnage: 0 };
}

// ─── Main fetch functions ────────────────────────────────────────────────────

export async function fetchWeeklyAggregates(params: AnalysisParams): Promise<WeeklyAggregate[]> {
  const { athleteId, startDate, endDate, exerciseFilter = [], categoryFilter = [] } = params;

  const [
    weekPlansRes,
    macroWeeksRes,
    macroPhasesRes,
    sessionsRes,
    logExercisesRes,
    bodyweightRes,
    exercisesRes,
  ] = await Promise.all([
    supabase
      .from('week_plans')
      .select('id, week_start')
      .eq('owner_id', getOwnerId())
      .eq('athlete_id', athleteId)
      .gte('week_start', startDate)
      .lte('week_start', endDate)
      .order('week_start'),
    supabase
      .from('macro_weeks')
      .select('week_start, week_number, week_type, week_type_text, total_reps_target, phase_id, macrocycle_id, macrocycles!inner(owner_id)')
      .eq('macrocycles.owner_id', getOwnerId())
      .gte('week_start', startDate)
      .lte('week_start', endDate),
    supabase
      .from('macro_phases')
      .select('id, name, color, macrocycle_id')
      .eq('owner_id', getOwnerId()),
    supabase
      .from('training_log_sessions')
      .select('id, date, week_start, raw_total, session_rpe, status')
      .eq('athlete_id', athleteId)
      .neq('status', 'planned')
      .gte('date', startDate)
      .lte('date', endDate),
    supabase
      .from('training_log_exercises')
      .select('session_id, exercise_id, performed_raw, status, planned_exercise_id')
      .in('session_id', []),  // placeholder; we'll refetch below
    supabase
      .from('bodyweight_entries')
      .select('date, weight_kg')
      .eq('athlete_id', athleteId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date'),
    supabase
      .from('exercises')
      .select('id, name, category, color')
      .eq('owner_id', getOwnerId()),
  ]);

  const weekPlans = weekPlansRes.data ?? [];
  const macroWeeks = macroWeeksRes.data ?? [];
  const macroPhases = macroPhasesRes.data ?? [];
  const sessions = sessionsRes.data ?? [];
  const bwEntries = bodyweightRes.data ?? [];
  const exercises = (exercisesRes.data ?? []).filter(
    (e: { id: string; name: string; category: string; color: string }) => e.category !== '— System'
  ) as Array<{ id: string; name: string; category: string; color: string }>;

  const exerciseMap = new Map(exercises.map(e => [e.id, e]));

  // Fetch planned exercises for all week plans
  const weekPlanIds = weekPlans.map(w => w.id);
  let plannedExercises: Array<{
    id: string; weekplan_id: string; day_index: number; exercise_id: string;
    prescription_raw: string | null; summary_total_sets: number | null; summary_total_reps: number | null;
    summary_highest_load: number | null; summary_avg_load: number | null; is_combo: boolean;
  }> = [];

  if (weekPlanIds.length > 0) {
    const peRes = await supabase
      .from('planned_exercises')
      .select('id, weekplan_id, day_index, exercise_id, prescription_raw, summary_total_sets, summary_total_reps, summary_highest_load, summary_avg_load, is_combo')
      .in('weekplan_id', weekPlanIds);
    plannedExercises = (peRes.data ?? []) as typeof plannedExercises;
  }

  // Apply filters
  if (exerciseFilter.length > 0) {
    plannedExercises = plannedExercises.filter(pe => exerciseFilter.includes(pe.exercise_id));
  }
  if (categoryFilter.length > 0) {
    plannedExercises = plannedExercises.filter(pe => {
      const ex = exerciseMap.get(pe.exercise_id);
      return ex ? categoryFilter.includes(ex.category) : false;
    });
  }

  // Fetch training log exercises for sessions in range
  const sessionIds = sessions.map(s => s.id);
  let logExercises: Array<{
    session_id: string; exercise_id: string; performed_raw: string; status: string; planned_exercise_id: string | null;
  }> = [];

  if (sessionIds.length > 0) {
    const leRes = await supabase
      .from('training_log_exercises')
      .select('session_id, exercise_id, performed_raw, status, planned_exercise_id')
      .in('session_id', sessionIds);
    logExercises = (leRes.data ?? []) as typeof logExercises;
  }

  // Build lookup maps
  const weekPlanByWeekStart = new Map(weekPlans.map(w => [w.week_start, w.id]));
  const plannedByWeekPlan = new Map<string, typeof plannedExercises>();
  for (const pe of plannedExercises) {
    const arr = plannedByWeekPlan.get(pe.weekplan_id) ?? [];
    arr.push(pe);
    plannedByWeekPlan.set(pe.weekplan_id, arr);
  }

  const sessionsByWeekStart = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const ws = s.week_start ?? getMonday(s.date);
    const arr = sessionsByWeekStart.get(ws) ?? [];
    arr.push(s);
    sessionsByWeekStart.set(ws, arr);
  }

  const logExBySession = new Map<string, typeof logExercises>();
  for (const le of logExercises) {
    const arr = logExBySession.get(le.session_id) ?? [];
    arr.push(le);
    logExBySession.set(le.session_id, arr);
  }

  // Macro week lookup
  const macroWeekByStart = new Map(macroWeeks.map(mw => [mw.week_start, mw]));
  const macroPhaseMap = new Map((macroPhases as Array<{ id: string; name: string; color: string; macrocycle_id: string }>).map(p => [p.id, p]));

  // Bodyweight by week
  const bwByWeek = new Map<string, number[]>();
  for (const bw of bwEntries) {
    const ws = getMonday(bw.date);
    const arr = bwByWeek.get(ws) ?? [];
    arr.push(bw.weight_kg);
    bwByWeek.set(ws, arr);
  }

  // Generate all weeks in range
  const weeks: string[] = [];
  let cur = getMonday(startDate);
  const end = endDate;
  while (cur <= end) {
    weeks.push(cur);
    cur = addWeeks(cur, 1);
  }

  return weeks.map(weekStart => {
    const macroWeek = macroWeekByStart.get(weekStart);
    const phase = macroWeek?.phase_id ? macroPhaseMap.get(macroWeek.phase_id) : undefined;

    const weekPlanId = weekPlanByWeekStart.get(weekStart);
    const pes = weekPlanId ? (plannedByWeekPlan.get(weekPlanId) ?? []) : [];
    const weekSessions = sessionsByWeekStart.get(weekStart) ?? [];

    // Planned aggregates
    let plannedSets = 0, plannedReps = 0, plannedTonnage = 0;
    const exBreakdownMap = new Map<string, ExerciseBreakdown>();

    for (const pe of pes) {
      const parsed = parsePlannedExercise(pe);
      plannedSets += parsed.sets;
      plannedReps += parsed.reps;
      plannedTonnage += parsed.tonnage;

      const ex = exerciseMap.get(pe.exercise_id);
      if (ex) {
        const bd = exBreakdownMap.get(pe.exercise_id) ?? {
          exerciseId: ex.id, exerciseName: ex.name, category: ex.category, color: ex.color,
          plannedSets: 0, plannedReps: 0, plannedMaxLoad: 0, plannedAvgLoad: 0,
          performedSets: 0, performedReps: 0, performedTonnage: 0, performedMaxLoad: 0, performedAvgLoad: 0,
        };
        bd.plannedSets += parsed.sets;
        bd.plannedReps += parsed.reps;
        bd.plannedMaxLoad = Math.max(bd.plannedMaxLoad, parsed.maxLoad);
        bd.plannedAvgLoad = parsed.avgLoad;
        exBreakdownMap.set(pe.exercise_id, bd);
      }
    }

    // Performed aggregates
    let performedSets = 0, performedReps = 0, performedTonnage = 0, skippedExercises = 0;
    const rawTotals: number[] = [];
    const rpeValues: number[] = [];
    let performedExerciseCount = 0;

    for (const session of weekSessions) {
      if (session.raw_total != null) rawTotals.push(session.raw_total);
      if (session.session_rpe != null) rpeValues.push(session.session_rpe);

      const les = logExBySession.get(session.id) ?? [];
      for (const le of les) {
        if (exerciseFilter.length > 0 && !exerciseFilter.includes(le.exercise_id)) continue;
        const ex = exerciseMap.get(le.exercise_id);
        if (categoryFilter.length > 0 && (!ex || !categoryFilter.includes(ex.category))) continue;

        if (le.status === 'skipped') {
          skippedExercises++;
          continue;
        }
        performedExerciseCount++;
        const parsed = parsePerformedRaw(le.performed_raw);
        performedSets += parsed.sets;
        performedReps += parsed.reps;
        performedTonnage += parsed.reps * parsed.load;

        if (ex) {
          const bd = exBreakdownMap.get(le.exercise_id) ?? {
            exerciseId: ex.id, exerciseName: ex.name, category: ex.category, color: ex.color,
            plannedSets: 0, plannedReps: 0, plannedMaxLoad: 0, plannedAvgLoad: 0,
            performedSets: 0, performedReps: 0, performedMaxLoad: 0, performedAvgLoad: 0,
          };
          bd.performedSets += parsed.sets;
          bd.performedReps += parsed.reps;
          bd.performedTonnage += parsed.reps * parsed.load;
          bd.performedMaxLoad = Math.max(bd.performedMaxLoad, parsed.load);
          bd.performedAvgLoad = parsed.load;
          exBreakdownMap.set(le.exercise_id, bd);
        }
      }
    }

    const bwValues = bwByWeek.get(weekStart) ?? [];
    const avgBodyweight = bwValues.length > 0 ? bwValues.reduce((a, b) => a + b, 0) / bwValues.length : null;
    const rawTotal = rawTotals.length > 0 ? rawTotals.reduce((a, b) => a + b, 0) / rawTotals.length : null;
    const sessionRpe = rpeValues.length > 0 ? rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length : null;

    return {
      weekStart,
      weekNumber: macroWeek?.week_number ?? 0,
      weekType: macroWeek?.week_type ?? null,
      phaseName: phase?.name ?? null,
      phaseColor: phase?.color ?? null,
      totalRepsTarget: macroWeek?.total_reps_target ?? null,
      plannedSets,
      plannedReps,
      plannedTonnage,
      plannedExerciseCount: pes.length,
      performedSets,
      performedReps,
      performedTonnage,
      performedExerciseCount,
      skippedExercises,
      complianceReps: plannedReps > 0 ? Math.round((performedReps / plannedReps) * 100) : 0,
      complianceTonnage: plannedTonnage > 0 ? Math.round((performedTonnage / plannedTonnage) * 100) : 0,
      exerciseBreakdowns: Array.from(exBreakdownMap.values()),
      rawTotal,
      sessionRpe,
      avgBodyweight,
    };
  });
}

export async function fetchExerciseTimeSeries(
  athleteId: string,
  exerciseId: string,
  startDate: string,
  endDate: string
): Promise<{ date: string; maxLoad: number; avgLoad: number; totalReps: number; totalSets: number }[]> {
  const { data: sessions } = await supabase
    .from('training_log_sessions')
    .select('id, date')
    .eq('athlete_id', athleteId)
    .neq('status', 'planned')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date');

  if (!sessions?.length) return [];

  const sessionIds = sessions.map(s => s.id);
  const { data: logExercises } = await supabase
    .from('training_log_exercises')
    .select('session_id, performed_raw, status')
    .in('session_id', sessionIds)
    .eq('exercise_id', exerciseId);

  if (!logExercises?.length) return [];

  const sessionDateMap = new Map(sessions.map(s => [s.id, s.date]));
  const byDate = new Map<string, { loads: number[]; reps: number; sets: number }>();

  for (const le of logExercises) {
    if (le.status === 'skipped') continue;
    const date = sessionDateMap.get(le.session_id);
    if (!date) continue;
    const parsed = parsePerformedRaw(le.performed_raw);
    if (!byDate.has(date)) byDate.set(date, { loads: [], reps: 0, sets: 0 });
    const entry = byDate.get(date)!;
    if (parsed.load > 0) entry.loads.push(parsed.load);
    entry.reps += parsed.reps;
    entry.sets += parsed.sets;
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      maxLoad: d.loads.length > 0 ? Math.max(...d.loads) : 0,
      avgLoad: d.loads.length > 0 ? d.loads.reduce((a, b) => a + b, 0) / d.loads.length : 0,
      totalReps: d.reps,
      totalSets: d.sets,
    }));
}

export async function fetchIntensityZones(
  athleteId: string,
  exerciseId: string,
  startDate: string,
  endDate: string,
  oneRepMax: number
): Promise<IntensityZone[]> {
  const timeSeries = await fetchExerciseTimeSeries(athleteId, exerciseId, startDate, endDate);

  const zones = [
    { zone: '<70%', min: 0, max: 0.7, reps: 0 },
    { zone: '70-80%', min: 0.7, max: 0.8, reps: 0 },
    { zone: '80-90%', min: 0.8, max: 0.9, reps: 0 },
    { zone: '90%+', min: 0.9, max: Infinity, reps: 0 },
  ];

  for (const entry of timeSeries) {
    if (!entry.avgLoad || !oneRepMax) continue;
    const pct = entry.avgLoad / oneRepMax;
    const zone = zones.find(z => pct >= z.min && pct < z.max);
    if (zone) zone.reps += entry.totalReps;
  }

  const totalReps = zones.reduce((s, z) => s + z.reps, 0);
  return zones.map(z => ({
    zone: z.zone,
    reps: z.reps,
    percentage: totalReps > 0 ? Math.round((z.reps / totalReps) * 100) : 0,
  }));
}

export async function fetchLiftRatios(athleteId: string): Promise<LiftRatio[]> {
  const [prsRes, exercisesRes] = await Promise.all([
    supabase
      .from('athlete_prs')
      .select('exercise_id, pr_value_kg, pr_date')
      .eq('athlete_id', athleteId),
    supabase
      .from('exercises')
      .select('id, name, lift_slot'),
  ]);

  const prs = prsRes.data ?? [];
  const exercises = (exercisesRes.data ?? []) as Array<{ id: string; name: string; lift_slot: string | null }>;

  const exMap = new Map(exercises.map(e => [e.id, { name: e.name.toLowerCase(), liftSlot: e.lift_slot }]));

  // Group PRs by exercise, take highest pr_value_kg
  const bestPR = new Map<string, number>();
  for (const pr of prs) {
    if (!pr.pr_value_kg) continue;
    const current = bestPR.get(pr.exercise_id) ?? 0;
    if (pr.pr_value_kg > current) bestPR.set(pr.exercise_id, pr.pr_value_kg);
  }

  // Find best load for each lift slot — primary: lift_slot, fallback: name heuristic
  function findBySlot(slot: string): number {
    let best = 0;
    for (const [exId, load] of bestPR.entries()) {
      if ((exMap.get(exId)?.liftSlot ?? null) === slot && load > best) best = load;
    }
    return best;
  }
  function findByName(pattern: (name: string) => boolean): number {
    let best = 0;
    for (const [exId, load] of bestPR.entries()) {
      const ex = exMap.get(exId);
      // Skip exercises that already have a lift_slot — already handled above
      if (ex?.liftSlot) continue;
      if (pattern(ex?.name ?? '') && load > best) best = load;
    }
    return best;
  }

  const snatch  = findBySlot('snatch')        || findByName(n => n.includes('snatch') && !n.includes('pull') && !n.includes('press') && !n.includes('balance'));
  const cj      = findBySlot('clean_and_jerk') || findByName(n => n.includes('clean') && n.includes('jerk'));
  const bsq     = findBySlot('back_squat')    || findByName(n => n.includes('back squat'));
  const fsq     = findBySlot('front_squat')   || findByName(n => n.includes('front squat'));
  const snPull  = findBySlot('snatch_pull')   || findByName(n => n.includes('snatch pull'));
  const clPull  = findBySlot('clean_pull')    || findByName(n => n.includes('clean pull'));

  const ratios: LiftRatio[] = [];

  function addRatio(name: string, numerator: number, denominator: number, targetMin: number, targetMax: number) {
    if (!numerator || !denominator) return;
    const value = Math.round((numerator / denominator) * 1000) / 10;
    const inRange = value >= targetMin && value <= targetMax;
    const close = Math.abs(value - targetMin) <= 3 || Math.abs(value - targetMax) <= 3;
    ratios.push({
      name,
      value,
      target: `${targetMin}-${targetMax}%`,
      targetMin,
      targetMax,
      color: inRange ? '#1D9E75' : close ? '#EF9F27' : '#E24B4A',
    });
  }

  addRatio('Snatch / C&J', snatch, cj, 80, 85);
  addRatio('Snatch / Back squat', snatch, bsq, 65, 70);
  addRatio('C&J / Back squat', cj, bsq, 78, 83);
  addRatio('Front squat / Back squat', fsq, bsq, 83, 87);
  addRatio('Snatch pull / Snatch', snPull, snatch, 105, 110);
  addRatio('Clean pull / C&J', clPull, cj, 110, 115);

  return ratios;
}

export async function fetchBodyweightSeries(
  athleteId: string,
  startDate: string,
  endDate: string
): Promise<{ date: string; weight: number }[]> {
  const { data } = await supabase
    .from('bodyweight_entries')
    .select('date, weight_kg')
    .eq('athlete_id', athleteId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date');

  return (data ?? []).map(d => ({ date: d.date, weight: d.weight_kg }));
}

export async function fetchPRTimeline(
  athleteId: string,
  startDate: string,
  endDate: string
): Promise<{ date: string; exerciseName: string; load: number; reps: number; isCompetition: boolean }[]> {
  const [prsRes, exercisesRes] = await Promise.all([
    supabase
      .from('athlete_prs')
      .select('exercise_id, pr_value_kg, pr_date')
      .eq('athlete_id', athleteId)
      .gte('pr_date', startDate)
      .lte('pr_date', endDate)
      .order('pr_date'),
    supabase
      .from('exercises')
      .select('id, name, is_competition_lift'),
  ]);

  const prs = prsRes.data ?? [];
  const exercises = (exercisesRes.data ?? []) as Array<{ id: string; name: string; is_competition_lift: boolean }>;
  const exMap = new Map(exercises.map(e => [e.id, e]));

  return prs
    .filter(p => p.pr_date && p.pr_value_kg)
    .map(p => {
      const ex = exMap.get(p.exercise_id);
      return {
        date: p.pr_date!,
        exerciseName: ex?.name ?? 'Unknown',
        load: p.pr_value_kg!,
        reps: 1,
        isCompetition: ex?.is_competition_lift ?? false,
      };
    });
}
