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
import { DAYS_OF_WEEK } from '../../lib/constants';
import { getMondayOfWeekISO as getMondayOfWeek } from '../../lib/weekUtils';
import { DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';
import { parsePrescription, formatPrescription, parseComboPrescription, formatComboPrescription } from '../../lib/prescriptionParser';
import type { PlanSelection } from '../../hooks/useWeekPlans';
import { WeekOverview } from './WeekOverview';
import { DayEditor } from './DayEditor';
import { ExerciseDetail } from './ExerciseDetail';
import { LoadDistribution } from './LoadDistribution';
import { PlannerControlPanel } from './PlannerControlPanel';
import { LogModeView } from './log/LogModeView';
import { PlannerModals } from './PlannerModals';
import { PlannerWeekOverview } from './PlannerWeekOverview';
import { PlannerDock } from './dock/PlannerDock';
import { TemplateImportDialog } from './dock/TemplateImportDialog';
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

  const { exercises: allExercises, fetchExercisesByName } = useExercises();
  const { athletes, fetchAllAthletes } = useAthletes();
  const { groups, fetchGroups } = useTrainingGroups();

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
    updateWeekPlan,
    reorderExercises,
    moveExercise,
    normalizePositions,
    savePrescription,
    saveNotes,
    saveGppSection,
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
  const [showCopyWeekModal, setShowCopyWeekModal] = useState(false);
  const [showLoadDistribution, setShowLoadDistribution] = useState(false);
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
  const [copiedWeekStart, setCopiedWeekStart] = useState<string | null>(null);
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
    fetchExercisesByName();
    fetchGroups();
    fetchAllAthletes();
    fetchSettings();
  }, []);

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
      const initialLabels: Record<number, string> = {};
      const maxDay = Math.max(...currentWeekPlan.active_days, 7);
      for (let i = 1; i <= maxDay; i++) {
        initialLabels[i] = labels[i] || DAYS_OF_WEEK.find(d => d.index === i)?.name || `Day ${i}`;
      }
      setEditingDayLabels(initialLabels);
      setWeekDescription(currentWeekPlan.week_description || '');
      setDayDisplayOrder(
        currentWeekPlan.day_display_order || currentWeekPlan.active_days.slice().sort((a, b) => a - b)
      );
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

  const loadExercises = () => fetchExercisesByName();
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
        weekType: mw.week_type,
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

  const handleExerciseDrop = async (fromDay: number, plannedExId: string, toDay: number, isCopy: boolean, isReplace: boolean) => {
    if (!currentWeekPlan) return;
    const sourceEx = (plannedExercises[fromDay] || []).find(ex => ex.id === plannedExId);
    if (!sourceEx) return;
    if (isReplace) {
      const targetIds = (plannedExercises[toDay] || []).map(ex => ex.id).filter(id => id !== plannedExId);
      if (targetIds.length > 0) await deleteDayExercises(targetIds);
    }
    const destPosition = isReplace ? 0 : (plannedExercises[toDay] || []).length;
    if (isCopy) {
      await copyExerciseWithSetLines(sourceEx, currentWeekPlan.id, toDay, destPosition);
    } else {
      await moveExercise(currentWeekPlan.id, plannedExId, fromDay, toDay);
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


  const handleReorderItems = async (dayIndex: number, orderedIds: string[]) => {
    if (!currentWeekPlan) return;
    try {
      await reorderExercises(currentWeekPlan.id, orderedIds);
      await fetchPlannedExercises(currentWeekPlan.id, currentWeekPlan.day_labels);
    } catch {
      // error already set in hook
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
      const initialLabels: Record<number, string> = {};
      const maxDay = Math.max(...currentWeekPlan.active_days, 7);
      for (let i = 1; i <= maxDay; i++) {
        initialLabels[i] = labels[i] || DAYS_OF_WEEK.find(d => d.index === i)?.name || `Day ${i}`;
      }
      setEditingDayLabels(initialLabels);
      setDayDisplayOrder(
        currentWeekPlan.day_display_order || currentWeekPlan.active_days.slice().sort((a, b) => a - b)
      );
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
    return DAYS_OF_WEEK.find(d => d.index === dayIndex)?.name || `Day ${dayIndex}`;
  };

  const addNewDay = () => {
    if (!currentWeekPlan) return;
    const allDayIndices = Object.keys(editingDayLabels).map(Number);
    const nextIndex = allDayIndices.length > 0 ? Math.max(...allDayIndices) + 1 : 1;
    setEditingDayLabels({ ...editingDayLabels, [nextIndex]: `Day ${nextIndex}` });
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

  const handleCopyWeek = () => {
    if (!currentWeekPlan) { alert('No week data to copy'); return; }
    setCopiedWeekStart(selectedDate);
  };

  const handlePasteWeek = () => {
    if (!copiedWeekStart) { alert('No week copied to clipboard'); return; }
    setShowCopyWeekModal(true);
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

            {/* ── Control Panel ── */}
            <PlannerControlPanel
                selectedAthlete={planSelection.athlete}
                selectedGroup={planSelection.group}
                selectedDate={selectedDate}
                macroContext={macroContext}
                macroWeekTarget={macroWeekTarget}
                plannedExercises={plannedExercises}
                athletePRs={athletePRs}
                settings={settings}
                weekDescription={weekDescription}
                daySchedule={(currentWeekPlan?.day_schedule as Record<number, { weekday: number; time: string | null }> | null) ?? null}
                canCopyPaste={planSelection.type === 'individual'}
                copiedWeekStart={copiedWeekStart}
                showLoadDistribution={showLoadDistribution}
                onPrevWeek={goToPreviousWeek}
                onNextWeek={goToNextWeek}
                onSaveWeekDescription={saveWeekDescription}
                onDayConfig={() => setShowSettings(s => !s)}
                onCopy={handleCopyWeek}
                onPaste={handlePasteWeek}
                onPrint={() => setShowPrintModal(true)}
                onToggleLoadDistribution={() => setShowLoadDistribution(s => !s)}
                onResolvePercentages={planSelection.type === 'individual' ? handleResolvePercentages : undefined}
                onNavigateToWeek={(weekStart) => navigate(`/planner/${weekStart}`)}
                weekTypes={settings?.week_types ?? []}
                onSaveAsTemplate={handleSaveWeekAsTemplate}
              />

            {/* ── Load Distribution (collapsible) ── */}
            {currentWeekPlan && showLoadDistribution && planSelection.type === 'individual' && planSelection.athlete && (
              <div style={{ marginBottom: 16, background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-secondary)', overflow: 'hidden' }}>
                <LoadDistribution
                  plannedExercises={plannedExercises}
                  athletePRs={athletePRs}
                  dayLabels={currentWeekPlan.day_labels || {}}
                  activeDays={activeDays}
                  dayDisplayOrder={dayDisplayOrder}
                  daySchedule={(currentWeekPlan.day_schedule as Record<number, { weekday: number; time: string | null }> | null) ?? null}
                />
              </div>
            )}

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
            {planSelection.type === 'individual' && planSelection.athlete && (
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
                    : { position: 'relative', zIndex: 10, width: '100%', maxWidth: 896, maxHeight: '85vh', background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border-secondary)' }}
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
                saveGppSection={saveGppSection}
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
                    : { position: 'relative', zIndex: 10, width: '100%', maxWidth: 768, maxHeight: '85vh', background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border-secondary)' }}
                  tabIndex={-1}>
                  <ExerciseDetail
                    plannedExercise={selectedExercise}
                    comboMembers={comboMembers}
                    weekPlanId={currentWeekPlan.id}
                    dayIndex={selectedDayIndex}
                    dayName={getDayLabel(selectedDayIndex)}
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
                saveGppSection={saveGppSection}
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
          showPasteModal={showCopyWeekModal}
          copiedWeekStart={copiedWeekStart}
          selectedDate={selectedDate}
          selectedAthlete={planSelection.athlete}
          allAthletes={athletes}
          allGroups={groups}
          onPasteClose={() => setShowCopyWeekModal(false)}
          onPasteComplete={() => { setShowCopyWeekModal(false); void loadWeekPlan(); }}
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

        {currentWeekPlan && !showWeekList && !showPrintModal && (
          <>
            <div style={{ height: 'var(--emos-dock-height, 32px)' }} aria-hidden />
            <PlannerDock
              exercises={allExercises}
              onOpenImport={handleOpenImportDialog}
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
