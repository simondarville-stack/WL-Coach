import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { WeekPlan, PlannedExercise, Exercise, Athlete, TrainingGroup, PlannedComboSetLine, AthletePR } from '../lib/database.types';
import { DAYS_OF_WEEK } from '../lib/constants';
import { DayColumn } from './DayColumn';
import { PrintWeek } from './PrintWeek';
import { MacroValidation } from './MacroValidation';
import { PlanSelector, type PlanSelection } from './PlanSelector';
import { LoadDistributionPanel } from './LoadDistributionPanel';
import { CopyWeekModal } from './CopyWeekModal';
import { ChevronLeft, ChevronRight, Settings, X, User, Printer, Users, BarChart3, Copy, Clipboard } from 'lucide-react';
import { getMondayOfWeek as getMondayOfWeekUtil, formatDateRange as formatDateRangeUtil } from '../lib/dateUtils';

function calculateAge(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const today = new Date();
  const birth = new Date(birthdate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function getMondayOfWeek(date: Date): string {
  return getMondayOfWeekUtil(date).toISOString().split('T')[0];
}

interface WeeklyPlannerProps {
  selectedAthlete: Athlete | null;
  onAthleteChange: (athlete: Athlete | null) => void;
}

export function WeeklyPlanner({ selectedAthlete, onAthleteChange }: WeeklyPlannerProps) {
  const [selectedDate, setSelectedDate] = useState(() => {
    return getMondayOfWeek(new Date());
  });
  const [planSelection, setPlanSelection] = useState<PlanSelection>({
    type: 'individual',
    athlete: selectedAthlete,
    group: null,
  });
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const [currentWeekPlan, setCurrentWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<Record<number, (PlannedExercise & { exercise: Exercise })[]>>({});
  const [weekComboSetLines, setWeekComboSetLines] = useState<(PlannedComboSetLine & { unit: string; day_index: number })[]>([]);
  const [weekComboItems, setWeekComboItems] = useState<{ combo_id: string; exercise: Exercise; position: number }[]>([]);
  const [comboExerciseIds, setComboExerciseIds] = useState<Set<string>>(new Set());
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showCopyWeekModal, setShowCopyWeekModal] = useState(false);
  const [showCategorySummaries, setShowCategorySummaries] = useState(true);
  const [showLoadDistribution, setShowLoadDistribution] = useState(false);
  const [athletePRs, setAthletePRs] = useState<AthletePR[]>([]);
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [editingDayLabels, setEditingDayLabels] = useState<Record<number, string>>({});
  const [weekDescription, setWeekDescription] = useState<string>('');
  const [dayDisplayOrder, setDayDisplayOrder] = useState<number[]>([]);
  const [draggedDayIndex, setDraggedDayIndex] = useState<number | null>(null);
  const [macroWeekTarget, setMacroWeekTarget] = useState<number | null>(null);
  const [macroWeekTypeText, setMacroWeekTypeText] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [comboRefreshKey, setComboRefreshKey] = useState(0);
  const [copiedWeekStart, setCopiedWeekStart] = useState<string | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);

  useEffect(() => {
    loadExercises();
    loadGroups();
    loadAthletes();
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

  const loadExercises = async () => {
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .order('name');

      if (error) throw error;
      setAllExercises(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exercises');
    }
  };

  const loadGroups = async () => {
    try {
      const { data, error } = await supabase
        .from('training_groups')
        .select('*')
        .order('name');

      if (error) throw error;
      setGroups(data || []);
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
  };

  const loadAthletes = async () => {
    try {
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .order('name');

      if (error) throw error;
      setAthletes(data || []);
    } catch (err) {
      console.error('Failed to load athletes:', err);
    }
  };

  const loadAthletePRs = async (athleteId: string) => {
    try {
      const { data, error } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('athlete_id', athleteId);

      if (error) throw error;
      setAthletePRs(data || []);
    } catch (err) {
      console.error('Failed to load athlete PRs:', err);
      setAthletePRs([]);
    }
  };

  const loadWeekPlan = async () => {
    const { type, athlete, group } = planSelection;
    if (!athlete && !group) return;

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('week_plans')
        .select('*')
        .eq('week_start', selectedDate);

      if (type === 'individual' && athlete) {
        query = query.eq('athlete_id', athlete.id).is('group_id', null);
      } else if (type === 'group' && group) {
        query = query.eq('group_id', group.id).is('athlete_id', null);
      }

      const { data: existingPlan, error: searchError } = await query.maybeSingle();

      if (searchError) throw searchError;

      let weekPlan = existingPlan;
      if (!weekPlan) {
        const insertData: any = {
          week_start: selectedDate,
          is_group_plan: type === 'group',
        };

        if (type === 'individual' && athlete) {
          insertData.athlete_id = athlete.id;
          insertData.group_id = null;
        } else if (type === 'group' && group) {
          insertData.group_id = group.id;
          insertData.athlete_id = null;
        }

        const { data: newPlan, error: createError } = await supabase
          .from('week_plans')
          .insert([insertData])
          .select()
          .single();

        if (createError) {
          if (createError.code === '23505') {
            const { data: retryPlan, error: retryError } = await query.maybeSingle();
            if (retryError) throw retryError;
            if (retryPlan) {
              weekPlan = retryPlan;
            } else {
              throw createError;
            }
          } else {
            throw createError;
          }
        } else {
          weekPlan = newPlan;
        }
      }

      setCurrentWeekPlan(weekPlan);
      await Promise.all([
        loadPlannedExercises(weekPlan.id),
        loadWeekCombos(weekPlan.id),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load week plan');
    } finally {
      setLoading(false);
    }
  };

  const loadMacroWeekTarget = async () => {
    if (!planSelection.athlete) return;

    try {
      const { data: macrocycles, error: macroError } = await supabase
        .from('macrocycles')
        .select('id, start_date, end_date')
        .eq('athlete_id', planSelection.athlete.id)
        .lte('start_date', selectedDate)
        .gte('end_date', selectedDate);

      if (macroError) throw macroError;

      console.log('Macrocycles found:', macrocycles);
      console.log('Selected date:', selectedDate);

      if (!macrocycles || macrocycles.length === 0) {
        console.log('No macrocycles found for this date range');
        setMacroWeekTarget(null);
        return;
      }

      const { data: macroWeeks, error: weekError } = await supabase
        .from('macro_weeks')
        .select('id, total_reps_target, week_type_text')
        .eq('macrocycle_id', macrocycles[0].id)
        .lte('week_start', selectedDate)
        .gte('week_start', new Date(new Date(selectedDate).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('week_start', { ascending: false })
        .limit(1);

      const macroWeek = macroWeeks && macroWeeks.length > 0 ? macroWeeks[0] : null;

      if (weekError) throw weekError;

      console.log('Macro week found:', macroWeek);
      console.log('Total reps target:', macroWeek?.total_reps_target);

      setMacroWeekTarget(macroWeek?.total_reps_target || null);
      setMacroWeekTypeText(macroWeek?.week_type_text || null);
    } catch (err) {
      console.error('Failed to load macro week target:', err);
      setMacroWeekTarget(null);
      setMacroWeekTypeText(null);
    }
  };

  const loadWeekCombos = async (weekPlanId: string) => {
    try {
      const { data: combos } = await supabase
        .from('planned_combos')
        .select('id, unit, day_index')
        .eq('weekplan_id', weekPlanId);

      if (!combos || combos.length === 0) {
        setWeekComboSetLines([]);
        setWeekComboItems([]);
        setComboExerciseIds(new Set());
        return;
      }

      const comboIds = combos.map(c => c.id);
      const comboUnitMap: Record<string, { unit: string; day_index: number }> = {};
      combos.forEach(c => { comboUnitMap[c.id] = { unit: c.unit, day_index: c.day_index }; });

      const { data: setLines } = await supabase
        .from('planned_combo_set_lines')
        .select('*')
        .in('planned_combo_id', comboIds);

      const enriched = (setLines || []).map(line => ({
        ...line,
        unit: comboUnitMap[line.planned_combo_id]?.unit || 'absolute_kg',
        day_index: comboUnitMap[line.planned_combo_id]?.day_index || 0,
      }));

      setWeekComboSetLines(enriched);

      const { data: items } = await supabase
        .from('planned_combo_items')
        .select('planned_exercise_id, planned_combo_id, position, exercise:exercise_id(*)')
        .in('planned_combo_id', comboIds)
        .order('position');

      const ids = new Set<string>((items || []).map((i: any) => i.planned_exercise_id));
      setComboExerciseIds(ids);

      const comboItemsForCategories = (items || []).map((i: any) => ({
        combo_id: i.planned_combo_id,
        exercise: i.exercise as Exercise,
        position: i.position as number,
      }));
      setWeekComboItems(comboItemsForCategories);
    } catch (err) {
      console.error('Failed to load week combos:', err);
    }
  };

  const loadPlannedExercises = async (weekPlanId: string) => {
    try {
      const { data, error } = await supabase
        .from('planned_exercises')
        .select(`
          *,
          exercise:exercise_id(*)
        `)
        .eq('weekplan_id', weekPlanId)
        .order('day_index')
        .order('position');

      if (error) throw error;

      const grouped: Record<number, (PlannedExercise & { exercise: Exercise })[]> = {};

      if (currentWeekPlan?.day_labels) {
        Object.keys(currentWeekPlan.day_labels).forEach((key) => {
          grouped[parseInt(key)] = [];
        });
      } else {
        DAYS_OF_WEEK.forEach((day) => {
          grouped[day.index] = [];
        });
      }

      (data || []).forEach((item) => {
        if (!grouped[item.day_index]) {
          grouped[item.day_index] = [];
        }
        grouped[item.day_index].push(item);
      });

      setPlannedExercises(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load planned exercises');
    }
  };

  const handleRefresh = async () => {
    if (currentWeekPlan) {
      await Promise.all([
        loadPlannedExercises(currentWeekPlan.id),
        loadWeekCombos(currentWeekPlan.id),
      ]);
      setComboRefreshKey(k => k + 1);
    }
  };

  const handleDeleteExercise = async (plannedExerciseId: string, dayIndex: number) => {
    if (!currentWeekPlan) return;

    try {
      const { error } = await supabase
        .from('planned_exercises')
        .delete()
        .eq('id', plannedExerciseId);

      if (error) throw error;

      await normalizePositions(currentWeekPlan.id, dayIndex);
      await Promise.all([
        loadPlannedExercises(currentWeekPlan.id),
        loadWeekCombos(currentWeekPlan.id),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete exercise');
    }
  };

  const handleReorderItems = async (dayIndex: number, orderedIds: string[]) => {
    if (!currentWeekPlan) return;

    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await supabase
          .from('planned_exercises')
          .update({ position: i + 1 })
          .eq('id', orderedIds[i]);
      }

      await loadPlannedExercises(currentWeekPlan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder exercises');
    }
  };

  const handleMoveExercise = async (
    exerciseId: string,
    fromDayIndex: number,
    toDayIndex: number
  ) => {
    if (!currentWeekPlan) return;

    try {
      const { data: toCombos } = await supabase
        .from('planned_combos')
        .select('id')
        .eq('weekplan_id', currentWeekPlan.id)
        .eq('day_index', toDayIndex);

      const { data: toExercises } = await supabase
        .from('planned_exercises')
        .select('id')
        .eq('weekplan_id', currentWeekPlan.id)
        .eq('day_index', toDayIndex);

      const { data: toComboItems } = (toCombos && toCombos.length > 0)
        ? await supabase.from('planned_combo_items').select('planned_exercise_id').in('planned_combo_id', toCombos.map(c => c.id))
        : { data: [] };

      const toComboExIds = new Set((toComboItems || []).map(i => i.planned_exercise_id));
      const toVisibleCount = (toExercises || []).filter(ex => !toComboExIds.has(ex.id)).length;
      const newToPosition = toVisibleCount + (toCombos?.length || 0) + 1;

      await supabase
        .from('planned_exercises')
        .update({
          day_index: toDayIndex,
          position: newToPosition,
        })
        .eq('id', exerciseId);

      await Promise.all([
        normalizePositions(currentWeekPlan.id, fromDayIndex),
        normalizePositions(currentWeekPlan.id, toDayIndex),
      ]);
      await Promise.all([
        loadPlannedExercises(currentWeekPlan.id),
        loadWeekCombos(currentWeekPlan.id),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move exercise');
    }
  };

  const normalizePositions = async (weekPlanId: string, dayIndex: number) => {
    try {
      const [{ data: exData }, { data: comboData }] = await Promise.all([
        supabase
          .from('planned_exercises')
          .select('id, position')
          .eq('weekplan_id', weekPlanId)
          .eq('day_index', dayIndex)
          .order('position'),
        supabase
          .from('planned_combos')
          .select('id, position')
          .eq('weekplan_id', weekPlanId)
          .eq('day_index', dayIndex)
          .order('position'),
      ]);

      const comboIds = (comboData || []).map(c => c.id);
      const { data: comboItemData } = comboIds.length > 0
        ? await supabase.from('planned_combo_items').select('planned_exercise_id').in('planned_combo_id', comboIds)
        : { data: [] };

      const comboExerciseIdSet = new Set((comboItemData || []).map(i => i.planned_exercise_id));

      const visibleExercises = (exData || []).filter(ex => !comboExerciseIdSet.has(ex.id));

      const allItems: Array<{ table: 'planned_exercises' | 'planned_combos'; id: string; position: number }> = [
        ...visibleExercises.map(ex => ({ table: 'planned_exercises' as const, id: ex.id, position: ex.position })),
        ...(comboData || []).map(c => ({ table: 'planned_combos' as const, id: c.id, position: c.position })),
      ].sort((a, b) => a.position - b.position);

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        await supabase
          .from(item.table)
          .update({ position: i + 1 })
          .eq('id', item.id);
      }
    } catch (err) {
      console.error('Failed to normalize positions:', err);
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
      const { error } = await supabase
        .from('week_plans')
        .update({
          day_labels: editingDayLabels,
          active_days: activeDays,
          day_display_order: dayDisplayOrder
        })
        .eq('id', currentWeekPlan.id);

      if (error) throw error;

      setCurrentWeekPlan({
        ...currentWeekPlan,
        day_labels: editingDayLabels,
        active_days: activeDays,
        day_display_order: dayDisplayOrder
      } as any);
      setShowSettings(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save day labels');
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
      const { error } = await supabase
        .from('week_plans')
        .update({ week_description: weekDescription.trim() || null })
        .eq('id', currentWeekPlan.id);

      if (error) throw error;

      setCurrentWeekPlan({ ...currentWeekPlan, week_description: weekDescription.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save week description');
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
      onAthleteChange(selection.athlete);
    } else {
      onAthleteChange(null);
    }
  };

  const handleCopyWeek = () => {
    if (!currentWeekPlan) {
      alert('No week data to copy');
      return;
    }
    setCopiedWeekStart(selectedDate);
  };

  const handlePasteWeek = () => {
    if (!copiedWeekStart) {
      alert('No week copied to clipboard');
      return;
    }
    if (copiedWeekStart === selectedDate) {
      alert('Source and destination weeks are the same');
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
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Training Days</h2>
                <button
                  onClick={handleCancelSettings}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-gray-600">
                    Drag to reorder, customize names, and toggle days on/off
                  </p>
                  <button
                    onClick={addNewDay}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
                  >
                    + Add Day
                  </button>
                </div>
                <div className="space-y-2">
                  {dayDisplayOrder
                    .filter((dayIndex) => editingDayLabels[dayIndex] !== undefined)
                    .map((dayIndex) => (
                      <div
                        key={dayIndex}
                        draggable
                        onDragStart={() => handleDragStart(dayIndex)}
                        onDragOver={(e) => handleDragOver(e, dayIndex)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-2 p-3 border border-gray-200 rounded-lg transition-all cursor-move ${
                          draggedDayIndex === dayIndex
                            ? 'opacity-50 scale-95'
                            : 'hover:bg-gray-50 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex flex-col text-gray-400">
                          <div className="h-1 w-1 bg-gray-400 rounded-full mb-0.5"></div>
                          <div className="h-1 w-1 bg-gray-400 rounded-full mb-0.5"></div>
                          <div className="h-1 w-1 bg-gray-400 rounded-full"></div>
                        </div>
                        <input
                          type="checkbox"
                          checked={activeDays.includes(dayIndex)}
                          onChange={() => toggleDay(dayIndex)}
                          className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={editingDayLabels[dayIndex] || ''}
                          onChange={(e) => setEditingDayLabels({ ...editingDayLabels, [dayIndex]: e.target.value })}
                          placeholder={`Day ${dayIndex}`}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => removeDay(dayIndex)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Remove this day"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Examples: "Monday", "Session 1", "Upper Body", "AM Workout", etc.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancelSettings}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveDayLabels}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <label htmlFor="weekDate" className="text-sm font-medium text-gray-700">
                Week of:
              </label>
              <input
                type="date"
                id="weekDate"
                value={selectedDate}
                onChange={(e) => setSelectedDate(getMondayOfWeek(new Date(e.target.value)))}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-600">{formatDateRange()}</span>
            </div>

            <div className="flex gap-2">
              {planSelection.athlete && (
                <button
                  onClick={() => setShowLoadDistribution(!showLoadDistribution)}
                  className={`px-4 py-2 border rounded-md transition-colors flex items-center gap-2 ${
                    showLoadDistribution
                      ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                  title="Toggle Load Distribution"
                >
                  <BarChart3 size={18} />
                  {showLoadDistribution ? 'Hide' : 'Show'} Load Distribution
                </button>
              )}
              <button
                onClick={handleCopyWeek}
                disabled={!currentWeekPlan}
                className={`px-4 py-2 border rounded-md transition-colors flex items-center gap-2 ${
                  copiedWeekStart === selectedDate
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 hover:bg-gray-50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Copy current week to clipboard"
              >
                <Copy size={18} />
                Copy
              </button>
              <button
                onClick={handlePasteWeek}
                disabled={!copiedWeekStart || copiedWeekStart === selectedDate}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={copiedWeekStart ? 'Paste copied week here' : 'No week copied'}
              >
                <Clipboard size={18} />
                Paste
              </button>
              <button
                onClick={() => setShowPrintModal(true)}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2"
                title="Print Week"
              >
                <Printer size={18} />
                Print
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                title="Settings"
              >
                <Settings size={20} />
              </button>
              <button
                onClick={goToPreviousWeek}
                className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={goToNextWeek}
                className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>

          {currentWeekPlan && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Weekly Summary
                </h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCategorySummaries}
                    onChange={(e) => setShowCategorySummaries(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-xs font-medium text-gray-600">Show by category</span>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">
                    Total Sets
                  </div>
                  <div className="text-2xl font-bold text-blue-900">
                    {weeklySummary.totalSets}
                  </div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">
                    Total Reps
                  </div>
                  <div className="text-2xl font-bold text-green-900">
                    {weeklySummary.totalReps}
                    {macroWeekTarget && (
                      <span className="text-base font-normal text-green-700 ml-2">
                        / {macroWeekTarget}
                      </span>
                    )}
                  </div>
                  {macroWeekTarget && (
                    <div className="text-xs text-green-700 mt-1">
                      {Math.round((weeklySummary.totalReps / macroWeekTarget) * 100)}% of target
                    </div>
                  )}
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <div className="text-xs font-medium text-orange-600 uppercase tracking-wide mb-1">
                    Total Tonnage
                  </div>
                  <div className="text-2xl font-bold text-orange-900">
                    {weeklySummary.totalTonnage} kg
                  </div>
                </div>
              </div>

              {showCategorySummaries && Object.keys(categorySummaries).length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                    By Category
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                    {Object.entries(categorySummaries)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([category, totals]) => (
                        <div key={category} className="bg-gray-50 rounded p-2 border border-gray-200">
                          <div className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                            {category}
                            <span className="text-gray-500 font-normal">×{totals.frequency}</span>
                          </div>
                          <div className="text-xs text-gray-900 space-y-0.5">
                            <div><span className="font-bold">{totals.sets}</span> sets</div>
                            <div><span className="font-bold">{totals.reps}</span> reps</div>
                            {totals.totalLoad > 0 && (
                              <>
                                <div><span className="font-bold">{Math.round(totals.totalLoad)}</span> kg</div>
                                <div className="text-gray-600">avg {Math.round(totals.avgLoad)}kg</div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
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

        {showPasteModal && copiedWeekStart && (
          <CopyWeekModal
            onClose={() => setShowPasteModal(false)}
            onPasteComplete={() => {
              setShowPasteModal(false);
              loadWeekPlan();
            }}
            destinationWeekStart={selectedDate}
            sourceWeekStart={copiedWeekStart}
            athlete={planSelection.athlete}
            group={planSelection.group}
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
