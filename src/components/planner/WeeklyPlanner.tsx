import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import { useWeekPlans } from '../../hooks/useWeekPlans';
import { useAthleteStore } from '../../store/athleteStore';
import { useExercises } from '../../hooks/useExercises';
import { useSettings } from '../../hooks/useSettings';
import { useAthletes } from '../../hooks/useAthletes';
import { useTrainingGroups } from '../../hooks/useTrainingGroups';
import { supabase } from '../../lib/supabase';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { formatDateRange } from '../../lib/dateUtils';
import { DAYS_OF_WEEK } from '../../lib/constants';
import type { PlannedExercise, DefaultUnit } from '../../lib/database.types';
import { WeekOverview } from './WeekOverview';
import { DayEditor } from './DayEditor';
import { ExerciseDetail } from './ExerciseDetail';
import { PlannerToolbar } from './PlannerToolbar';
import { useMacroContext } from './useMacroContext';
import { LoadDistribution } from './LoadDistribution';
import { PlannerModals } from './PlannerModals';

export interface MacroContext {
  macroId: string;
  macroName: string;
  weekType: string;
  weekTypeText: string;
  weekNumber: number;
  totalWeeks: number;
  phaseName: string | null;
  phaseColor: string | null;
  totalRepsTarget: number | null;
}

interface OpenExercise {
  id: string;
  dayIndex: number;
}

