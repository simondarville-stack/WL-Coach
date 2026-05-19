/**
 * GppLogCard — athlete-side editable GPP block.
 *
 * Shows the coach's planned section (title + description) and a table
 * of rows. Each row is editable (reps / sets / load), with a checkbox
 * to mark it done. Athlete edits are stored on
 * training_log_exercises.metadata.gpp; the coach's planned section
 * stays untouched as the fallback / "what was prescribed".
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type {
  TrainingLogExercise,
  GppSection,
  GppRow,
} from '../../../lib/database.types';

interface GppLogCardProps {
  /** Planned section the coach wrote, or null if the coach left it blank. */
  planned: GppSection | null;
  /** Athlete's log row, used to read existing edits via metadata.gpp. */
  loggedExercise: TrainingLogExercise | null;
  /** Persists the athlete-side GPP state. */
  onSave: (section: GppSection) => Promise<void>;
}

/** Merge planned rows with athlete-edited rows by position. Athlete
 *  fields override planned; `done` is athlete-only. */
function mergeRows(planned: GppRow[], athlete: GppRow[] | undefined): GppRow[] {
  if (!athlete || athlete.length === 0) return planned.map(r => ({ ...r, done: false }));
  // We trust the athlete copy if it exists — it'll have been seeded
  // from planned on first edit. Tail rows that only exist in planned
  // get appended so a coach who added rows after the athlete first
  // viewed still surfaces.
  if (athlete.length >= planned.length) return athlete;
  return [...athlete, ...planned.slice(athlete.length).map(r => ({ ...r, done: false }))];
}

export function GppLogCard({ planned, loggedExercise, onSave }: GppLogCardProps) {
  const athleteSection = loggedExercise?.metadata?.gpp;
  const initialRows = planned
    ? mergeRows(planned.rows, athleteSection?.rows)
    : athleteSection?.rows ?? [];

  const [rows, setRows] = useState<GppRow[]>(initialRows);

  useEffect(() => {
    const next = planned
      ? mergeRows(planned.rows, athleteSection?.rows)
      : athleteSection?.rows ?? [];
    setRows(next);
    // Re-seed when planned changes or athlete state arrives from server.
    // Length signature is enough — finer diffing isn't worth the churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned?.rows.length, athleteSection?.rows.length]);

  const title = planned?.title || 'GPP';
  const description = planned?.description || '';

  const commit = (nextRows: GppRow[]) => {
    const section: GppSection = {
      title,
      description,
      rows: nextRows,
    };
    void onSave(section);
  };

  const updateRow = (i: number, patch: Partial<GppRow>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    commit(next);
  };

  const allDone = rows.length > 0 && rows.every(r => r.done);

  return (
    <div className={`rounded-xl bg-gray-900 border ${allDone ? 'border-emerald-700/50' : 'border-gray-800'} overflow-hidden`}>
      <div className="flex items-start gap-2 px-3 py-3">
        <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-emerald-500" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white truncate">{title}</h3>
            <span className="text-[9px] bg-emerald-900/50 text-emerald-200 font-medium px-1.5 py-0.5 rounded uppercase tracking-wide">
              GPP
            </span>
            {allDone && <Check size={14} className="text-emerald-400 flex-shrink-0" />}
          </div>
          {description && (
            <p className="text-[11px] text-gray-300 italic mt-0.5 whitespace-pre-wrap leading-snug">
              {description}
            </p>
          )}
        </div>
      </div>

      <div className="px-3 pb-3">
        {rows.length === 0 ? (
          <p className="text-[11px] text-gray-500 italic text-center py-3">
            No rows yet — your coach hasn't filled this in.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-gray-500">
                  <th className="text-center px-1 py-1 w-8">Done</th>
                  <th className="text-left px-1 py-1">Exercise</th>
                  <th className="text-center px-1 py-1 w-12">Reps</th>
                  <th className="text-center px-1 py-1 w-10">Sets</th>
                  <th className="text-center px-1 py-1 w-14">Load</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={`border-t border-gray-800 ${row.done ? 'bg-emerald-950/30' : ''}`}>
                    <td className="px-1 py-1 text-center">
                      <button
                        onClick={() => updateRow(i, { done: !row.done })}
                        className={`w-6 h-6 rounded-md flex items-center justify-center border transition-colors ${
                          row.done
                            ? 'bg-emerald-500 border-emerald-400 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-500 hover:bg-gray-700 hover:text-emerald-300'
                        }`}
                        title={row.done ? 'Mark not done' : 'Mark done'}
                        aria-pressed={row.done}
                      >
                        <Check size={12} strokeWidth={3} />
                      </button>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={row.exercise}
                        onChange={e => updateRow(i, { exercise: e.target.value })}
                        className="w-full bg-transparent text-gray-100 focus:outline-none focus:bg-gray-800 focus:rounded focus:px-1 text-[12px]"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={row.reps}
                        onChange={e => updateRow(i, { reps: e.target.value })}
                        className="w-full bg-transparent text-gray-100 focus:outline-none focus:bg-gray-800 focus:rounded focus:px-1 text-center tabular-nums text-[12px]"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min={1}
                        value={row.sets || ''}
                        onChange={e => updateRow(i, { sets: parseInt(e.target.value, 10) || 1 })}
                        className="w-full bg-transparent text-gray-100 focus:outline-none focus:bg-gray-800 focus:rounded focus:px-1 text-center tabular-nums text-[12px]"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={row.load}
                        onChange={e => updateRow(i, { load: e.target.value })}
                        placeholder="—"
                        className="w-full bg-transparent text-gray-100 placeholder-gray-600 focus:outline-none focus:bg-gray-800 focus:rounded focus:px-1 text-center text-[12px]"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
