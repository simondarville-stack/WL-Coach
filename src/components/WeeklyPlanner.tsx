import { useState, useEffect } from 'react';
import { useWeekPlans } from '../hooks/useWeekPlans';
import { useAthleteStore } from '../store/athleteStore';
import { useExercises } from '../hooks/useExercises';
import { useAthletes } from '../hooks/useAthletes';
import { useTrainingGroups } from '../hooks/useTrainingGroups';
import { DAYS_OF_WEEK } from '../lib/constants';
import { DayColumn } from './DayColumn';
import { PrintWeek } from './PrintWeek';
import { MacroValidation } from './MacroValidation';
import { PlanSelector, type PlanSelection } from './PlanSelector';
import { LoadDistributionPanel } from './LoadDistributionPanel';
import { CopyWeekModal } from './CopyWeekModal';
import { User, Users } from 'lucide-react';
import { formatDateRange as formatDateRangeUtil } from '../lib/dateUtils';
import { getMondayOfWeekISO as getMondayOfWeek } from '../lib/weekUtils';
import { DayConfigModal } from './DayConfigModal';
import { WeeklyPlannerHeader } from './WeeklyPlannerHeader';
import { WeeklySummaryPanel } from './WeeklySummaryPanel';

interface WeeklyPlannerProps {
  initialWeekStart?: string | null;
}

