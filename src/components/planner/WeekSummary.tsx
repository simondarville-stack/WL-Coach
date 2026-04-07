import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  PlannedExercise, Exercise, AthletePR, GeneralSettings,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { computeMetrics, DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';

function weekTypeBadgeClass(weekType: string): string {
  switch (weekType) {
    case 'High':        return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'Medium':      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Low':         return 'bg-green-100 text-green-700 border-green-200';
    case 'Deload':      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'Competition': return 'bg-red-100 text-red-700 border-red-200';
    case 'Taper':       return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Testing':     return 'bg-purple-100 text-purple-700 border-purple-200';
    default:            return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

interface WeekSummaryProps {
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  athletePRs: AthletePR[];
  macroContext: MacroContext | null;
  macroWeekTarget: number | null;
  settings: GeneralSettings | null;
  competitionTotal?: number | null;
}

interface CategoryRow {
  category: string;
  sets: number;
  reps: number;
  tonnage: number;
}

export function WeekSummary({
  plannedExercises,
  athletePRs,
  macroContext,
  macroWeekTarget,
  settings,
  competitionTotal = null,
}: WeekSummaryProps) {
  const [showCategories, setShowCategories] = useState(false);
  const navigate = useNavigate();

  const { metrics, totalStress, categories } = useMemo(() => {
    const prMap = new Map<string, number>(
      athletePRs.filter(pr => pr.pr_value_kg).map(pr => [pr.exercise_id, pr.pr_value_kg!])
    );

    let totalStress = 0;
    const catMap = new Map<string, CategoryRow>();
    const allExercises: Array<{ summary_total_sets: number | null; summary_total_reps: number | null; summary_highest_load: number | null; summary_avg_load: number | null; counts_towards_totals: boolean; unit: string | null; exercise_id: string }> = [];

    Object.values(plannedExercises).forEach(dayExs => {
      dayExs.forEach(ex => {
        allExercises.push({ ...ex, counts_towards_totals: ex.exercise.counts_towards_totals });
        if (!ex.exercise.counts_towards_totals) return;
        const s = ex.summary_total_sets ?? 0;
        const r = ex.summary_total_reps ?? 0;
        const avg = ex.summary_avg_load ?? 0;
        const ton = ex.unit === 'absolute_kg' ? avg * r : 0;
        if (ex.unit === 'absolute_kg' && avg > 0) {
          const pr = prMap.get(ex.exercise_id);
          if (pr && pr > 0) totalStress += r * Math.pow(avg / pr, 2);
        }
        if (ex.exercise.category !== '— System') {
          const prev = catMap.get(ex.exercise.category) || { category: ex.exercise.category, sets: 0, reps: 0, tonnage: 0 };
          catMap.set(ex.exercise.category, { ...prev, sets: prev.sets + s, reps: prev.reps + r, tonnage: prev.tonnage + ton });
        }
      });
    });

    return {
      metrics: computeMetrics(allExercises, competitionTotal),
      totalStress: Math.round(totalStress * 10) / 10,
      categories: Array.from(catMap.values()).sort((a, b) => b.reps - a.reps),
    };
  }, [plannedExercises, athletePRs, competitionTotal]);

  const visibleMetrics: MetricKey[] = (settings?.visible_summary_metrics as MetricKey[] | undefined) ?? DEFAULT_VISIBLE_METRICS;
  const showStress = settings?.show_stress_metric ?? false;
  const repsProgress = macroContext?.totalRepsTarget
    ? Math.min(100, Math.round((metrics.reps / macroContext.totalRepsTarget) * 100))
    : null;

  return (
    <div className="space-y-2">
      {/* Macro context bar */}
      {macroContext && (
        <div
          className="bg-white rounded-lg border border-gray-200 px-4 py-2.5 space-y-2 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
          onClick={() => navigate('/macrocycles')}
          title="Go to Macro Cycles"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded border text-xs font-medium ${weekTypeBadgeClass(macroContext.weekType)}`}>
              {macroContext.weekType}
            </span>
            {macroContext.phaseName && (
              <span className="text-sm font-medium text-gray-700">{macroContext.phaseName}</span>
            )}
            {macroContext.phaseName && <span className="text-gray-300">·</span>}
            <span className="text-sm text-gray-500">{macroContext.macroName}</span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-500">
              Wk <strong className="text-gray-900">{macroContext.weekNumber}</strong>
              {macroContext.totalWeeks > 0 && ` / ${macroContext.totalWeeks}`}
            </span>
            {macroContext.totalRepsTarget != null && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-sm text-gray-500">
                  R <strong className="text-gray-900">{metrics.reps}</strong>
                  <span className="text-gray-400"> / {macroContext.totalRepsTarget}</span>
                </span>
              </>
            )}
          </div>
          {macroContext.weekTypeText && (
            <p className="text-xs text-blue-700 italic">{macroContext.weekTypeText}</p>
          )}
          {repsProgress !== null && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    repsProgress >= 100 ? 'bg-green-500' :
                    repsProgress >= 75  ? 'bg-blue-500' :
                    repsProgress >= 40  ? 'bg-amber-400' : 'bg-gray-300'
                  }`}
                  style={{ width: `${repsProgress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-8 text-right">{repsProgress}%</span>
            </div>
          )}
        </div>
      )}

      {/* Metric cards */}
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-2.5">
        <div className="flex items-center gap-5 flex-wrap">
          {visibleMetrics.includes('sets') && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Sets</span>
              <span className="text-xl font-medium text-gray-900">{metrics.sets}</span>
            </div>
          )}
          {visibleMetrics.includes('sets') && visibleMetrics.includes('reps') && (
            <div className="w-px h-8 bg-gray-200" />
          )}
          {visibleMetrics.includes('reps') && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Reps</span>
              <span className="text-xl font-medium text-gray-900">{metrics.reps}</span>
            </div>
          )}
          {macroWeekTarget != null && (
            <>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Target</span>
                <span className="text-xl font-medium text-gray-900">{macroWeekTarget}</span>
              </div>
            </>
          )}
          {visibleMetrics.includes('max') && metrics.max > 0 && (
            <>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Max</span>
                <span className="text-xl font-medium text-gray-900">{metrics.max}</span>
              </div>
            </>
          )}
          {visibleMetrics.includes('avg') && metrics.avg > 0 && (
            <>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Avg</span>
                <span className="text-xl font-medium text-gray-900">{metrics.avg}</span>
              </div>
            </>
          )}
          {visibleMetrics.includes('tonnage') && metrics.tonnage > 0 && (
            <>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Tonnage</span>
                <span className="text-xl font-medium text-gray-900">{metrics.tonnage.toLocaleString()}</span>
              </div>
            </>
          )}
          {visibleMetrics.includes('k') && metrics.k != null && (
            <>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">K</span>
                <span className="text-xl font-medium text-gray-900">{(metrics.k * 100).toFixed(0)}%</span>
              </div>
            </>
          )}
          {showStress && totalStress > 0 && (
            <>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Stress</span>
                <span className="text-xl font-medium text-gray-900">{totalStress}</span>
              </div>
            </>
          )}

          {categories.length > 0 && (
            <button
              onClick={() => setShowCategories(v => !v)}
              className="ml-auto flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showCategories ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Categories
            </button>
          )}
        </div>

        {showCategories && categories.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            {categories.map(cat => (
              <div key={cat.category} className="flex items-center gap-3 text-xs">
                <span className="text-gray-600 flex-1 truncate">{cat.category}</span>
                <span className="text-gray-500">S <strong className="text-gray-900">{cat.sets}</strong></span>
                <span className="text-gray-500">R <strong className="text-gray-900">{cat.reps}</strong></span>
                {cat.tonnage > 0 && (
                  <span className="text-gray-500">T <strong className="text-gray-900">{cat.tonnage.toLocaleString()}</strong></span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
