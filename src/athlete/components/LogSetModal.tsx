// @ts-nocheck
import { useState, useEffect } from 'react';
import { X, Plus, Check, Trash2, Minus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getMonday, toISODate } from '../lib/dateHelpers';
import type { Athlete, PlannedExercise, Exercise, PlannedSetLine, TrainingLogSession, TrainingLogExercise, TrainingLogSet } from '../../lib/database.types';

interface DayExercise extends PlannedExercise {
  exercise: Exercise;
  set_lines: PlannedSetLine[];
}

interface LoggedExercise extends TrainingLogExercise {
  sets: TrainingLogSet[];
}

interface Props {
  athlete: Athlete;
  exercise: DayExercise;
  sessionDate: string;
  dayIndex: number;
  existingSession: TrainingLogSession | null;
  existingLogExercise: LoggedExercise | null;
  onClose: () => void;
  onSaved: () => void;
}

interface SetEntry {
  id?: string;
  setNumber: number;
  plannedLoad: number | null;
  plannedReps: number | null;
  performedLoad: string;
  performedReps: string;
  status: 'pending' | 'completed' | 'skipped' | 'failed';
}

export function LogSetModal({ athlete, exercise, sessionDate, dayIndex, existingSession, existingLogExercise, onClose, onSaved }: Props) {
  const [sets, setSets] = useState<SetEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingLogExercise && existingLogExercise.sets.length > 0) {
      setSets(existingLogExercise.sets.map(s => ({
        id: s.id,
        setNumber: s.set_number,
        plannedLoad: s.planned_load,
        plannedReps: s.planned_reps,
        performedLoad: s.performed_load?.toString() || '',
        performedReps: s.performed_reps?.toString() || '',
        status: s.status,
      })));
    } else {
      const entries: SetEntry[] = [];
      let setNum = 1;
      for (const sl of exercise.set_lines) {
        for (let i = 0; i < sl.sets; i++) {
          entries.push({
            setNumber: setNum++,
            plannedLoad: sl.load_value,
            plannedReps: sl.reps,
            performedLoad: sl.load_value > 0 ? sl.load_value.toString() : '',
            performedReps: sl.reps.toString(),
            status: 'pending',
          });
        }
      }
      if (entries.length === 0) {
        entries.push({
          setNumber: 1,
          plannedLoad: null,
          plannedReps: null,
          performedLoad: '',
          performedReps: '',
          status: 'pending',
        });
      }
      setSets(entries);
    }
  }, [exercise, existingLogExercise]);

  function updateSet(index: number, field: Partial<SetEntry>) {
    setSets(prev => prev.map((s, i) => i === index ? { ...s, ...field } : s));
  }

  function addSet() {
    const last = sets[sets.length - 1];
    setSets(prev => [...prev, {
      setNumber: prev.length + 1,
      plannedLoad: null,
      plannedReps: null,
      performedLoad: last?.performedLoad || '',
      performedReps: last?.performedReps || '',
      status: 'pending',
    }]);
  }

  function removeSet(index: number) {
    if (sets.length <= 1) return;
    setSets(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, setNumber: i + 1 })));
  }

  function toggleSetDone(index: number) {
    setSets(prev => prev.map((s, i) =>
      i === index
        ? { ...s, status: s.status === 'completed' ? 'pending' : 'completed' }
        : s
    ));
  }

  function adjustValue(index: number, field: 'performedLoad' | 'performedReps', delta: number) {
    setSets(prev => prev.map((s, i) => {
      if (i !== index) return s;
      const current = parseFloat(s[field]) || 0;
      const newVal = Math.max(0, current + delta);
      return { ...s, [field]: newVal.toString() };
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      let sessionId = existingSession?.id;

      if (!sessionId) {
        const weekStart = toISODate(getMonday(new Date(sessionDate + 'T00:00:00')));
        const { data: newSession, error } = await supabase
          .from('training_log_sessions')
          .insert({
            athlete_id: athlete.id,
            date: sessionDate,
            week_start: weekStart,
            day_index: dayIndex,
            status: 'in_progress',
            session_notes: '',
          } as any)
          .select()
          .single();

        if (error) throw error;
        sessionId = (newSession as any).id;
      }

      let logExId = existingLogExercise?.id;

      if (existingLogExercise) {
        await supabase
          .from('training_log_sets')
          .delete()
          .eq('log_exercise_id', existingLogExercise.id);
      } else {
        const { data: newLogEx, error } = await supabase
          .from('training_log_exercises')
          .insert({
            session_id: sessionId,
            exercise_id: exercise.exercise_id,
            planned_exercise_id: exercise.id,
            position: exercise.position,
            performed_raw: '',
            performed_notes: '',
            status: 'completed',
          } as any)
          .select()
          .single();

        if (error) throw error;
        logExId = (newLogEx as any).id;
      }

      const completedSets = sets.filter(s => s.performedLoad || s.performedReps);

      if (completedSets.length > 0 && logExId) {
        await supabase.from('training_log_sets').insert(
          completedSets.map(s => ({
            log_exercise_id: logExId!,
            set_number: s.setNumber,
            planned_load: s.plannedLoad,
            planned_reps: s.plannedReps,
            performed_load: s.performedLoad ? parseFloat(s.performedLoad) : null,
            performed_reps: s.performedReps ? parseInt(s.performedReps) : null,
            status: s.status,
          })) as any
        );
      }

      if (logExId) {
        const perfParts = completedSets.map(s => {
          const load = s.performedLoad || '?';
          const reps = s.performedReps || '?';
          return `${load}x${reps}`;
        });

        await supabase
          .from('training_log_exercises')
          .update({
            performed_raw: perfParts.join(', '),
            status: completedSets.length > 0 ? 'completed' : 'pending',
          } as any)
          .eq('id', logExId);
      }

      onSaved();
    } catch (err) {
      console.error('Failed to save log:', err);
    } finally {
      setSaving(false);
    }
  }

  const allCompleted = sets.every(s => s.status === 'completed');

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center">
      <div className="w-full max-w-lg bg-gray-900 rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div
              className="w-1 h-8 rounded-full"
              style={{ backgroundColor: exercise.exercise?.color || '#3B82F6' }}
            />
            <div>
              <h2 className="text-base font-bold text-white">{exercise.exercise?.name}</h2>
              <p className="text-xs text-gray-500">{exercise.prescription_raw || 'Log your sets'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-[40px_1fr_1fr_40px_40px] gap-2 text-[10px] font-medium text-gray-500 uppercase tracking-wider px-1">
            <span>Set</span>
            <span>KG</span>
            <span>Reps</span>
            <span></span>
            <span></span>
          </div>

          {sets.map((s, idx) => (
            <div
              key={idx}
              className={`grid grid-cols-[40px_1fr_1fr_40px_40px] gap-2 items-center transition-all ${
                s.status === 'completed' ? 'opacity-60' : ''
              }`}
            >
              <span className="text-sm font-semibold text-gray-500 text-center">{s.setNumber}</span>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => adjustValue(idx, 'performedLoad', -2.5)}
                  className="w-7 h-9 flex items-center justify-center bg-gray-800 rounded-l-lg text-gray-400 active:bg-gray-700"
                >
                  <Minus size={12} />
                </button>
                <input
                  type="number"
                  value={s.performedLoad}
                  onChange={e => updateSet(idx, { performedLoad: e.target.value })}
                  placeholder={s.plannedLoad?.toString() || '0'}
                  className="flex-1 h-9 bg-gray-800 text-center text-white text-sm font-medium border-0 outline-none focus:ring-1 focus:ring-blue-500 min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => adjustValue(idx, 'performedLoad', 2.5)}
                  className="w-7 h-9 flex items-center justify-center bg-gray-800 rounded-r-lg text-gray-400 active:bg-gray-700"
                >
                  <Plus size={12} />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => adjustValue(idx, 'performedReps', -1)}
                  className="w-7 h-9 flex items-center justify-center bg-gray-800 rounded-l-lg text-gray-400 active:bg-gray-700"
                >
                  <Minus size={12} />
                </button>
                <input
                  type="number"
                  value={s.performedReps}
                  onChange={e => updateSet(idx, { performedReps: e.target.value })}
                  placeholder={s.plannedReps?.toString() || '0'}
                  className="flex-1 h-9 bg-gray-800 text-center text-white text-sm font-medium border-0 outline-none focus:ring-1 focus:ring-blue-500 min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => adjustValue(idx, 'performedReps', 1)}
                  className="w-7 h-9 flex items-center justify-center bg-gray-800 rounded-r-lg text-gray-400 active:bg-gray-700"
                >
                  <Plus size={12} />
                </button>
              </div>

              <button
                onClick={() => toggleSetDone(idx)}
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                  s.status === 'completed'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                <Check size={16} />
              </button>

              <button
                onClick={() => removeSet(idx)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-800 text-gray-600 hover:text-red-400 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <button
            onClick={addSet}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 rounded-lg transition-colors"
          >
            + Add Set
          </button>
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-medium text-gray-400 bg-gray-800 rounded-xl hover:bg-gray-750 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex-1 py-3 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 ${
              allCompleted
                ? 'bg-green-600 text-white hover:bg-green-500'
                : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
