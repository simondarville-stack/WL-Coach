import { useState, useRef, useEffect } from 'react';
import { X, Plus, GripVertical, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import type { Exercise, DefaultUnit } from '../lib/database.types';

interface ComboCreatorModalProps {
  allExercises: Exercise[];
  onClose: () => void;
  onSave: (data: {
    exercises: { exercise: Exercise; position: number }[];
    unit: DefaultUnit;
    comboName: string;
    color: string;
  }) => Promise<void>;
}

const PRESET_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#6366F1', // indigo
];

export function ComboCreatorModal({ allExercises, onClose, onSave }: ComboCreatorModalProps) {
  const [selectedExercises, setSelectedExercises] = useState<{ exercise: Exercise; position: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [unit, setUnit] = useState<DefaultUnit>('absolute_kg');
  const [comboName, setComboName] = useState('');
  const [color, setColor] = useState('#3B82F6');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [searchQuery]);

  const searchResults = searchQuery
    ? allExercises.filter(ex =>
        ex.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ex.exercise_code && ex.exercise_code.toLowerCase().includes(searchQuery.toLowerCase()))
      ).slice(0, 15)
    : [];

  const addExercise = (exercise: Exercise) => {
    setSelectedExercises(prev => [
      ...prev,
      { exercise, position: prev.length + 1 }
    ]);
    setSearchQuery('');
    searchRef.current?.focus();
  };

  const removeExercise = (index: number) => {
    setSelectedExercises(prev => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((item, i) => ({ ...item, position: i + 1 }));
    });
  };

  const moveExercise = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= selectedExercises.length) return;
    setSelectedExercises(prev => {
      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next.map((item, i) => ({ ...item, position: i + 1 }));
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSearchIndex(prev => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSearchIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && searchResults.length > 0) {
      e.preventDefault();
      addExercise(searchResults[selectedSearchIndex]);
    }
  };

  const handleSave = async () => {
    if (selectedExercises.length < 2) return;
    setIsSaving(true);
    try {
      await onSave({
        exercises: selectedExercises,
        unit,
        comboName: comboName.trim(),
        color,
      });
      onClose();
    } catch (err) {
    } finally {
      setIsSaving(false);
    }
  };

  const autoName = selectedExercises.map(e => e.exercise.name).join(' + ');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Create Combo</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Combo Name (optional)</label>
            <input
              type="text"
              value={comboName}
              onChange={(e) => setComboName(e.target.value)}
              placeholder={autoName || 'Auto-generated from exercises'}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as DefaultUnit)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="absolute_kg">kg</option>
                <option value="percentage">%</option>
                <option value="rpe">RPE</option>
                <option value="free_text">Free Text</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ribbon Color</label>
              <div className="flex gap-1.5">
                {PRESET_COLORS.map((presetColor) => (
                  <button
                    key={presetColor}
                    type="button"
                    onClick={() => setColor(presetColor)}
                    className={`w-7 h-7 rounded border-2 transition-all ${
                      color === presetColor ? 'border-gray-900 scale-110' : 'border-gray-300 hover:border-gray-400'
                    }`}
                    style={{ backgroundColor: presetColor }}
                    title={presetColor}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Exercises ({selectedExercises.length} selected)
            </label>

            {selectedExercises.length > 0 && (
              <div className="space-y-1 mb-3">
                {selectedExercises.map((item, index) => (
                  <div key={`${item.exercise.id}-${index}`} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                    <GripVertical size={14} className="text-gray-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-gray-500 w-5">{index + 1}.</span>
                    <div
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: item.exercise.color }}
                    />
                    <span className="text-sm text-gray-900 flex-1 truncate">{item.exercise.name}</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => moveExercise(index, -1)}
                        disabled={index === 0}
                        className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => moveExercise(index, 1)}
                        disabled={index === selectedExercises.length - 1}
                        className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        onClick={() => removeExercise(index)}
                        className="p-0.5 text-red-400 hover:text-red-600 ml-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search exercises to add..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map((ex, index) => (
                    <button
                      key={ex.id}
                      onClick={() => addExercise(ex)}
                      className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                        index === selectedSearchIndex ? 'bg-blue-100 text-blue-900' : 'hover:bg-blue-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: ex.color }} />
                        <span className="font-medium text-gray-900">{ex.name}</span>
                        {ex.exercise_code && (
                          <span className="text-xs text-gray-500 ml-auto">{ex.exercise_code}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {searchQuery && searchResults.length === 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg px-3 py-2 text-sm text-gray-500">
                  No matches
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-5 py-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || selectedExercises.length < 2}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            <Plus size={16} />
            {isSaving ? 'Creating...' : 'Create Combo'}
          </button>
        </div>
      </div>
    </div>
  );
}
