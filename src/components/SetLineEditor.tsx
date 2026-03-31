import { useState, useEffect } from 'react';
import type { PlannedExerciseWithExercise, PlannedSetLine } from '../lib/database.types';
import { getUnitSymbol, getUnitLabel } from '../lib/constants';
import { X, Plus, Trash2 } from 'lucide-react';
import { useWeekPlans } from '../hooks/useWeekPlans';

interface SetLineEditorProps {
  plannedExercise: PlannedExerciseWithExercise;
  onClose: () => void;
  onSave: () => void;
}

export function SetLineEditor({ plannedExercise, onClose, onSave }: SetLineEditorProps) {
  const { fetchSetLines, addSetLine, deleteSetLine, normalizeSetLinePositions, saveSetLinesWithSummary } = useWeekPlans();
  const [setLines, setSetLines] = useState<PlannedSetLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitSymbol = getUnitSymbol(plannedExercise.unit);
  const unitLabel = getUnitLabel(plannedExercise.unit);

  useEffect(() => {
    loadSetLines();
  }, [plannedExercise.id]);

  const loadSetLines = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSetLines(plannedExercise.id);
      setSetLines(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load set lines');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLine = async () => {
    try {
      const newPosition = setLines.length > 0 ? Math.max(...setLines.map(l => l.position)) + 1 : 1;
      const data = await addSetLine(plannedExercise.id, newPosition);
      setSetLines([...setLines, data]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add set line');
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    try {
      await deleteSetLine(lineId);
      const updatedLines = setLines.filter(l => l.id !== lineId);
      setSetLines(updatedLines);
      await normalizeSetLinePositions(updatedLines);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete set line');
    }
  };

  const handleUpdateLine = (lineId: string, field: keyof PlannedSetLine, value: number) => {
    setSetLines(setLines.map(line =>
      line.id === lineId ? { ...line, [field]: value } : line
    ));
  };

  const calculateSummaries = () => {
    if (setLines.length === 0) {
      return { total_sets: 0, total_reps: 0, highest_load: null, avg_load: null };
    }

    const total_sets = setLines.reduce((sum, line) => sum + line.sets, 0);
    const total_reps = setLines.reduce((sum, line) => sum + (line.sets * line.reps), 0);
    const highest_load = Math.max(...setLines.map(line => line.load_value));
    const weighted_load_sum = setLines.reduce(
      (sum, line) => sum + (line.load_value * line.sets * line.reps), 0
    );
    const avg_load = total_reps > 0 ? weighted_load_sum / total_reps : null;

    return { total_sets, total_reps, highest_load, avg_load };
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await saveSetLinesWithSummary(plannedExercise.id, setLines);
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{plannedExercise.exercise.name}</h2>
            <p className="text-sm text-gray-600 mt-1">
              Unit: {unitLabel} {unitSymbol && `(${unitSymbol})`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading set lines...</div>
          ) : (
            <>
              <div className="space-y-3">
                {setLines.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    No sets yet. Click "Add Set Line" to get started.
                  </div>
                ) : (
                  setLines.map((line, index) => (
                    <div
                      key={line.id}
                      className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                        {index + 1}
                      </div>

                      <div className="flex-1 grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Sets</label>
                          <input
                            type="number"
                            min="1"
                            value={line.sets}
                            onChange={(e) => handleUpdateLine(line.id, 'sets', parseInt(e.target.value) || 1)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Reps</label>
                          <input
                            type="number"
                            min="1"
                            value={line.reps}
                            onChange={(e) => handleUpdateLine(line.id, 'reps', parseInt(e.target.value) || 1)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Load {unitSymbol && `(${unitSymbol})`}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={line.load_value}
                            onChange={(e) => handleUpdateLine(line.id, 'load_value', parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteLine(line.id)}
                        className="flex-shrink-0 p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Delete line"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={handleAddLine}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Plus size={20} />
                Add Set Line
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-600">
            {setLines.length > 0 && (
              <div className="space-y-1">
                <p>
                  <span className="font-medium">Preview:</span>{' '}
                  {calculateSummaries().total_sets} sets, {calculateSummaries().total_reps} reps
                </p>
                {calculateSummaries().highest_load !== null && (
                  <p className="text-xs">
                    High: {calculateSummaries().highest_load?.toFixed(1)} {unitSymbol} |
                    Avg: {calculateSummaries().avg_load?.toFixed(1)} {unitSymbol}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