export function WeeklyPlanner({ initialWeekStart }: WeeklyPlannerProps) {
  const { selectedAthlete, setSelectedAthlete } = useAthleteStore();
  const [selectedDate, setSelectedDate] = useState(() => {
    if (initialWeekStart) return initialWeekStart;
    return getMondayOfWeek(new Date());
  });
  const [planSelection, setPlanSelection] = useState<PlanSelection>({
    type: 'individual',
    athlete: selectedAthlete,
    group: null,
  });
  const {
    exercises: allExercises,
    fetchExercisesByName,
  } = useExercises();

  const {
    athletes,
    fetchAllAthletes,
  } = useAthletes();

  const {
    groups,
    fetchGroups,
  } = useTrainingGroups();

  const {
    weekPlan: currentWeekPlan,
    setWeekPlan: setCurrentWeekPlan,
    plannedExercises,
    setPlannedExercises,
    weekComboSetLines,
    weekComboItems,
    comboExerciseIds,
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
  } = useWeekPlans();

  const [showSettings, setShowSettings] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showCopyWeekModal, setShowCopyWeekModal] = useState(false);
  const [showCategorySummaries, setShowCategorySummaries] = useState(true);
  const [showLoadDistribution, setShowLoadDistribution] = useState(false);
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [editingDayLabels, setEditingDayLabels] = useState<Record<number, string>>({});
  const [weekDescription, setWeekDescription] = useState<string>('');
  const [dayDisplayOrder, setDayDisplayOrder] = useState<number[]>([]);
  const [draggedDayIndex, setDraggedDayIndex] = useState<number | null>(null);
  const [comboRefreshKey, setComboRefreshKey] = useState(0);
  const [copiedWeekStart, setCopiedWeekStart] = useState<string | null>(null);
  const [copiedSourceWeekPlanId, setCopiedSourceWeekPlanId] = useState<string | null>(null);
  const [copiedSourceLabel, setCopiedSourceLabel] = useState<string>('');
  const [showPasteModal, setShowPasteModal] = useState(false);

  useEffect(() => {
    fetchExercisesByName();
    fetchGroups();
    fetchAllAthletes();
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
        loadAthletePRs(planSelection.athlete.id);
      } else {
        setMacroWeekTarget(null);
        setMacroWeekTypeText(null);
        setAthletePRs([]);
      }
    } else {
      setCurrentWeekPlan(null);
      setPlannedExercises({});
      setMacroWeekTarget(null);
      setMacroWeekTypeText(null);
      setAthletePRs([]);
    }
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
        (currentWeekPlan as any).day_display_order || currentWeekPlan.active_days.slice().sort((a, b) => a - b)
      );
    }
  }, [currentWeekPlan]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadExercises();
        if (selectedAthlete && currentWeekPlan) {
          loadPlannedExercises(currentWeekPlan.id);
          loadWeekCombos(currentWeekPlan.id);
          loadMacroWeekTarget();
        }
      }
    };

    const handleFocus = () => {
      loadExercises();
      if (selectedAthlete && currentWeekPlan) {
        loadPlannedExercises(currentWeekPlan.id);
        loadWeekCombos(currentWeekPlan.id);
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
  const loadGroups = () => fetchGroups();
  const loadAthletes = () => fetchAllAthletes();
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

  const loadWeekCombos = (weekPlanId: string) => fetchWeekCombos(weekPlanId);

  const loadPlannedExercises = (weekPlanId: string) =>
    fetchPlannedExercises(weekPlanId, currentWeekPlan?.day_labels);

  const handleRefresh = async () => {
    if (currentWeekPlan) {
      await Promise.all([
        fetchPlannedExercises(currentWeekPlan.id, currentWeekPlan.day_labels),
        fetchWeekCombos(currentWeekPlan.id),
      ]);
      setComboRefreshKey(k => k + 1);
    }
  };

  const handleDeleteExercise = async (plannedExerciseId: string, dayIndex: number) => {
    if (!currentWeekPlan) return;
    try {
      await deletePlannedExercise(plannedExerciseId);
      await normalizePositions(currentWeekPlan.id, dayIndex);
      await Promise.all([
        fetchPlannedExercises(currentWeekPlan.id, currentWeekPlan.day_labels),
        fetchWeekCombos(currentWeekPlan.id),
      ]);
    } catch {
      // error already set in hook
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

  const handleMoveExercise = async (
    exerciseId: string,
    fromDayIndex: number,
    toDayIndex: number
  ) => {
    if (!currentWeekPlan) return;
    try {
      await moveExercise(currentWeekPlan.id, exerciseId, fromDayIndex, toDayIndex);
      await Promise.all([
        fetchPlannedExercises(currentWeekPlan.id, currentWeekPlan.day_labels),
        fetchWeekCombos(currentWeekPlan.id),
      ]);
    } catch {
      // error already set in hook
    }
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

  const formatDateRange = () => {
    return formatDateRangeUtil(selectedDate, 7);
  };

  const toggleDay = (dayIndex: number) => {
    if (!currentWeekPlan) return;

    if (activeDays.includes(dayIndex)) {
      setActiveDays(activeDays.filter((d) => d !== dayIndex));
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
        (currentWeekPlan as any).day_display_order || currentWeekPlan.active_days.slice().sort((a, b) => a - b)
      );
    }
    setShowSettings(false);
  };

  const handleDragStart = (dayIndex: number) => {
    setDraggedDayIndex(dayIndex);
  };

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

  const handleDragEnd = () => {
    setDraggedDayIndex(null);
  };

  const saveDayLabels = async () => {
    if (!currentWeekPlan) return;
    try {
      await updateWeekPlan(currentWeekPlan.id, {
        day_labels: editingDayLabels,
        active_days: activeDays,
        day_display_order: dayDisplayOrder,
      } as any);
      setShowSettings(false);
    } catch {
      // error already set in hook
    }
  };

  const getDayLabel = (dayIndex: number): string => {
    if (currentWeekPlan?.day_labels && currentWeekPlan.day_labels[dayIndex]) {
      return currentWeekPlan.day_labels[dayIndex];
    }
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

    if (activeDays.includes(dayIndex)) {
      const newActiveDays = activeDays.filter(d => d !== dayIndex);
      setActiveDays(newActiveDays);
    }

    setDayDisplayOrder(dayDisplayOrder.filter(d => d !== dayIndex));
  };

  const saveWeekDescription = async () => {
    if (!currentWeekPlan) return;
    try {
      await updateWeekPlan(currentWeekPlan.id, { week_description: weekDescription.trim() || null });
    } catch {
      // error already set in hook
    }
  };

  const visibleDays = dayDisplayOrder
    .filter(dayIndex => activeDays.includes(dayIndex))
    .map(dayIndex => ({
      index: dayIndex,
      name: getDayLabel(dayIndex)
    }));

  const calculateWeeklySummary = () => {
    let totalSets = 0;
    let totalReps = 0;
    let totalTonnage = 0;

    Object.values(plannedExercises).forEach((dayExercises) => {
      dayExercises.forEach((ex) => {
        if (!comboExerciseIds.has(ex.id) && ex.exercise.counts_towards_totals) {
          totalSets += ex.summary_total_sets || 0;
          totalReps += ex.summary_total_reps || 0;
          if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
            totalTonnage += (ex.summary_avg_load * (ex.summary_total_reps || 0));
          }
        }
      });
    });

    const itemsByCombo: Record<string, typeof weekComboItems> = {};
    weekComboItems.forEach(item => {
      if (!itemsByCombo[item.combo_id]) itemsByCombo[item.combo_id] = [];
      itemsByCombo[item.combo_id].push(item);
    });

    const comboSetLineMap: Record<string, (typeof weekComboSetLines[number])[]> = {};
    weekComboSetLines.forEach(line => {
      if (!comboSetLineMap[line.planned_combo_id]) comboSetLineMap[line.planned_combo_id] = [];
      comboSetLineMap[line.planned_combo_id].push(line);
    });

    Object.keys(itemsByCombo).forEach(comboId => {
      const items = itemsByCombo[comboId];
      const lines = comboSetLineMap[comboId] || [];
      if (lines.length === 0) return;

      const countingItems = items.filter(item => item.exercise.counts_towards_totals);
      if (countingItems.length === 0) return;

      const sortedItems = items.sort((a, b) => a.position - b.position);

      lines.forEach(line => {
        const repsParts = line.reps_tuple_text.split('+').map(p => parseInt(p.trim(), 10) || 0);
        totalSets += line.sets;

        sortedItems.forEach((item, itemIndex) => {
          if (!item.exercise.counts_towards_totals) return;
          const myReps = repsParts[itemIndex] ?? repsParts[0] ?? 0;
          totalReps += line.sets * myReps;
          if (line.unit === 'absolute_kg' && line.load_value > 0) {
            totalTonnage += line.load_value * line.sets * myReps;
          }
        });
      });
    });

    return { totalSets, totalReps, totalTonnage: Math.round(totalTonnage) };
  };

  const calculateCategorySummaries = () => {
    const categoryTotals: Record<string, { sets: number; reps: number; totalLoad: number; avgLoad: number; loadCount: number; frequency: number }> = {};

    const ensureCategory = (cat: string) => {
      if (!categoryTotals[cat]) {
        categoryTotals[cat] = { sets: 0, reps: 0, totalLoad: 0, avgLoad: 0, loadCount: 0, frequency: 0 };
      }
    };

    Object.values(plannedExercises).forEach((dayExercises) => {
      dayExercises.forEach((ex) => {
        if (!comboExerciseIds.has(ex.id) && ex.exercise.counts_towards_totals && ex.exercise.category) {
          ensureCategory(ex.exercise.category);
          categoryTotals[ex.exercise.category].sets += ex.summary_total_sets || 0;
          categoryTotals[ex.exercise.category].reps += ex.summary_total_reps || 0;
          categoryTotals[ex.exercise.category].frequency += 1;

          if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
            const tonnage = ex.summary_avg_load * (ex.summary_total_reps || 0);
            categoryTotals[ex.exercise.category].totalLoad += tonnage;
            categoryTotals[ex.exercise.category].avgLoad += ex.summary_avg_load;
            categoryTotals[ex.exercise.category].loadCount += 1;
          }
        }
      });
    });

    const comboSetLineMap: Record<string, (typeof weekComboSetLines[number])[]> = {};
    weekComboSetLines.forEach(line => {
      if (!comboSetLineMap[line.planned_combo_id]) comboSetLineMap[line.planned_combo_id] = [];
      comboSetLineMap[line.planned_combo_id].push(line);
    });

    const itemsByCombo: Record<string, typeof weekComboItems> = {};
    weekComboItems.forEach(item => {
      if (!itemsByCombo[item.combo_id]) itemsByCombo[item.combo_id] = [];
      itemsByCombo[item.combo_id].push(item);
    });

    const seenCombosByCategory: Record<string, Set<string>> = {};

    Object.keys(itemsByCombo).forEach(comboId => {
      const items = itemsByCombo[comboId].sort((a, b) => a.position - b.position);
      const lines = comboSetLineMap[comboId] || [];
      if (lines.length === 0) return;

      const unit = lines[0].unit;

      lines.forEach(line => {
        const repsParts = line.reps_tuple_text.split('+').map(p => parseInt(p.trim(), 10) || 0);

        const categoriesSeenThisLine = new Set<string>();

        items.forEach((item, itemIndex) => {
          const ex = item.exercise;
          if (!ex.counts_towards_totals || !ex.category) return;
          ensureCategory(ex.category);

          if (!seenCombosByCategory[ex.category]) seenCombosByCategory[ex.category] = new Set();
          if (!seenCombosByCategory[ex.category].has(comboId)) {
            seenCombosByCategory[ex.category].add(comboId);
            categoryTotals[ex.category].frequency += 1;
          }

          const myReps = repsParts[itemIndex] ?? repsParts[0] ?? 0;
          const totalRepsForThis = line.sets * myReps;

          if (!categoriesSeenThisLine.has(ex.category)) {
            categoriesSeenThisLine.add(ex.category);
            categoryTotals[ex.category].sets += line.sets;
          }

          categoryTotals[ex.category].reps += totalRepsForThis;

          if (unit === 'absolute_kg' && line.load_value > 0) {
            categoryTotals[ex.category].totalLoad += line.load_value * totalRepsForThis;
            categoryTotals[ex.category].avgLoad += line.load_value;
            categoryTotals[ex.category].loadCount += 1;
          }
        });
      });
    });

    Object.keys(categoryTotals).forEach(category => {
      if (categoryTotals[category].loadCount > 0) {
        categoryTotals[category].avgLoad = categoryTotals[category].avgLoad / categoryTotals[category].loadCount;
      }
    });

    return categoryTotals;
  };

  const weeklySummary = calculateWeeklySummary();
  const categorySummaries = calculateCategorySummaries();

  const handlePlanSelection = (selection: PlanSelection) => {
    setPlanSelection(selection);
    if (selection.type === 'individual' && selection.athlete) {
      setSelectedAthlete(selection.athlete);
    } else {
      setSelectedAthlete(null);
    }
  };

  const handleCopyWeek = () => {
    if (!currentWeekPlan) {
      alert('No week data to copy');
      return;
    }
    setCopiedWeekStart(selectedDate);
    setCopiedSourceWeekPlanId(currentWeekPlan.id);
    const label = planSelection.athlete
      ? planSelection.athlete.name
      : planSelection.group
      ? `${planSelection.group.name} (Group)`
      : 'Unassigned';
    setCopiedSourceLabel(label);
  };

  const handlePasteWeek = () => {
    if (!copiedWeekStart) {
      alert('No week copied to clipboard');
      return;
    }
    setShowPasteModal(true);
  };

  const getPlanTitle = () => {
    if (planSelection.type === 'group' && planSelection.group) {
      return (
        <div className="flex items-center gap-2">
          <Users className="text-blue-600" size={28} />
          <span className="text-3xl font-bold text-gray-900">{planSelection.group.name}</span>
          <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-lg">
            Group Plan
          </span>
        </div>
      );
    }
    if (planSelection.type === 'individual' && planSelection.athlete) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold text-gray-900">{planSelection.athlete.name}</span>
          <span className="px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg">
            Individual Plan
          </span>
        </div>
      );
    }
    return <h1 className="text-3xl font-bold text-gray-900">Weekly Planner</h1>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          {getPlanTitle()}
          <PlanSelector
            athletes={athletes}
            groups={groups}
            selection={planSelection}
            onSelect={handlePlanSelection}
          />
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {!planSelection.athlete && !planSelection.group ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <User className="mx-auto text-gray-400 mb-4" size={48} />
            <h2 className="text-xl font-semibold text-gray-700 mb-2">Select a Plan</h2>
            <p className="text-gray-500">
              Choose an individual plan or a group plan from the dropdown above to view and edit the weekly plan.
            </p>
          </div>
        ) : (
          <>
            {showSettings && (
          <DayConfigModal
            dayDisplayOrder={dayDisplayOrder}
            editingDayLabels={editingDayLabels}
            activeDays={activeDays}
            draggedDayIndex={draggedDayIndex}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onToggleDay={toggleDay}
            onLabelChange={(dayIndex, value) => setEditingDayLabels({ ...editingDayLabels, [dayIndex]: value })}
            onRemoveDay={removeDay}
            onAddDay={addNewDay}
            onCancel={handleCancelSettings}
            onSave={saveDayLabels}
          />
        )}

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <WeeklyPlannerHeader
            selectedDate={selectedDate}
            dateRangeLabel={formatDateRange()}
            hasAthlete={!!planSelection.athlete}
            hasWeekPlan={!!currentWeekPlan}
            isCurrentWeekCopied={copiedWeekStart === selectedDate}
            hasCopiedWeek={!!copiedWeekStart}
            showLoadDistribution={showLoadDistribution}
            onDateChange={(rawDate) => setSelectedDate(getMondayOfWeek(new Date(rawDate)))}
            onToggleLoadDistribution={() => setShowLoadDistribution(!showLoadDistribution)}
            onCopyWeek={handleCopyWeek}
            onPasteWeek={handlePasteWeek}
            onPrint={() => setShowPrintModal(true)}
            onOpenSettings={() => setShowSettings(!showSettings)}
            onPreviousWeek={goToPreviousWeek}
            onNextWeek={goToNextWeek}
          />

          {currentWeekPlan && (
            <WeeklySummaryPanel
              weeklySummary={weeklySummary}
              macroWeekTarget={macroWeekTarget}
              showCategorySummaries={showCategorySummaries}
              categorySummaries={categorySummaries}
              onShowCategorySummariesChange={setShowCategorySummaries}
            />
          )}
        </div>

        {currentWeekPlan && showLoadDistribution && planSelection.type === 'individual' && planSelection.athlete && (
          <div className="mb-6 bg-white rounded-lg shadow-md overflow-hidden">
            <LoadDistributionPanel
              plannedExercises={plannedExercises}
              athletePRs={athletePRs}
              dayLabels={currentWeekPlan.day_labels || {}}
              activeDays={activeDays}
              dayDisplayOrder={dayDisplayOrder}
            />
          </div>
        )}

        {currentWeekPlan && planSelection.type === 'individual' && planSelection.athlete && (
          <div className="mb-6">
            <MacroValidation
              athlete={planSelection.athlete}
              weekPlan={currentWeekPlan}
              plannedExercises={plannedExercises}
            />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading week plan...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {currentWeekPlan && visibleDays.map((day) => (
              <DayColumn
                key={day.index}
                dayIndex={day.index}
                dayName={day.name}
                weekPlanId={currentWeekPlan.id}
                exercises={plannedExercises[day.index] || []}
                allExercises={allExercises}
                onRefresh={handleRefresh}
                onDeleteExercise={handleDeleteExercise}
                onReorderItems={handleReorderItems}
                onMoveExercise={handleMoveExercise}
                comboRefreshKey={comboRefreshKey}
              />
            ))}
          </div>
        )}

        {macroWeekTypeText && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
            <h3 className="text-xs font-semibold text-blue-900 uppercase tracking-wide mb-1">
              Macro Cycle Week Type
            </h3>
            <p className="text-sm text-blue-800">{macroWeekTypeText}</p>
          </div>
        )}

        {currentWeekPlan && (
          <div className="bg-white rounded-lg shadow-md p-6 mt-6">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Week Notes & Description
            </h3>
            <textarea
              value={weekDescription}
              onChange={(e) => setWeekDescription(e.target.value)}
              onBlur={saveWeekDescription}
              placeholder="Add notes, focus areas, or description for this training week..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px] resize-y"
            />
            <p className="text-xs text-gray-500 mt-2">
              These notes will appear in the print view between summaries and daily programming
            </p>
          </div>
        )}
          </>
        )}

        {showPasteModal && copiedWeekStart && copiedSourceWeekPlanId && (
          <CopyWeekModal
            onClose={() => setShowPasteModal(false)}
            onPasteComplete={() => {
              setShowPasteModal(false);
              loadWeekPlan();
            }}
            destinationWeekStart={selectedDate}
            sourceWeekStart={copiedWeekStart}
            sourceWeekPlanId={copiedSourceWeekPlanId}
            sourceLabel={copiedSourceLabel}
            destinationAthlete={planSelection.athlete}
            destinationGroup={planSelection.group}
            allAthletes={athletes}
            allGroups={groups}
          />
        )}

        {showPrintModal && planSelection.athlete && (
          <PrintWeek
            athlete={planSelection.athlete}
            weekStart={selectedDate}
            onClose={() => setShowPrintModal(false)}
            showCategorySummaries={showCategorySummaries}
            dayLabels={currentWeekPlan?.day_labels}
            weekDescription={currentWeekPlan?.week_description}
          />
        )}
      </div>
    </div>
  );
}
