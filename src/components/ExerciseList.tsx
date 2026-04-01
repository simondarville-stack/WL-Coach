import { useState, useEffect } from 'react';
import { Edit2, Trash2, Search, ExternalLink } from 'lucide-react';
import type { Exercise } from '../lib/database.types';
import { DEFAULT_UNITS } from '../lib/constants';
import { useExercises } from '../hooks/useExercises';

interface ExerciseListProps {
  exercises: Exercise[];
  onEdit: (exercise: Exercise) => void;
  onDelete: (id: string) => void;
}

export function ExerciseList({ exercises, onEdit, onDelete }: ExerciseListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const { categories, fetchCategories } = useExercises();

  useEffect(() => {
    fetchCategories();
  }, []);

  const getUnitLabel = (unitValue: string) => {
    const unit = DEFAULT_UNITS.find((u) => u.value === unitValue);
    return unit?.label || unitValue;
  };

  const handleDelete = (exercise: Exercise) => {
    if (window.confirm(`Are you sure you want to delete "${exercise.name}"?`)) {
      onDelete(exercise.id);
    }
  };

  const filteredExercises = exercises.filter((ex) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = ex.name.toLowerCase().includes(query) ||
                         (ex.exercise_code && ex.exercise_code.toLowerCase().includes(query));
    const matchesCategory = selectedCategory === 'all' || ex.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (exercises.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">No exercises yet. Add your first exercise to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Exercise Library</h2>

        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or code..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
              selectedCategory === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All ({exercises.length})
          </button>
          {categories.map((cat) => {
            const count = exercises.filter(ex => ex.category === cat.name).length;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                  selectedCategory === cat.name
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {cat.name} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {filteredExercises.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">
            {searchQuery || selectedCategory !== 'all'
              ? 'No exercises match your filters'
              : 'No exercises yet. Add your first exercise to get started.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredExercises.map((exercise) => (
        <div
          key={exercise.id}
          className="bg-white border-l-4 border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
          style={{ borderLeftColor: exercise.color }}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-4 h-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: exercise.color }}
                />
                <h3 className="text-lg font-semibold text-gray-900">{exercise.name}</h3>
                {exercise.exercise_code && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                    {exercise.exercise_code}
                  </span>
                )}
                {exercise.is_competition_lift && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded">
                    Competition
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                <div>
                  <span className="font-medium">Category:</span> {exercise.category}
                </div>
                <div>
                  <span className="font-medium">Default Unit:</span> {getUnitLabel(exercise.default_unit)}
                </div>
              </div>
              {exercise.notes && (
                <p className="mt-2 text-sm text-gray-600 italic">{exercise.notes}</p>
              )}
              {exercise.link && (
                <a
                  href={exercise.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  <ExternalLink size={14} />
                  View Demonstration
                </a>
              )}
            </div>
            <div className="flex gap-2 ml-4">
              <button
                onClick={() => onEdit(exercise)}
                className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                title="Edit exercise"
              >
                <Edit2 size={18} />
              </button>
              <button
                onClick={() => handleDelete(exercise)}
                className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Delete exercise"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        </div>
      ))}
        </div>
      )}
    </div>
  );
}
