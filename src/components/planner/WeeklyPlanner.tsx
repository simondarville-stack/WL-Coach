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
import type { PlanSelection } from '../PlanSelector';
import { WeekOverview } from './WeekOverview';
import { DayEditor } from './DayEditor';
import { ExerciseDetail } from './ExerciseDetail';
import { LoadDistribution } from './LoadDistribution';
import { PlannerControlPanel } from './PlannerControlPanel';
import { PlannerModals } from './PlannerModals';
import { User } from 'lucide-react';

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
  const initialWeekStart = (location.state as { weekStart?: string } | null)?.weekStart ?? null;
  const { selectedAthlete, setSelectedAthlete } = useAthleteStore();
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
  } = useWeekPlans();

  const [macroContext, setMacroContext] = useState<MacroContext | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showCopyWeekModal, setShowCopyWeekModal] = useState(false);
  const [showLoadDistribution, setShowLoadDistribution] = useState(false);
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [editingDayLabels, setEditingDayLabels] = useState<Record<number, string>>({});
  const [weekDescription, setWeekDescription] = useState<string>('');
  const [dayDisplayOrder, setDayDisplayOrder] = useState<number[]>([]);
  const [draggedDayIndex, setDraggedDayIndex] = useState<number | null>(null);
  const [copiedWeekStart, setCopiedWeekStart] = useState<string | null>(null);

  useEffect(() => {
    fetchExercisesByName();
    fetchGroups();
    fetchAllAthletes();
    fetchSettings();
  }, []);

  useEffect(() => {
    if (selectedAthlete) {
      setPlanSelection({ type: 'individual', athlete: selectedAthlete, group: null });
    }
  }, [selectedAthlete]);

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
      const { data: mw } = await supabase
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

      if (!mw) { setMacroContext(null); return; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const macro = (mw as any).macrocycles;

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

  // Close any dialog, refreshing data first so day cards reflect changes
  const closeDialog = async () => {
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
    const date = new Date(selectedDate);
    date.setDate(date.getDate() - 7);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  const goToNextWeek = () => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + 7);
    setSelectedDate(date.toISOString().split('T')[0]);
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
      await updateWeekPlan(currentWeekPlan.id, {
        day_labels: editingDayLabels,
        active_days: activeDays,
        day_display_order: dayDisplayOrder,
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

  const handlePlanSelection = (selection: PlanSelection) => {
    setPlanSelection(selection);
    if (selection.type === 'individual' && selection.athlete) {
      setSelectedAthlete(selection.athlete);
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
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto">

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline text-xs">Dismiss</button>
          </div>
        )}

        {!planSelection.athlete && !planSelection.group ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <User className="mx-auto text-gray-300 mb-4" size={40} />
            <h2 className="text-lg font-medium text-gray-600 mb-1">Select an athlete</h2>
            <p className="text-sm text-gray-400">
              Choose an athlete from the top-right selector to start planning.
            </p>
          </div>
        ) : (
          <>
            {/* ── Control Panel ── */}
            <div className="bg-white rounded-lg border border-gray-200 mb-4">
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
              />
            </div>

            {/* ── Load Distribution (collapsible) ── */}
            {currentWeekPlan && showLoadDistribution && planSelection.type === 'individual' && planSelection.athlete && (
              <div className="mb-4 bg-white rounded-lg border border-gray-200 overflow-hidden">
                <LoadDistribution
                  plannedExercises={plannedExercises}
                  athletePRs={athletePRs}
                  dayLabels={currentWeekPlan.day_labels || {}}
                  activeDays={activeDays}
                  dayDisplayOrder={dayDisplayOrder}
                />
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
                onNavigateToDay={handleNavigateToDay}
                onNavigateToExercise={handleNavigateToExercise}
                addExerciseToDay={addExerciseToDay}
                createComboExercise={createComboExercise}
                onRefresh={handleRefresh}
                onDeleteExercise={handleDeleteExercise}
                onExerciseDrop={handleExerciseDrop}
                onDayDrop={handleDayDrop}
              />
            )}

            {/* ── Day Editor dialog ── */}
            {panelView === 'day' && currentWeekPlan && selectedDayIndex !== null && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-6"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
                    e.preventDefault();
                    await closeDialog();
                  }
                }}
              >
                <div className="absolute inset-0 bg-black/20" onClick={closeDialog} />
                <div className="relative z-10 w-full max-w-4xl max-h-[85vh] bg-white shadow-xl flex flex-col overflow-y-auto rounded-xl border border-gray-200" tabIndex={-1}>
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
                    addExerciseToDay={addExerciseToDay}
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
            )}

            {/* ── Exercise Detail dialog ── */}
            {panelView === 'exercise' && currentWeekPlan && selectedDayIndex !== null && selectedExercise && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-6"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
                    e.preventDefault();
                    await closeDialog();
                  }
                }}
              >
                <div className="absolute inset-0 bg-black/20" onClick={closeDialog} />
                <div className="relative z-10 w-full max-w-3xl max-h-[85vh] bg-white shadow-xl flex flex-col overflow-y-auto rounded-xl border border-gray-200" tabIndex={-1}>
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
            )}
          </>
        )}

        {/* ── Modals ── */}
        <PlannerModals
          showDayConfig={showSettings}
          dayDisplayOrder={dayDisplayOrder}
          editingDayLabels={editingDayLabels}
          activeDays={activeDays}
          dayDragIndex={draggedDayIndex}
          onDayDragStart={handleDragStart}
          onDayDragOver={handleDragOver}
          onDayDragEnd={handleDragEnd}
          onToggleDay={toggleDay}
          onLabelChange={(dayIndex, value) => setEditingDayLabels({ ...editingDayLabels, [dayIndex]: value })}
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
