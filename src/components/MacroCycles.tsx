import React, { useState, useEffect } from 'react';
import type { MacroCycle, MacroTarget } from '../lib/database.types';
import { useMacroCycles } from '../hooks/useMacroCycles';
import { useAthleteStore } from '../store/athleteStore';
import { useExercises } from '../hooks/useExercises';
import { ChevronLeft, ChevronRight, X, Plus, Trash2, TrendingUp, BarChart3 } from 'lucide-react';
import { getMondayOfWeek, formatDateShort, formatDateToDDMMYYYY } from '../lib/dateUtils';
import { MacroGraph } from './MacroGraph';
import { TotalRepsGraph } from './TotalRepsGraph';

function generateMacroWeeks(startDate: string, endDate: string): Array<{ week_start: string; week_number: number }> {
  const weeks: Array<{ week_start: string; week_number: number }> = [];
  const start = getMondayOfWeek(new Date(startDate));
  const end = new Date(endDate);

  let currentWeek = new Date(start);
  let weekNumber = 1;

  while (currentWeek <= end) {
    weeks.push({
      week_start: currentWeek.toISOString().split('T')[0],
      week_number: weekNumber
    });

    currentWeek.setDate(currentWeek.getDate() + 7);
    weekNumber++;
  }

  return weeks;
}

