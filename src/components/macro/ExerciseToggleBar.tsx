import type { MacroTrackedExerciseWithExercise } from '../../lib/database.types';
import { getExerciseCategoryShade } from '../../lib/colorUtils';

export type GeneralMetricKey = 'k' | 'tonnage' | 'avg';

export const GENERAL_METRIC_LABELS: Record<GeneralMetricKey, string> = {
  k: 'Σreps',
  tonnage: 'Tonnage',
  avg: 'Avg int.',
};

// Neutral colors for general metric chips
const GENERAL_METRIC_COLORS: Record<GeneralMetricKey, string> = {
  k: '#6366f1',
  tonnage: '#f59e0b',
  avg: '#10b981',
};

interface ExerciseToggleBarProps {
  exercises: MacroTrackedExerciseWithExercise[];
  visible: Set<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
  generalMetrics?: GeneralMetricKey[];
  visibleMetrics?: Set<GeneralMetricKey>;
  onToggleMetric?: (metric: GeneralMetricKey) => void;
}

export function ExerciseToggleBar({
  exercises,
  visible,
  onToggle,
  onShowAll,
  generalMetrics,
  visibleMetrics,
  onToggleMetric,
}: ExerciseToggleBarProps) {
  if (exercises.length === 0 && !generalMetrics?.length) return null;

  const hasHidden = exercises.some(te => !visible.has(te.id));

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {/* General metric toggles — appear first (left side, matches table column order) */}
      {generalMetrics && visibleMetrics && onToggleMetric && generalMetrics.map(metric => {
        const isVisible = visibleMetrics.has(metric);
        const color = GENERAL_METRIC_COLORS[metric];
        return (
          <button
            key={metric}
            onClick={() => onToggleMetric(metric)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
              isVisible
                ? 'border-current'
                : 'bg-gray-50 text-gray-400 border-gray-200 line-through'
            }`}
            style={isVisible ? { backgroundColor: color + '18', color, borderColor: color + '60' } : undefined}
          >
            {GENERAL_METRIC_LABELS[metric]}
          </button>
        );
      })}

      {/* Divider between general metrics and exercises */}
      {generalMetrics?.length && exercises.length > 0 && (
        <span className="text-gray-200 text-[10px] select-none">|</span>
      )}

      {/* Exercise toggles */}
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
              style={{ backgroundColor: isVisible ? getExerciseCategoryShade(te.exercise.id, te.exercise.color, te.exercise.category, trackedExercises) : '#9ca3af' }}
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
