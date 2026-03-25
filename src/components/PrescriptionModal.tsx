import { useState, useRef, useEffect } from 'react';
import { X, Check, Type, Grid3x3 } from 'lucide-react';
import type { PlannedExercise, Exercise, PlannedSetLine, DefaultUnit } from '../lib/database.types';
import { getUnitSymbol, DEFAULT_UNITS, DAYS_OF_WEEK } from '../lib/constants';
import { parsePrescription, parseFreeTextPrescription } from '../lib/prescriptionParser';
import { supabase } from '../lib/supabase';
import { GridPrescriptionEditor } from './GridPrescriptionEditor';

interface PrescriptionModalProps {
  plannedEx: PlannedExercise & { exercise: Exercise };
  onClose: () => void;
  onSave: () => Promise<void>;
}

interface MacroTarget {
  target_reps: number | null;
  target_ave: number | null;
  target_hi: number | null;
  target_rhi: number | null;
  target_shi: number | null;
}

interface OtherDayEntry {
  dayIndex: number;
  dayName: string;
  prescriptionRaw: string | null;
  totalSets: number | null;
  totalReps: number | null;
}

export function PrescriptionModal({ plannedEx, onClose, onSave }: PrescriptionModalProps) {
  const [prescription, setPrescription] = useState(plannedEx.prescription_raw || '');
  const [notes, setNotes] = useState(plannedEx.notes || '');
  const [unit, setUnit] = useState<DefaultUnit>(plannedEx.unit || plannedEx.exercise.default_unit);
  const [setLines, setSetLines] = useState<PlannedSetLine[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [macroTarget, setMacroTarget] = useState<MacroTarget | null>(null);
  const [inputMode, setInputMode] = useState<'text' | 'grid'>('text');
  const [gridSettings, setGridSettings] = useState({ loadIncrement: 5, clickIncrement: 1 });
  const [otherDayEntries, setOtherDayEntries] = useState<OtherDayEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSetLines();
    loadMacroTarget();
    loadGridSettings();
    loadOtherDayPrescriptions();
  }, []);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const loadSetLines = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('planned_set_lines')
        .select('*')
        .eq('planned_exercise_id', plannedEx.id)
        .order('position');

      if (error) throw error;
      setSetLines(data || []);
    } catch (err) {
      console.error('Failed to load set lines:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMacroTarget = async () => {
    try {
      const { data: weekPlan } = await supabase
        .from('week_plans')
        .select('week_start, athlete_id')
        .eq('id', plannedEx.weekplan_id)
        .maybeSingle();

      if (!weekPlan) return;

      const { data: macrocycle } = await supabase
        .from('macrocycles')
        .select('id')
        .eq('is_active', true)
        .eq('athlete_id', weekPlan.athlete_id)
        .maybeSingle();

      if (!macrocycle) return;

      const { data: macroWeek } = await supabase
        .from('macro_weeks')
        .select('id')
        .eq('macrocycle_id', macrocycle.id)
        .eq('week_start', weekPlan.week_start)
        .maybeSingle();

      if (!macroWeek) return;

      const { data: trackedExercise } = await supabase
        .from('macro_tracked_exercises')
        .select('id')
        .eq('macrocycle_id', macrocycle.id)
        .eq('exercise_id', plannedEx.exercise_id)
        .maybeSingle();

      if (!trackedExercise) return;

      const { data: target } = await supabase
        .from('macro_targets')
        .select('target_reps, target_ave, target_hi, target_rhi, target_shi')
        .eq('macro_week_id', macroWeek.id)
        .eq('tracked_exercise_id', trackedExercise.id)
        .maybeSingle();

      if (target) {
        setMacroTarget(target);
      }
    } catch (err) {
      console.error('Failed to load macro target:', err);
    }
  };

  const loadGridSettings = async () => {
    try {
      const { data } = await supabase
        .from('general_settings')
        .select('grid_load_increment, grid_click_increment')
        .maybeSingle();

      if (data) {
        setGridSettings({
          loadIncrement: data.grid_load_increment || 5,
          clickIncrement: data.grid_click_increment || 1,
        });
      }
    } catch (err) {
      console.error('Failed to load grid settings:', err);
    }
  };

  const loadOtherDayPrescriptions = async () => {
    try {
      const { data: otherExercises, error } = await supabase
        .from('planned_exercises')
        .select('day_index, prescription_raw, summary_total_sets, summary_total_reps')
        .eq('weekplan_id', plannedEx.weekplan_id)
        .eq('exercise_id', plannedEx.exercise_id)
        .neq('id', plannedEx.id);

      if (error) throw error;
      if (!otherExercises || otherExercises.length === 0) return;

      const entries: OtherDayEntry[] = otherExercises.map(ex => {
        const day = DAYS_OF_WEEK.find(d => d.index === ex.day_index);
        return {
          dayIndex: ex.day_index,
          dayName: day?.name || `Day ${ex.day_index}`,
          prescriptionRaw: ex.prescription_raw,
          totalSets: ex.summary_total_sets,
          totalReps: ex.summary_total_reps,
        };
      });

      entries.sort((a, b) => a.dayIndex - b.dayIndex);
      setOtherDayEntries(entries);
    } catch (err) {
      console.error('Failed to load other day prescriptions:', err);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const isFreeText = unit === 'free_text';
      const isRPE = unit === 'rpe';
      const isOtherUnit = unit === 'other';
      const isTextBased = isFreeText || isRPE;
      const isNonNumeric = isFreeText || isOtherUnit;

      const parsed = isNonNumeric ? [] : parsePrescription(prescription);
      const parsedText = isTextBased ? parseFreeTextPrescription(prescription) : [];

      await supabase
        .from('planned_set_lines')
        .delete()
        .eq('planned_exercise_id', plannedEx.id);

      if (parsed.length > 0 && !isNonNumeric) {
        const setLines = parsed.map((line, idx) => ({
          planned_exercise_id: plannedEx.id,
          sets: line.sets,
          reps: line.reps,
          load_value: line.load,
          position: idx + 1,
        }));

        await supabase.from('planned_set_lines').insert(setLines);

        const totalSets = parsed.reduce((sum, line) => sum + line.sets, 0);
        const totalReps = parsed.reduce((sum, line) => sum + line.sets * line.reps, 0);
        const highestLoad = Math.max(...parsed.map(line => line.load));
        const weightedLoadSum = parsed.reduce(
          (sum, line) => sum + line.load * line.sets * line.reps,
          0
        );
        const avgLoad = totalReps > 0 ? weightedLoadSum / totalReps : null;

        await supabase
          .from('planned_exercises')
          .update({
            prescription_raw: prescription,
            notes: notes.trim() || null,
            unit: unit,
            summary_total_sets: totalSets,
            summary_total_reps: totalReps,
            summary_highest_load: highestLoad,
            summary_avg_load: avgLoad,
          })
          .eq('id', plannedEx.id);
      } else if (parsedText.length > 0 && isTextBased) {
        const totalSets = parsedText.reduce((sum, line) => sum + line.sets, 0);
        const totalReps = parsedText.reduce((sum, line) => sum + line.sets * line.reps, 0);

        await supabase
          .from('planned_exercises')
          .update({
            prescription_raw: prescription,
            notes: notes.trim() || null,
            unit: unit,
            summary_total_sets: totalSets,
            summary_total_reps: totalReps,
            summary_highest_load: null,
            summary_avg_load: null,
          })
          .eq('id', plannedEx.id);
      } else {
        await supabase
          .from('planned_exercises')
          .update({
            prescription_raw: prescription,
            notes: notes.trim() || null,
            unit: unit,
            summary_total_sets: 0,
            summary_total_reps: 0,
            summary_highest_load: null,
            summary_avg_load: null,
          })
          .eq('id', plannedEx.id);
      }

      await onSave();
      onClose();
    } catch (err) {
      console.error('Failed to save prescription:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const unitSymbol = getUnitSymbol(unit);
  const isFreeText = unit === 'free_text';
  const isRPE = unit === 'rpe';
  const isOtherUnit = unit === 'other';
  const isTextBased = isFreeText || isRPE;
  const isFreeTextExercise = plannedEx.exercise.exercise_code === 'TEXT';

  if (isFreeTextExercise) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Free Text / Notes</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Text / Notes
              </label>
              <textarea
                ref={inputRef as any}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter any text or notes here..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[200px] resize-y"
                autoFocus
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={async () => {
                  setIsSaving(true);
                  try {
                    await supabase
                      .from('planned_exercises')
                      .update({
                        notes: notes.trim() || null,
                      })
                      .eq('id', plannedEx.id);

                    await onSave();
                    onClose();
                  } catch (err) {
                    console.error('Failed to save notes:', err);
                  } finally {
                    setIsSaving(false);
                  }
                }}
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 font-medium"
              >
                <Check size={18} />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={onClose}
                disabled={isSaving}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{plannedEx.exercise.name}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {plannedEx.exercise.category} • {unitSymbol || plannedEx.unit}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {macroTarget && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">Macro Targets</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {macroTarget.target_reps !== null && (
                  <div>
                    <span className="text-gray-600">Target Reps:</span>
                    <span className="ml-2 font-semibold text-gray-900">{macroTarget.target_reps}</span>
                  </div>
                )}
                {macroTarget.target_ave !== null && (
                  <div>
                    <span className="text-gray-600">Avg:</span>
                    <span className="ml-2 font-semibold text-gray-900">{macroTarget.target_ave}kg</span>
                  </div>
                )}
                {macroTarget.target_hi !== null && (
                  <div>
                    <span className="text-gray-600">High:</span>
                    <span className="ml-2 font-semibold text-gray-900">{macroTarget.target_hi}kg</span>
                  </div>
                )}
                {macroTarget.target_rhi !== null && (
                  <div>
                    <span className="text-gray-600">Reps @ High:</span>
                    <span className="ml-2 font-semibold text-gray-900">{macroTarget.target_rhi}</span>
                  </div>
                )}
                {macroTarget.target_shi !== null && (
                  <div>
                    <span className="text-gray-600">Sets @ High:</span>
                    <span className="ml-2 font-semibold text-gray-900">{macroTarget.target_shi}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Unit
            </label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as DefaultUnit)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            >
              {DEFAULT_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                {isTextBased
                  ? 'Prescription (Text x Reps x Sets)'
                  : isOtherUnit
                  ? 'Prescription (Free Text)'
                  : 'Prescription (Weight x Reps x Sets)'}
              </label>
              {!isTextBased && !isOtherUnit && (
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setInputMode('text')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                      inputMode === 'text'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Type size={14} />
                    Text
                  </button>
                  <button
                    onClick={() => setInputMode('grid')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                      inputMode === 'grid'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Grid3x3 size={14} />
                    Grid
                  </button>
                </div>
              )}
            </div>
            {isTextBased ? (
              <div>
                <input
                  ref={inputRef}
                  type="text"
                  value={prescription}
                  onChange={(e) => setPrescription(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isRPE ? "e.g., 8 x 5 x 3, 9 x 3 x 2" : "e.g., Heavy x 5 x 3, Moderate x 3 x 3, 80-90% x 3 x 2"}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Format: "load description x reps x sets" (sets = 1 if omitted). Separate multiple sets with commas.
                </p>
              </div>
            ) : isOtherUnit ? (
              <textarea
                ref={inputRef as any}
                value={prescription}
                onChange={(e) => setPrescription(e.target.value)}
                placeholder="Enter any prescription text (e.g., 3x max reps, AMRAP, timed hold, etc.)"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px] resize-y"
              />
            ) : inputMode === 'grid' ? (
              <GridPrescriptionEditor
                prescriptionRaw={prescription}
                unit={unit}
                gridLoadIncrement={gridSettings.loadIncrement}
                gridClickIncrement={gridSettings.clickIncrement}
                onSave={(newPrescription) => setPrescription(newPrescription)}
                macroTarget={macroTarget}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={prescription}
                onChange={(e) => setPrescription(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`e.g., 300x3 or 20x4x3, 30x4x3`}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            {inputMode === 'text' && !isOtherUnit && (
              <p className="mt-1 text-xs text-gray-500">
                {isOtherUnit
                  ? 'Free text field for any type of prescription'
                  : `Format: LoadxReps or LoadxRepsxSets (e.g., 300x3 = 1 set, 20x4x3 = 3 sets)`}
              </p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Current Sets</h3>
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : setLines.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No sets planned yet</p>
            ) : (
              <div className="space-y-2">
                {setLines.map((line, index) => (
                  <div
                    key={line.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-500 w-6">
                        {index + 1}.
                      </span>
                      <div className="text-sm">
                        <span className="font-semibold text-gray-900">
                          {line.load_value}{unitSymbol}×{line.reps}
                        </span>
                        {line.sets > 1 && (
                          <>
                            <span className="text-gray-500 mx-1">×</span>
                            <span className="text-gray-900">{line.sets}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {line.sets * line.reps} total reps
                    </div>
                  </div>
                ))}
              </div>
            )}

            {otherDayEntries.length > 0 && (
              <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Also planned this week
                </p>
                <div className="space-y-1.5">
                  {otherDayEntries.map(entry => (
                    <div
                      key={entry.dayIndex}
                      className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-100 rounded"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-amber-800 w-12">{entry.dayName.substring(0, 3)}</span>
                        <span className="text-xs text-gray-700">
                          {entry.prescriptionRaw || <span className="italic text-gray-400">No prescription</span>}
                        </span>
                      </div>
                      {(entry.totalSets || entry.totalReps) && (
                        <span className="text-[10px] text-gray-500">
                          S{entry.totalSets || 0} / R{entry.totalReps || 0}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes / Technical Cues
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add coaching notes, technical cues, or instructions..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] resize-y"
            />
            <p className="mt-1 text-xs text-gray-500">
              These notes will be visible when planning and executing this exercise
            </p>
          </div>

          {plannedEx.summary_total_sets !== null && plannedEx.summary_total_sets > 0 && (
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-blue-600 font-medium">Total Sets</p>
                  <p className="text-lg font-bold text-blue-900">
                    {plannedEx.summary_total_sets}
                  </p>
                </div>
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-xs text-green-600 font-medium">Total Reps</p>
                  <p className="text-lg font-bold text-green-900">
                    {plannedEx.summary_total_reps}
                  </p>
                </div>
                {plannedEx.summary_highest_load !== null && (
                  <>
                    <div className="bg-orange-50 p-3 rounded-lg">
                      <p className="text-xs text-orange-600 font-medium">Highest Load</p>
                      <p className="text-lg font-bold text-orange-900">
                        {plannedEx.summary_highest_load.toFixed(0)}{unitSymbol}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-xs text-gray-600 font-medium">Avg Load</p>
                      <p className="text-lg font-bold text-gray-900">
                        {plannedEx.summary_avg_load?.toFixed(0)}{unitSymbol}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            <Check size={16} />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
