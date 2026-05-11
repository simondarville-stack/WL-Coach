import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  PlannedExercise, Exercise, AthletePR, GeneralSettings,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { computeMetrics, DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';

function weekTypeBadgeStyle(weekType: string): React.CSSProperties {
  switch (weekType) {
    case 'High':        return { background: 'var(--color-warning-bg)',  color: 'var(--color-warning-text)',  border: '0.5px solid var(--color-warning-border)' };
    case 'Medium':      return { background: 'var(--color-accent-muted)', color: 'var(--color-accent)',        border: '0.5px solid var(--color-accent-border)' };
    case 'Low':         return { background: 'var(--color-success-bg)',   color: 'var(--color-success-text)',  border: '0.5px solid var(--color-success-border)' };
    case 'Deload':      return { background: 'var(--color-success-bg)',   color: 'var(--color-success-text)',  border: '0.5px solid var(--color-success-border)' };
    case 'Competition': return { background: 'var(--color-danger-bg)',    color: 'var(--color-danger-text)',   border: '0.5px solid var(--color-danger-border)' };
    case 'Taper':       return { background: 'var(--color-warning-bg)',   color: 'var(--color-warning-text)',  border: '0.5px solid var(--color-warning-border)' };
    case 'Testing':     return { background: 'var(--color-purple-50)',     color: 'var(--color-purple-600)',     border: '0.5px solid var(--color-purple-200)' };
    default:            return { background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-secondary)' };
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
  const [macroBarHovered, setMacroBarHovered] = useState(false);
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

  const progressBarColor = repsProgress == null ? '' :
    repsProgress >= 100 ? 'var(--color-success-text)' :
    repsProgress >= 75  ? 'var(--color-accent)' :
    repsProgress >= 40  ? 'var(--color-warning-text)' :
    'var(--color-border-primary)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Macro context bar */}
      {macroContext && (
        <div
          style={{
            background: macroBarHovered ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
            borderRadius: 'var(--radius-lg)',
            border: macroBarHovered ? '1px solid var(--color-accent-border)' : '1px solid var(--color-border-secondary)',
            padding: '8px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onClick={() => navigate('/macrocycles')}
          onMouseEnter={() => setMacroBarHovered(true)}
          onMouseLeave={() => setMacroBarHovered(false)}
          title="Go to Macro Cycles"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              padding: '2px 8px', borderRadius: 'var(--radius-sm)',
              fontSize: 11, fontWeight: 500,
              ...weekTypeBadgeStyle(macroContext.weekType),
            }}>
              {macroContext.weekType}
            </span>
            {macroContext.phaseName && (
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>{macroContext.phaseName}</span>
            )}
            {macroContext.phaseName && <span style={{ color: 'var(--color-border-secondary)' }}>·</span>}
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{macroContext.macroName}</span>
            <span style={{ color: 'var(--color-border-secondary)' }}>·</span>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Wk <strong style={{ color: 'var(--color-text-primary)' }}>{macroContext.weekNumber}</strong>
              {macroContext.totalWeeks > 0 && ` / ${macroContext.totalWeeks}`}
            </span>
            {macroContext.totalRepsTarget != null && (
              <>
                <span style={{ color: 'var(--color-border-secondary)' }}>·</span>
                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  R <strong style={{ color: 'var(--color-text-primary)' }}>{metrics.reps}</strong>
                  <span style={{ color: 'var(--color-text-tertiary)' }}> / {macroContext.totalRepsTarget}</span>
                </span>
              </>
            )}
          </div>
          {macroContext.weekTypeText && (
            <p style={{ fontSize: 11, color: 'var(--color-accent)', fontStyle: 'italic', margin: 0 }}>{macroContext.weekTypeText}</p>
          )}
          {repsProgress !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 6, background: 'var(--color-bg-secondary)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 99, width: `${repsProgress}%`, background: progressBarColor, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 32, textAlign: 'right' }}>{repsProgress}%</span>
            </div>
          )}
        </div>
      )}

      {/* Metric cards */}
      <div style={{
        background: 'var(--color-bg-primary)',
        borderRadius: 'var(--radius-lg)',
        border: '0.5px solid var(--color-border-secondary)',
        padding: '8px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          {visibleMetrics.includes('sets') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sets</span>
              <span style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.sets}</span>
            </div>
          )}
          {visibleMetrics.includes('sets') && visibleMetrics.includes('reps') && (
            <div style={{ width: 1, height: 32, background: 'var(--color-border-secondary)' }} />
          )}
          {visibleMetrics.includes('reps') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reps</span>
              <span style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.reps}</span>
            </div>
          )}
          {macroWeekTarget != null && (
            <>
              <div style={{ width: 1, height: 32, background: 'var(--color-border-secondary)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target</span>
                <span style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{macroWeekTarget}</span>
              </div>
            </>
          )}
          {visibleMetrics.includes('max') && metrics.max > 0 && (
            <>
              <div style={{ width: 1, height: 32, background: 'var(--color-border-secondary)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Max</span>
                <span style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.max}</span>
              </div>
            </>
          )}
          {visibleMetrics.includes('avg') && metrics.avg > 0 && (
            <>
              <div style={{ width: 1, height: 32, background: 'var(--color-border-secondary)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg</span>
                <span style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.avg}</span>
              </div>
            </>
          )}
          {visibleMetrics.includes('tonnage') && metrics.tonnage > 0 && (
            <>
              <div style={{ width: 1, height: 32, background: 'var(--color-border-secondary)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tonnage</span>
                <span style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.tonnage.toLocaleString()}</span>
              </div>
            </>
          )}
          {visibleMetrics.includes('k') && metrics.k != null && (
            <>
              <div style={{ width: 1, height: 32, background: 'var(--color-border-secondary)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>K</span>
                <span style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{(metrics.k * 100).toFixed(0)}%</span>
              </div>
            </>
          )}
          {showStress && totalStress > 0 && (
            <>
              <div style={{ width: 1, height: 32, background: 'var(--color-border-secondary)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stress</span>
                <span style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{totalStress}</span>
              </div>
            </>
          )}

          {categories.length > 0 && (
            <button
              onClick={() => setShowCategories(v => !v)}
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2,
                fontSize: 11, color: 'var(--color-text-tertiary)', background: 'none', border: 'none',
                cursor: 'pointer', padding: 4, borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)'; }}
            >
              {showCategories ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Categories
            </button>
          )}
        </div>

        {showCategories && categories.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border-tertiary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {categories.map(cat => (
              <div key={cat.category} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }}>
                <span style={{ color: 'var(--color-text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.category}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>S <strong style={{ color: 'var(--color-text-primary)' }}>{cat.sets}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>R <strong style={{ color: 'var(--color-text-primary)' }}>{cat.reps}</strong></span>
                {cat.tonnage > 0 && (
                  <span style={{ color: 'var(--color-text-secondary)' }}>T <strong style={{ color: 'var(--color-text-primary)' }}>{cat.tonnage.toLocaleString()}</strong></span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
