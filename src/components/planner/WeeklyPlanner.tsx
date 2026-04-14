// TODO: Consider extracting macro context loading into a dedicated hook (or unifying with useMacroContext.ts)
// TODO: Consider extracting print-mode rendering into a PrintManager component
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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
import { parsePrescription, formatPrescription } from '../../lib/prescriptionParser';
import type { PlanSelection } from '../../hooks/useWeekPlans';
import { WeekOverview } from './WeekOverview';
import { DayEditor } from './DayEditor';
import { ExerciseDetail } from './ExerciseDetail';
import { LoadDistribution } from './LoadDistribution';
import { PlannerControlPanel } from './PlannerControlPanel';
import { PlannerModals } from './PlannerModals';
import { PlannerWeekOverview } from './PlannerWeekOverview';
import { AthleteCardPicker } from '../AthleteCardPicker';
import { ArrowLeft, User } from 'lucide-react';

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
  const location = useLocation();
  const locationState = (location.state as { weekStart?: string; groupId?: string } | null);
  const initialWeekStart = locationState?.weekStart ?? null;
  const initialGroupId = locationState?.groupId ?? null;
  const { selectedAthlete, setSelectedAthlete, selectedGroup: storeSelectedGroup, setSelectedGroup } = useAthleteStore();
  const { settings, fetchSettings } = useSettings();

  const [selectedDate, setSelectedDate] = useState(() => {
    if (initialWeekStart) return initialWeekStart;
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
    fetchOtherDayPrescriptions,
    addExerciseToDay,
    createComboExercise,
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
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [editingDayLabels, setEditingDayLabels] = useState<Record<number, string>>({});
  const [weekDescription, setWeekDescription] = useState<string>('');
  const [dayDisplayOrder, setDayDisplayOrder] = useState<number[]>([]);
  const [editingDaySchedule, setEditingDaySchedule] = useState<Record<number, { weekday: number; time: string | null }>>({});
  const [draggedDayIndex, setDraggedDayIndex] = useState<number | null>(null);
  const [copiedWeekStart, setCopiedWeekStart] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showWeekList, setShowWeekList] = useState(() => {
    // If navigated here with a specific weekStart (e.g. from macro wheel),
    // go straight to detail view. Otherwise show the overview.
    return !initialWeekStart;
  });

  useEffect(() => {
    fetchExercisesByName();
    fetchGroups();
    fetchAllAthletes();
    fetchSettings();
  }, []);

  useEffect(() => {
    if (initialGroupId && groups.length > 0) {
      const group = groups.find(g => g.id === initialGroupId);
      if (group) {
        setPlanSelection({ type: 'group', athlete: null, group });
        setSelectedGroup(group);
      }
    }
  }, [initialGroupId, groups]);

  useEffect(() => {
    if (selectedAthlete && !initialGroupId) {
      setPlanSelection({ type: 'individual', athlete: selectedAthlete, group: null });
      setShowWeekList(true);
    }
  }, [selectedAthlete]);

  useEffect(() => {
    if (storeSelectedGroup) {
      setPlanSelection({ type: 'group', athlete: null, group: storeSelectedGroup });
      setShowWeekList(true);
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

  const handleExerciseDrop = async (fromDay: number, plannedExId: string, toDay: number, isCopy: boolean) => {
    if (!currentWeekPlan) return;
    const sourceEx = (plannedExercises[fromDay] || []).find(ex => ex.id === plannedExId);
    if (!sourceEx) return;
    const destPosition = (plannedExercises[toDay] || []).length;
    if (isCopy) {
      await copyExerciseWithSetLines(sourceEx, currentWeekPlan.id, toDay, destPosition);
    } else {
      await moveExercise(currentWeekPlan.id, plannedExId, fromDay, toDay);
    }
    await handleRefresh();
  };

  const handleDayDrop = async (sourceDay: number, destDay: number, isCopy: boolean) => {
    if (!currentWeekPlan) return;
    const srcExercises = plannedExercises[sourceDay] || [];
    if (srcExercises.length === 0) return;
    const basePosition = (plannedExercises[destDay] || []).length;
    await copyDayExercises(srcExercises, currentWeekPlan.id, destDay, basePosition);
    if (!isCopy) {
      await deleteDayExercises(srcExercises.map(ex => ex.id));
    }
    await handleRefresh();
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
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const goToNextWeek = () => {
    const d = new Date(selectedDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    setSelectedDate(d.toISOString().slice(0, 10));
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

  const handleResolvePercentages = async () => {
    if (!currentWeekPlan) return;
    const prMap = new Map<string, number>(
      athletePRs.filter(pr => pr.pr_value_kg).map(pr => [pr.exercise_id, pr.pr_value_kg!])
    );
    const allExercises = Object.values(plannedExercises).flat();
    const toResolve = allExercises.filter(ex => ex.unit === 'percentage' && ex.prescription_raw);

    for (const ex of toResolve) {
      // Resolve PR: direct first, then via reference exercise
      const refId = ex.exercise.pr_reference_exercise_id ?? ex.exercise_id;
      const prKg = prMap.get(refId) ?? prMap.get(ex.exercise_id);
      if (!prKg) continue;

      const parsed = parsePrescription(ex.prescription_raw!);
      if (parsed.length === 0) continue;

      const kgLines = parsed.map(line => ({
        sets: line.sets,
        reps: line.reps,
        load: Math.round((line.load / 100) * prKg * 2) / 2,
        loadMax: line.loadMax != null ? Math.round((line.loadMax / 100) * prKg * 2) / 2 : null,
      }));

      await savePrescription(ex.id, {
        prescription: formatPrescription(kgLines, 'absolute_kg'),
        unit: 'absolute_kg',
      });
    }

    if (toResolve.length > 0) {
      await handleRefresh();
    }
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
    <div className="min-h-screen bg-slate-50 p-4 md:p-5">
      <div className="max-w-[1600px] mx-auto">

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline text-xs">Dismiss</button>
          </div>
        )}

        {!planSelection.athlete && !planSelection.group ? (
          <div className="py-4">
            <AthleteCardPicker />
          </div>
        ) : showWeekList ? (
          <PlannerWeekOverview
            athlete={planSelection.athlete}
            group={planSelection.group}
            onSelectWeek={(weekStart) => {
              setSelectedDate(weekStart);
              setShowWeekList(false);
            }}
          />
        ) : (
          <>

            {/* ── Back to overview ── */}
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setShowWeekList(true)}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                title="Back to week overview"
              >
                <ArrowLeft size={14} />
              </button>
            </div>

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
              />

            {/* ── Load Distribution (collapsible) ── */}
            {currentWeekPlan && showLoadDistribution && planSelection.type === 'individual' && planSelection.athlete && (
              <div className="mb-4 bg-white rounded-lg border border-gray-200 overflow-hidden">
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
              <div className="mb-3 flex items-center justify-between px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-indigo-800">Group plan:</span>
                  <span className="text-xs text-indigo-700">{planSelection.group.name}</span>
                </div>
                <button
                  onClick={handleSyncGroupPlan}
                  disabled={isSyncing}
                  className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {isSyncing ? 'Syncing…' : 'Sync to athletes'}
                </button>
              </div>
            )}

            {/* ── Linked-to-group banner for individual plans ── */}
            {planSelection.type === 'individual' && currentWeekPlan?.source_group_plan_id && (
              <div className="mb-3 px-4 py-2 bg-indigo-50/60 border border-indigo-200 rounded-lg">
                <span className="text-xs text-indigo-600">Linked to group plan · Exercises with </span>
                <span className="text-[8px] px-1 py-px bg-indigo-50 text-indigo-500 rounded font-medium">G</span>
                <span className="text-xs text-indigo-600"> come from the group. Edit to override </span>
                <span className="text-[8px] px-1 py-px bg-amber-50 text-amber-500 rounded font-medium">I</span>
                <span className="text-xs text-indigo-600">.</span>
              </div>
            )}

            {/* ── Week Overview (always visible) ── */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-sm text-gray-400">Loading week plan...</div>
              </div>
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
              />
            )}

            {/* ── Day Editor dialog ── */}
            {panelView === 'day' && currentWeekPlan && selectedDayIndex !== null && (() => {
              const isSidebar = (settings?.dialog_mode ?? 'center') === 'sidebar';
              return (
              <div
                className={isSidebar
                  ? 'fixed inset-0 z-50 flex items-start justify-end animate-backdrop-in'
                  : 'fixed inset-0 z-50 flex items-center justify-center p-6 animate-backdrop-in'}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
                    e.preventDefault();
                    await closeDialog();
                  }
                }}
              >
                <div className="absolute inset-0 bg-black/20" onClick={closeDialog} />
                <div className={isSidebar
                  ? 'relative z-10 w-full max-w-lg h-full bg-white shadow-xl border-l border-gray-200 overflow-y-auto flex flex-col animate-sidebar-in'
                  : 'relative z-10 w-full max-w-4xl max-h-[85vh] bg-white shadow-lg flex flex-col overflow-y-auto rounded-xl border border-gray-200 animate-dialog-in'}
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
                className={isSidebar
                  ? 'fixed inset-0 z-50 flex items-start justify-end animate-backdrop-in'
                  : 'fixed inset-0 z-50 flex items-center justify-center p-6 animate-backdrop-in'}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
                    e.preventDefault();
                    await closeDialog();
                  }
                }}
              >
                <div className="absolute inset-0 bg-black/20" onClick={closeDialog} />
                <div className={isSidebar
                  ? 'relative z-10 w-full max-w-lg h-full bg-white shadow-xl border-l border-gray-200 overflow-y-auto flex flex-col animate-sidebar-in'
                  : 'relative z-10 w-full max-w-3xl max-h-[85vh] bg-white shadow-lg flex flex-col overflow-y-auto rounded-xl border border-gray-200 animate-dialog-in'}
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
                    onClose={closeDialog}
                    onBack={() => setPanelView('day')}
                    onSaved={handleRefresh}
                    savePrescription={savePrescription}
                    saveNotes={saveNotes}
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
      </div>
    </div>
  );
}
