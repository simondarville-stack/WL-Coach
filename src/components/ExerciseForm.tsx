import { useState, useEffect } from 'react';
import type { Exercise, DefaultUnit } from '../lib/database.types';
import { DEFAULT_UNITS } from '../lib/constants';
import { useExercises } from '../hooks/useExercises';

interface ExerciseFormProps {
  editingExercise: Exercise | null;
  onSave: (exercise: Partial<Exercise>) => Promise<void>;
  onCancelEdit: () => void;
  allExercises?: Exercise[];
}

const PRESET_COLORS = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Green', value: '#10B981' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Orange', value: '#F59E0B' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Teal', value: '#14B8A6' },
  { name: 'Indigo', value: '#6366F1' },
];

export function ExerciseForm({ editingExercise, onSave, onCancelEdit, allExercises = [] }: ExerciseFormProps) {
  const { categories, fetchCategories } = useExercises();

  const [name, setName] = useState('');
  const [exerciseCode, setExerciseCode] = useState('');
  const [category, setCategory] = useState<string>('');
  const [isCompetitionLift, setIsCompetitionLift] = useState(false);
  const [defaultUnit, setDefaultUnit] = useState<DefaultUnit>('percentage');
  const [color, setColor] = useState('#3B82F6');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [countsTowardsTotals, setCountsTowardsTotals] = useState(true);
  const [useStackedNotation, setUseStackedNotation] = useState(false);
  const [trackPr, setTrackPr] = useState(true);
  const [prReferenceId, setPrReferenceId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (editingExercise) {
      setName(editingExercise.name);
      setExerciseCode(editingExercise.exercise_code || '');
      setCategory(editingExercise.category);
      setIsCompetitionLift(editingExercise.is_competition_lift);
      setDefaultUnit(editingExercise.default_unit);
      setColor(editingExercise.color || '#3B82F6');
      setNotes(editingExercise.notes || '');
      setLink(editingExercise.link || '');
      setCountsTowardsTotals(editingExercise.counts_towards_totals);
      setUseStackedNotation(editingExercise.use_stacked_notation || false);
      setTrackPr(editingExercise.track_pr ?? true);
      setPrReferenceId(editingExercise.pr_reference_exercise_id ?? null);
    } else {
      resetForm();
    }
  }, [editingExercise, categories]);

  const resetForm = () => {
    setName('');
    setExerciseCode('');
    setCategory(categories.length > 0 ? categories[0].name : '');
    setIsCompetitionLift(false);
    setDefaultUnit('percentage');
    setColor('#3B82F6');
    setNotes('');
    setLink('');
    setCountsTowardsTotals(true);
    setUseStackedNotation(false);
    setTrackPr(true);
    setPrReferenceId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        exercise_code: exerciseCode.trim() || null,
        category,
        is_competition_lift: isCompetitionLift,
        default_unit: defaultUnit,
        color,
        counts_towards_totals: countsTowardsTotals,
        use_stacked_notation: useStackedNotation,
        track_pr: trackPr,
        pr_reference_exercise_id: prReferenceId,
        notes: notes.trim() || null,
        link: link.trim() || null,
      });
      if (!editingExercise) {
        resetForm();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onCancelEdit();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-2xl font-medium text-gray-800">
        {editingExercise ? 'Edit Exercise' : 'Add New Exercise'}
      </h2>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Name *
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Snatch, Back Squat"
          required
        />
      </div>

      <div>
        <label htmlFor="exerciseCode" className="block text-sm font-medium text-gray-700 mb-1">
          Code (Optional)
        </label>
        <input
          type="text"
          id="exerciseCode"
          value={exerciseCode}
          onChange={(e) => setExerciseCode(e.target.value.toUpperCase())}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., SN, CJ, BS"
          maxLength={10}
        />
        <p className="mt-1 text-xs text-gray-500">
          Short code for quick search (e.g., SN for Snatch, BS for Back Squat)
        </p>
      </div>

      <div>
        <label htmlFor="link" className="block text-sm font-medium text-gray-700 mb-1">
          Video Link (Optional)
        </label>
        <input
          type="url"
          id="link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="https://youtube.com/watch?v=..."
        />
        <p className="mt-1 text-xs text-gray-500">
          Link to a demonstration video (YouTube, Vimeo, etc.)
        </p>
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
          Category *
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        >
          {categories.map((cat) => (
            <option key={cat.id} value={cat.name}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={isCompetitionLift}
            onChange={(e) => setIsCompetitionLift(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Competition Lift</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={countsTowardsTotals}
            onChange={(e) => setCountsTowardsTotals(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Counts Towards Totals</span>
        </label>
        <p className="text-xs text-gray-500 ml-6">
          When enabled, this exercise will be included in weekly set, rep, and tonnage summaries
        </p>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={useStackedNotation}
            onChange={(e) => setUseStackedNotation(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Use Stacked Notation</span>
        </label>
        <p className="text-xs text-gray-500 ml-6">
          Display prescriptions in stacked blocks (load over reps with sets on the right) instead of linear format
        </p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={trackPr}
            onChange={(e) => setTrackPr(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Track PR</span>
        </label>
        <p className="text-xs text-gray-500 ml-6">
          When enabled, PRs for this exercise are tracked and used for percentage-based calculations
        </p>
        {(() => {
          const eligible = allExercises.filter(e =>
            e.track_pr &&
            e.id !== editingExercise?.id &&
            e.category !== '— System'
          );
          const wouldCycle = (id: string) => {
            const candidate = allExercises.find(e => e.id === id);
            return candidate?.pr_reference_exercise_id === editingExercise?.id;
          };
          if (eligible.length === 0) return null;
          return (
            <div className="ml-6">
              <label htmlFor="prReference" className="block text-xs font-medium text-gray-600 mb-1">
                PR Reference Exercise (optional)
              </label>
              <select
                id="prReference"
                value={prReferenceId ?? ''}
                onChange={(e) => setPrReferenceId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— None (use own PR) —</option>
                {eligible.map(e => (
                  <option key={e.id} value={e.id} disabled={wouldCycle(e.id)}>
                    {e.name}{e.exercise_code ? ` (${e.exercise_code})` : ''}{wouldCycle(e.id) ? ' — would create cycle' : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Percentage prescriptions will resolve against this exercise's PR instead of its own
              </p>
            </div>
          );
        })()}
      </div>

      <div>
        <label htmlFor="defaultUnit" className="block text-sm font-medium text-gray-700 mb-1">
          Default Unit *
        </label>
        <select
          id="defaultUnit"
          value={defaultUnit}
          onChange={(e) => setDefaultUnit(e.target.value as DefaultUnit)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        >
          {DEFAULT_UNITS.map((unit) => (
            <option key={unit.value} value={unit.value}>
              {unit.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Color *
        </label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setColor(preset.value)}
              className={`w-10 h-10 rounded-md border-2 transition-all ${
                color === preset.value ? 'border-gray-900 scale-110' : 'border-gray-300'
              }`}
              style={{ backgroundColor: preset.value }}
              title={preset.name}
            />
          ))}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded-md border-2 border-gray-300 cursor-pointer"
              title="Custom color"
            />
            <span className="text-xs text-gray-500">Custom</span>
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
          placeholder="Additional notes about this exercise..."
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting || !name.trim()}
          className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Saving...' : editingExercise ? 'Update Exercise' : 'Add Exercise'}
        </button>
        {editingExercise && (
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
