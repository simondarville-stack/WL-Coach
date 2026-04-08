import { useState } from 'react';

interface PlanningPRExercise {
  id: string;
  name: string;
  exerciseCode: string | null;
  currentPR: number | null;         // from athlete_prs (read-only)
  prReferenceId: string | null;     // derives from another exercise
}

interface PlanningPRPanelProps {
  exercises: PlanningPRExercise[];
  planningPRs: Map<string, number>;   // editable values
  onUpdatePR: (exerciseId: string, value: number) => void;
  maxPercentages: Map<string, number>; // highest % in template per exercise
}

export function PlanningPRPanel({
  exercises,
  planningPRs,
  onUpdatePR,
  maxPercentages,
}: PlanningPRPanelProps) {
  // Local string values for editing (so user can type decimals)
  const [localValues, setLocalValues] = useState<Map<string, string>>(new Map());

  // Separate direct and derived exercises
  const directExercises = exercises.filter(ex => !ex.prReferenceId);
  const derivedExercises = exercises.filter(ex => ex.prReferenceId);

  const getDisplayName = (ex: PlanningPRExercise) =>
    ex.exerciseCode ? `${ex.exerciseCode} — ${ex.name}` : ex.name;

  const getParentExercise = (refId: string) =>
    exercises.find(ex => ex.id === refId);

  const getMaxInPlan = (exerciseId: string, refId?: string | null): number | null => {
    const resolvedId = refId ?? exerciseId;
    const pr = planningPRs.get(resolvedId);
    const maxPct = maxPercentages.get(resolvedId) ?? maxPercentages.get(exerciseId);
    if (!pr || !maxPct) return null;
    return Math.round(pr * maxPct / 100);
  };

  const getLocalOrPlanned = (exerciseId: string): string => {
    if (localValues.has(exerciseId)) return localValues.get(exerciseId)!;
    const val = planningPRs.get(exerciseId);
    return val != null ? String(val) : '';
  };

  const handleBlur = (exerciseId: string) => {
    const local = localValues.get(exerciseId);
    if (local != null) {
      const num = parseFloat(local);
      if (!isNaN(num) && num > 0) {
        onUpdatePR(exerciseId, num);
      }
      setLocalValues(prev => {
        const next = new Map(prev);
        next.delete(exerciseId);
        return next;
      });
    }
  };

  const handleChange = (exerciseId: string, value: string) => {
    setLocalValues(prev => new Map(prev).set(exerciseId, value));
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      onUpdatePR(exerciseId, num);
    }
  };

  if (directExercises.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">
        Reference PRs for resolution
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        These values are used to calculate kg from %. Defaults come from the athlete's PR table.
        Edit to plan from a target PR (goal) instead.
      </p>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Exercise</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Current PR</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Planning PR</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Max in plan</th>
            </tr>
          </thead>
          <tbody>
            {directExercises.map(ex => {
              const localVal = getLocalOrPlanned(ex.id);
              const hasValue = localVal !== '' && !isNaN(parseFloat(localVal));
              const isMissing = !hasValue;
              const maxInPlan = getMaxInPlan(ex.id);
              const maxPct = maxPercentages.get(ex.id);

              return (
                <tr key={ex.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-800 font-medium">
                    {getDisplayName(ex)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">
                    {ex.currentPR != null ? `${ex.currentPR} kg` : '— (no PR)'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={localVal}
                      onChange={e => handleChange(ex.id, e.target.value)}
                      onBlur={() => handleBlur(ex.id)}
                      placeholder="Enter PR"
                      className={`w-20 text-right px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        isMissing ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                    {isMissing && (
                      <div className="text-[10px] text-red-500 mt-0.5">Required</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">
                    {maxPct != null && maxInPlan != null ? (
                      <span className="text-gray-700">{maxPct}% → <strong>{maxInPlan} kg</strong></span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {derivedExercises.length > 0 && (
          <>
            <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-200">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                Derived exercises (auto-resolved)
              </span>
            </div>
            {derivedExercises.map(ex => {
              const parent = getParentExercise(ex.prReferenceId!);
              const parentPR = parent ? planningPRs.get(parent.id) : null;
              return (
                <div key={ex.id} className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-xs text-gray-500">
                  <span>{getDisplayName(ex)}</span>
                  <span>
                    → uses {parent ? getDisplayName(parent) : ex.prReferenceId} PR
                    {parentPR != null && ` (${parentPR} kg)`}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
