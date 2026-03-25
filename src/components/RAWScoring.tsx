import { AlertCircle } from 'lucide-react';

interface RAWScoringProps {
  sleep: number | null;
  physical: number | null;
  mood: number | null;
  nutrition: number | null;
  onChange: (field: 'sleep' | 'physical' | 'mood' | 'nutrition', value: number) => void;
}

export function RAWScoring({ sleep, physical, mood, nutrition, onChange }: RAWScoringProps) {
  const total = (sleep || 0) + (physical || 0) + (mood || 0) + (nutrition || 0);

  const getGuidance = (total: number): string | null => {
    if (total === 0) return null;

    if (total >= 4 && total <= 6) {
      return "Reduce total volume by 25-30%:\n• Reduce session RPE by 2\n• Reduce sets by 1-2 per lift\n• Reduce reps by 2-4 per lift\n• Reduce session length by 25-30%\n• Increase rest by ~30 sec depending on session goal";
    }

    if (total >= 7 && total <= 9) {
      return "Reduce total volume by 15-20%:\n• Reduce session RPE by 1\n• Reduce sets by 1 per lift\n• Reduce reps by 1-2 per lift\n• Reduce session length by 15-20%\n• Increase rest by ~30 sec depending on session goal";
    }

    if (total >= 10 && total <= 12) {
      return "Good to train as hard as you desire within your ability level.";
    }

    return null;
  };

  const guidance = getGuidance(total);

  const renderScoreButton = (
    label: string,
    field: 'sleep' | 'physical' | 'mood' | 'nutrition',
    value: number | null
  ) => {
    return (
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
        <div className="flex gap-2">
          {[1, 2, 3].map((score) => (
            <button
              key={score}
              onClick={() => onChange(field, score)}
              className={`flex-1 px-4 py-3 text-sm font-semibold rounded-lg border-2 transition-colors ${
                value === score
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
              }`}
            >
              {score}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const getGuidanceColor = () => {
    if (total >= 4 && total <= 6) return 'bg-red-50 border-red-200';
    if (total >= 7 && total <= 9) return 'bg-yellow-50 border-yellow-200';
    if (total >= 10 && total <= 12) return 'bg-green-50 border-green-200';
    return 'bg-gray-50 border-gray-200';
  };

  const getGuidanceTextColor = () => {
    if (total >= 4 && total <= 6) return 'text-red-900';
    if (total >= 7 && total <= 9) return 'text-yellow-900';
    if (total >= 10 && total <= 12) return 'text-green-900';
    return 'text-gray-900';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-lg font-semibold text-gray-900">RAW Score</h3>
        <div className="text-sm text-gray-600">
          (Rate each pillar: 1 = Poor, 2 = OK, 3 = Good)
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {renderScoreButton('Sleep', 'sleep', sleep)}
        {renderScoreButton('Physical', 'physical', physical)}
        {renderScoreButton('Mood', 'mood', mood)}
        {renderScoreButton('Nutrition', 'nutrition', nutrition)}
      </div>

      {total > 0 && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
          <span className="text-sm font-medium text-gray-700">Total Score:</span>
          <span className="text-lg font-bold text-gray-900">{total}/12</span>
        </div>
      )}

      {guidance && sleep !== null && physical !== null && mood !== null && nutrition !== null && (
        <div className={`p-4 rounded-lg border-2 ${getGuidanceColor()}`}>
          <div className="flex items-start gap-3">
            <AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${getGuidanceTextColor()}`} />
            <div className="flex-1">
              <h4 className={`font-semibold mb-2 ${getGuidanceTextColor()}`}>
                Training Guidance
              </h4>
              <div className={`text-sm whitespace-pre-line ${getGuidanceTextColor()}`}>
                {guidance}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
