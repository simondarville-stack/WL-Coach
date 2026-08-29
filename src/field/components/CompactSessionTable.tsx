/**
 * CompactSessionTable — the Field View highlight table for one session.
 *
 * One row per planned exercise: code / name / total reps / total sets /
 * heaviest segment in Stacked Load Notation / average load. Percentage
 * loads resolved to kilograms render in amber under the stacked segment.
 * Rows at or above the coach's bold threshold render bold.
 */
import { StackedNotation } from '../../components/planner/StackedNotation';
import type { FieldExerciseRow } from '../../lib/fieldView';

/** Comma-decimal display per the app's numeric convention. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

export function CompactSessionTable({ rows }: { rows: FieldExerciseRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-[color:var(--color-text-secondary)] px-3 pb-3">No exercises planned.</p>;
  }
  return (
    <table className="w-full text-xs" style={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
      <thead>
        <tr className="text-[length:var(--text-caption)] uppercase tracking-wide text-[color:var(--color-text-secondary)]">
          <th className="text-left font-normal pl-3 py-1">Exercise</th>
          <th className="text-right font-normal py-1 w-9">Reps</th>
          <th className="text-right font-normal py-1 w-9">Sets</th>
          <th className="text-center font-normal py-1 w-16">Top</th>
          <th className="text-right font-normal pr-3 py-1 w-12">Avg</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const tone = r.isHeavy ? 'text-white font-semibold' : 'text-[color:var(--color-text-primary)]';
          const avg = r.avgKg != null
            ? <span className="text-amber-400">{fmt(r.avgKg)}</span>
            : r.avgValue != null
              ? <span>{fmt(r.avgValue)}{r.unit === 'percentage' ? '%' : ''}</span>
              : <span className="text-[color:var(--color-text-tertiary)]">—</span>;
          return (
            <tr key={r.key} className={`border-t border-gray-800/80 ${tone}`}>
              {/* No truncate: long names (combos joined with "+") wrap to
                  extra lines so the whole combination stays readable. */}
              <td className="pl-3 py-1.5 pr-1 break-words leading-snug">{r.name}</td>
              <td className="py-1.5 text-right tabular-nums">{r.totalReps || '—'}</td>
              <td className="py-1.5 text-right tabular-nums">{r.totalSets || '—'}</td>
              <td className="py-1.5">
                {r.topRaw ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <StackedNotation raw={r.topRaw} unit={r.unit} isCombo={r.isCombo} />
                    {r.topKg != null && (
                      <span className="text-[length:var(--text-caption)] leading-none text-amber-400">→ {fmt(r.topKg)}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-[color:var(--color-text-tertiary)]">—</div>
                )}
              </td>
              <td className="pr-3 py-1.5 text-right tabular-nums">{avg}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
