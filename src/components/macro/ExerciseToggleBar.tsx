import type { MacroTrackedExerciseWithExercise } from '../../lib/database.types';

interface ExerciseToggleBarProps {
  exercises: MacroTrackedExerciseWithExercise[];
  visible: Set<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
}

export function ExerciseToggleBar({ exercises, visible, onToggle, onShowAll }: ExerciseToggleBarProps) {
  if (exercises.length === 0) return null;

  const hasHidden = exercises.some(te => !visible.has(te.id));

  return (
    <div className="flex flex-wrap gap-1.5">
      {exercises.map(te => {
        const isVisible = visible.has(te.id);
        return (
          <button
            key={te.id}
            onClick={() => onToggle(te.id)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
              isVisible
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-gray-50 text-gray-400 border-gray-200 line-through'
            }`}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
              style={{ backgroundColor: isVisible ? te.exercise.color : '#9ca3af' }}
            />
            {te.exercise.exercise_code || te.exercise.name}
          </button>
        );
      })}
      {hasHidden && (
        <button
          onClick={onShowAll}
          className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-600"
        >
          Show all
        </button>
      )}
    </div>
  );
}
