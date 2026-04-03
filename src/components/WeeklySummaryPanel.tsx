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
  const pct = macroWeekTarget && macroWeekTarget > 0
    ? Math.round((weeklySummary.totalReps / macroWeekTarget) * 100)
    : null;

  // Filter out system category
  const filteredCategories = Object.entries(categorySummaries)
    .filter(([cat]) => cat !== '— System')
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="mt-4">
      {/* Metric cards row */}
      <div className="flex items-start gap-3 mb-3">
        <div className="bg-gray-50 rounded-lg py-2 px-4 min-w-[72px]">
          <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Sets</div>
          <div className="text-xl font-medium text-gray-900">{weeklySummary.totalSets}</div>
        </div>
        <div className="bg-gray-50 rounded-lg py-2 px-4 min-w-[72px]">
          <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Reps</div>
          <div className="text-xl font-medium text-gray-900">
            {weeklySummary.totalReps}
            {macroWeekTarget && (
              <span className="text-sm font-normal text-gray-400 ml-1">/ {macroWeekTarget}</span>
            )}
          </div>
          {pct !== null && (
            <div className={`text-xs font-medium mt-0.5 ${
              pct >= 90 ? 'text-green-600' : pct >= 70 ? 'text-amber-600' : 'text-red-500'
            }`}>
              {pct}%
            </div>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg py-2 px-4 min-w-[72px]">
          <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Tonnage</div>
          <div className="text-xl font-medium text-gray-900">{weeklySummary.totalTonnage}</div>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => onShowCategorySummariesChange(!showCategorySummaries)}
          className="text-xs text-gray-500 hover:text-gray-700 py-2 px-1 transition-colors"
        >
          {showCategorySummaries ? '▾' : '▸'} Categories
        </button>
      </div>

      {/* Category breakdown - compact inline chips */}
      {showCategorySummaries && filteredCategories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filteredCategories.map(([category, totals]) => (
            <div
              key={category}
              className="bg-gray-50 border border-gray-100 rounded-md py-1.5 px-3 text-xs"
            >
              <span className="font-medium text-gray-900">{category}</span>
              <span className="text-gray-400 ml-1">×{totals.frequency}</span>
              <span className="text-gray-300 mx-1.5">|</span>
              <span className="text-gray-600">
                S <span className="font-medium text-gray-900">{totals.sets}</span>
              </span>
              <span className="text-gray-300 mx-1">·</span>
              <span className="text-gray-600">
                R <span className="font-medium text-gray-900">{totals.reps}</span>
              </span>
              {totals.totalLoad > 0 && (
                <>
                  <span className="text-gray-300 mx-1">·</span>
                  <span className="text-gray-600">
                    T <span className="font-medium text-gray-900">{Math.round(totals.totalLoad)}</span>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
