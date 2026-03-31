interface CategoryTotals {
  sets: number;
  reps: number;
  totalLoad: number;
  avgLoad: number;
  loadCount: number;
  frequency: number;
}

interface WeeklySummaryPanelProps {
  weeklySummary: { totalSets: number; totalReps: number; totalTonnage: number };
  macroWeekTarget: number | null;
  showCategorySummaries: boolean;
  categorySummaries: Record<string, CategoryTotals>;
  onShowCategorySummariesChange: (show: boolean) => void;
}

export function WeeklySummaryPanel({
  weeklySummary,
  macroWeekTarget,
  showCategorySummaries,
  categorySummaries,
  onShowCategorySummariesChange,
}: WeeklySummaryPanelProps) {
  return (
    <div className="mt-6 pt-6 border-t border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Weekly Summary
        </h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showCategorySummaries}
            onChange={(e) => onShowCategorySummariesChange(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="text-xs font-medium text-gray-600">Show by category</span>
        </label>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">
            Total Sets
          </div>
          <div className="text-2xl font-bold text-blue-900">
            {weeklySummary.totalSets}
          </div>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">
            Total Reps
          </div>
          <div className="text-2xl font-bold text-green-900">
            {weeklySummary.totalReps}
            {macroWeekTarget && (
              <span className="text-base font-normal text-green-700 ml-2">
                / {macroWeekTarget}
              </span>
            )}
          </div>
          {macroWeekTarget && (
            <div className="text-xs text-green-700 mt-1">
              {Math.round((weeklySummary.totalReps / macroWeekTarget) * 100)}% of target
            </div>
          )}
        </div>
        <div className="bg-orange-50 rounded-lg p-4">
          <div className="text-xs font-medium text-orange-600 uppercase tracking-wide mb-1">
            Total Tonnage
          </div>
          <div className="text-2xl font-bold text-orange-900">
            {weeklySummary.totalTonnage} kg
          </div>
        </div>
      </div>

      {showCategorySummaries && Object.keys(categorySummaries).length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            By Category
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {Object.entries(categorySummaries)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([category, totals]) => (
                <div key={category} className="bg-gray-50 rounded p-2 border border-gray-200">
                  <div className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                    {category}
                    <span className="text-gray-500 font-normal">×{totals.frequency}</span>
                  </div>
                  <div className="text-xs text-gray-900 space-y-0.5">
                    <div><span className="font-bold">{totals.sets}</span> sets</div>
                    <div><span className="font-bold">{totals.reps}</span> reps</div>
                    {totals.totalLoad > 0 && (
                      <>
                        <div><span className="font-bold">{Math.round(totals.totalLoad)}</span> kg</div>
                        <div className="text-gray-600">avg {Math.round(totals.avgLoad)}kg</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