export function WeeklyPlanner() {
  const location = useLocation();
  const initialWeekStart = (location.state as { weekStart?: string } | null)?.weekStart ?? null;
  const { selectedAthlete } = useAthleteStore();

  const [selectedDate, setSelectedDate] = useState<string>(
    () => initialWeekStart ?? getMondayOfWeekISO(new Date())
  );

  // Dialog state — replaces PlannerView state machine
  const [openDayIndex, setOpenDayIndex] = useState<number | null>(null);
  const [openExercise, setOpenExercise] = useState<OpenExercise | null>(null);

  const { exercises: allExercises, fetchExercisesByName } = useExercises();
  const { settings, fetchSettings } = useSettings();
  const { athletes: allAthletes, fetchAllAthletes } = useAthletes();
  const { groups: allGroups, fetchGroups } = useTrainingGroups();
  const { macroContext, setMacroContext, loadMacroContext } = useMacroContext();

  // Toolbar modal state
  const [showDayConfig, setShowDayConfig] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [copiedWeekStart, setCopiedWeekStart] = useState<string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showLoadDistribution, setShowLoadDistribution] = useState(false);

  // DayConfig editing state
  const [editingDayLabels, setEditingDayLabels] = useState<Record<number, string>>({});
  const [weekDescription, setWeekDescription] = useState('');
  const [dayDragIndex, setDayDragIndex] = useState<number | null>(null);

  const planSelection = selectedAthlete
    ? { type: 'individual' as const, athlete: selectedAthlete, group: null }
    : { type: 'individual' as const, athlete: null, group: null };

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
    fetchOrCreateWeekPlan,
    fetchPlannedExercises,
    fetchWeekCombos,
    fetchMacroWeekTarget,
    fetchAthletePRs,
    deletePlannedExercise,
    reorderExercises,
    moveExercise,
    normalizePositions,
    addExerciseToDay,
    savePrescription,
    saveNotes,
    updateWeekPlan,
    copyExerciseWithSetLines,
    copyDayExercises,
    deleteDayExercises,
    fetchExercisesForDay,
    fetchOtherDayPrescriptions,
    createComboExercise,
  } = useWeekPlans();

  useEffect(() => {
    fetchExercisesByName();
    fetchSettings();
    fetchAllAthletes();
    fetchGroups();
  }, []);

  useEffect(() => {
    if (selectedAthlete) {
      void loadWeekData();
      void loadMacroContext(selectedAthlete.id, selectedDate);
    } else {
      setCurrentWeekPlan(null);
      setPlannedExercises({});
      setMacroWeekTarget(null);
      setMacroWeekTypeText(null);
      setAthletePRs([]);
      setMacroContext(null);
    }
  }, [selectedDate, selectedAthlete?.id]);

  useEffect(() => {
    if (!currentWeekPlan) return;
    setWeekDescription(currentWeekPlan.week_description ?? '');
    // Populate editingDayLabels for ALL active days, falling back to DAYS_OF_WEEK names
    const labels = currentWeekPlan.day_labels ?? {};
    const maxDay = Math.max(...currentWeekPlan.active_days, 7);
    const initialLabels: Record<number, string> = {};
    for (let i = 1; i <= maxDay; i++) {
      if (currentWeekPlan.active_days.includes(i)) {
        initialLabels[i] = labels[i] || DAYS_OF_WEEK.find(d => d.index === i)?.name || `Day ${i}`;
      }
    }
    setEditingDayLabels(initialLabels);
  }, [currentWeekPlan?.id]);

  async function loadWeekData() {
    if (!selectedAthlete) return;
    const plan = await fetchOrCreateWeekPlan(selectedDate, planSelection);
    if (!plan) return;
    await Promise.all([
      fetchPlannedExercises(plan.id, plan.day_labels),
      fetchWeekCombos(plan.id),
    ]);
    fetchMacroWeekTarget(selectedAthlete.id, selectedDate);
    fetchAthletePRs(selectedAthlete.id);
  }

  async function handleRefresh() {
    if (!currentWeekPlan) return;
    await Promise.all([
      fetchPlannedExercises(currentWeekPlan.id, currentWeekPlan.day_labels),
      fetchWeekCombos(currentWeekPlan.id),
    ]);
  }

  function prevWeek() {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 7);
    setSelectedDate(d.toISOString().split('T')[0]);
    setOpenDayIndex(null);
    setOpenExercise(null);
  }

  function nextWeek() {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 7);
    setSelectedDate(d.toISOString().split('T')[0]);
    setOpenDayIndex(null);
    setOpenExercise(null);
  }

  // ── Day layout ───────────────────────────────────────────────
  const activeDays = currentWeekPlan?.active_days ?? [1, 2, 3, 4, 5];
  const rawOrder = currentWeekPlan?.day_display_order;
  const dayDisplayOrder = rawOrder && rawOrder.length > 0
    ? rawOrder : activeDays.slice().sort((a, b) => a - b);
  const dayLabels: Record<number, string> = currentWeekPlan?.day_labels ?? {};

  function getDayLabel(i: number) {
    return dayLabels[i] || DAYS_OF_WEEK.find(d => d.index === i)?.name || `Day ${i}`;
  }

  const visibleDays = dayDisplayOrder
    .filter(i => activeDays.includes(i))
    .map(i => ({ index: i, name: getDayLabel(i) }));

  // ── DayConfig handlers ───────────────────────────────────────
  function toggleDay(dayIndex: number) {
    setEditingDayLabels(prev => {
      const next = { ...prev };
      if (!next[dayIndex]) next[dayIndex] = getDayLabel(dayIndex);
      return next;
    });
  }

  async function saveDayLabels() {
    if (!currentWeekPlan) return;
    const newActiveDays = Object.keys(editingDayLabels).map(Number);
    // Delete exercises for days that were removed
    const removedDays = (currentWeekPlan.active_days ?? []).filter(d => !newActiveDays.includes(d));
    for (const dayIndex of removedDays) {
      await supabase.from('planned_exercises').delete()
        .eq('weekplan_id', currentWeekPlan.id).eq('day_index', dayIndex);
    }
    // Keep existing order for days that remain, then append any newly added days
    const newOrder = [
      ...dayDisplayOrder.filter(d => newActiveDays.includes(d)),
      ...newActiveDays.filter(d => !dayDisplayOrder.includes(d)).sort((a, b) => a - b),
    ];
    await updateWeekPlan(currentWeekPlan.id, {
      day_labels: editingDayLabels,
      active_days: newActiveDays.length > 0 ? newActiveDays : activeDays,
      day_display_order: newOrder.length > 0 ? newOrder : dayDisplayOrder,
    });
    // Reload fully so week plan reflects saved changes
    await loadWeekData();
    setShowDayConfig(false);
  }

  async function saveWeekDescription(value: string) {
    setWeekDescription(value);
    if (!currentWeekPlan) return;
    await updateWeekPlan(currentWeekPlan.id, { week_description: value });
  }

  function addNewDay() {
    const currentKeys = Object.keys(editingDayLabels).map(Number);
    const nextFromWeek = DAYS_OF_WEEK.find(d => !currentKeys.includes(d.index));
    if (nextFromWeek) {
      setEditingDayLabels(prev => ({ ...prev, [nextFromWeek.index]: nextFromWeek.name }));
    } else {
      const nextIndex = currentKeys.length > 0 ? Math.max(...currentKeys) + 1 : 1;
      setEditingDayLabels(prev => ({ ...prev, [nextIndex]: `Day ${nextIndex}` }));
    }
  }

  function removeDay(dayIndex: number) {
    setEditingDayLabels(prev => { const n = { ...prev }; delete n[dayIndex]; return n; });
  }

  function handleDayDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dayDragIndex === null || dayDragIndex === idx) return;
    const newOrder = [...dayDisplayOrder];
    const fromPos = newOrder.indexOf(dayDragIndex);
    const toPos = newOrder.indexOf(idx);
    if (fromPos === -1 || toPos === -1) return;
    newOrder.splice(fromPos, 1);
    newOrder.splice(toPos, 0, dayDragIndex);
    if (currentWeekPlan) void updateWeekPlan(currentWeekPlan.id, { day_display_order: newOrder });
  }

  // ── Drag operations ──────────────────────────────────────────
  async function handleExerciseDrop(fromDay: number, plannedExId: string, toDay: number, isCopy: boolean) {
    if (!currentWeekPlan) return;
    if (isCopy) {
      const srcExs = await fetchExercisesForDay(currentWeekPlan.id, fromDay);
      const sourceEx = srcExs.find((e: PlannedExercise) => e.id === plannedExId);
      if (!sourceEx) return;
      const destExs = await fetchExercisesForDay(currentWeekPlan.id, toDay);
      await copyExerciseWithSetLines(sourceEx, currentWeekPlan.id, toDay, destExs.length + 1);
    } else {
      await moveExercise(currentWeekPlan.id, plannedExId, fromDay, toDay);
      await Promise.all([normalizePositions(currentWeekPlan.id, fromDay), normalizePositions(currentWeekPlan.id, toDay)]);
    }
    await handleRefresh();
  }

  async function handleDayDrop(sourceDay: number, destDay: number, isCopy: boolean) {
    if (!currentWeekPlan) return;
    const wid = currentWeekPlan.id;
    const [srcExs, destExs] = await Promise.all([fetchExercisesForDay(wid, sourceDay), fetchExercisesForDay(wid, destDay)]);
    if (isCopy) {
      if (destExs.length > 0) await deleteDayExercises(destExs.map((e: PlannedExercise) => e.id));
      for (let i = 0; i < srcExs.length; i++) {
        await copyExerciseWithSetLines(srcExs[i] as PlannedExercise, wid, destDay, i + 1);
      }
    } else {
      await Promise.all([
        ...(srcExs.length > 0 ? [supabase.from('planned_exercises').update({ day_index: destDay }).in('id', srcExs.map((e: PlannedExercise) => e.id))] : []),
        ...(destExs.length > 0 ? [supabase.from('planned_exercises').update({ day_index: sourceDay }).in('id', destExs.map((e: PlannedExercise) => e.id))] : []),
      ]);
    }
    await handleRefresh();
  }

  const canCopyPaste = !!selectedAthlete && !!currentWeekPlan;
  const athleteInitials = selectedAthlete?.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? '';

  // Resolve exercise detail data from state
  const dialogDayIndex = openExercise?.dayIndex ?? openDayIndex;
  const dayExercisesForDialog = dialogDayIndex !== null ? (plannedExercises[dialogDayIndex] || []) : [];
  const plannedExForDetail = openExercise
    ? (dayExercisesForDialog.find(e => e.id === openExercise.id) ?? null)
    : null;

  const dialogOpen = openDayIndex !== null || openExercise !== null;

  function closeAll() {
    setOpenDayIndex(null);
    setOpenExercise(null);
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Week navigation bar */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-500"><ChevronLeft size={18} /></button>
          <span className="text-base font-medium text-gray-900 min-w-[160px] text-center select-none">{formatDateRange(selectedDate, 7)}</span>
          <button onClick={nextWeek} className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-500"><ChevronRight size={18} /></button>
        </div>
        <div className="flex-1 flex justify-end">
          <PlannerToolbar canCopyPaste={canCopyPaste} copiedWeekStart={copiedWeekStart} showLoadDistribution={showLoadDistribution}
            onDayConfig={() => setShowDayConfig(true)} onCopy={() => setCopiedWeekStart(selectedDate)}
            onPaste={() => { if (copiedWeekStart) setShowPasteModal(true); }} onPrint={() => setShowPrintModal(true)}
            onToggleLoadDistribution={() => setShowLoadDistribution(v => !v)} />
        </div>
      </div>

      {/* Athlete ribbon */}
      {selectedAthlete && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-gray-50 border-b border-gray-100 flex-shrink-0">
          {selectedAthlete.photo_url
            ? <img src={selectedAthlete.photo_url} alt={selectedAthlete.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" onError={e => { e.currentTarget.style.display = 'none'; }} />
            : <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-semibold text-blue-700 flex-shrink-0">{athleteInitials}</div>}
          <span className="text-sm text-gray-700 font-medium">{selectedAthlete.name}</span>
        </div>
      )}

      {/* Content — always WeekOverview */}
      <div className="flex-1 overflow-y-auto">
        {!selectedAthlete ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <User className="text-gray-300 mb-3" size={40} />
            <p className="text-sm text-gray-500">Select an athlete to start planning</p>
          </div>
        ) : loading && !currentWeekPlan ? (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400">Loading...</div>
        ) : error ? (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
        ) : (
          <>
            <WeekOverview
              weekPlan={currentWeekPlan}
              visibleDays={visibleDays}
              plannedExercises={plannedExercises}
              comboMembers={comboMembers}
              allExercises={allExercises}
              athletePRs={athletePRs}
              macroWeekTarget={macroWeekTarget}
              macroContext={macroContext}
              weekDescription={weekDescription}
              settings={settings}
              onSaveWeekDescription={saveWeekDescription}
              onNavigateToDay={dayIndex => setOpenDayIndex(dayIndex)}
              onNavigateToExercise={(dayIndex, exerciseId) => setOpenExercise({ id: exerciseId, dayIndex })}
              addExerciseToDay={addExerciseToDay}
              createComboExercise={createComboExercise}
              onRefresh={handleRefresh}
              onDeleteExercise={async (id) => { await deletePlannedExercise(id); await handleRefresh(); }}
              onExerciseDrop={handleExerciseDrop}
              onDayDrop={handleDayDrop}
            />
            {showLoadDistribution && currentWeekPlan && (
              <div className="px-4 pb-4">
                <LoadDistribution plannedExercises={plannedExercises} athletePRs={athletePRs}
                  dayLabels={dayLabels} activeDays={activeDays} dayDisplayOrder={dayDisplayOrder} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Dialog overlay — Day editor OR exercise detail */}
      {dialogOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={closeAll}
          />
          {/* Dialog container */}
          <div className="fixed inset-0 z-50 pointer-events-none flex items-start justify-center pt-6 pb-6 px-4">
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden pointer-events-auto"
              onClick={e => e.stopPropagation()}
            >
              {openExercise !== null ? (
                <ExerciseDetail
                  plannedExercise={plannedExForDetail}
                  comboMembers={comboMembers}
                  weekPlanId={currentWeekPlan?.id ?? ''}
                  dayIndex={openExercise.dayIndex}
                  dayName={getDayLabel(openExercise.dayIndex)}
                  athleteId={selectedAthlete?.id ?? ''}
                  macroContext={macroContext}
                  athletePRs={athletePRs}
                  dayLabels={dayLabels}
                  settings={settings}
                  onClose={() => setOpenExercise(null)}
                  onBack={openDayIndex !== null ? () => setOpenExercise(null) : undefined}
                  onSaved={handleRefresh}
                  savePrescription={savePrescription as (id: string, data: { prescription: string; notes: string; unit: DefaultUnit; isCombo?: boolean }) => Promise<void>}
                  saveNotes={saveNotes as (id: string, notes: string) => Promise<void>}
                  fetchOtherDayPrescriptions={fetchOtherDayPrescriptions}
                />
              ) : openDayIndex !== null ? (
                <DayEditor
                  weekPlan={currentWeekPlan!}
                  dayIndex={openDayIndex}
                  dayName={getDayLabel(openDayIndex)}
                  exercises={plannedExercises[openDayIndex] || []}
                  comboMembers={comboMembers}
                  athletePRs={athletePRs}
                  settings={settings}
                  macroContext={macroContext}
                  allExercises={allExercises}
                  onClose={() => setOpenDayIndex(null)}
                  onNavigateToExercise={exerciseId => setOpenExercise({ id: exerciseId, dayIndex: openDayIndex })}
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
              ) : null}
            </div>
          </div>
        </>
      )}

      {/* Modals */}
      {/* Merge dayDisplayOrder with any keys in editingDayLabels not yet saved (newly added days) */}
      <PlannerModals
        showDayConfig={showDayConfig}
        dayDisplayOrder={[
          ...dayDisplayOrder,
          ...Object.keys(editingDayLabels).map(Number)
            .filter(k => !dayDisplayOrder.includes(k))
            .sort((a, b) => a - b),
        ]}
        editingDayLabels={editingDayLabels}
        activeDays={activeDays}
        dayDragIndex={dayDragIndex}
        onDayDragStart={idx => setDayDragIndex(idx)}
        onDayDragOver={handleDayDragOver}
        onDayDragEnd={() => setDayDragIndex(null)}
        onToggleDay={toggleDay}
        onLabelChange={(dayIndex, value) => setEditingDayLabels(prev => ({ ...prev, [dayIndex]: value }))}
        onRemoveDay={removeDay}
        onAddDay={addNewDay}
        onDayConfigCancel={() => setShowDayConfig(false)}
        onDayConfigSave={() => { void saveDayLabels(); }}
        showPasteModal={showPasteModal}
        copiedWeekStart={copiedWeekStart}
        selectedDate={selectedDate}
        selectedAthlete={selectedAthlete}
        allAthletes={allAthletes}
        allGroups={allGroups}
        onPasteClose={() => setShowPasteModal(false)}
        onPasteComplete={() => { setShowPasteModal(false); void handleRefresh(); }}
        showPrintModal={showPrintModal}
        dayLabels={dayLabels}
        weekDescription={currentWeekPlan?.week_description}
        onPrintClose={() => setShowPrintModal(false)}
      />
    </div>
  );
}
