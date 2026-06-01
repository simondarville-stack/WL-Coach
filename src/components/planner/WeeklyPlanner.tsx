// TODO: Consider extracting macro context loading into a dedicated hook (or unifying with useMacroContext.ts)
// TODO: Consider extracting print-mode rendering into a PrintManager component
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useWeekPlans } from '../../hooks/useWeekPlans';
import { useSettings } from '../../hooks/useSettings';
import { useAthleteStore } from '../../store/athleteStore';
import { useExercises } from '../../hooks/useExercises';
import { useAthletes } from '../../hooks/useAthletes';
import { useTrainingGroups } from '../../hooks/useTrainingGroups';
import { useCoachStore } from '../../store/coachStore';
import { useExerciseStore } from '../../store/exerciseStore';
import { defaultUnitLabel } from '../../lib/constants';
import { formatDateRange } from '../../lib/dateUtils';
import { getMondayOfWeekISO as getMondayOfWeek } from '../../lib/weekUtils';
import { DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';
import { parsePrescription, formatPrescription, parseComboPrescription, formatComboPrescription } from '../../lib/prescriptionParser';
import type { PlanSelection } from '../../hooks/useWeekPlans';
import { WeekOverview } from './WeekOverview';
import { DayEditor } from './DayEditor';
import { ExerciseDetail } from './ExerciseDetail';
import { WeekSummaryBox } from './WeekSummaryBox';
import { WeekNavRibbon } from './WeekNavRibbon';
import { PlannerControlPanel } from './PlannerControlPanel';
import { UnsavedDraftsBanner } from './UnsavedDraftsBanner';
import { LogModeView } from './log/LogModeView';
import { GroupLogView } from './log/GroupLogView';
import { PlannerModals } from './PlannerModals';
import { PlannerWeekOverview } from './PlannerWeekOverview';
import { PlannerDock } from './dock/PlannerDock';
import { TemplateImportDialog } from './dock/TemplateImportDialog';
import {
  useClipboardState,
  type ClipboardExerciseSnapshot,
  type ClipboardExerciseDisplay,
} from './dock/useClipboardState';
import { getSentinelType } from './sentinelUtils';
import { ResolvePercentagesModal, type ResolveCandidate, type ResolveRoundingOptions, type ResolveDirection } from './ResolvePercentagesModal';
import { AthleteCardPicker } from '../AthleteCardPicker';
import { MacroTimeline } from '../planning';
import { ArrowLeft } from 'lucide-react';
import {
  applyTemplateDayToPlanDay,
  createTemplateFromDay,
  createTemplateFromWeek,
  fetchTemplateFull,
} from '../../lib/templateService';
import { SaveAsTemplateModal, type SaveAsTemplateInput } from './SaveAsTemplateModal';

export interface MacroContext {
  macroId: string;
  macroName: string;
  weekType: string;
  weekTypeText: string | null;
  weekNumber: number;
  totalWeeks: number;
  phaseName: string | null;
  phaseColor: string | null;
  totalRepsTarget: number | null;
}

type PanelView = 'overview' | 'day' | 'exercise';

export function WeeklyPlanner() {
  const { weekStart: urlWeekStart } = useParams<{ weekStart?: string }>();
  const navigate = useNavigate();
  const { selectedAthlete, setSelectedAthlete, selectedGroup: storeSelectedGroup, setSelectedGroup } = useAthleteStore();
  const { settings, fetchSettings } = useSettings();

  const [selectedDate, setSelectedDate] = useState(() => {
    if (urlWeekStart) return urlWeekStart;
    return getMondayOfWeek(new Date());
  });
  const [planSelection, setPlanSelection] = useState<PlanSelection>({
    type: 'individual',
    athlete: selectedAthlete,
    group: null,
  });

  // Panel navigation
  const [panelView, setPanelView] = useState<PanelView>('overview');
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);

  const { exercises: allExercises } = useExercises();
  const { fetchAllAthletes } = useAthletes();
  const { fetchGroups } = useTrainingGroups();

  const {
    weekPlan: currentWeekPlan,
    setWeekPlan: setCurrentWeekPlan,
    plannedExercises,
    setPlannedExercises,
    comboMembers,
    athletePRs,
    setAthletePRs,
    macroWeekTarget,
    setMacroWeekTarget,
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
    updateWeekPlan,
    reorderExercises,
    moveExercise,
    reorderInDay,
    insertExerciseSnapshot,
    normalizePositions,
    savePrescription,
    saveNotes,
    saveGppSection,
    saveMediaDescription,
    fetchOtherDayPrescriptions,
    addExerciseToDay,
    createComboExercise,
    swapPlannedExercise,
    updateComboExercise,
    copyExerciseWithSetLines,
    copyDayExercises,
    deleteDayExercises,
    syncGroupPlanToAthletes,
  } = useWeekPlans();

  // Wrap addExerciseToDay so manually-added exercises on individual plans get source='individual',
  // giving them the I badge and protecting them from being overwritten on group sync.
  const addExerciseToDayWrapped: typeof addExerciseToDay = (weekPlanId, dayIndex, exerciseId, position, unit, extras) =>
    addExerciseToDay(weekPlanId, dayIndex, exerciseId, position, unit, {
      ...extras,
      source: planSelection.type === 'individual' ? 'individual' : (extras?.source ?? null),
    });

  const [macroContext, setMacroContext] = useState<MacroContext | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [pendingWeekPaste, setPendingWeekPaste] = useState<string | null>(null);
  const [showLoadDistribution, setShowLoadDistribution] = useState(false);

  // Press "L" toggles the load-distribution band (D stays bound to the dock).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'l' && e.key !== 'L') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setShowLoadDistribution(s => !s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [resolveCandidates, setResolveCandidates] = useState<ResolveCandidate[] | null>(null);
  const [resolveDirection, setResolveDirection] = useState<ResolveDirection>('percent-to-kg');
  const [importTarget, setImportTarget] = useState<{ templateId: string; startDayIndex: number } | null>(null);
  const [saveTarget, setSaveTarget] = useState<{ kind: 'day'; dayIndex: number } | { kind: 'week' } | null>(null);
  // Convert-then-save flow: when the user ticks "Convert kg to percentages
  // before saving", the SaveAsTemplateModal closes and we route through
  // the resolver modal in kg → % direction. The original input is stashed
  // so the actual template insert can use the converted prescriptions.
  const [pendingConvertSave, setPendingConvertSave] = useState<{
    scope: { kind: 'day'; dayIndex: number } | { kind: 'week' };
    input: SaveAsTemplateInput;
  } | null>(null);
  const [convertCandidates, setConvertCandidates] = useState<ResolveCandidate[] | null>(null);
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [editingDayLabels, setEditingDayLabels] = useState<Record<number, string>>({});
  const [weekDescription, setWeekDescription] = useState<string>('');
  const [dayDisplayOrder, setDayDisplayOrder] = useState<number[]>([]);
  const [editingDaySchedule, setEditingDaySchedule] = useState<Record<number, { weekday: number; time: string | null }>>({});
  const [draggedDayIndex, setDraggedDayIndex] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showWeekList, setShowWeekList] = useState(() => {
    return !urlWeekStart;
  });
  const [viewMode, setViewMode] = useState<'plan' | 'log'>('plan');

  // Keep internal view in sync with URL on subsequent navigations.
  // useState initializers only run once; this effect handles the
  // case where the user navigates from /planner → /planner/2026-04-13
  // while the planner is already mounted.
  useEffect(() => {
    if (urlWeekStart) {
      setSelectedDate(urlWeekStart);
      setShowWeekList(false);
    } else {
      setShowWeekList(true);
    }
  }, [urlWeekStart]);

  useEffect(() => {
    // No standalone fetchExercisesByName here — the context-aware effect
    // below covers both "no athlete selected" (active coach's library)
    // and "shared athlete" (host coach's library). Issuing both in
    // parallel races: the store no-ops the second call while the first
    // is loading, which would otherwise pin Coach B's library when
    // working on a shared athlete.
    fetchGroups();
    fetchAllAthletes();
    fetchSettings();
  }, []);

  // Hot-swap the exercise + category library when the planning context
  // changes. For unshared athletes/groups the host == active coach and
  // this is a no-op (the store's cache hits). For shared athletes the
  // store repopulates with the host's library so the picker shows the
  // exercises that the programme is actually written against.
  const { fetchExercisesByName: fetchContextExercises, fetchCategories: fetchContextCategories } =
    useExerciseStore();
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const contextOwnerId =
    selectedAthlete?.owner_id ?? storeSelectedGroup?.owner_id ?? activeCoachId;
  useEffect(() => {
    if (!contextOwnerId) return;
    void fetchContextExercises(contextOwnerId);
    void fetchContextCategories(contextOwnerId);
  }, [contextOwnerId, fetchContextExercises, fetchContextCategories]);

  useEffect(() => {
    if (selectedAthlete) {
      setPlanSelection({ type: 'individual', athlete: selectedAthlete, group: null });
      if (!urlWeekStart) setShowWeekList(true);
    }
  }, [selectedAthlete]);

  useEffect(() => {
    if (storeSelectedGroup) {
      setPlanSelection({ type: 'group', athlete: null, group: storeSelectedGroup });
      if (!urlWeekStart) setShowWeekList(true);
    }
  }, [storeSelectedGroup]);

  useEffect(() => {
    if (planSelection.athlete || planSelection.group) {
      loadWeekPlan();
      if (planSelection.athlete) {
        loadMacroWeekTarget();
        loadMacroContext(planSelection.athlete.id, selectedDate);
        loadAthletePRs(planSelection.athlete.id);
      } else {
        setMacroWeekTarget(null);
        setMacroWeekTypeText(null);
        setAthletePRs([]);
        setMacroContext(null);
      }
    } else {
      setCurrentWeekPlan(null);
      setPlannedExercises({});
      setMacroWeekTarget(null);
      setMacroWeekTypeText(null);
      setAthletePRs([]);
      setMacroContext(null);
    }
    // Reset panel on week/athlete change
    setPanelView('overview');
    setSelectedDayIndex(null);
    setSelectedExerciseId(null);
  }, [selectedDate, planSelection]);

  useEffect(() => {
    if (currentWeekPlan) {
      setActiveDays(currentWeekPlan.active_days);
      const labels = currentWeekPlan.day_labels || {};
      const order = currentWeekPlan.day_display_order || currentWeekPlan.active_days.slice().sort((a, b) => a - b);
      const initialLabels: Record<number, string> = {};
      const maxDay = Math.max(...currentWeekPlan.active_days, 7);
      for (let i = 1; i <= maxDay; i++) {
        initialLabels[i] = labels[i] || defaultUnitLabel(i, order);
      }
      setEditingDayLabels(initialLabels);
      setWeekDescription(currentWeekPlan.week_description || '');
      setDayDisplayOrder(order);
      setEditingDaySchedule(
        (currentWeekPlan.day_schedule as Record<number, { weekday: number; time: string | null }> | null) ?? {}
      );
    }
  }, [currentWeekPlan]);

  // Global Escape/Enter key closes any open dialog (with refresh)
  useEffect(() => {
    if (panelView === 'overview') return;
    const handler = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        await closeDialog();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelView]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadExercises();
        if (selectedAthlete && currentWeekPlan) {
          loadPlannedExercises(currentWeekPlan.id);
          loadMacroWeekTarget();
        }
      }
    };
    const handleFocus = () => {
      loadExercises();
      if (selectedAthlete && currentWeekPlan) {
        loadPlannedExercises(currentWeekPlan.id);
        loadMacroWeekTarget();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [selectedAthlete, currentWeekPlan]);

  // Refresh the exercise library on tab focus / visibility change. Uses
  // the context-aware fetch so a shared athlete's planner stays on the
  // host's catalogue across blur/focus cycles.
  const loadExercises = () => {
    if (contextOwnerId) void fetchContextExercises(contextOwnerId);
  };
  const loadAthletePRs = (athleteId: string) => fetchAthletePRs(athleteId);

  const loadWeekPlan = async () => {
    const plan = await fetchOrCreateWeekPlan(selectedDate, planSelection);
    if (plan) {
      await Promise.all([
        fetchPlannedExercises(plan.id, plan.day_labels),
        fetchWeekCombos(plan.id),
      ]);
    }
  };

  const loadMacroWeekTarget = async () => {
    if (!planSelection.athlete) return;
    await fetchMacroWeekTarget(planSelection.athlete.id, selectedDate);
  };

  const loadMacroContext = async (athleteId: string, date: string) => {
    try {
      const { data: mwRaw } = await supabase
        .from('macro_weeks')
        .select(`
          id, macrocycle_id, week_number, week_type, week_type_text, total_reps_target,
          macrocycles!inner(id, athlete_id, start_date, end_date, name)
        `)
        .eq('macrocycles.athlete_id', athleteId)
        .eq('week_start', date)
        .lte('macrocycles.start_date', date)
        .gte('macrocycles.end_date', date)
        .limit(1)
        .maybeSingle();

      type MacroWeekWithJoin = {
        id: string; macrocycle_id: string; week_number: number;
        week_type: string | null; week_type_text: string | null; total_reps_target: number | null;
        macrocycles: { id: string; name: string } | null;
      };
      const mw = mwRaw as MacroWeekWithJoin | null;
      if (!mw) { setMacroContext(null); return; }

      const macro = mw.macrocycles;

      const [phaseResult, countResult] = await Promise.all([
        supabase
          .from('macro_phases')
          .select('name, color')
          .eq('macrocycle_id', mw.macrocycle_id)
          .lte('start_week_number', mw.week_number)
          .gte('end_week_number', mw.week_number)
          .maybeSingle(),
        supabase
          .from('macro_weeks')
          .select('id', { count: 'exact', head: true })
          .eq('macrocycle_id', mw.macrocycle_id),
      ]);

      setMacroContext({
        macroId: mw.macrocycle_id,
        macroName: macro?.name ?? 'Macrocycle',
        weekType: mw.week_type ?? '',
        weekTypeText: mw.week_type_text,
        weekNumber: mw.week_number,
        totalWeeks: countResult.count ?? 0,
        phaseName: phaseResult.data?.name ?? null,
        phaseColor: phaseResult.data?.color ?? null,
        totalRepsTarget: mw.total_reps_target,
      });
    } catch {
      setMacroContext(null);
    }
  };

  const loadPlannedExercises = (weekPlanId: string) =>
    fetchPlannedExercises(weekPlanId, currentWeekPlan?.day_labels);

  const handleRefresh = async () => {
    if (currentWeekPlan) {
      await Promise.all([
        fetchPlannedExercises(currentWeekPlan.id, currentWeekPlan.day_labels),
        fetchWeekCombos(currentWeekPlan.id),
      ]);
    }
  };

  // Close any dialog — wait briefly for any in-flight saves, then refresh so day cards reflect changes
  const closeDialog = async () => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await handleRefresh();
    setPanelView('overview');
  };

  const handleDeleteExercise = async (plannedExerciseId: string) => {
    if (!currentWeekPlan) return;
    const dayIndex = Object.entries(plannedExercises).find(
      ([, exs]) => exs.some(ex => ex.id === plannedExerciseId)
    )?.[0];
    try {
      await deletePlannedExercise(plannedExerciseId);
      if (dayIndex) await normalizePositions(currentWeekPlan.id, parseInt(dayIndex));
      await handleRefresh();
    } catch {
      // error already set in hook
    }
  };

  const handleExerciseDrop = async (
    fromDay: number,
    plannedExId: string,
    toDay: number,
    isCopy: boolean,
    isReplace: boolean,
    /** Cross-day drop target: ex id to land near, and side. When provided the
     *  dropped exercise lands at the target visual position instead of being
     *  appended to the end of the destination day. */
    target?: { exId: string; position: 'before' | 'after' },
  ) => {
    if (!currentWeekPlan) return;
    const sourceEx = (plannedExercises[fromDay] || []).find(ex => ex.id === plannedExId);
    if (!sourceEx) return;
    if (isReplace) {
      const targetIds = (plannedExercises[toDay] || []).map(ex => ex.id).filter(id => id !== plannedExId);
      if (targetIds.length > 0) await deleteDayExercises(targetIds);
    }
    const destPosition = isReplace ? 0 : (plannedExercises[toDay] || []).length;
    let newExId: string | null = null;
    if (isCopy) {
      newExId = await copyExerciseWithSetLines(sourceEx, currentWeekPlan.id, toDay, destPosition);
    } else {
      await moveExercise(currentWeekPlan.id, plannedExId, fromDay, toDay);
      newExId = plannedExId;
    }
    if (target && newExId && !isReplace) {
      const destExercises = (plannedExercises[toDay] || []).filter(ex => ex.id !== plannedExId);
      const targetIdx = destExercises.findIndex(ex => ex.id === target.exId);
      if (targetIdx >= 0) {
        const insertAt = target.position === 'before' ? targetIdx : targetIdx + 1;
        await reorderInDay(currentWeekPlan.id, toDay, newExId, insertAt);
      }
    }
    await handleRefresh();
  };

  const handleDayDrop = async (sourceDay: number, destDay: number, isCopy: boolean, isReplace: boolean) => {
    if (!currentWeekPlan) return;
    const srcExercises = plannedExercises[sourceDay] || [];
    if (srcExercises.length === 0 && !isReplace) return;
    if (isReplace) {
      const targetIds = (plannedExercises[destDay] || []).map(ex => ex.id);
      if (targetIds.length > 0) await deleteDayExercises(targetIds);
    }
    const basePosition = isReplace ? 0 : (plannedExercises[destDay] || []).length;
    if (srcExercises.length > 0) {
      await copyDayExercises(srcExercises, currentWeekPlan.id, destDay, basePosition);
      if (!isCopy) {
        await deleteDayExercises(srcExercises.map(ex => ex.id));
      }
    }
    await handleRefresh();
  };

  const handleDockExerciseDrop = async (exerciseId: string, dayIndex: number, isReplace: boolean) => {
    if (!currentWeekPlan) return;
    const exercise = allExercises.find(e => e.id === exerciseId);
    if (!exercise) return;
    if (isReplace) {
      const targetIds = (plannedExercises[dayIndex] || []).map(ex => ex.id);
      if (targetIds.length > 0) await deleteDayExercises(targetIds);
    }
    const destPosition = isReplace ? 0 : (plannedExercises[dayIndex] || []).length;
    await addExerciseToDayWrapped(currentWeekPlan.id, dayIndex, exercise.id, destPosition, exercise.default_unit);
    await handleRefresh();
  };

  const handleDockTemplateDayDrop = async (templateDayId: string, dayIndex: number, isReplace: boolean) => {
    if (!currentWeekPlan) return;
    try {
      await applyTemplateDayToPlanDay(templateDayId, currentWeekPlan.id, dayIndex, { replace: isReplace });
      await handleRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply template day');
    }
  };

  const handleDockTemplateDrop = async (templateId: string, dayIndex: number, isReplace: boolean) => {
    if (!currentWeekPlan) return;
    try {
      const template = await fetchTemplateFull(templateId);
      if (!template || template.days.length === 0) return;
      if (template.days.length > 1) {
        // Multi-day templates open the import dialog seeded with the drop target.
        // The dialog ignores the drop-time isReplace flag (the coach picks it
        // explicitly in the dialog) — replace-on-drag for a multi-day template
        // would otherwise be ambiguous across the N target days.
        setImportTarget({ templateId, startDayIndex: dayIndex });
        return;
      }
      await applyTemplateDayToPlanDay(template.days[0].id, currentWeekPlan.id, dayIndex, { replace: isReplace });
      await handleRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply template');
    }
  };

  const handleOpenImportDialog = (templateId: string) => {
    const firstActiveDay = visibleDays[0]?.index ?? activeDays[0] ?? 1;
    setImportTarget({ templateId, startDayIndex: firstActiveDay });
  };

  // ── Clipboard ───────────────────────────────────────────────────────────
  // The clipboard is a localStorage-backed scratch space living in the dock.
  // Coaches drag planner items into it to park them, then drag them back
  // into any day later. Snapshots include set lines + combo members + the
  // metadata blob, so sentinel types (text / video / image / GPP) round-trip
  // verbatim.
  const clipboard = useClipboardState();

  const buildExerciseDisplay = (
    ex: typeof plannedExercises[number][number],
  ): ClipboardExerciseDisplay => {
    const sentinel = getSentinelType(ex.exercise.exercise_code);
    if (sentinel === 'text') {
      return { label: ex.notes?.slice(0, 60) || 'Text note', color: 'var(--color-border-secondary)', sentinel: 'text', caption: null };
    }
    if (sentinel === 'video') {
      return { label: 'Video', color: '#6366F1', sentinel: 'video', caption: ex.notes ?? null };
    }
    if (sentinel === 'image') {
      return { label: 'Image', color: '#EC4899', sentinel: 'image', caption: ex.notes ?? null };
    }
    if (sentinel === 'gpp') {
      const rows = ex.metadata?.gpp?.rows?.length ?? 0;
      return {
        label: ex.metadata?.gpp?.title || 'GPP',
        color: '#10B981',
        sentinel: 'gpp',
        caption: rows > 0 ? `${rows} row${rows === 1 ? '' : 's'}` : null,
      };
    }
    if (ex.is_combo) {
      const members = (comboMembers[ex.id] ?? []).slice().sort((a, b) => a.position - b.position);
      const label = ex.combo_notation || members.map(m => m.exercise.name).join(' + ') || 'Combo';
      return {
        label,
        color: ex.combo_color || members[0]?.exercise.color || '#94a3b8',
        sentinel: 'combo',
        caption: 'Combo',
      };
    }
    return {
      label: ex.exercise.name,
      color: ex.exercise.color || '#94a3b8',
      sentinel: 'exercise',
      caption: ex.exercise.category ?? null,
    };
  };

  const buildExerciseSnapshot = async (
    plannedExId: string,
  ): Promise<{ display: ClipboardExerciseDisplay; snapshot: ClipboardExerciseSnapshot } | null> => {
    // Find the row in our in-memory plannedExercises map.
    let found: { dayIndex: number; ex: typeof plannedExercises[number][number] } | null = null;
    for (const [dayIdxStr, list] of Object.entries(plannedExercises)) {
      const match = list.find(e => e.id === plannedExId);
      if (match) {
        found = { dayIndex: parseInt(dayIdxStr, 10), ex: match };
        break;
      }
    }
    if (!found) return null;
    const { ex } = found;

    // Fetch set_lines for this exercise — they aren't in plannedExercises
    // state, so a parked snapshot would otherwise drop the per-set breakdown
    // when re-inserted.
    const { data: setLines } = await supabase
      .from('planned_set_lines')
      .select('sets,reps,reps_text,load_value,load_max,position')
      .eq('planned_exercise_id', ex.id)
      .order('position');

    const members = ex.is_combo
      ? (comboMembers[ex.id] ?? []).slice().sort((a, b) => a.position - b.position)
      : [];

    const display = buildExerciseDisplay(ex);
    const snapshot: ClipboardExerciseSnapshot = {
      exercise_id: ex.exercise_id,
      unit: ex.unit ?? ex.exercise.default_unit ?? 'absolute_kg',
      prescription_raw: ex.prescription_raw,
      notes: ex.notes,
      variation_note: ex.variation_note,
      summary_total_sets: ex.summary_total_sets ?? 0,
      summary_total_reps: ex.summary_total_reps ?? 0,
      summary_highest_load: ex.summary_highest_load,
      summary_avg_load: ex.summary_avg_load,
      is_combo: ex.is_combo,
      combo_notation: ex.combo_notation,
      combo_color: ex.combo_color,
      metadata: (ex.metadata ?? null) as Record<string, unknown> | null,
      set_lines: (setLines ?? []).map(l => ({
        sets: l.sets,
        reps: l.reps,
        reps_text: l.reps_text ?? null,
        load_value: l.load_value,
        load_max: l.load_max ?? null,
        position: l.position,
      })),
      combo_members: members.map(m => ({ exercise_id: m.exerciseId, position: m.position })),
    };
    return { display, snapshot };
  };

  const handleClipboardPlannerDrop = async (data: string) => {
    if (data.startsWith('DAY:')) {
      const dayIndex = parseInt(data.slice(4), 10);
      if (Number.isNaN(dayIndex)) return;
      const rows = plannedExercises[dayIndex] ?? [];
      if (rows.length === 0) return;
      const snapshots: { display: ClipboardExerciseDisplay; snapshot: ClipboardExerciseSnapshot }[] = [];
      for (const ex of rows) {
        const built = await buildExerciseSnapshot(ex.id);
        if (built) snapshots.push(built);
      }
      if (snapshots.length === 0) return;
      const label = currentWeekPlan?.day_labels?.[dayIndex]
        || defaultUnitLabel(dayIndex, dayDisplayOrder);
      clipboard.addDay(label, snapshots);
      return;
    }
    // <dayIndex>:exercise:<plannedExId>
    const parts = data.split(':');
    if (parts.length >= 3 && parts[1] === 'exercise') {
      const plannedExId = parts[2];
      const built = await buildExerciseSnapshot(plannedExId);
      if (built) clipboard.addExercise(built.display, built.snapshot);
    }
  };

  const applyWeekFromClipboard = async (weekId: string, overwrite: boolean) => {
    if (!currentWeekPlan) return;
    const week = clipboard.findById(weekId);
    if (!week || week.kind !== 'week') return;
    const src = planSelection.type === 'individual' ? 'individual' : null;
    for (const day of week.days) {
      const di = day.dayIndex;
      if (overwrite) {
        const existing = (plannedExercises[di] || []).map(ex => ex.id);
        if (existing.length > 0) await deleteDayExercises(existing);
      }
      const base = overwrite ? 0 : (plannedExercises[di] || []).length;
      for (let i = 0; i < day.exercises.length; i++) {
        await insertExerciseSnapshot(day.exercises[i].snapshot, currentWeekPlan.id, di, base + i + 1, { source: src });
      }
    }
    await handleRefresh();
  };

  const handleApplyWeekFromClipboard = (weekId: string) => {
    const week = clipboard.findById(weekId);
    if (!week || week.kind !== 'week') return;
    const anyData = week.days.some(d => (plannedExercises[d.dayIndex] || []).length > 0);
    if (anyData) setPendingWeekPaste(weekId);
    else void applyWeekFromClipboard(weekId, false);
  };

  const handleClipboardItemDrop = async (clipboardItemId: string, dayIndex: number, isReplace: boolean) => {
    if (!currentWeekPlan) return;

    // A single day from a parked week: "week-day:<weekId>:<srcDayIndex>".
    if (clipboardItemId.startsWith('week-day:')) {
      const [, weekId, srcStr] = clipboardItemId.split(':');
      const week = clipboard.findById(weekId);
      if (!week || week.kind !== 'week') return;
      const day = week.days.find(d => d.dayIndex === Number(srcStr));
      if (!day || day.exercises.length === 0) return;
      if (isReplace) {
        const targetIds = (plannedExercises[dayIndex] || []).map(ex => ex.id);
        if (targetIds.length > 0) await deleteDayExercises(targetIds);
      }
      const base = isReplace ? 0 : (plannedExercises[dayIndex] || []).length;
      const src = planSelection.type === 'individual' ? 'individual' : null;
      for (let i = 0; i < day.exercises.length; i++) {
        await insertExerciseSnapshot(day.exercises[i].snapshot, currentWeekPlan.id, dayIndex, base + i + 1, { source: src });
      }
      await handleRefresh();
      return;
    }

    // A whole parked week → ask append vs overwrite.
    if (clipboardItemId.startsWith('week:')) {
      handleApplyWeekFromClipboard(clipboardItemId.slice('week:'.length));
      return;
    }

    const item = clipboard.findById(clipboardItemId);
    if (!item) return;

    if (isReplace) {
      const targetIds = (plannedExercises[dayIndex] || []).map(ex => ex.id);
      if (targetIds.length > 0) await deleteDayExercises(targetIds);
    }

    const basePosition = isReplace ? 0 : (plannedExercises[dayIndex] || []).length;
    const source = planSelection.type === 'individual' ? 'individual' : null;

    if (item.kind === 'exercise') {
      await insertExerciseSnapshot(item.snapshot, currentWeekPlan.id, dayIndex, basePosition + 1, { source });
    } else if (item.kind === 'day') {
      for (let i = 0; i < item.exercises.length; i++) {
        await insertExerciseSnapshot(
          item.exercises[i].snapshot,
          currentWeekPlan.id,
          dayIndex,
          basePosition + i + 1,
          { source },
        );
      }
    }
    await handleRefresh();
  };

  const handleSaveDayAsTemplate = (dayIndex: number) => {
    setSaveTarget({ kind: 'day', dayIndex });
  };

  const handleSaveWeekAsTemplate = () => {
    setSaveTarget({ kind: 'week' });
  };

  // Build the scope's planned exercises that qualify for kg → % conversion.
  const collectKgExercisesInScope = (
    scope: { kind: 'day'; dayIndex: number } | { kind: 'week' },
    input: SaveAsTemplateInput,
  ) => {
    const dayFilter = scope.kind === 'day'
      ? new Set<number>([scope.dayIndex])
      : input.dayLabels
        ? new Set<number>(Object.keys(input.dayLabels).map(Number))
        : null;
    const all = Object.values(plannedExercises).flat();
    return all.filter(ex =>
      ex.unit === 'absolute_kg'
      && !!ex.prescription_raw
      && (dayFilter == null || dayFilter.has(ex.day_index)),
    );
  };

  // Mirror of handleResolvePercentages but scoped + filtered to kg rows.
  const buildKgToPercentCandidates = (
    exercises: ReturnType<typeof collectKgExercisesInScope>,
  ): ResolveCandidate[] => {
    const prMap = new Map<string, number>(
      athletePRs.filter(pr => pr.pr_value_kg).map(pr => [pr.exercise_id, pr.pr_value_kg!]),
    );
    return exercises.map<ResolveCandidate>(ex => {
      if (ex.is_combo) {
        const members = (comboMembers[ex.id] ?? []).slice().sort((a, b) => a.position - b.position);
        return {
          kind: 'combo',
          plannedExerciseId: ex.id,
          exerciseColor: ex.combo_color || '#94a3b8',
          prescriptionRaw: ex.prescription_raw ?? '',
          comboName: ex.combo_notation || members.map(m => m.exercise.name).join(' + ') || 'Combo',
          members: members.map(m => {
            const refId = m.exercise.pr_reference_exercise_id ?? m.exercise.id;
            const pr = prMap.get(m.exercise.id) ?? prMap.get(refId) ?? null;
            return {
              exerciseId: m.exercise.id,
              name: m.exercise.name,
              color: m.exercise.color || '#94a3b8',
              pr,
            };
          }),
        };
      }
      const refId = ex.exercise.pr_reference_exercise_id ?? ex.exercise_id;
      const directPR = prMap.get(ex.exercise_id);
      const refPR = prMap.get(refId);
      const defaultPR = directPR ?? refPR ?? null;
      const prSource = ex.exercise.pr_reference_exercise_id
        ? allExercises.find(e => e.id === ex.exercise.pr_reference_exercise_id) ?? null
        : null;
      return {
        kind: 'single',
        plannedExerciseId: ex.id,
        exerciseName: ex.exercise.name,
        exerciseColor: ex.exercise.color || '#94a3b8',
        prescriptionRaw: ex.prescription_raw ?? '',
        prSourceName: prSource?.name ?? null,
        defaultPR,
      };
    });
  };

  const handleSaveTemplateSubmit = async (input: SaveAsTemplateInput) => {
    if (!currentWeekPlan || !saveTarget) return;

    // Convert-and-save path: defer the actual insert until the converter
    // modal closes. The original plan is never touched.
    if (input.convertToPercentages) {
      const kgExercises = collectKgExercisesInScope(saveTarget, input);
      if (kgExercises.length > 0) {
        setPendingConvertSave({ scope: saveTarget, input });
        setConvertCandidates(buildKgToPercentCandidates(kgExercises));
        return;
      }
      // No kg rows in scope — just save verbatim, the checkbox was a no-op.
    }

    await persistTemplate(saveTarget, input);
  };

  // Compute kg → % overrides per planned exercise, then create the
  // template using those overrides. Called after the converter modal
  // confirms PRs + rounding.
  const handleConvertConfirm = async (
    overrides: Record<string, number>,
    rounding: ResolveRoundingOptions,
  ) => {
    if (!pendingConvertSave || !currentWeekPlan) return;
    const { scope, input } = pendingConvertSave;
    const kgExercises = collectKgExercisesInScope(scope, input);
    const idToEx = new Map(kgExercises.map(ex => [ex.id, ex]));

    const round = (pct: number) => {
      if (!rounding.enabled || rounding.increment <= 0) {
        return Math.round(pct * 10) / 10;
      }
      return Math.round(pct / rounding.increment) * rounding.increment;
    };

    const prescriptionOverrides: Record<string, { prescription_raw: string | null; unit: string }> = {};
    for (const [id, prKg] of Object.entries(overrides)) {
      const ex = idToEx.get(id);
      if (!ex || !ex.prescription_raw || !Number.isFinite(prKg) || prKg <= 0) continue;

      if (ex.is_combo) {
        const parsed = parseComboPrescription(ex.prescription_raw);
        if (parsed.length === 0) continue;
        const pctLines = parsed.map(line => ({
          sets: line.sets,
          repsText: line.repsText,
          totalReps: line.totalReps,
          load: line.loadText ? line.load : round((line.load / prKg) * 100),
          loadMax: line.loadMax != null ? round((line.loadMax / prKg) * 100) : null,
          loadText: line.loadText,
        }));
        prescriptionOverrides[id] = {
          prescription_raw: formatComboPrescription(pctLines, 'percentage'),
          unit: 'percentage',
        };
        continue;
      }

      const parsed = parsePrescription(ex.prescription_raw);
      if (parsed.length === 0) continue;
      const pctLines = parsed.map(line => ({
        sets: line.sets,
        reps: line.reps,
        load: round((line.load / prKg) * 100),
        loadMax: line.loadMax != null ? round((line.loadMax / prKg) * 100) : null,
      }));
      prescriptionOverrides[id] = {
        prescription_raw: formatPrescription(pctLines, 'percentage'),
        unit: 'percentage',
      };
    }

    await persistTemplate(scope, input, prescriptionOverrides);
    setPendingConvertSave(null);
    setConvertCandidates(null);
  };

  const persistTemplate = async (
    scope: { kind: 'day'; dayIndex: number } | { kind: 'week' },
    input: SaveAsTemplateInput,
    prescriptionOverrides?: Record<string, { prescription_raw: string | null; unit: string }>,
  ) => {
    if (!currentWeekPlan) return;
    if (scope.kind === 'day') {
      const dayLabel = getDayLabel(scope.dayIndex);
      await createTemplateFromDay(currentWeekPlan.id, scope.dayIndex, input.name, {
        description: input.description,
        dayLabel,
        prescriptionOverrides,
      });
    } else {
      const includeDays = input.dayLabels ? Object.keys(input.dayLabels).map(Number) : undefined;
      await createTemplateFromWeek(currentWeekPlan.id, input.name, {
        description: input.description,
        dayLabels: input.dayLabels ?? null,
        includeDays,
        prescriptionOverrides,
      });
    }
  };


  const handleNavigateToDay = (dayIndex: number) => {
    setSelectedDayIndex(dayIndex);
    setSelectedExerciseId(null);
    setPanelView('day');
  };

  const handleNavigateToExercise = (dayIndex: number, exerciseId: string) => {
    setSelectedDayIndex(dayIndex);
    setSelectedExerciseId(exerciseId);
    setPanelView('exercise');
  };

  const goToPreviousWeek = () => {
    const d = new Date(selectedDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    navigate(`/planner/${d.toISOString().slice(0, 10)}`);
  };

  const goToNextWeek = () => {
    const d = new Date(selectedDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    navigate(`/planner/${d.toISOString().slice(0, 10)}`);
  };

  const toggleDay = (dayIndex: number) => {
    if (!currentWeekPlan) return;
    if (activeDays.includes(dayIndex)) {
      setActiveDays(activeDays.filter(d => d !== dayIndex));
    } else {
      setActiveDays([...activeDays, dayIndex].sort((a, b) => a - b));
      if (!dayDisplayOrder.includes(dayIndex)) {
        setDayDisplayOrder([...dayDisplayOrder, dayIndex]);
      }
    }
  };

  const handleCancelSettings = () => {
    if (currentWeekPlan) {
      setActiveDays(currentWeekPlan.active_days);
      const labels = currentWeekPlan.day_labels || {};
      const order = currentWeekPlan.day_display_order || currentWeekPlan.active_days.slice().sort((a, b) => a - b);
      const initialLabels: Record<number, string> = {};
      const maxDay = Math.max(...currentWeekPlan.active_days, 7);
      for (let i = 1; i <= maxDay; i++) {
        initialLabels[i] = labels[i] || defaultUnitLabel(i, order);
      }
      setEditingDayLabels(initialLabels);
      setDayDisplayOrder(order);
      setEditingDaySchedule(
        (currentWeekPlan.day_schedule as Record<number, { weekday: number; time: string | null }> | null) ?? {}
      );
    }
    setShowSettings(false);
  };

  const handleDragStart = (dayIndex: number) => setDraggedDayIndex(dayIndex);

  const handleDragOver = (e: React.DragEvent, targetDayIndex: number) => {
    e.preventDefault();
    if (draggedDayIndex === null || draggedDayIndex === targetDayIndex) return;
    const newOrder = [...dayDisplayOrder];
    const draggedIdx = newOrder.indexOf(draggedDayIndex);
    const targetIdx = newOrder.indexOf(targetDayIndex);
    if (draggedIdx !== -1 && targetIdx !== -1) {
      newOrder.splice(draggedIdx, 1);
      newOrder.splice(targetIdx, 0, draggedDayIndex);
      setDayDisplayOrder(newOrder);
    }
  };

  const handleDragEnd = () => setDraggedDayIndex(null);

  const saveDayLabels = async () => {
    if (!currentWeekPlan) return;
    try {
      // Delete exercises for any days that were removed
      const removedDays = currentWeekPlan.active_days.filter(d => !activeDays.includes(d));
      if (removedDays.length > 0) {
        await supabase
          .from('planned_exercises')
          .delete()
          .eq('weekplan_id', currentWeekPlan.id)
          .in('day_index', removedDays);
      }
      // Strip removed days from schedule
      const cleanSchedule: Record<number, { weekday: number; time: string | null }> = {};
      activeDays.forEach(d => { if (editingDaySchedule[d]) cleanSchedule[d] = editingDaySchedule[d]; });
      await updateWeekPlan(currentWeekPlan.id, {
        day_labels: editingDayLabels,
        active_days: activeDays,
        day_display_order: dayDisplayOrder,
        day_schedule: Object.keys(cleanSchedule).length > 0 ? cleanSchedule : null,
      });
      if (removedDays.length > 0) await handleRefresh();
      setShowSettings(false);
    } catch {
      // error already set in hook
    }
  };

  const getDayLabel = (dayIndex: number): string => {
    if (currentWeekPlan?.day_labels?.[dayIndex]) return currentWeekPlan.day_labels[dayIndex];
    if (editingDayLabels[dayIndex]) return editingDayLabels[dayIndex];
    return defaultUnitLabel(dayIndex, dayDisplayOrder);
  };

  const addNewDay = () => {
    if (!currentWeekPlan) return;
    const allDayIndices = Object.keys(editingDayLabels).map(Number);
    const nextIndex = allDayIndices.length > 0 ? Math.max(...allDayIndices) + 1 : 1;
    setEditingDayLabels({ ...editingDayLabels, [nextIndex]: `Unit ${dayDisplayOrder.length + 1}` });
    setActiveDays([...activeDays, nextIndex].sort((a, b) => a - b));
    setDayDisplayOrder([...dayDisplayOrder, nextIndex]);
  };

  const removeDay = (dayIndex: number) => {
    if (!currentWeekPlan) return;
    const newLabels = { ...editingDayLabels };
    delete newLabels[dayIndex];
    setEditingDayLabels(newLabels);
    setActiveDays(activeDays.filter(d => d !== dayIndex));
    setDayDisplayOrder(dayDisplayOrder.filter(d => d !== dayIndex));
    const newSched = { ...editingDaySchedule };
    delete newSched[dayIndex];
    setEditingDaySchedule(newSched);
  };

  const saveWeekDescription = async (value: string) => {
    if (!currentWeekPlan) return;
    setWeekDescription(value);
    try {
      await updateWeekPlan(currentWeekPlan.id, { week_description: value.trim() || null });
    } catch {
      // error already set in hook
    }
  };

  const handleCopyWeek = async () => {
    if (!currentWeekPlan) { alert('No week data to copy'); return; }
    // Park the whole week on the dock clipboard — one parent holding all of its
    // training days (labels included), draggable as a week or per-day. Every
    // content type round-trips via buildExerciseSnapshot (regular, combo, and
    // the text/image/video/GPP sentinels carry through exercise_id + metadata).
    const visible = dayDisplayOrder.filter(d => activeDays.includes(d));
    const days = [];
    for (const dayIndex of visible) {
      const rows = plannedExercises[dayIndex] ?? [];
      const exercises: { display: ClipboardExerciseDisplay; snapshot: ClipboardExerciseSnapshot }[] = [];
      for (const ex of rows) {
        const built = await buildExerciseSnapshot(ex.id);
        if (built) exercises.push(built);
      }
      const label = currentWeekPlan.day_labels?.[dayIndex] || defaultUnitLabel(dayIndex, dayDisplayOrder);
      days.push({ dayIndex, label, exercises });
    }
    const who = planSelection.athlete?.name ?? planSelection.group?.name ?? 'Week';
    clipboard.addWeek(`${who} · ${formatDateRange(selectedDate, 7)}`, selectedDate, days);
  };

  const handleResolvePercentages = (direction: ResolveDirection = 'percent-to-kg') => {
    if (!currentWeekPlan) return;
    setResolveDirection(direction);
    const wantedUnit = direction === 'percent-to-kg' ? 'percentage' : 'absolute_kg';
    const prMap = new Map<string, number>(
      athletePRs.filter(pr => pr.pr_value_kg).map(pr => [pr.exercise_id, pr.pr_value_kg!])
    );
    const planned = Object.values(plannedExercises).flat();
    const toResolve = planned.filter(ex => ex.unit === wantedUnit && ex.prescription_raw);

    const candidates: ResolveCandidate[] = toResolve.map<ResolveCandidate>(ex => {
      if (ex.is_combo) {
        const members = (comboMembers[ex.id] ?? []).slice().sort((a, b) => a.position - b.position);
        return {
          kind: 'combo',
          plannedExerciseId: ex.id,
          exerciseColor: ex.combo_color || '#94a3b8',
          prescriptionRaw: ex.prescription_raw ?? '',
          comboName: ex.combo_notation || members.map(m => m.exercise.name).join(' + ') || 'Combo',
          members: members.map(m => {
            // Honour pr_reference_exercise_id on the constituent exercise too.
            const refId = m.exercise.pr_reference_exercise_id ?? m.exercise.id;
            const pr = prMap.get(m.exercise.id) ?? prMap.get(refId) ?? null;
            return {
              exerciseId: m.exercise.id,
              name: m.exercise.name,
              color: m.exercise.color || '#94a3b8',
              pr,
            };
          }),
        };
      }

      const refId = ex.exercise.pr_reference_exercise_id ?? ex.exercise_id;
      const directPR = prMap.get(ex.exercise_id);
      const refPR = prMap.get(refId);
      const defaultPR = directPR ?? refPR ?? null;
      const prSource = ex.exercise.pr_reference_exercise_id
        ? allExercises.find(e => e.id === ex.exercise.pr_reference_exercise_id) ?? null
        : null;
      return {
        kind: 'single',
        plannedExerciseId: ex.id,
        exerciseName: ex.exercise.name,
        exerciseColor: ex.exercise.color || '#94a3b8',
        prescriptionRaw: ex.prescription_raw ?? '',
        prSourceName: prSource?.name ?? null,
        defaultPR,
      };
    });

    setResolveCandidates(candidates);
  };

  const applyResolvedPercentages = async (overrides: Record<string, number>, rounding: ResolveRoundingOptions) => {
    if (!currentWeekPlan) return;
    const planned = Object.values(plannedExercises).flat();
    const idToEx = new Map(planned.map(ex => [ex.id, ex]));
    const toKg = resolveDirection === 'percent-to-kg';
    const targetUnit = toKg ? 'absolute_kg' : 'percentage';

    const convert = (input: number, prKg: number) => {
      const raw = toKg ? (input / 100) * prKg : (input / prKg) * 100;
      if (!rounding.enabled || rounding.increment <= 0) {
        // 2 decimals when rounding is off — avoids floating-point dust.
        return Math.round(raw * 100) / 100;
      }
      return Math.round(raw / rounding.increment) * rounding.increment;
    };

    const ids = Object.keys(overrides);
    for (const id of ids) {
      const ex = idToEx.get(id);
      if (!ex || !ex.prescription_raw) continue;
      const prKg = overrides[id];
      if (!Number.isFinite(prKg) || prKg <= 0) continue;

      if (ex.is_combo) {
        const parsed = parseComboPrescription(ex.prescription_raw);
        if (parsed.length === 0) continue;
        const newLines = parsed.map(line => ({
          sets: line.sets,
          repsText: line.repsText,
          totalReps: line.totalReps,
          load: line.loadText ? line.load : convert(line.load, prKg),
          loadMax: line.loadMax != null ? convert(line.loadMax, prKg) : null,
          loadText: line.loadText,
        }));
        await savePrescription(ex.id, {
          prescription: formatComboPrescription(newLines, targetUnit),
          unit: targetUnit,
          isCombo: true,
        });
        continue;
      }

      const parsed = parsePrescription(ex.prescription_raw);
      if (parsed.length === 0) continue;
      const newLines = parsed.map(line => ({
        sets: line.sets,
        reps: line.reps,
        load: convert(line.load, prKg),
        loadMax: line.loadMax != null ? convert(line.loadMax, prKg) : null,
      }));
      await savePrescription(ex.id, {
        prescription: formatPrescription(newLines, targetUnit),
        unit: targetUnit,
      });
    }

    if (ids.length > 0) await handleRefresh();
  };

  const handleSyncGroupPlan = async () => {
    if (!currentWeekPlan || planSelection.type !== 'group' || !planSelection.group) return;
    setIsSyncing(true);
    setError(null);
    try {
      await syncGroupPlanToAthletes(currentWeekPlan.id, planSelection.group.id, selectedDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync group plan to athletes');
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePlanSelection = (selection: PlanSelection) => {
    setPlanSelection(selection);
    if (selection.type === 'individual' && selection.athlete) {
      setSelectedAthlete(selection.athlete); // also clears selectedGroup in store
    } else if (selection.type === 'group' && selection.group) {
      setSelectedGroup(selection.group); // also clears selectedAthlete in store
    } else {
      setSelectedAthlete(null);
    }
  };

  const visibleDays = dayDisplayOrder
    .filter(dayIndex => activeDays.includes(dayIndex))
    .map(dayIndex => ({ index: dayIndex, name: getDayLabel(dayIndex) }));

  // Derive selected exercise from panelView state
  const selectedExercise = selectedDayIndex !== null && selectedExerciseId !== null
    ? (plannedExercises[selectedDayIndex] || []).find(ex => ex.id === selectedExerciseId) ?? null
    : null;

  const dayLabels: Record<number, string> = currentWeekPlan?.day_labels ?? {};

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-secondary)', padding: 16 }}>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger-text)', fontSize: 13 }}>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: 8, textDecoration: 'underline', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger-text)' }}>Dismiss</button>
          </div>
        )}

        <SharedContextBanner
          athlete={planSelection.athlete}
          group={planSelection.group}
          activeCoachId={activeCoachId}
        />

        <LastEditedByIndicator
          weekPlan={currentWeekPlan}
          activeCoachId={activeCoachId}
        />

        {!planSelection.athlete && !planSelection.group ? (
          <div style={{ paddingTop: 16, paddingBottom: 16 }}>
            <AthleteCardPicker />
          </div>
        ) : showWeekList ? (
          <PlannerWeekOverview
            athlete={planSelection.athlete}
            group={planSelection.group}
            onSelectWeek={(weekStart) => {
              navigate(`/planner/${weekStart}`);
            }}
            visibleMetrics={(settings?.visible_card_metrics as MetricKey[] | undefined) ?? DEFAULT_VISIBLE_METRICS}
            visibleSummaryMetrics={(settings?.visible_summary_metrics as MetricKey[] | undefined) ?? DEFAULT_VISIBLE_METRICS}
            competitionTotal={planSelection.athlete?.competition_total ?? null}
          />
        ) : (
          <>

            {/* ── Unsaved-changes recovery (dropped-connection safety) ── */}
            <UnsavedDraftsBanner
              weekPlanId={currentWeekPlan?.id ?? null}
              plannedExercises={plannedExercises}
              savePrescription={savePrescription}
              onReload={loadWeekPlan}
            />

            {/* ── Back to overview ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => navigate('/planner')}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 11, color: 'var(--color-text-secondary)', background: 'transparent', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'background 0.1s, color 0.1s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = 'var(--color-text-primary)'; el.style.background = 'var(--color-bg-tertiary)'; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = 'var(--color-text-secondary)'; el.style.background = 'transparent'; }}
                title="Back to week overview"
              >
                <ArrowLeft size={14} />
              </button>
            </div>

            {/* ── Macro timeline (bounded mode, above the control panel) ── */}
            {macroContext && planSelection.athlete && (
              <div style={{ padding: '12px 24px 0' }}>
                <MacroTimeline
                  mode="bounded"
                  cycleId={macroContext.macroId}
                  athleteId={planSelection.athlete.id}
                  groupId={planSelection.group?.id ?? null}
                  selectedWeekStart={selectedDate}
                />
              </div>
            )}

            {/* ── Unified week header card (overview · profile · brief · load) ── */}
            <div style={{ background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16 }}>
            {(planSelection.athlete || planSelection.group) && (
              <WeekNavRibbon
                selectedDate={selectedDate}
                macroContext={macroContext}
                weekTypes={settings?.week_types ?? []}
                onPrevWeek={goToPreviousWeek}
                onNextWeek={goToNextWeek}
              />
            )}

            {/* ── Control Panel ── */}
            <PlannerControlPanel
                selectedAthlete={planSelection.athlete}
                selectedGroup={planSelection.group}
                selectedDate={selectedDate}
                macroContext={macroContext}
                macroWeekTarget={macroWeekTarget}
                plannedExercises={plannedExercises}
                comboMembers={comboMembers}
                athletePRs={athletePRs}
                settings={settings}
                weekDescription={weekDescription}
                daySchedule={(currentWeekPlan?.day_schedule as Record<number, { weekday: number; time: string | null }> | null) ?? null}
                canCopyPaste={planSelection.type === 'individual' || planSelection.type === 'group'}
                showLoadDistribution={showLoadDistribution}
                onPrevWeek={goToPreviousWeek}
                onNextWeek={goToNextWeek}
                onSaveWeekDescription={saveWeekDescription}
                onDayConfig={() => setShowSettings(s => !s)}
                onCopy={() => void handleCopyWeek()}
                onPrint={() => setShowPrintModal(true)}
                onToggleLoadDistribution={() => setShowLoadDistribution(s => !s)}
                onResolvePercentages={planSelection.type === 'individual' ? handleResolvePercentages : undefined}
                onNavigateToWeek={(weekStart) => navigate(`/planner/${weekStart}`)}
                weekTypes={settings?.week_types ?? []}
                onSaveAsTemplate={handleSaveWeekAsTemplate}
              />

            {/* ── Load distribution (collapsible band) ── */}
            {(planSelection.athlete || planSelection.group) && (
              <WeekSummaryBox
                selectedAthlete={planSelection.athlete}
                plannedExercises={plannedExercises}
                comboMembers={comboMembers}
                activeDays={activeDays}
                dayDisplayOrder={dayDisplayOrder}
                dayLabels={currentWeekPlan?.day_labels || {}}
                daySchedule={(currentWeekPlan?.day_schedule as Record<number, { weekday: number; time: string | null }> | null) ?? null}
                expanded={showLoadDistribution}
                onToggle={() => setShowLoadDistribution(s => !s)}
              />
            )}
            </div>{/* end unified week header card */}

            {/* ── Group plan banner ── */}
            {planSelection.type === 'group' && planSelection.group && (
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'var(--color-accent-muted)', border: '0.5px solid var(--color-accent-border)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-accent-hover)' }}>Group plan:</span>
                  <span style={{ fontSize: 11, color: 'var(--color-accent)' }}>{planSelection.group.name}</span>
                </div>
                <button
                  onClick={() => void handleSyncGroupPlan()}
                  disabled={isSyncing}
                  style={{
                    fontSize: 11, padding: '4px 12px', background: 'var(--color-accent)', color: 'var(--color-text-on-accent)',
                    border: 'none', borderRadius: 'var(--radius-md)', cursor: isSyncing ? 'not-allowed' : 'pointer',
                    opacity: isSyncing ? 0.5 : 1, transition: 'opacity var(--transition-fast)',
                  }}
                >
                  {isSyncing ? 'Syncing…' : 'Sync to athletes'}
                </button>
              </div>
            )}

            {/* ── Linked-to-group banner for individual plans ── */}
            {planSelection.type === 'individual' && currentWeekPlan?.source_group_plan_id && (
              <div style={{ marginBottom: 12, padding: '8px 16px', background: 'var(--color-accent-muted)', border: '0.5px solid var(--color-accent-border)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-accent)' }}>Linked to group plan · Exercises with </span>
                <span style={{ fontSize: 8, padding: '1px 4px', background: 'var(--color-accent-muted)', color: 'var(--color-accent)', borderRadius: 'var(--radius-sm)', fontWeight: 500 }}>G</span>
                <span style={{ fontSize: 11, color: 'var(--color-accent)' }}> come from the group. Edit to override </span>
                <span style={{ fontSize: 8, padding: '1px 4px', background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', borderRadius: 'var(--radius-sm)', fontWeight: 500 }}>I</span>
                <span style={{ fontSize: 11, color: 'var(--color-accent)' }}>.</span>
              </div>
            )}

            {/* ── Plan / Log mode toggle ── */}
            {(planSelection.athlete || planSelection.group) && (
              <div style={{ display: 'inline-flex', gap: 0, marginBottom: 12, padding: 2, background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--color-border-secondary)' }}>
                <button
                  onClick={() => setViewMode('plan')}
                  style={{
                    padding: '4px 14px',
                    fontSize: 11,
                    fontWeight: 500,
                    background: viewMode === 'plan' ? 'var(--color-bg-primary)' : 'transparent',
                    color: viewMode === 'plan' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    boxShadow: viewMode === 'plan' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    transition: 'background var(--transition-fast)',
                  }}
                >
                  Plan
                </button>
                <button
                  onClick={() => setViewMode('log')}
                  style={{
                    padding: '4px 14px',
                    fontSize: 11,
                    fontWeight: 500,
                    background: viewMode === 'log' ? 'var(--color-bg-primary)' : 'transparent',
                    color: viewMode === 'log' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    boxShadow: viewMode === 'log' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    transition: 'background var(--transition-fast)',
                  }}
                >
                  Log
                </button>
              </div>
            )}

            {/* ── Week Overview (always visible) ── */}
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
                <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>Loading week plan...</div>
              </div>
            ) : viewMode === 'log' && planSelection.athlete ? (
              <LogModeView
                athleteId={planSelection.athlete.id}
                weekStart={selectedDate}
                visibleDays={visibleDays}
                plannedExercises={plannedExercises}
                dayLabels={currentWeekPlan?.day_labels ?? null}
              />
            ) : viewMode === 'log' && planSelection.group ? (
              <GroupLogView
                group={planSelection.group}
                weekPlan={currentWeekPlan}
                weekStart={selectedDate}
                onSelectAthlete={(athlete) => {
                  handlePlanSelection({ type: 'individual', athlete, group: null });
                  setViewMode('log');
                }}
              />
            ) : (
              <WeekOverview
                weekPlan={currentWeekPlan}
                visibleDays={visibleDays}
                plannedExercises={plannedExercises}
                comboMembers={comboMembers}
                allExercises={allExercises}
                daySchedule={(currentWeekPlan?.day_schedule as Record<number, { weekday: number; time: string | null }> | null) ?? null}
                visibleCardMetrics={(settings?.visible_card_metrics as MetricKey[] | undefined) ?? DEFAULT_VISIBLE_METRICS}
                competitionTotal={planSelection.athlete?.competition_total ?? null}
                onNavigateToDay={handleNavigateToDay}
                onNavigateToExercise={handleNavigateToExercise}
                addExerciseToDay={addExerciseToDayWrapped}
                createComboExercise={createComboExercise}
                onRefresh={handleRefresh}
                onDeleteExercise={handleDeleteExercise}
                onExerciseDrop={handleExerciseDrop}
                onDayDrop={handleDayDrop}
                onDockExerciseDrop={handleDockExerciseDrop}
                onDockTemplateDrop={handleDockTemplateDrop}
                onDockTemplateDayDrop={handleDockTemplateDayDrop}
                onClipboardItemDrop={handleClipboardItemDrop}
                onSaveAsTemplate={handleSaveDayAsTemplate}
                savePrescription={savePrescription}
                saveGppSection={saveGppSection}
                loadIncrement={settings?.grid_load_increment ?? 5}
                defaultPrescriptionLoad={settings?.default_prescription_load ?? 50}
                isLinkedToGroupPlan={planSelection.type === 'individual' && !!currentWeekPlan?.source_group_plan_id}
              />
            )}

            {/* ── Day Editor dialog ── */}
            {panelView === 'day' && currentWeekPlan && selectedDayIndex !== null && (() => {
              const isSidebar = (settings?.dialog_mode ?? 'center') === 'sidebar';
              return (
              <div
                className="animate-backdrop-in"
                style={isSidebar
                  ? { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }
                  : { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
                    e.preventDefault();
                    await closeDialog();
                  }
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)' }} onClick={() => void closeDialog()} />
                <div
                  className={isSidebar ? 'animate-sidebar-in' : 'animate-dialog-in'}
                  style={isSidebar
                    ? { position: 'relative', zIndex: 10, width: '100%', maxWidth: 512, height: '100%', background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)', borderLeft: '1px solid var(--color-border-secondary)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }
                    : { position: 'relative', zIndex: 10, width: '100%', maxWidth: 896, maxHeight: '85vh', background: 'var(--color-bg-primary)', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border-secondary)' }}
                  tabIndex={-1}>
                  <DayEditor
                    weekPlan={currentWeekPlan}
                    dayIndex={selectedDayIndex}
                    dayName={getDayLabel(selectedDayIndex)}
                    exercises={plannedExercises[selectedDayIndex] || []}
                    comboMembers={comboMembers}
                    athletePRs={athletePRs}
                    settings={settings}
                    macroContext={macroContext}
                    allExercises={allExercises}
                    onClose={closeDialog}
                    onNavigateToExercise={exerciseId =>
                      handleNavigateToExercise(selectedDayIndex, exerciseId)
                    }
                    onRefresh={handleRefresh}
                    addExerciseToDay={addExerciseToDayWrapped}
                    createComboExercise={createComboExercise}
                    savePrescription={savePrescription}
                    saveNotes={saveNotes}
                    deletePlannedExercise={deletePlannedExercise}
                    reorderExercises={reorderExercises}
                    moveExercise={moveExercise}
                    normalizePositions={normalizePositions}
                  />
                </div>
              </div>
              );
            })()}

            {/* ── Exercise Detail dialog ── */}
            {panelView === 'exercise' && currentWeekPlan && selectedDayIndex !== null && selectedExercise && (() => {
              const isSidebar = (settings?.dialog_mode ?? 'center') === 'sidebar';
              return (
              <div
                className="animate-backdrop-in"
                style={isSidebar
                  ? { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }
                  : { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
                    e.preventDefault();
                    await closeDialog();
                  }
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)' }} onClick={() => void closeDialog()} />
                <div
                  className={isSidebar ? 'animate-sidebar-in' : 'animate-dialog-in'}
                  style={isSidebar
                    ? { position: 'relative', zIndex: 10, width: '100%', maxWidth: 512, height: '100%', background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)', borderLeft: '1px solid var(--color-border-secondary)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }
                    : { position: 'relative', zIndex: 10, width: '100%', maxWidth: 768, maxHeight: '85vh', background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRadius: 'var(--radius-xl)' }}
                  tabIndex={-1}>
                  <ExerciseDetail
                    plannedExercise={selectedExercise}
                    comboMembers={comboMembers}
                    weekPlanId={currentWeekPlan.id}
                    dayIndex={selectedDayIndex}
                    dayName={getDayLabel(selectedDayIndex)}
                    weekStart={selectedDate}
                    athleteId={planSelection.athlete?.id ?? ''}
                    macroContext={macroContext}
                    athletePRs={athletePRs}
                    dayLabels={dayLabels}
                    settings={settings}
                    allExercises={allExercises}
                    onClose={closeDialog}
                    onBack={() => setPanelView('day')}
                    onSaved={handleRefresh}
                    savePrescription={savePrescription}
                    saveMediaDescription={saveMediaDescription}
                    saveNotes={saveNotes}
                    swapPlannedExercise={swapPlannedExercise}
                    updateComboExercise={updateComboExercise}
                    fetchOtherDayPrescriptions={fetchOtherDayPrescriptions}
                  />
                </div>
              </div>
              );
            })()}
          </>
        )}

        {/* ── Modals ── */}
        <PlannerModals
          showDayConfig={showSettings}
          dayDisplayOrder={dayDisplayOrder}
          editingDayLabels={editingDayLabels}
          activeDays={activeDays}
          daySchedule={editingDaySchedule}
          dayDragIndex={draggedDayIndex}
          onDayDragStart={handleDragStart}
          onDayDragOver={handleDragOver}
          onDayDragEnd={handleDragEnd}
          onToggleDay={toggleDay}
          onLabelChange={(dayIndex, value) => setEditingDayLabels({ ...editingDayLabels, [dayIndex]: value })}
          onScheduleChange={(dayIndex, entry) => {
            const next = { ...editingDaySchedule };
            if (entry === null) { delete next[dayIndex]; } else { next[dayIndex] = entry; }
            setEditingDaySchedule(next);
          }}
          onRemoveDay={removeDay}
          onAddDay={addNewDay}
          onDayConfigCancel={handleCancelSettings}
          onDayConfigSave={saveDayLabels}
          selectedDate={selectedDate}
          selectedAthlete={planSelection.athlete}
          selectedGroup={planSelection.group}
          showPrintModal={showPrintModal}
          dayLabels={currentWeekPlan?.day_labels ?? {}}
          weekDescription={currentWeekPlan?.week_description}
          onPrintClose={() => setShowPrintModal(false)}
        />

        {resolveCandidates !== null && (
          <ResolvePercentagesModal
            candidates={resolveCandidates}
            direction={resolveDirection}
            onClose={() => setResolveCandidates(null)}
            onConfirm={applyResolvedPercentages}
            defaultRounding={resolveDirection === 'percent-to-kg'
              ? {
                  enabled: settings?.percent_to_kg_round_enabled ?? true,
                  increment: settings?.percent_to_kg_round_increment ?? 0.5,
                }
              : { enabled: true, increment: 1 }
            }
          />
        )}

        {/* Append vs overwrite prompt when applying a parked week onto a week that already has content */}
        {pendingWeekPaste && (() => {
          const w = clipboard.findById(pendingWeekPaste);
          const wkLabel = w && w.kind === 'week' ? w.label : '';
          const dayCount = w && w.kind === 'week' ? w.days.length : 0;
          const close = () => setPendingWeekPaste(null);
          const apply = (overwrite: boolean) => { const id = pendingWeekPaste; close(); void applyWeekFromClipboard(id, overwrite); };
          const btn: React.CSSProperties = { padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-label)', fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-sans)' };
          return (
            <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 28px rgba(0,0,0,0.18)', padding: 18, maxWidth: 400, width: '90%' }}>
                <div style={{ fontSize: 'var(--text-section)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>Apply week</div>
                <p style={{ fontSize: 'var(--text-body)', color: 'var(--color-text-secondary)', lineHeight: 1.5, margin: '0 0 16px' }}>
                  This week already has planned content. Apply <b style={{ color: 'var(--color-text-primary)' }}>{wkLabel}</b> ({dayCount} day{dayCount === 1 ? '' : 's'}) by appending to the existing plan, or overwriting it?
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={close} style={{ ...btn, background: 'transparent', border: 'none', color: 'var(--color-text-secondary)' }}>Cancel</button>
                  <button onClick={() => apply(false)} style={{ ...btn, background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-primary)' }}>Append</button>
                  <button onClick={() => apply(true)} style={{ ...btn, background: 'var(--color-accent)', border: '0.5px solid var(--color-accent)', color: 'var(--color-text-on-accent)' }}>Overwrite</button>
                </div>
              </div>
            </div>
          );
        })()}

        {currentWeekPlan && !showWeekList && !showPrintModal && (
          <>
            <div style={{ height: 'var(--emos-dock-height, 32px)' }} aria-hidden />
            <PlannerDock
              exercises={allExercises}
              onOpenImport={handleOpenImportDialog}
              clipboardItems={clipboard.items}
              onClipboardRemove={clipboard.remove}
              onClipboardClear={clipboard.clear}
              onClipboardPlannerDrop={handleClipboardPlannerDrop}
            />
          </>
        )}

        {importTarget && currentWeekPlan && (
          <TemplateImportDialog
            templateId={importTarget.templateId}
            weekPlanId={currentWeekPlan.id}
            visibleDays={visibleDays}
            startDayIndex={importTarget.startDayIndex}
            onClose={() => setImportTarget(null)}
            onApplied={() => { void handleRefresh(); }}
          />
        )}

        {saveTarget && currentWeekPlan && saveTarget.kind === 'day' && (() => {
          const hasKg = (plannedExercises[saveTarget.dayIndex] ?? []).some(
            ex => ex.unit === 'absolute_kg' && !!ex.prescription_raw,
          );
          return (
            <SaveAsTemplateModal
              mode="day"
              defaultName={getDayLabel(saveTarget.dayIndex)}
              hasKgPrescriptions={hasKg}
              onClose={() => setSaveTarget(null)}
              onSave={handleSaveTemplateSubmit}
            />
          );
        })()}
        {saveTarget && currentWeekPlan && saveTarget.kind === 'week' && (() => {
          const hasKg = Object.values(plannedExercises).flat().some(
            ex => ex.unit === 'absolute_kg' && !!ex.prescription_raw,
          );
          return (
            <SaveAsTemplateModal
              mode="week"
              defaultName={`Week of ${selectedDate}`}
              defaultDescription={currentWeekPlan.week_description ?? undefined}
              availableDays={visibleDays.map(d => ({
                index: d.index,
                label: d.name,
                exerciseCount: (plannedExercises[d.index] ?? []).length,
              }))}
              hasKgPrescriptions={hasKg}
              onClose={() => setSaveTarget(null)}
              onSave={handleSaveTemplateSubmit}
            />
          );
        })()}

        {convertCandidates && (
          <ResolvePercentagesModal
            candidates={convertCandidates}
            direction="kg-to-percent"
            defaultRounding={{ enabled: true, increment: 1 }}
            onClose={() => {
              setConvertCandidates(null);
              setPendingConvertSave(null);
            }}
            onConfirm={handleConvertConfirm}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Renders a "Last edited by Coach X · 2 min ago" hint when the week plan
 * was last touched by someone other than the active coach. Silent when
 * the active coach is the most recent editor or when the column is null
 * (legacy plans created before the column existed). Looks up the editor's
 * display name from coach_profiles on first mount.
 */
function LastEditedByIndicator({
  weekPlan,
  activeCoachId,
}: {
  weekPlan: { id: string; last_edited_by_coach_id: string | null; updated_at: string } | null;
  activeCoachId: string | null;
}) {
  const editorId = weekPlan?.last_edited_by_coach_id ?? null;
  const [editorName, setEditorName] = useState<string | null>(null);
  useEffect(() => {
    if (!editorId || editorId === activeCoachId) {
      setEditorName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('coach_profiles')
        .select('name')
        .eq('id', editorId)
        .maybeSingle();
      if (!cancelled) setEditorName((data?.name as string | undefined) ?? null);
    })();
    return () => { cancelled = true; };
  }, [editorId, activeCoachId]);
  if (!weekPlan || !editorId || editorId === activeCoachId || !editorName) return null;
  return (
    <div
      style={{
        marginBottom: 12,
        padding: '4px 10px',
        fontSize: 11,
        color: 'var(--color-text-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span>Last edited by</span>
      <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{editorName}</span>
      <span>·</span>
      <span>{formatRelativeShort(weekPlan.updated_at)}</span>
    </div>
  );
}

function formatRelativeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Renders a small banner at the top of the planner when the active coach
 * is working on an athlete or group hosted by another coach. Pulls the
 * host name from the athleteStore's hostName map (populated on fetch).
 */
function SharedContextBanner({
  athlete,
  group,
  activeCoachId,
}: {
  athlete: { id: string; owner_id: string; name: string } | null;
  group: { id: string; owner_id: string; name: string } | null;
  activeCoachId: string | null;
}) {
  const athleteHostName = useAthleteStore(s => s.athleteHostName);
  const hostOwnerId = athlete?.owner_id ?? group?.owner_id ?? null;
  if (!hostOwnerId || !activeCoachId || hostOwnerId === activeCoachId) return null;
  const targetLabel = athlete?.name ?? group?.name ?? 'this athlete';
  const hostName = athlete ? athleteHostName[athlete.id] : null;
  const hostDescriptor = hostName ?? 'another coach';
  return (
    <div
      style={{
        marginBottom: 12,
        padding: '8px 12px',
        background: 'var(--color-info-bg, #eff6ff)',
        border: '1px solid var(--color-info-border, #bfdbfe)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-info-text, #1e40af)',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontWeight: 500 }}>Shared:</span>
      <span>
        Planning for <strong>{targetLabel}</strong> · using {hostDescriptor}'s exercise library.
        New exercises you add land in their library.
      </span>
    </div>
  );
}
