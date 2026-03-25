import { useState, useRef, useEffect } from 'react';
import type { PlannedExercise, Exercise, PlannedComboWithDetails, DefaultUnit } from '../lib/database.types';
import { GripVertical, X, Layers } from 'lucide-react';
import { getUnitSymbol } from '../lib/constants';
import { supabase } from '../lib/supabase';
import { PrescriptionModal } from './PrescriptionModal';
import { ComboCard } from './ComboCard';
import { ComboEditorModal } from './ComboEditorModal';
import { ComboCreatorModal } from './ComboCreatorModal';

interface DayColumnProps {
  dayIndex: number;
  dayName: string;
  weekPlanId: string;
  exercises: (PlannedExercise & { exercise: Exercise })[];
  allExercises: Exercise[];
  onRefresh: () => Promise<void>;
  onDeleteExercise: (plannedExerciseId: string, dayIndex: number) => Promise<void>;
  onReorderItems: (dayIndex: number, orderedIds: string[]) => Promise<void>;
  onMoveExercise: (exerciseId: string, fromDayIndex: number, toDayIndex: number) => Promise<void>;
  comboRefreshKey?: number;
}

export function DayColumn({
  dayIndex,
  dayName,
  weekPlanId,
  exercises,
  allExercises,
  onRefresh,
  onDeleteExercise,
  onReorderItems,
  onMoveExercise,
  comboRefreshKey,
}: DayColumnProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [editingExercise, setEditingExercise] = useState<(PlannedExercise & { exercise: Exercise }) | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [draggedItemType, setDraggedItemType] = useState<'exercise' | 'combo' | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOverEmpty, setIsDragOverEmpty] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);

  const [combos, setCombos] = useState<PlannedComboWithDetails[]>([]);
  const [editingCombo, setEditingCombo] = useState<PlannedComboWithDetails | null>(null);
  const [comboExerciseIds, setComboExerciseIds] = useState<Set<string>>(new Set());
  const [showComboCreator, setShowComboCreator] = useState(false);

  useEffect(() => {
    if (weekPlanId) {
      loadCombos();
    }
  }, [weekPlanId, dayIndex, comboRefreshKey]);

  async function loadCombos() {
    const { data: combosData, error } = await supabase
      .from('planned_combos')
      .select('*')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', dayIndex)
      .order('position');

    if (error) {
      console.error('Error loading combos:', error);
      return;
    }

    const combosWithDetails: PlannedComboWithDetails[] = [];
    const linkedExerciseIds = new Set<string>();

    for (const combo of combosData || []) {
      let template = null;
      if (combo.template_id) {
        const { data: tpl } = await supabase
          .from('exercise_combo_templates')
          .select('*')
          .eq('id', combo.template_id)
          .maybeSingle();
        template = tpl;
      }

      const { data: items, error: itemsError } = await supabase
        .from('planned_combo_items')
        .select('*, exercise:exercise_id(*)')
        .eq('planned_combo_id', combo.id)
        .order('position');

      if (itemsError) {
        console.error('Error loading combo items:', itemsError);
        continue;
      }

      const { data: setLines, error: setLinesError } = await supabase
        .from('planned_combo_set_lines')
        .select('*')
        .eq('planned_combo_id', combo.id)
        .order('position');

      if (setLinesError) {
        console.error('Error loading combo set lines:', setLinesError);
        continue;
      }

      if (items && items.length > 0) {
        combosWithDetails.push({
          ...combo,
          template,
          items: items.map(item => ({ ...item, exercise: item.exercise })),
          set_lines: setLines || []
        });

        items.forEach(item => linkedExerciseIds.add(item.planned_exercise_id));
      }
    }

    setCombos(combosWithDetails);
    setComboExerciseIds(linkedExerciseIds);
  }

  const searchResults = searchQuery && searchQuery.toLowerCase() !== '/combo' && searchQuery.toLowerCase() !== '/text'
    ? allExercises.filter(ex =>
        ex.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ex.exercise_code && ex.exercise_code.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  async function handleCreateCombo(data: {
    exercises: { exercise: Exercise; position: number }[];
    unit: DefaultUnit;
    comboName: string;
    color: string;
  }) {
    setIsLoading(true);
    try {
      const visibleExerciseCount = exercises.filter(ex => !comboExerciseIds.has(ex.id)).length;
      const newPosition = visibleExerciseCount + combos.length + 1;
      const defaultRepsTuple = data.exercises.map(() => '1').join('+');

      const { data: newCombo, error: comboError } = await supabase
        .from('planned_combos')
        .insert({
          weekplan_id: weekPlanId,
          day_index: dayIndex,
          position: newPosition,
          template_id: null,
          combo_name: data.comboName || null,
          unit: data.unit,
          shared_load_value: 0,
          sets: 1,
          reps_tuple_text: defaultRepsTuple,
          color: data.color
        })
        .select()
        .single();

      if (comboError) throw comboError;

      for (let i = 0; i < data.exercises.length; i++) {
        const part = data.exercises[i];

        const { data: plannedEx, error: exError } = await supabase
          .from('planned_exercises')
          .insert({
            weekplan_id: weekPlanId,
            day_index: dayIndex,
            exercise_id: part.exercise.id,
            position: newPosition,
            unit: data.unit,
            summary_total_sets: 0,
            summary_total_reps: 0
          })
          .select()
          .single();

        if (exError) throw exError;

        const { error: itemError } = await supabase
          .from('planned_combo_items')
          .insert({
            planned_combo_id: newCombo.id,
            exercise_id: part.exercise.id,
            position: i + 1,
            planned_exercise_id: plannedEx.id
          });

        if (itemError) throw itemError;
      }

      const { error: setLineError } = await supabase
        .from('planned_combo_set_lines')
        .insert({
          planned_combo_id: newCombo.id,
          position: 1,
          load_value: 0,
          sets: 1,
          reps_tuple_text: defaultRepsTuple
        });

      if (setLineError) throw setLineError;

      await loadCombos();
      await onRefresh();
    } catch (err) {
      console.error('Failed to create combo:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteCombo(comboId: string) {
    if (!confirm('Delete this combo?')) return;

    setIsLoading(true);
    try {
      const combo = combos.find(c => c.id === comboId);
      if (!combo) return;

      const plannedExIds = combo.items.map(item => item.planned_exercise_id);

      await supabase.from('planned_set_lines').delete().in('planned_exercise_id', plannedExIds);
      await supabase.from('planned_combo_set_lines').delete().eq('planned_combo_id', comboId);
      await supabase.from('planned_combo_items').delete().eq('planned_combo_id', comboId);
      await supabase.from('planned_exercises').delete().in('id', plannedExIds);
      await supabase.from('planned_combos').delete().eq('id', comboId);

      await loadCombos();
      await onRefresh();
    } catch (err) {
      console.error('Failed to delete combo:', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSearchIndex(prev => prev < searchResults.length - 1 ? prev + 1 : prev);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSearchIndex(prev => prev > 0 ? prev - 1 : 0);
    } else if (e.key === 'Enter' && searchResults.length > 0) {
      e.preventDefault();
      handleSelectExercise(searchResults[selectedSearchIndex]);
    }
  };

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [searchQuery]);

  const handleSelectExercise = async (exercise: Exercise) => {
    if (searchQuery.toLowerCase() === '/combo') {
      setShowComboCreator(true);
      setSearchQuery('');
      setShowSearchResults(false);
      return;
    }

    if (searchQuery.toLowerCase() === '/text') {
      await handleAddFreeText();
      return;
    }

    setIsLoading(true);
    try {
      const visibleExerciseCount = exercises.filter(ex => !comboExerciseIds.has(ex.id)).length;
      const newPosition = visibleExerciseCount + combos.length + 1;

      const { error } = await supabase
        .from('planned_exercises')
        .insert([{
          weekplan_id: weekPlanId,
          day_index: dayIndex,
          exercise_id: exercise.id,
          position: newPosition,
          unit: exercise.default_unit,
          summary_total_sets: 0,
          summary_total_reps: 0,
        }]);

      if (error) throw error;

      setSearchQuery('');
      setShowSearchResults(false);
      await onRefresh();

      setTimeout(() => { searchInputRef.current?.focus(); }, 100);
    } catch (err) {
      console.error('Failed to add exercise:', err);
    } finally {
      setIsLoading(false);
    }
  };

  async function handleAddFreeText() {
    setIsLoading(true);
    try {
      const { data: freeTextExercise } = await supabase
        .from('exercises')
        .select('*')
        .eq('exercise_code', 'TEXT')
        .maybeSingle();

      if (!freeTextExercise) {
        console.error('Free Text exercise not found');
        return;
      }

      const visibleExerciseCount = exercises.filter(ex => !comboExerciseIds.has(ex.id)).length;
      const newPosition = visibleExerciseCount + combos.length + 1;

      const { error } = await supabase
        .from('planned_exercises')
        .insert([{
          weekplan_id: weekPlanId,
          day_index: dayIndex,
          exercise_id: freeTextExercise.id,
          position: newPosition,
          unit: freeTextExercise.default_unit,
          summary_total_sets: 0,
          summary_total_reps: 0,
          notes: 'Enter your text here...',
        }]);

      if (error) throw error;

      setSearchQuery('');
      setShowSearchResults(false);
      await onRefresh();

      setTimeout(() => { searchInputRef.current?.focus(); }, 100);
    } catch (err) {
      console.error('Failed to add free text:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const handleDragStart = (e: React.DragEvent, itemId: string, itemType: 'exercise' | 'combo') => {
    setDraggedItemId(itemId);
    setDraggedItemType(itemType);
    e.dataTransfer.effectAllowed = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', `${dayIndex}:${itemType}:${itemId}`);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setDraggedItemType(null);
    setDragOverIndex(null);
    setIsDragOverEmpty(false);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    setDragOverIndex(index);
  };

  const handleDropReorder = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);

    if (!draggedItemId || !draggedItemType) {
      await handleDrop(e);
      return;
    }

    const isCopy = e.ctrlKey || e.metaKey;
    const visibleExercises = exercises.filter(ex => !comboExerciseIds.has(ex.id));
    const allItems: Array<{ type: 'exercise' | 'combo'; id: string; position: number }> = [
      ...visibleExercises.map(ex => ({ type: 'exercise' as const, id: ex.id, position: ex.position })),
      ...combos.map(combo => ({ type: 'combo' as const, id: combo.id, position: combo.position }))
    ].sort((a, b) => a.position - b.position);

    const draggedIndex = allItems.findIndex(item => item.id === draggedItemId && item.type === draggedItemType);
    if (draggedIndex === -1) return;

    if (isCopy) {
      setIsLoading(true);
      try {
        if (draggedItemType === 'exercise') {
          const draggedExercise = exercises.find(ex => ex.id === draggedItemId);
          if (!draggedExercise) return;

          const { data, error } = await supabase
            .from('planned_exercises')
            .insert([{
              weekplan_id: weekPlanId,
              day_index: dayIndex,
              exercise_id: draggedExercise.exercise_id,
              position: dropIndex + 1,
              unit: draggedExercise.unit,
              prescription_raw: draggedExercise.prescription_raw,
              summary_total_sets: draggedExercise.summary_total_sets,
              summary_total_reps: draggedExercise.summary_total_reps,
              summary_highest_load: draggedExercise.summary_highest_load,
              summary_avg_load: draggedExercise.summary_avg_load,
            }])
            .select()
            .single();

          if (error) throw error;

          if (data && draggedExercise.prescription_raw) {
            const { data: setLines } = await supabase
              .from('planned_set_lines')
              .select('*')
              .eq('planned_exercise_id', draggedExercise.id);

            if (setLines && setLines.length > 0) {
              await supabase.from('planned_set_lines').insert(
                setLines.map((line) => ({
                  planned_exercise_id: data.id,
                  sets: line.sets,
                  reps: line.reps,
                  load_value: line.load_value,
                  position: line.position,
                }))
              );
            }
          }
        } else {
          await copyCombo(draggedItemId, dropIndex + 1);
        }

        await onRefresh();
      } finally {
        setIsLoading(false);
      }
    } else {
      if (draggedIndex === dropIndex) return;

      const reorderedItems = [...allItems];
      const [draggedItem] = reorderedItems.splice(draggedIndex, 1);
      reorderedItems.splice(dropIndex, 0, draggedItem);

      setIsLoading(true);
      try {
        for (let i = 0; i < reorderedItems.length; i++) {
          const item = reorderedItems[i];
          if (item.type === 'exercise') {
            await supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', item.id);
          } else {
            await supabase.from('planned_combos').update({ position: i + 1 }).eq('id', item.id);
          }
        }

        await loadCombos();
        await onRefresh();
      } finally {
        setIsLoading(false);
      }
    }

    setDraggedItemId(null);
    setDraggedItemType(null);
  };

  async function copyCombo(sourceComboId: string, targetPosition: number, targetDayIndex?: number, targetWeekPlanId?: string) {
    const srcCombo = combos.find(c => c.id === sourceComboId);
    let sourceCombo = srcCombo;
    let sourceItems = srcCombo?.items;
    let sourceSetLines = srcCombo?.set_lines;

    if (!sourceCombo) {
      const { data: sc } = await supabase.from('planned_combos').select('*').eq('id', sourceComboId).single();
      if (!sc) return;
      sourceCombo = sc as any;
      const { data: si } = await supabase.from('planned_combo_items').select('*, exercise:exercise_id(*)').eq('planned_combo_id', sourceComboId).order('position');
      sourceItems = si?.map(item => ({ ...item, exercise: item.exercise })) || [];
      const { data: ssl } = await supabase.from('planned_combo_set_lines').select('*').eq('planned_combo_id', sourceComboId).order('position');
      sourceSetLines = ssl || [];
    }

    if (!sourceCombo || !sourceItems) return;

    const tgtDay = targetDayIndex ?? dayIndex;
    const tgtWp = targetWeekPlanId ?? weekPlanId;

    const { data: newCombo, error: comboError } = await supabase
      .from('planned_combos')
      .insert({
        weekplan_id: tgtWp,
        day_index: tgtDay,
        position: targetPosition,
        template_id: sourceCombo.template_id || null,
        combo_name: sourceCombo.combo_name || null,
        unit: sourceCombo.unit,
        shared_load_value: sourceCombo.shared_load_value,
        sets: sourceCombo.sets,
        reps_tuple_text: sourceCombo.reps_tuple_text,
        notes: sourceCombo.notes
      })
      .select()
      .single();

    if (comboError) throw comboError;

    for (const item of sourceItems) {
      const { data: srcExData } = await supabase
        .from('planned_exercises')
        .select('*')
        .eq('id', item.planned_exercise_id)
        .maybeSingle();

      const { data: plannedEx, error: exError } = await supabase
        .from('planned_exercises')
        .insert({
          weekplan_id: tgtWp,
          day_index: tgtDay,
          exercise_id: item.exercise_id,
          position: targetPosition,
          unit: sourceCombo.unit,
          summary_total_sets: srcExData?.summary_total_sets ?? 0,
          summary_total_reps: srcExData?.summary_total_reps ?? 0,
          summary_highest_load: srcExData?.summary_highest_load ?? null,
          summary_avg_load: srcExData?.summary_avg_load ?? null,
        })
        .select()
        .single();

      if (exError) throw exError;

      await supabase.from('planned_combo_items').insert({
        planned_combo_id: newCombo.id,
        exercise_id: item.exercise_id,
        position: item.position,
        planned_exercise_id: plannedEx.id
      });

      const { data: srcSetLines } = await supabase
        .from('planned_set_lines')
        .select('*')
        .eq('planned_exercise_id', item.planned_exercise_id)
        .order('position');

      if (srcSetLines && srcSetLines.length > 0) {
        await supabase.from('planned_set_lines').insert(
          srcSetLines.map(line => ({
            planned_exercise_id: plannedEx.id,
            sets: line.sets,
            reps: line.reps,
            load_value: line.load_value,
            position: line.position,
          }))
        );
      }
    }

    if (sourceSetLines) {
      for (const line of sourceSetLines) {
        await supabase.from('planned_combo_set_lines').insert({
          planned_combo_id: newCombo.id,
          position: line.position,
          load_value: line.load_value,
          sets: line.sets,
          reps_tuple_text: line.reps_tuple_text
        });
      }
    }

    await loadCombos();
  }

  async function deleteComboById(comboId: string) {
    const { data: items } = await supabase
      .from('planned_combo_items')
      .select('planned_exercise_id')
      .eq('planned_combo_id', comboId);

    const plannedExIds = (items || []).map(i => i.planned_exercise_id);

    if (plannedExIds.length > 0) {
      await supabase.from('planned_set_lines').delete().in('planned_exercise_id', plannedExIds);
    }
    await supabase.from('planned_combo_set_lines').delete().eq('planned_combo_id', comboId);
    await supabase.from('planned_combo_items').delete().eq('planned_combo_id', comboId);
    if (plannedExIds.length > 0) {
      await supabase.from('planned_exercises').delete().in('id', plannedExIds);
    }
    await supabase.from('planned_combos').delete().eq('id', comboId);
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);

    const dragSource = e.dataTransfer.getData('text/plain');
    if (!dragSource) return;

    const parts = dragSource.split(':');
    if (parts.length < 3) return;

    const [fromDayIndex, itemType, itemId] = parts;
    const fromDay = parseInt(fromDayIndex, 10);

    if (fromDay === dayIndex) return;

    const isCopy = e.ctrlKey || e.metaKey;
    const visibleExercises = exercises.filter(ex => !comboExerciseIds.has(ex.id));
    const newPosition = visibleExercises.length + combos.length + 1;

    setIsLoading(true);
    try {
      if (itemType === 'exercise') {
        if (isCopy) {
          const { data: sourceExercise } = await supabase
            .from('planned_exercises')
            .select('*')
            .eq('id', itemId)
            .single();

          if (sourceExercise) {
            const { data, error } = await supabase
              .from('planned_exercises')
              .insert([{
                weekplan_id: weekPlanId,
                day_index: dayIndex,
                exercise_id: sourceExercise.exercise_id,
                position: newPosition,
                unit: sourceExercise.unit,
                prescription_raw: sourceExercise.prescription_raw,
                summary_total_sets: sourceExercise.summary_total_sets,
                summary_total_reps: sourceExercise.summary_total_reps,
                summary_highest_load: sourceExercise.summary_highest_load,
                summary_avg_load: sourceExercise.summary_avg_load,
              }])
              .select()
              .single();

            if (error) throw error;

            if (data && sourceExercise.prescription_raw) {
              const { data: setLines } = await supabase
                .from('planned_set_lines')
                .select('*')
                .eq('planned_exercise_id', sourceExercise.id);

              if (setLines && setLines.length > 0) {
                await supabase.from('planned_set_lines').insert(
                  setLines.map((line) => ({
                    planned_exercise_id: data.id,
                    sets: line.sets,
                    reps: line.reps,
                    load_value: line.load_value,
                    position: line.position,
                  }))
                );
              }
            }
          }
        } else {
          await onMoveExercise(itemId, fromDay, dayIndex);
        }
      } else if (itemType === 'combo') {
        await copyCombo(itemId, newPosition);

        if (!isCopy) {
          await deleteComboById(itemId);
        }
      }

      await onRefresh();
    } finally {
      setIsLoading(false);
    }

    setDraggedItemId(null);
    setDraggedItemType(null);
  };

  const handleDayDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', `DAY:${dayIndex}`);
  };

  const handleDayDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const dragData = e.dataTransfer.getData('text/plain');
    if (!dragData.startsWith('DAY:')) return;

    const sourceDayIndex = parseInt(dragData.split(':')[1], 10);
    if (sourceDayIndex === dayIndex) return;

    const isCopy = e.ctrlKey || e.metaKey;
    setIsLoading(true);

    try {
      const { data: sourceExercises } = await supabase
        .from('planned_exercises')
        .select('*')
        .eq('weekplan_id', weekPlanId)
        .eq('day_index', sourceDayIndex)
        .order('position');

      if (sourceExercises && sourceExercises.length > 0) {
        for (const sourceEx of sourceExercises) {
          const newPosition = exercises.length + sourceExercises.indexOf(sourceEx) + 1;

          const { data: newEx, error } = await supabase
            .from('planned_exercises')
            .insert([{
              weekplan_id: weekPlanId,
              day_index: dayIndex,
              exercise_id: sourceEx.exercise_id,
              position: newPosition,
              unit: sourceEx.unit,
              prescription_raw: sourceEx.prescription_raw,
              summary_total_sets: sourceEx.summary_total_sets,
              summary_total_reps: sourceEx.summary_total_reps,
              summary_highest_load: sourceEx.summary_highest_load,
              summary_avg_load: sourceEx.summary_avg_load,
            }])
            .select()
            .single();

          if (error) throw error;

          if (newEx && sourceEx.prescription_raw) {
            const { data: setLines } = await supabase
              .from('planned_set_lines')
              .select('*')
              .eq('planned_exercise_id', sourceEx.id);

            if (setLines && setLines.length > 0) {
              await supabase.from('planned_set_lines').insert(
                setLines.map((line) => ({
                  planned_exercise_id: newEx.id,
                  sets: line.sets,
                  reps: line.reps,
                  load_value: line.load_value,
                  position: line.position,
                }))
              );
            }
          }
        }

        if (!isCopy) {
          const exerciseIds = sourceExercises.map((ex) => ex.id);
          await supabase.from('planned_set_lines').delete().in('planned_exercise_id', exerciseIds);
          await supabase.from('planned_exercises').delete().in('id', exerciseIds);
        }

        await onRefresh();
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 min-h-[500px] flex flex-col"
        onDragOver={(e) => {
          e.preventDefault();
          const dragData = e.dataTransfer.types.includes('text/plain');
          if (dragData) {
            e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
          }
        }}
        onDrop={(e) => {
          const dragData = e.dataTransfer.getData('text/plain');
          if (dragData.startsWith('DAY:')) {
            handleDayDrop(e);
          } else {
            handleDrop(e);
          }
        }}
      >
        <div
          draggable={exercises.length > 0}
          onDragStart={handleDayDragStart}
          className={`flex items-center gap-2 mb-3 ${exercises.length > 0 ? 'cursor-move' : ''}`}
        >
          {exercises.length > 0 && <GripVertical size={16} className="text-gray-400" />}
          <h2 className="text-base font-bold text-gray-900 uppercase tracking-wide">{dayName}</h2>
        </div>

        <div className="mb-3">
          <div className="relative" ref={searchInputRef}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setShowSearchResults(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Add exercise, /combo, or /text..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            {showSearchResults && searchQuery && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-64 overflow-y-auto">
                {searchQuery.toLowerCase() === '/combo' ? (
                  <button
                    onClick={() => {
                      setShowComboCreator(true);
                      setSearchQuery('');
                      setShowSearchResults(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Layers size={14} className="text-blue-700" />
                      <div className="font-medium text-blue-900">Create Combo Exercise</div>
                    </div>
                  </button>
                ) : searchQuery.toLowerCase() === '/text' ? (
                  <button
                    onClick={handleAddFreeText}
                    className="w-full text-left px-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm flex-shrink-0 bg-gray-400" />
                      <div className="font-medium text-gray-900">Add Free Text / Notes</div>
                    </div>
                  </button>
                ) : searchResults.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                ) : (
                  searchResults.map((ex, index) => (
                    <button
                      key={ex.id}
                      onClick={() => handleSelectExercise(ex)}
                      className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                        index === selectedSearchIndex ? 'bg-blue-100 text-blue-900' : 'hover:bg-blue-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: ex.color }} />
                        <div className="font-medium text-gray-900">{ex.name}</div>
                        {ex.exercise_code && (
                          <span className="text-xs text-gray-500 ml-auto">{ex.exercise_code}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 ml-5">{ex.category}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div
          className="flex-1 space-y-2 overflow-y-auto"
          onDragOver={(e) => {
            if (exercises.length === 0) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
              setIsDragOverEmpty(true);
            }
          }}
          onDragLeave={(e) => {
            if (exercises.length === 0 && e.currentTarget === e.target) {
              setIsDragOverEmpty(false);
            }
          }}
          onDrop={(e) => {
            if (exercises.length === 0) {
              setIsDragOverEmpty(false);
              const dragData = e.dataTransfer.getData('text/plain');
              if (dragData.startsWith('DAY:')) {
                handleDayDrop(e);
              } else {
                handleDrop(e);
              }
            }
          }}
        >
          {(() => {
            const visibleExercises = exercises.filter(ex => !comboExerciseIds.has(ex.id));
            const hasItems = visibleExercises.length > 0 || combos.length > 0;

            if (!hasItems) {
              return (
                <div className={`text-center py-8 text-sm transition-colors ${
                  isDragOverEmpty
                    ? 'text-blue-500 bg-blue-50 border-2 border-dashed border-blue-300 rounded-lg'
                    : 'text-gray-400'
                }`}>
                  {isDragOverEmpty ? 'Drop exercise here' : 'No exercises yet'}
                </div>
              );
            }

            const allItems: Array<{ type: 'exercise' | 'combo'; data: any; position: number }> = [
              ...visibleExercises.map(ex => ({ type: 'exercise' as const, data: ex, position: ex.position })),
              ...combos.map(combo => ({ type: 'combo' as const, data: combo, position: combo.position }))
            ].sort((a, b) => a.position - b.position);

            return (
              <>
                {allItems.map((item, index) => {
                  if (item.type === 'exercise') {
                    return (
                      <ExerciseCard
                        key={item.data.id}
                        plannedEx={item.data}
                        index={index}
                        isDragged={draggedItemId === item.data.id && draggedItemType === 'exercise'}
                        isDraggedOver={dragOverIndex === index}
                        onSelect={() => setEditingExercise(item.data)}
                        onDelete={() => onDeleteExercise(item.data.id, dayIndex)}
                        onDragStart={(e) => handleDragStart(e, item.data.id, 'exercise')}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDropReorder(e, index)}
                      />
                    );
                  } else {
                    return (
                      <div
                        key={item.data.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.data.id, 'combo')}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDropReorder(e, index)}
                        className={`transition-all ${
                          draggedItemId === item.data.id && draggedItemType === 'combo' ? 'opacity-50' : ''
                        } ${dragOverIndex === index ? 'border-blue-400 bg-blue-50' : ''}`}
                      >
                        <ComboCard
                          combo={item.data}
                          onEdit={setEditingCombo}
                          onDelete={handleDeleteCombo}
                        />
                      </div>
                    );
                  }
                })}
              </>
            );
          })()}
        </div>

        {(exercises.length > 0 || combos.length > 0) && (() => {
          const standaloneExercises = exercises.filter(ex => !comboExerciseIds.has(ex.id) && ex.exercise.counts_towards_totals);

          const standaloneSetCount = standaloneExercises.reduce((sum, ex) => sum + (ex.summary_total_sets || 0), 0);
          const standaloneRepCount = standaloneExercises.reduce((sum, ex) => sum + (ex.summary_total_reps || 0), 0);
          const standaloneTonnage = standaloneExercises
            .filter(ex => ex.unit === 'absolute_kg')
            .reduce((sum, ex) => sum + (ex.summary_avg_load || 0) * (ex.summary_total_reps || 0), 0);

          const comboSetCount = combos.reduce((sum, combo) =>
            sum + combo.set_lines.reduce((s, line) => s + line.sets, 0), 0);
          const comboRepCount = combos.reduce((sum, combo) =>
            sum + combo.set_lines.reduce((s, line) => {
              const totalRepsInTuple = line.reps_tuple_text.split('+').reduce((r, p) => r + (parseInt(p.trim(), 10) || 0), 0);
              return s + line.sets * totalRepsInTuple;
            }, 0), 0);
          const comboTonnage = combos
            .filter(combo => combo.unit === 'absolute_kg')
            .reduce((sum, combo) =>
              sum + combo.set_lines.reduce((s, line) => {
                const totalRepsInTuple = line.reps_tuple_text.split('+').reduce((r, p) => r + (parseInt(p.trim(), 10) || 0), 0);
                return s + line.load_value * line.sets * totalRepsInTuple;
              }, 0), 0);

          return (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Daily Summary
              </div>
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Sets:</span>{' '}
                  <span className="font-semibold text-gray-900">{standaloneSetCount + comboSetCount}</span>
                </div>
                <div>
                  <span className="text-gray-600">Reps:</span>{' '}
                  <span className="font-semibold text-gray-900">{standaloneRepCount + comboRepCount}</span>
                </div>
                <div>
                  <span className="text-gray-600">Tonnage:</span>{' '}
                  <span className="font-semibold text-gray-900">{Math.round(standaloneTonnage + comboTonnage)}kg</span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {editingExercise && (
        <PrescriptionModal
          plannedEx={editingExercise}
          onClose={() => setEditingExercise(null)}
          onSave={onRefresh}
        />
      )}

      {editingCombo && (
        <ComboEditorModal
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={async () => {
            await loadCombos();
            await onRefresh();
          }}
        />
      )}

      {showComboCreator && (
        <ComboCreatorModal
          allExercises={allExercises}
          onClose={() => setShowComboCreator(false)}
          onSave={handleCreateCombo}
        />
      )}
    </>
  );
}

interface ExerciseCardProps {
  plannedEx: PlannedExercise & { exercise: Exercise };
  index: number;
  isDragged: boolean;
  isDraggedOver: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function ExerciseCard({
  plannedEx,
  isDragged,
  isDraggedOver,
  onSelect,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ExerciseCardProps) {
  const unitSymbol = getUnitSymbol(plannedEx.unit);
  const hasSummary = plannedEx.summary_total_sets !== null && plannedEx.summary_total_sets > 0;
  const isFreeText = plannedEx.exercise.exercise_code === 'TEXT';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`border-l-4 border rounded transition-all cursor-pointer ${
        isDraggedOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
      } ${isDragged ? 'opacity-50' : ''} bg-white hover:bg-gray-50`}
      style={{ borderLeftColor: plannedEx.exercise.color }}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2 p-3">
        <GripVertical size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          {isFreeText ? (
            <>
              <p className="text-sm text-gray-600 italic">
                {plannedEx.notes || 'Click to add text...'}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {plannedEx.exercise.name}
                </p>
                {unitSymbol && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 rounded">
                    {unitSymbol}
                  </span>
                )}
              </div>

              {plannedEx.prescription_raw ? (
                <p className="text-xs text-gray-600 font-medium">{plannedEx.prescription_raw}</p>
              ) : (
                <p className="text-xs text-gray-400 italic">Click to add prescription</p>
              )}
              {hasSummary && (
                <div className="text-[10px] text-gray-500 mt-1">
                  S {plannedEx.summary_total_sets} | R {plannedEx.summary_total_reps}
                  {plannedEx.summary_highest_load !== null && (
                    <> | Hi {plannedEx.summary_highest_load?.toFixed(0) ?? '0'} | Avg {plannedEx.summary_avg_load?.toFixed(0)}</>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
          title="Delete"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
