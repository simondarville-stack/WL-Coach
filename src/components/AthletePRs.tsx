import { useState, useEffect } from 'react';
import type { Athlete, Exercise } from '../lib/database.types';
import { ArrowLeft, Search } from 'lucide-react';
import { useAthletes } from '../hooks/useAthletes';
import { useExercises } from '../hooks/useExercises';

interface AthletePRsProps {
  athlete: Athlete;
  onClose: () => void;
}

interface ExerciseWithPR extends Exercise {
  pr_value_kg: number | null;
  pr_date: string | null;
  pr_id: string | null;
}

export function AthletePRs({ athlete, onClose }: AthletePRsProps) {
  const { fetchPRs, upsertPR, deletePR } = useAthletes();
  const { categories, fetchCategories } = useExercises();

  const [exercises, setExercises] = useState<ExerciseWithPR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [savingExerciseId, setSavingExerciseId] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchCategories();
    loadExercisesWithPRs();
  }, [athlete.id]);

  const loadExercisesWithPRs = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: exercisesData, error: exercisesError } = await (await import('../lib/supabase')).supabase
        .from('exercises')
        .select('*')
        .order('category')
        .order('name');

      if (exercisesError) throw exercisesError;

      const prsData = await fetchPRs(athlete.id);

      const prsByExercise = new Map<string, { id: string; pr_value_kg: number | null; pr_date: string | null }>();
      prsData.forEach((pr) => {
        prsByExercise.set(pr.exercise_id, { id: pr.id, pr_value_kg: pr.pr_value_kg, pr_date: pr.pr_date });
      });

      const exercisesWithPRs: ExerciseWithPR[] = (exercisesData || []).map((ex) => {
        const pr = prsByExercise.get(ex.id);
        return {
          ...ex,
          pr_value_kg: pr?.pr_value_kg || null,
          pr_date: pr?.pr_date || null,
          pr_id: pr?.id || null,
        };
      });

      setExercises(exercisesWithPRs);

      const initialInputValues: Record<string, string> = {};
      exercisesWithPRs.forEach((ex) => {
        initialInputValues[ex.id] = ex.pr_value_kg?.toString() || '';
      });
      setInputValues(initialInputValues);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exercises');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (exerciseId: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [exerciseId]: value }));
  };

  const handlePRSave = async (exerciseId: string) => {
    const value = inputValues[exerciseId] || '';
    const exercise = exercises.find((ex) => ex.id === exerciseId);
    if (!exercise) return;

    const currentValue = exercise.pr_value_kg?.toString() || '';
    if (value === currentValue) return;

    const numValue = value.trim() === '' ? null : parseFloat(value);
    if (numValue !== null && (isNaN(numValue) || numValue <= 0)) {
      setError('Please enter a valid positive number for PR');
      return;
    }

    setSavingExerciseId(exerciseId);
    setError(null);
    try {
      if (exercise.pr_id) {
        if (numValue === null) {
          await deletePR(exercise.pr_id);
        } else {
          await upsertPR(athlete.id, exerciseId, numValue, exercise.pr_date || new Date().toISOString().split('T')[0], exercise.pr_id);
        }
      } else if (numValue !== null) {
        await upsertPR(athlete.id, exerciseId, numValue, new Date().toISOString().split('T')[0]);
      }

      await loadExercisesWithPRs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save PR');
      setInputValues((prev) => ({ ...prev, [exerciseId]: currentValue }));
    } finally {
      setSavingExerciseId(null);
    }
  };

  const filteredExercises = exercises.filter((ex) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      ex.name.toLowerCase().includes(query) ||
      (ex.exercise_code && ex.exercise_code.toLowerCase().includes(query));
    const matchesCategory = selectedCategory === 'all' || ex.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Back to athletes">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="text-xl font-medium text-gray-800">Personal Records</h2>
            <p className="text-gray-600">{athlete.name}</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
        )}

        <div className="mb-6">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or code..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                selectedCategory === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              All ({exercises.length})
            </button>
            {categories.map((cat) => {
              const count = exercises.filter((ex) => ex.category === cat.name).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                    selectedCategory === cat.name ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {cat.name} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading exercises...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-600 text-xs uppercase tracking-wide">Exercise</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600 text-xs uppercase tracking-wide">Category</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600 text-xs uppercase tracking-wide">Code</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600 text-xs uppercase tracking-wide">PR (kg)</th>
                </tr>
              </thead>
              <tbody>
                {filteredExercises.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-gray-500">
                      {searchQuery || selectedCategory !== 'all'
                        ? 'No exercises match your filters'
                        : 'No exercises yet. Add exercises to the library first.'}
                    </td>
                  </tr>
                ) : (
                  filteredExercises.map((exercise) => (
                    <tr key={exercise.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: exercise.color }} />
                          <span className="font-medium text-gray-900">{exercise.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-sm">{exercise.category}</td>
                      <td className="py-3 px-4 text-gray-600 text-sm">{exercise.exercise_code || '-'}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={inputValues[exercise.id] || ''}
                            onChange={(e) => handleInputChange(exercise.id, e.target.value)}
                            onBlur={() => handlePRSave(exercise.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            placeholder="--"
                            className="w-24 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            step="0.5"
                            min="0"
                            disabled={savingExerciseId === exercise.id}
                          />
                          {savingExerciseId === exercise.id && (
                            <span className="text-xs text-gray-500">Saving...</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Tip:</strong> Enter PR values in kilograms. Changes are saved automatically. Leave blank to remove a PR.
          </p>
        </div>
      </div>
    </div>
  );
}
