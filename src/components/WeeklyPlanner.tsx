import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useWeekPlans } from '../../hooks/useWeekPlans';
import { useAthleteStore } from '../../store/athleteStore';
import { useExercises } from '../../hooks/useExercises';
import { useAthletes } from '../../hooks/useAthletes';
import { useTrainingGroups } from '../../hooks/useTrainingGroups';
import { useSettings } from '../../hooks/useSettings';
import { DAYS_OF_WEEK } from '../../lib/constants';
import { getMondayOfWeekISO as getMondayOfWeek } from '../../lib/weekUtils';
import type { DefaultUnit } from '../../lib/database.types';

import { PlannerControlPanel } from './PlannerControlPanel';
import { WeekSummary } from './WeekSummary';
import { WeekOverview } from './WeekOverview';
import { DayEditor } from './DayEditor';
import { ExerciseDetail } from './ExerciseDetail';
import { PlannerModals } from './PlannerModals';
import { LoadDistribution } from './LoadDistribution';
import { useMacroContext } from './useMacroContext';

// ── Exported type used by DayEditor, ExerciseDetail, PlannerControlPanel, etc.
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

export function WeeklyPlanner() {
  const location = useLocation();
  const initialWeekStart = (location.state as { weekStart?: string } | null)?.weekStart ?? null;
  const { selectedAthlete } = useAthleteStore();
  const { settings, fetchSettings } = useSettings();

  const [selectedDate, setSelectedDate] = useState(() =>
    initialWeekStart ?? getMondayOfWeek(new Date())
  );

  const {
    exercises: allExercises,
    fetchExercisesByName,
  } = useExercises();

  const { athletes, fetchAllAthletes } = useAthletes();
  const { groups, fetchGroups } = useTrainingGroups();

  const {
    weekPlan,
    plannedExercises,
    comboMembers,
    athletePRs,
    macroWeekTarget,
    loading,
    error,
    fetchOrCreateWeekPlan,
    fetchPlannedExercises,
    fetchWeekCombos,
    fetchAthletePRs,
    updateWeekPlan,
    deletePlannedExercise,
    reorderExercises,
    moveExercise,
    normalizePositions,
    savePrescription,
    saveNotes,
    addExerciseToDay,
    createComboExercise,
    copyExerciseWithSetLines,
    copyDayExercises,
    deleteDayExercises,
    fetchExercisesForDay,
    fetchOtherDayPrescriptions,
  } = useWeekPlans();

  const { macroContext, loadMacroContext } = useMacroContext();

  // ── UI state ─────────────────────────────────────────────────────────────
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [editingDayLabels, setEditingDayLabels] = useState<Record<number, string>>({});
  const [weekDescription, setWeekDescription] = useState('');
  const [dayDisplayOrder, setDayDisplayOrder] = useState<number[]>([]);
  const [dayDragIndex, setDayDragIndex] = useState<number | null>(null);

  // Modal / dialog state
  const [showDayConfig, setShowDayConfig] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showLoadDistribution, setShowLoadDistribution] = useState(false);
  const [copiedWeekStart, setCopiedWeekStart] = useState<string | null>(null);

  // Dialog overlays
  const [openDayIndex, setOpenDayIndex] = useState<number | null>(null);
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null);
  const [openExerciseDayIndex, setOpenExerciseDayIndex] = useState<number | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchExercisesByName();
    fetchGroups();
    fetchAllAthletes();
    fetchSettings();
  }, []);

  useEffect(() => {
    if (selectedAthlete) {
      loadWeekPlan();
      loadMacroContext(selectedAthlete.id, selectedDate);
      fetchAthletePRs(selectedAthlete.id);
    }
  }, [selectedDate, selectedAthlete]);

  const loadWeekPlan = async () => {
    if (!selectedAthlete) return;
    const plan = await fetchOrCreateWeekPlan(selectedDate, {
      type: 'individual',
      athlete: selectedAthlete,
      group: null,
    });
    if (plan) {
      await Promise.all([
        fetchPlannedExercises(plan.id, plan.day_labels),
        fetchWeekCombos(plan.id),
      ]);
    }
  };

  // Sync week plan state to local UI state
  useEffect(() => {
    if (weekPlan) {
      setActiveDays(weekPlan.active_days);
      const labels: Record<number, string> = {};
      const maxDay = Math.max(...weekPlan.active_days, 7);
      for (let i = 1; i <= maxDay; i++) {
        labels[i] = weekPlan.day_labels?.[i] || DAYS_OF_WEEK.find(d => d.index === i)?.name || `Day ${i}`;
      }
      setEditingDayLabels(labels);
      setWeekDescription(weekPlan.week_description || '');
      setDayDisplayOrder(
        weekPlan.day_display_order || weekPlan.active_days.slice().sort((a, b) => a - b)
      );
    }
  }, [weekPlan]);

  // ── Refresh helper ───────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    if (!weekPlan) return;
    await Promise.all([
      fetchPlannedExercises(weekPlan.id, weekPlan.day_labels),
      fetchWeekCombos(weekPlan.id),
    ]);
  }, [weekPlan]);

  // ── Week navigation ──────────────────────────────────────────────────────
  const goPrevWeek = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 7);
    setSelectedDate(d.toISOString().split('T')[0]);
  };
  const goNextWeek = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 7);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  // ── Day config ───────────────────────────────────────────────────────────
  const toggleDay = (i: number) => {
    setActiveDays(prev =>
      prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i].sort((a, b) => a - b)
    );
    if (!dayDisplayOrder.includes(i)) setDayDisplayOrder(prev => [...prev, i]);
  };
  const addNewDay = () => {
    const all = Object.keys(editingDayLabels).map(Number);
    const next = all.length > 0 ? Math.max(...all) + 1 : 1;
    setEditingDayLabels(prev => ({ ...prev, [next]: `Day ${next}` }));
    setActiveDays(prev => [...prev, next].sort((a, b) => a - b));
    setDayDisplayOrder(prev => [...prev, next]);
  };
  const removeDay = (i: number) => {
    setEditingDayLabels(prev => { const n = { ...prev }; delete n[i]; return n; });
    setActiveDays(prev => prev.filter(d => d !== i));
    setDayDisplayOrder(prev => prev.filter(d => d !== i));
  };
  const saveDayLabels = async () => {
    if (!weekPlan) return;
    // Delete exercises for removed days
    const removedDays = (weekPlan.active_days || []).filter(d => !activeDays.includes(d));
    for (const dayIdx of removedDays) {
      const exs = await fetchExercisesForDay(weekPlan.id, dayIdx);
      for (const ex of exs) await deletePlannedExercise(ex.id);
    }
    await updateWeekPlan(weekPlan.id, {
      day_labels: editingDayLabels,
      active_days: activeDays,
      day_display_order: dayDisplayOrder,
    });
    setShowDayConfig(false);
    await loadWeekPlan();
  };
  const cancelDayConfig = () => {
    if (weekPlan) {
      setActiveDays(weekPlan.active_days);
      const labels: Record<number, string> = {};
      const maxDay = Math.max(...weekPlan.active_days, 7);
      for (let i = 1; i <= maxDay; i++) {
        labels[i] = weekPlan.day_labels?.[i] || DAYS_OF_WEEK.find(d => d.index === i)?.name || `Day ${i}`;
      }
      setEditingDayLabels(labels);
      setDayDisplayOrder(weekPlan.day_display_order || weekPlan.active_days.slice().sort((a, b) => a - b));
    }
    setShowDayConfig(false);
  };

  // ── Day drag reorder ─────────────────────────────────────────────────────
  const handleDayDragStart = (i: number) => setDayDragIndex(i);
  const handleDayDragOver = (e: React.DragEvent, target: number) => {
    e.preventDefault();
    if (dayDragIndex === null || dayDragIndex === target) return;
    const order = [...dayDisplayOrder];
    const from = order.indexOf(dayDragIndex);
    const to = order.indexOf(target);
    if (from !== -1 && to !== -1) {
      order.splice(from, 1);
      order.splice(to, 0, dayDragIndex);
      setDayDisplayOrder(order);
    }
  };
  const handleDayDragEnd = () => setDayDragIndex(null);

  // ── Copy / Paste / Print ─────────────────────────────────────────────────
  const handleCopy = () => { if (weekPlan) setCopiedWeekStart(selectedDate); };
  const handlePaste = () => { if (copiedWeekStart) setShowPasteModal(true); };
  const saveWeekDescription = async (value: string) => {
    setWeekDescription(value);
    if (weekPlan) await updateWeekPlan(weekPlan.id, { week_description: value.trim() || null });
  };

  // ── Exercise / Day drop handlers ─────────────────────────────────────────
  const handleExerciseDrop = async (fromDay: number, exId: string, toDay: number, isCopy: boolean) => {
    if (!weekPlan) return;
    if (isCopy) {
      const ex = plannedExercises[fromDay]?.find(e => e.id === exId);
      if (ex) {
        const toExs = plannedExercises[toDay] || [];
        await copyExerciseWithSetLines(ex, weekPlan.id, toDay, toExs.length + 1);
      }
    } else {
      await moveExercise(weekPlan.id, exId, fromDay, toDay);
    }
    await handleRefresh();
  };

  const handleDayDrop = async (sourceDay: number, destDay: number, isCopy: boolean) => {
    if (!weekPlan) return;
    const sourceExs = await fetchExercisesForDay(weekPlan.id, sourceDay);
    if (sourceExs.length === 0) return;

    if (isCopy) {
      // Copy: delete destination, then copy source there
      const destExs = await fetchExercisesForDay(weekPlan.id, destDay);
      if (destExs.length > 0) await deleteDayExercises(destExs.map(e => e.id));
      await copyDayExercises(sourceExs, weekPlan.id, destDay, 1);
    } else {
      // Swap: move source exercises to destination and vice versa
      const destExs = await fetchExercisesForDay(weekPlan.id, destDay);
      // Move all source to a temp day index (999) to avoid collision
      for (const ex of sourceExs) {
        await (await import('../../lib/supabase')).supabase
          .from('planned_exercises').update({ day_index: 999 }).eq('id', ex.id);
      }
      // Move all dest to source day
      for (const ex of destExs) {
        await (await import('../../lib/supabase')).supabase
          .from('planned_exercises').update({ day_index: sourceDay }).eq('id', ex.id);
      }
      // Move temp (old source) to dest day
      for (const ex of sourceExs) {
        await (await import('../../lib/supabase')).supabase
          .from('planned_exercises').update({ day_index: destDay }).eq('id', ex.id);
      }
    }
    await handleRefresh();
  };

  // ── Navigation helpers ───────────────────────────────────────────────────
  const navigateToDay = (dayIndex: number) => {
    setOpenDayIndex(dayIndex);
    setOpenExerciseId(null);
  };
  const navigateToExercise = (dayIndex: number, exerciseId: string) => {
    setOpenExerciseDayIndex(dayIndex);
    setOpenExerciseId(exerciseId);
  };
  const closeDay = () => { setOpenDayIndex(null); };
  const closeExercise = () => { setOpenExerciseId(null); setOpenExerciseDayIndex(null); };

  // ── Derived data ─────────────────────────────────────────────────────────
  const visibleDays = dayDisplayOrder
    .filter(i => activeDays.includes(i))
    .map(i => ({ index: i, name: editingDayLabels[i] || DAYS_OF_WEEK.find(d => d.index === i)?.name || `Day ${i}` }));

  const getDayLabel = (i: number) =>
    weekPlan?.day_labels?.[i] || DAYS_OF_WEEK.find(d => d.index === i)?.name || `Day ${i}`;

  // Find the exercise for ExerciseDetail
  const openExercise = openExerciseId
    ? Object.values(plannedExercises).flat().find(e => e.id === openExerciseId) ?? null
    : null;
  const exerciseDayIndex = openExerciseDayIndex ?? openDayIndex ?? 0;

  // ── Render ───────────────────────────────────────────────────────────────
  if (!selectedAthlete) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-300 text-4xl mb-3">&#9881;</div>
          <p className="text-gray-500">Select an athlete from the top-right to start planning.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-5">
      <div className="max-w-[1700px] mx-auto space-y-3">

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        {/* ── Control Panel ── */}
        <PlannerControlPanel
          selectedAthlete={selectedAthlete}
          selectedGroup={null}
          selectedDate={selectedDate}
          macroContext={macroContext}
          macroWeekTarget={macroWeekTarget}
          plannedExercises={plannedExercises}
          athletePRs={athletePRs}
          settings={settings}
          weekDescription={weekDescription}
          canCopyPaste={!!weekPlan}
          copiedWeekStart={copiedWeekStart}
          showLoadDistribution={showLoadDistribution}
          onPrevWeek={goPrevWeek}
          onNextWeek={goNextWeek}
          onSaveWeekDescription={saveWeekDescription}
          onDayConfig={() => setShowDayConfig(true)}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onPrint={() => setShowPrintModal(true)}
          onToggleLoadDistribution={() => setShowLoadDistribution(v => !v)}
        />

        {/* ── Week Summary ── */}
        {weekPlan && (
          <WeekSummary
            plannedExercises={plannedExercises}
            athletePRs={athletePRs}
            macroContext={macroContext}
            macroWeekTarget={macroWeekTarget}
            settings={settings}
          />
        )}

        {/* ── Load Distribution ── */}
        {weekPlan && showLoadDistribution && (
          <LoadDistribution
            plannedExercises={plannedExercises}
            athletePRs={athletePRs}
            dayLabels={weekPlan.day_labels || {}}
            activeDays={activeDays}
            dayDisplayOrder={dayDisplayOrder}
          />
        )}

        {/* ── Day Cards Grid ── */}
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading week plan...</div>
        ) : (
          <WeekOverview
            weekPlan={weekPlan}
            visibleDays={visibleDays}
            plannedExercises={plannedExercises}
            comboMembers={comboMembers}
            allExercises={allExercises}
            onNavigateToDay={navigateToDay}
            onNavigateToExercise={navigateToExercise}
            addExerciseToDay={addExerciseToDay}
            createComboExercise={createComboExercise}
            onRefresh={handleRefresh}
            onDeleteExercise={async (id) => { await deletePlannedExercise(id); await handleRefresh(); }}
            onExerciseDrop={handleExerciseDrop}
            onDayDrop={handleDayDrop}
          />
        )}

        {/* ── Dialog: Day Editor ── */}
        {openDayIndex !== null && weekPlan && (
          <div className="fixed inset-0 bg-black/20 z-40 flex items-start justify-center pt-8 pb-8 overflow-y-auto">
            <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-4xl mx-4 max-h-[85vh] overflow-y-auto">
              <DayEditor
                weekPlan={weekPlan}
                dayIndex={openDayIndex}
                dayName={getDayLabel(openDayIndex)}
                exercises={plannedExercises[openDayIndex] || []}
                comboMembers={comboMembers}
                athletePRs={athletePRs}
                settings={settings}
                macroContext={macroContext}
                allExercises={allExercises}
                onClose={closeDay}
                onNavigateToExercise={(id) => navigateToExercise(openDayIndex, id)}
                onRefresh={handleRefresh}
                addExerciseToDay={addExerciseToDay}
                createComboExercise={createComboExercise}
                savePrescription={async (id, data) => {
                  await savePrescription(id, { prescription: data.prescription, notes: '', unit: data.unit, variation_note: undefined });
                }}
                saveNotes={saveNotes}
                deletePlannedExercise={async (id) => { await deletePlannedExercise(id); }}
                reorderExercises={reorderExercises}
                moveExercise={moveExercise}
                normalizePositions={normalizePositions}
              />
            </div>
          </div>
        )}

        {/* ── Dialog: Exercise Detail ── */}
        {openExerciseId && weekPlan && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-8 pb-8 overflow-y-auto">
            <div className="bg-white rounded-xl border border-gray-200 shadow-lg w-full max-w-3xl mx-4 max-h-[85vh] overflow-y-auto">
              <ExerciseDetail
                plannedExercise={openExercise}
                comboMembers={comboMembers}
                weekPlanId={weekPlan.id}
                dayIndex={exerciseDayIndex}
                dayName={getDayLabel(exerciseDayIndex)}
                athleteId={selectedAthlete.id}
                macroContext={macroContext}
                athletePRs={athletePRs}
                dayLabels={weekPlan.day_labels || {}}
                settings={settings}
                onClose={closeExercise}
                onBack={openDayIndex !== null ? closeExercise : undefined}
                onSaved={handleRefresh}
                savePrescription={async (id, data) => {
                  await savePrescription(id, { prescription: data.prescription, notes: '', unit: data.unit, variation_note: undefined });
                }}
                saveNotes={saveNotes}
                fetchOtherDayPrescriptions={fetchOtherDayPrescriptions}
              />
            </div>
          </div>
        )}

        {/* ── Modals (DayConfig, Copy/Paste, Print) ── */}
        <PlannerModals
          showDayConfig={showDayConfig}
          dayDisplayOrder={dayDisplayOrder}
          editingDayLabels={editingDayLabels}
          activeDays={activeDays}
          dayDragIndex={dayDragIndex}
          onDayDragStart={handleDayDragStart}
          onDayDragOver={handleDayDragOver}
          onDayDragEnd={handleDayDragEnd}
          onToggleDay={toggleDay}
          onLabelChange={(i, v) => setEditingDayLabels(prev => ({ ...prev, [i]: v }))}
          onRemoveDay={removeDay}
          onAddDay={addNewDay}
          onDayConfigCancel={cancelDayConfig}
          onDayConfigSave={saveDayLabels}
          showPasteModal={showPasteModal}
          copiedWeekStart={copiedWeekStart}
          selectedDate={selectedDate}
          selectedAthlete={selectedAthlete}
          allAthletes={athletes}
          allGroups={groups}
          onPasteClose={() => setShowPasteModal(false)}
          onPasteComplete={async () => { setShowPasteModal(false); await loadWeekPlan(); }}
          showPrintModal={showPrintModal}
          dayLabels={weekPlan?.day_labels || {}}
          weekDescription={weekPlan?.week_description}
          onPrintClose={() => setShowPrintModal(false)}
        />
      </div>
    </div>
  );
}