export function MacroCycles() {
  const { selectedAthlete } = useAthleteStore();
  const {
    exercises,
    fetchExercisesByName,
  } = useExercises();

  const {
    macrocycles,
    macroWeeks,
    trackedExercises,
    targets,
    loading,
    error,
    setError,
    fetchMacrocycles,
    createMacrocycle,
    deleteMacrocycle,
    fetchMacroWeeks,
    updateMacroWeek,
    fetchTrackedExercises,
    addTrackedExercise,
    swapTrackedExercisePositions,
    removeTrackedExercise,
    reorderTrackedExercise,
    fetchTargets,
    upsertTarget,
  } = useMacroCycles();

  const [selectedMacrocycle, setSelectedMacrocycle] = useState<MacroCycle | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGraphForExercise, setShowGraphForExercise] = useState<string | null>(null);
  const [showTotalRepsGraph, setShowTotalRepsGraph] = useState(false);
  const [localTargetValues, setLocalTargetValues] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    name: '',
    start_date: '',
    end_date: ''
  });

  useEffect(() => {
    fetchExercisesByName();
  }, []);

  useEffect(() => {
    if (selectedAthlete) {
      fetchMacrocycles(selectedAthlete.id);
    } else {
      setSelectedMacrocycle(null);
    }
  }, [selectedAthlete]);

  useEffect(() => {
    if (selectedMacrocycle) {
      fetchMacroWeeks(selectedMacrocycle.id);
      fetchTrackedExercises(selectedMacrocycle.id);
    }
  }, [selectedMacrocycle]);

  useEffect(() => {
    if (macroWeeks.length > 0) {
      fetchTargets(macroWeeks.map(w => w.id));
    }
  }, [macroWeeks]);


  const handleCreateMacrocycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAthlete) return;
    try {
      const weeks = generateMacroWeeks(formData.start_date, formData.end_date);
      const weekInserts = weeks.map(week => ({
        macrocycle_id: '',
        week_start: week.week_start,
        week_number: week.week_number,
        week_type: 'Medium',
        week_type_text: '',
        notes: ''
      }));
      const macrocycle = await createMacrocycle(
        selectedAthlete.id,
        formData.name,
        formData.start_date,
        formData.end_date,
        weekInserts
      );
      setFormData({ name: '', start_date: '', end_date: '' });
      await fetchMacrocycles(selectedAthlete.id);
      setSelectedMacrocycle(macrocycle);
    } catch {
      // error already set in hook
    }
  };

  const getWeekInputKey = (weekId: string, field: string): string => {
    return `week_${weekId}_${field}`;
  };

  const getWeekInputValue = (weekId: string, field: 'week_type_text' | 'notes'): string => {
    const key = getWeekInputKey(weekId, field);
    if (key in localTargetValues) {
      return localTargetValues[key];
    }
    const week = macroWeeks.find(w => w.id === weekId);
    return week?.[field] ?? '';
  };

  const handleWeekInputChange = (weekId: string, field: 'week_type_text' | 'notes', value: string) => {
    const key = getWeekInputKey(weekId, field);
    setLocalTargetValues(prev => ({ ...prev, [key]: value }));
  };

  const handleUpdateWeek = async (weekId: string, field: 'week_type_text' | 'notes', value: string) => {
    try {
      await updateMacroWeek(weekId, { [field]: value });
      const key = getWeekInputKey(weekId, field);
      setLocalTargetValues(prev => {
        const newValues = { ...prev };
        delete newValues[key];
        return newValues;
      });
    } catch {
      // error already set in hook
    }
  };

  const handleUpdateTotalRepsTarget = async (weekId: string, value: string) => {
    const numValue = value === '' ? null : parseInt(value, 10);
    if (value !== '' && isNaN(numValue as number)) return;
    try {
      await updateMacroWeek(weekId, { total_reps_target: numValue });
      const key = getWeekInputKey(weekId, 'total_reps_target');
      setLocalTargetValues(prev => {
        const newValues = { ...prev };
        delete newValues[key];
        return newValues;
      });
    } catch {
      // error already set in hook
    }
  };

  const handleDeleteMacrocycle = async (macrocycleId: string) => {
    if (!confirm('Are you sure you want to delete this macrocycle? This will delete all associated weeks, exercises, and targets.')) {
      return;
    }
    try {
      if (selectedMacrocycle?.id === macrocycleId) {
        setSelectedMacrocycle(null);
      }
      await deleteMacrocycle(macrocycleId);
    } catch {
      // error already set in hook
    }
  };

  const handleAddTrackedExercise = async () => {
    if (!selectedMacrocycle || !selectedExercise) return;

    const exerciseAlreadyTracked = trackedExercises.some(
      te => te.exercise_id === selectedExercise
    );

    if (exerciseAlreadyTracked) {
      setError('This exercise is already being tracked');
      return;
    }

    try {
      await addTrackedExercise(selectedMacrocycle.id, selectedExercise, trackedExercises.length + 1);
      setSelectedExercise('');
      setShowAddExercise(false);
      await fetchTrackedExercises(selectedMacrocycle.id);
    } catch {
      // error already set in hook
    }
  };

  const handleMoveTrackedExercise = async (index: number, direction: 'left' | 'right') => {
    if (direction === 'left' && index === 0) return;
    if (direction === 'right' && index === trackedExercises.length - 1) return;

    const swapIndex = direction === 'left' ? index - 1 : index + 1;
    const current = trackedExercises[index];
    const swap = trackedExercises[swapIndex];

    try {
      await swapTrackedExercisePositions(current.id, swap.position, swap.id, current.position);
      await fetchTrackedExercises(selectedMacrocycle!.id);
    } catch {
      // error already set in hook
    }
  };

  const handleRemoveTrackedExercise = async (id: string) => {
    try {
      await removeTrackedExercise(id);
      const remaining = trackedExercises.filter(te => te.id !== id);
      for (let i = 0; i < remaining.length; i++) {
        const newPosition = i + 1;
        if (remaining[i].position !== newPosition) {
          await reorderTrackedExercise(remaining[i].id, newPosition);
        }
      }
      await fetchTrackedExercises(selectedMacrocycle!.id);
    } catch {
      // error already set in hook
    }
  };

  const getTarget = (weekId: string, trackedExId: string): MacroTarget | undefined => {
    return targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === trackedExId);
  };

  const getInputKey = (weekId: string, trackedExId: string, field: string): string => {
    return `${weekId}_${trackedExId}_${field}`;
  };

  const getInputValue = (weekId: string, trackedExId: string, field: keyof MacroTarget): string => {
    const key = getInputKey(weekId, trackedExId, field);
    if (key in localTargetValues) {
      return localTargetValues[key];
    }
    const target = getTarget(weekId, trackedExId);
    return target?.[field]?.toString() ?? '';
  };

  const handleInputChange = (
    weekId: string,
    trackedExId: string,
    field: keyof MacroTarget,
    value: string
  ) => {
    const key = getInputKey(weekId, trackedExId, field);
    setLocalTargetValues(prev => ({ ...prev, [key]: value }));
  };

  const handleUpdateTarget = async (
    weekId: string,
    trackedExId: string,
    field: keyof MacroTarget,
    value: string
  ) => {
    const numValue = value === '' ? null : parseFloat(value);
    if (value !== '' && isNaN(numValue as number)) return;
    const existingTarget = getTarget(weekId, trackedExId);
    try {
      await upsertTarget(weekId, trackedExId, field, numValue, existingTarget);
      const key = getInputKey(weekId, trackedExId, field);
      setLocalTargetValues(prev => {
        const newValues = { ...prev };
        delete newValues[key];
        return newValues;
      });
    } catch {
      // error already set in hook
    }
  };

  const handleGraphTargetUpdate = async (
    weekId: string,
    field: 'target_ave' | 'target_hi',
    value: number
  ) => {
    if (!showGraphForExercise) return;
    const existingTarget = targets.find(
      t => t.macro_week_id === weekId && t.tracked_exercise_id === showGraphForExercise
    );
    try {
      await upsertTarget(weekId, showGraphForExercise, field, value, existingTarget);
    } catch {
      // error already set in hook
    }
  };

  const handleTotalRepsUpdate = async (weekId: string, value: number) => {
    try {
      await updateMacroWeek(weekId, { total_reps_target: value });
    } catch {
      // error already set in hook
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-[1800px] mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Macro Cycle Planning</h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-3 underline">Dismiss</button>
          </div>
        )}

        {!selectedAthlete ? (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-500">Please select an athlete from the dropdown in the top right corner to manage macro cycles.</p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium shadow-md"
              >
                <Plus size={20} />
                Create New Macrocycle
              </button>
            </div>

            {macrocycles.length > 0 && (
              <div className="bg-white rounded-lg shadow p-4 mb-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Select Macrocycle</h2>
                <div className="flex gap-2 flex-wrap">
                  {macrocycles.map(macro => (
                    <div key={macro.id} className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedMacrocycle(macro)}
                        className={`px-4 py-2 text-sm rounded border transition-colors ${
                          selectedMacrocycle?.id === macro.id
                            ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                            : 'border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {macro.name}
                      </button>
                      <button
                        onClick={() => handleDeleteMacrocycle(macro.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete macrocycle"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedMacrocycle && (
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {selectedMacrocycle.name}
                  </h2>
                  <button
                    onClick={() => setShowAddExercise(!showAddExercise)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    <Plus className="w-4 h-4" />
                    Add Exercise
                  </button>
                </div>

                {showAddExercise && (
                  <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-200">
                    <div className="flex gap-2">
                      <select
                        value={selectedExercise}
                        onChange={(e) => setSelectedExercise(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select exercise...</option>
                        {exercises.map(exercise => (
                          <option key={exercise.id} value={exercise.id}>
                            {exercise.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleAddTrackedExercise}
                        disabled={!selectedExercise}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setShowAddExercise(false)}
                        className="px-3 py-2 text-gray-600 text-sm rounded hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {(trackedExercises.length > 0 || macroWeeks.length > 0) && (
                  <div className="mb-4 flex gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-700 self-center">View Graphs:</span>
                    <button
                      onClick={() => setShowTotalRepsGraph(!showTotalRepsGraph)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1 ${
                        showTotalRepsGraph
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                      }`}
                    >
                      <BarChart3 size={16} />
                      Total Reps
                    </button>
                    {trackedExercises.map((trackedEx) => (
                      <button
                        key={trackedEx.id}
                        onClick={() => setShowGraphForExercise(
                          showGraphForExercise === trackedEx.id ? null : trackedEx.id
                        )}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1 ${
                          showGraphForExercise === trackedEx.id
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                        }`}
                      >
                        <TrendingUp size={16} />
                        {trackedEx.exercise.exercise_code || trackedEx.exercise.name}
                      </button>
                    ))}
                  </div>
                )}

                {showTotalRepsGraph && (
                  <div className="mb-4">
                    <TotalRepsGraph
                      macroWeeks={macroWeeks}
                      onRepsUpdate={handleTotalRepsUpdate}
                    />
                  </div>
                )}

                {showGraphForExercise && (
                  <div className="mb-4">
                    <MacroGraph
                      macroWeeks={macroWeeks}
                      targets={targets}
                      trackedExerciseId={showGraphForExercise}
                      onTargetUpdate={handleGraphTargetUpdate}
                    />
                  </div>
                )}

                {loading ? (
                  <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>
                ) : (
                  <div className="overflow-x-auto border border-gray-300 rounded">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-yellow-100 border-b border-gray-300">
                          <th className="sticky left-0 z-20 bg-yellow-100 px-2 py-1.5 text-left font-semibold text-gray-700 border-r border-gray-300 min-w-[40px]">
                            Wk
                          </th>
                          <th className="sticky left-[40px] z-20 bg-yellow-100 px-2 py-1.5 text-left font-semibold text-gray-700 border-r border-gray-300 min-w-[60px]">
                            Date
                          </th>
                          <th className="sticky left-[100px] z-20 bg-yellow-100 px-2 py-1.5 text-left font-semibold text-gray-700 border-r border-gray-300 min-w-[80px]">
                            Type
                          </th>
                          <th className="sticky left-[180px] z-20 bg-yellow-100 px-2 py-1.5 text-center font-semibold text-gray-700 border-r border-gray-400 min-w-[60px]">
                            Total Reps
                          </th>
                          {trackedExercises.map((trackedEx, idx) => (
                            <th
                              key={trackedEx.id}
                              className="bg-yellow-100 border-r border-gray-300 last:border-r-0"
                              colSpan={5}
                            >
                              <div className="px-2 py-1 min-w-[200px]">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-semibold text-gray-900 text-xs">
                                    {trackedEx.exercise.exercise_code || trackedEx.exercise.name}
                                  </span>
                                  <div className="flex gap-0.5">
                                    <button
                                      onClick={() => handleMoveTrackedExercise(idx, 'left')}
                                      disabled={idx === 0}
                                      className="p-0.5 text-gray-600 hover:bg-yellow-200 rounded disabled:opacity-30"
                                      title="Move left"
                                    >
                                      <ChevronLeft className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleMoveTrackedExercise(idx, 'right')}
                                      disabled={idx === trackedExercises.length - 1}
                                      className="p-0.5 text-gray-600 hover:bg-yellow-200 rounded disabled:opacity-30"
                                      title="Move right"
                                    >
                                      <ChevronRight className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleRemoveTrackedExercise(trackedEx.id)}
                                      className="p-0.5 text-red-600 hover:bg-red-50 rounded"
                                      title="Remove"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </th>
                          ))}
                        </tr>
                        {trackedExercises.length > 0 && (
                          <tr className="bg-yellow-50 border-b border-gray-300">
                            <th className="sticky left-0 z-20 bg-yellow-50 border-r border-gray-300"></th>
                            <th className="sticky left-[40px] z-20 bg-yellow-50 border-r border-gray-300"></th>
                            <th className="sticky left-[100px] z-20 bg-yellow-50 border-r border-gray-300"></th>
                            <th className="sticky left-[180px] z-20 bg-yellow-50 border-r border-gray-400"></th>
                            {trackedExercises.map(trackedEx => (
                              <React.Fragment key={trackedEx.id}>
                                <th className="px-1 py-1 text-center text-[10px] font-medium text-gray-600 border-r border-gray-200">Reps</th>
                                <th className="px-1 py-1 text-center text-[10px] font-medium text-gray-600 border-r border-gray-200">Ave</th>
                                <th className="px-1 py-1 text-center text-[10px] font-medium text-gray-600 border-r border-gray-200">Hi</th>
                                <th className="px-1 py-1 text-center text-[10px] font-medium text-gray-600 border-r border-gray-200">Rhi</th>
                                <th className="px-1 py-1 text-center text-[10px] font-medium text-gray-600 border-r border-gray-300">Shi</th>
                              </React.Fragment>
                            ))}
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {macroWeeks.map((week) => {
                          const weekColor = week.week_type_text.toLowerCase().includes('deload') ||
                            week.week_type_text.toLowerCase().includes('low')
                            ? 'bg-green-50'
                            : week.week_type_text.toLowerCase().includes('high')
                            ? 'bg-orange-50'
                            : 'bg-white';

                          return (
                            <tr key={week.id} className={`border-b border-gray-200 ${weekColor} hover:bg-gray-50`}>
                              <td className={`sticky left-0 z-10 ${weekColor} px-2 py-1 text-center font-medium text-gray-900 border-r border-gray-300`}>
                                {week.week_number}
                              </td>
                              <td className={`sticky left-[40px] z-10 ${weekColor} px-2 py-1 text-center text-gray-700 border-r border-gray-300`}>
                                {formatDateShort(week.week_start)}
                              </td>
                              <td className={`sticky left-[100px] z-10 ${weekColor} px-1 py-0.5 border-r border-gray-300`}>
                                <input
                                  type="text"
                                  value={getWeekInputValue(week.id, 'week_type_text')}
                                  onChange={(e) => handleWeekInputChange(week.id, 'week_type_text', e.target.value)}
                                  onBlur={(e) => handleUpdateWeek(week.id, 'week_type_text', e.target.value)}
                                  placeholder="Type..."
                                  className="w-full px-1 py-0.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                />
                              </td>
                              <td className={`sticky left-[180px] z-10 ${weekColor} px-1 py-0.5 border-r border-gray-400`}>
                                <input
                                  type="text"
                                  value={getWeekInputKey(week.id, 'total_reps_target') in localTargetValues
                                    ? localTargetValues[getWeekInputKey(week.id, 'total_reps_target')]
                                    : (week.total_reps_target?.toString() ?? '')}
                                  onChange={(e) => {
                                    const key = getWeekInputKey(week.id, 'total_reps_target');
                                    setLocalTargetValues(prev => ({ ...prev, [key]: e.target.value }));
                                  }}
                                  onBlur={(e) => handleUpdateTotalRepsTarget(week.id, e.target.value)}
                                  placeholder="-"
                                  className="w-full px-1 py-0.5 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-medium"
                                />
                              </td>
                              {trackedExercises.map(trackedEx => {
                                return (
                                  <React.Fragment key={trackedEx.id}>
                                    <td className="px-1 py-0.5 border-r border-gray-200">
                                      <input
                                        type="text"
                                        value={getInputValue(week.id, trackedEx.id, 'target_reps')}
                                        onChange={(e) => handleInputChange(week.id, trackedEx.id, 'target_reps', e.target.value)}
                                        onBlur={(e) => handleUpdateTarget(week.id, trackedEx.id, 'target_reps', e.target.value)}
                                        className="w-full px-1 py-0.5 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        placeholder="-"
                                      />
                                    </td>
                                    <td className="px-1 py-0.5 border-r border-gray-200">
                                      <input
                                        type="text"
                                        value={getInputValue(week.id, trackedEx.id, 'target_ave')}
                                        onChange={(e) => handleInputChange(week.id, trackedEx.id, 'target_ave', e.target.value)}
                                        onBlur={(e) => handleUpdateTarget(week.id, trackedEx.id, 'target_ave', e.target.value)}
                                        className="w-full px-1 py-0.5 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        placeholder="-"
                                      />
                                    </td>
                                    <td className="px-1 py-0.5 border-r border-gray-200">
                                      <input
                                        type="text"
                                        value={getInputValue(week.id, trackedEx.id, 'target_hi')}
                                        onChange={(e) => handleInputChange(week.id, trackedEx.id, 'target_hi', e.target.value)}
                                        onBlur={(e) => handleUpdateTarget(week.id, trackedEx.id, 'target_hi', e.target.value)}
                                        className="w-full px-1 py-0.5 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        placeholder="-"
                                      />
                                    </td>
                                    <td className="px-1 py-0.5 border-r border-gray-200">
                                      <input
                                        type="text"
                                        value={getInputValue(week.id, trackedEx.id, 'target_rhi')}
                                        onChange={(e) => handleInputChange(week.id, trackedEx.id, 'target_rhi', e.target.value)}
                                        onBlur={(e) => handleUpdateTarget(week.id, trackedEx.id, 'target_rhi', e.target.value)}
                                        className="w-full px-1 py-0.5 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        placeholder="-"
                                      />
                                    </td>
                                    <td className="px-1 py-0.5 border-r border-gray-300">
                                      <input
                                        type="text"
                                        value={getInputValue(week.id, trackedEx.id, 'target_shi')}
                                        onChange={(e) => handleInputChange(week.id, trackedEx.id, 'target_shi', e.target.value)}
                                        onBlur={(e) => handleUpdateTarget(week.id, trackedEx.id, 'target_shi', e.target.value)}
                                        className="w-full px-1 py-0.5 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                        placeholder="-"
                                      />
                                    </td>
                                  </React.Fragment>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {selectedMacrocycle && macroWeeks.length > 0 && (
                  <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                    <textarea
                      value={getWeekInputValue(macroWeeks[0].id, 'notes')}
                      onChange={(e) => handleWeekInputChange(macroWeeks[0].id, 'notes', e.target.value)}
                      onBlur={(e) => handleUpdateWeek(macroWeeks[0].id, 'notes', e.target.value)}
                      placeholder="Add notes about training camps, competitions, or other events..."
                      rows={3}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
              <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-xl font-bold text-gray-900">Create New Macrocycle</h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setFormData({ name: '', start_date: '', end_date: '' });
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <form onSubmit={(e) => {
                  handleCreateMacrocycle(e);
                  setShowCreateModal(false);
                }} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Spring 2024"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                    <input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                    <input
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div className="flex gap-3 justify-end pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateModal(false);
                        setFormData({ name: '', start_date: '', end_date: '' });
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
                    >
                      Create Macrocycle
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
