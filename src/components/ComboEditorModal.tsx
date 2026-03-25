import { useState, useRef, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import type { PlannedComboWithDetails, DefaultUnit } from '../lib/database.types';
import { supabase } from '../lib/supabase';

interface ComboEditorModalProps {
  combo: PlannedComboWithDetails;
  onClose: () => void;
  onSave: () => Promise<void>;
}

export function ComboEditorModal({ combo, onClose, onSave }: ComboEditorModalProps) {
  const formatInitialPrescription = () => {
    if (combo.set_lines.length > 0) {
      return combo.set_lines.map(line =>
        `${line.load_value} x ${line.reps_tuple_text}${line.sets > 1 ? ` x ${line.sets}` : ''}`
      ).join(', ');
    }
    return `${combo.shared_load_value} x ${combo.reps_tuple_text}${combo.sets > 1 ? ` x ${combo.sets}` : ''}`;
  };

  const [prescription, setPrescription] = useState(formatInitialPrescription());
  const [notes, setNotes] = useState(combo.notes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  function formatUnit(unit: DefaultUnit): string {
    if (unit === 'absolute_kg') return 'kg';
    if (unit === 'percentage') return '%';
    if (unit === 'rpe') return 'RPE';
    return '';
  }

  function parsePrescription(input: string): { loadValue: number; repsTuple: string; sets: number }[] | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const segments = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    const result: { loadValue: number; repsTuple: string; sets: number }[] = [];
    const numParts = combo.items.length;

    for (const segment of segments) {
      const matchWithSets = segment.match(/^([\d.]+)\s*[xX×]\s*([\d+\s]+)\s*[xX×]\s*(\d+)$/);
      const matchWithoutSets = segment.match(/^([\d.]+)\s*[xX×]\s*([\d+\s]+)$/);

      let loadValue: number;
      let repsTuple: string;
      let sets: number;

      if (matchWithSets) {
        loadValue = parseFloat(matchWithSets[1]);
        repsTuple = matchWithSets[2].replace(/\s/g, '');
        sets = parseInt(matchWithSets[3]);
      } else if (matchWithoutSets) {
        loadValue = parseFloat(matchWithoutSets[1]);
        repsTuple = matchWithoutSets[2].replace(/\s/g, '');
        sets = 1;
      } else {
        return null;
      }

      const parts = repsTuple.split('+').map(p => p.trim()).filter(Boolean);

      if (numParts > 1 && parts.length === 1) {
        const expandedTuple = Array(numParts).fill(parts[0]).join('+');
        result.push({ loadValue, repsTuple: expandedTuple, sets });
        continue;
      }

      if (parts.length !== numParts) {
        return null;
      }

      if (!parts.every(p => /^\d+$/.test(p))) {
        return null;
      }

      if (sets < 1 || isNaN(loadValue)) {
        return null;
      }

      result.push({ loadValue, repsTuple, sets });
    }

    return result.length > 0 ? result : null;
  }

  const handleSave = async () => {
    setError(null);

    const parsed = parsePrescription(prescription);
    if (!parsed) {
      const exampleReps = combo.items.length > 1 ? combo.items.map(() => '2').join('+') : '3';
      setError(`Invalid format. Use: load x reps x sets — e.g. "80 x ${exampleReps} x 3" or "80 x ${exampleReps}" (sets=1 implied). Separate multiple lines with commas.`);
      return;
    }

    try {
      setIsSaving(true);

      const { data: existingSetLines } = await supabase
        .from('planned_combo_set_lines')
        .select('*')
        .eq('planned_combo_id', combo.id)
        .order('position');

      const perItemSnapshots: { plannedExerciseId: string; setLines: any[]; summary: any }[] = [];
      for (const item of combo.items) {
        const { data: itemSetLines } = await supabase
          .from('planned_set_lines')
          .select('*')
          .eq('planned_exercise_id', item.planned_exercise_id)
          .order('position');
        const { data: itemSummary } = await supabase
          .from('planned_exercises')
          .select('summary_total_sets, summary_total_reps, summary_avg_load, summary_highest_load')
          .eq('id', item.planned_exercise_id)
          .maybeSingle();
        perItemSnapshots.push({ plannedExerciseId: item.planned_exercise_id, setLines: itemSetLines || [], summary: itemSummary });
      }

      const restore = async () => {
        await supabase.from('planned_combo_set_lines').delete().eq('planned_combo_id', combo.id);
        if (existingSetLines && existingSetLines.length > 0) {
          await supabase.from('planned_combo_set_lines').insert(existingSetLines.map(({ id: _id, ...rest }: any) => rest));
        }
        for (const snap of perItemSnapshots) {
          await supabase.from('planned_set_lines').delete().eq('planned_exercise_id', snap.plannedExerciseId);
          if (snap.setLines.length > 0) {
            await supabase.from('planned_set_lines').insert(snap.setLines.map(({ id: _id, ...rest }: any) => rest));
          }
          if (snap.summary) {
            await supabase.from('planned_exercises').update(snap.summary).eq('id', snap.plannedExerciseId);
          }
        }
      };

      try {
        const { error: delSetLinesError } = await supabase
          .from('planned_combo_set_lines')
          .delete()
          .eq('planned_combo_id', combo.id);
        if (delSetLinesError) throw delSetLinesError;

        for (let lineIdx = 0; lineIdx < parsed.length; lineIdx++) {
          const line = parsed[lineIdx];
          const { error: setLineError } = await supabase
            .from('planned_combo_set_lines')
            .insert({
              planned_combo_id: combo.id,
              position: lineIdx + 1,
              load_value: line.loadValue,
              sets: line.sets,
              reps_tuple_text: line.repsTuple
            });
          if (setLineError) throw setLineError;
        }

        for (let i = 0; i < combo.items.length; i++) {
          const item = combo.items[i];
          const plannedExerciseId = item.planned_exercise_id;

          const { error: delLinesError } = await supabase
            .from('planned_set_lines')
            .delete()
            .eq('planned_exercise_id', plannedExerciseId);
          if (delLinesError) throw delLinesError;

          let totalSets = 0;
          let totalReps = 0;
          let totalLoadTimesReps = 0;
          let highestLoad = 0;

          for (let lineIdx = 0; lineIdx < parsed.length; lineIdx++) {
            const line = parsed[lineIdx];
            const repsParts = line.repsTuple.split('+').map(p => parseInt(p.trim()));
            const repsForPart = repsParts[i];

            const { error: lineError } = await supabase
              .from('planned_set_lines')
              .insert({
                planned_exercise_id: plannedExerciseId,
                sets: line.sets,
                reps: repsForPart,
                load_value: line.loadValue,
                position: lineIdx + 1
              });
            if (lineError) throw lineError;

            totalSets += line.sets;
            totalReps += line.sets * repsForPart;
            totalLoadTimesReps += line.loadValue * (line.sets * repsForPart);
            highestLoad = Math.max(highestLoad, line.loadValue);
          }

          const avgLoad = totalReps > 0 ? totalLoadTimesReps / totalReps : 0;

          const { error: summaryError } = await supabase
            .from('planned_exercises')
            .update({
              summary_total_sets: totalSets,
              summary_total_reps: totalReps,
              summary_avg_load: avgLoad,
              summary_highest_load: highestLoad,
              updated_at: new Date().toISOString()
            })
            .eq('id', plannedExerciseId);
          if (summaryError) throw summaryError;
        }

        const { error: comboError } = await supabase
          .from('planned_combos')
          .update({
            notes: notes.trim() || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', combo.id);
        if (comboError) throw comboError;
      } catch (innerErr) {
        await restore();
        throw innerErr;
      }

      await onSave();
      onClose();
    } catch (err) {
      console.error('Error saving combo:', err);
      setError(err instanceof Error ? err.message : 'Failed to save combo');
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

  const unitSymbol = formatUnit(combo.unit);

  const calculateTotals = () => {
    const parsed = parsePrescription(prescription);
    if (!parsed) return { totalSets: 0, totalReps: 0 };

    let totalSets = 0;
    let totalReps = 0;

    for (const line of parsed) {
      const repsParts = line.repsTuple.split('+').map(p => parseInt(p.trim()));
      const repsPerSet = repsParts.reduce((sum, r) => sum + r, 0);
      totalSets += line.sets;
      totalReps += line.sets * repsPerSet;
    }

    return { totalSets, totalReps };
  };

  const { totalSets, totalReps } = calculateTotals();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {combo.combo_name || combo.template?.name || combo.items.map(i => i.exercise.name).join(' + ')}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Combined Exercise • {unitSymbol}
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
          <div className="bg-blue-50 p-3 rounded-lg">
            <p className="text-xs font-medium text-blue-700 mb-1">Exercises</p>
            <div className="text-sm text-blue-900">
              {combo.items.map((item, idx) => (
                <span key={item.id}>
                  {idx > 0 && ' + '}
                  {item.exercise.name}
                </span>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prescription
            </label>
            <textarea
              ref={inputRef}
              value={prescription}
              onChange={(e) => setPrescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`e.g., 80 x ${combo.items.map(() => '2').join('+')} x 3, 85 x ${combo.items.map(() => '2').join('+')} x 2`}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] resize-y"
            />
            <p className="mt-1 text-xs text-gray-500">
              Format: load ({unitSymbol}) × reps × sets, comma-separated
              <br />
              Example: 80 x {combo.items.map(() => '2').join('+')} x 3, 85 x {combo.items.map(() => '2').join('+')} x 2
              <br />
              Sets can be omitted if 1 (e.g., 80 x {combo.items.map(() => '2').join('+')})
            </p>
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
              These notes will be visible when planning and executing this combo
            </p>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Summary</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="text-xs text-blue-600 font-medium">Total Sets</p>
                <p className="text-lg font-bold text-blue-900">{totalSets}</p>
              </div>
              <div className="bg-green-50 p-3 rounded-lg">
                <p className="text-xs text-green-600 font-medium">Total Reps</p>
                <p className="text-lg font-bold text-green-900">{totalReps}</p>
              </div>
            </div>
          </div>
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
