/**
 * PRDetailScreen — per-exercise PR view.
 *
 * Hero: implied 1RM big and prominent.
 * Body: vertical 1RM→10RM list. Real entries show weight + date;
 * empty rows show the phantom estimate (greyed). Tap a real row to
 * edit; tap an empty row to add. Footer: compact e1RM progression
 * line over the last 12 months derived from the history rows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Plus } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { supabase } from '../../../lib/supabase';
import { describeError } from '../../../lib/errorMessage';
import {
  buildPRRows,
  fetchPRHistory,
  type ExerciseRow,
  type RepCount,
} from '../../../lib/prTable';
import { estimate1RM } from '../../../lib/xrmUtils';
import type { AthletePRHistory, Exercise } from '../../../lib/database.types';
import { useAuth } from '../lib/AuthContext';
import { PRFormModal } from '../components/PRFormModal';

function formatRowDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatChartDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface FormState {
  open: boolean;
  mode: 'add' | 'edit';
  repCount?: RepCount;
  entryId?: string;
  initialValueKg?: number;
  initialDate?: string;
}

export function PRDetailScreen() {
  const navigate = useNavigate();
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const { athlete } = useAuth();

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [history, setHistory] = useState<AthletePRHistory[]>([]);
  const [row, setRow] = useState<ExerciseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ open: false, mode: 'add' });

  const load = useCallback(async () => {
    if (!athlete || !exerciseId) return;
    setError(null);
    setLoading(true);
    try {
      const [{ data: exData, error: exErr }, hist] = await Promise.all([
        supabase
          .from('exercises')
          .select('*')
          .eq('id', exerciseId)
          .eq('owner_id', athlete.owner_id)
          // Defensive: refuse to render PR detail for a "— System"
          // sentinel even if the URL was hand-edited.
          .neq('category', '— System')
          .single(),
        fetchPRHistory(athlete.id),
      ]);
      if (exErr) throw exErr;
      const ex = exData as Exercise;
      setExercise(ex);
      const filtered = hist.filter(h => h.exercise_id === exerciseId);
      setHistory(filtered);
      setRow(buildPRRows([ex], filtered)[0] ?? null);
    } catch (e) {
      console.error('[PRDetailScreen] load failed', e);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [athlete, exerciseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Build the e1RM-over-time series for the chart: for each history
  // entry, compute its implied 1RM and group by date. Take the max
  // implied for any given date so a heavy single doesn't compete with
  // the same-day 5RM.
  const chartData = useMemo(() => {
    if (history.length === 0) return [];
    const byDate = new Map<string, number>();
    for (const h of history) {
      const implied = h.rep_count === 1 ? h.value_kg : estimate1RM(h.value_kg, h.rep_count);
      const existing = byDate.get(h.achieved_date);
      if (existing == null || implied > existing) {
        byDate.set(h.achieved_date, implied);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, e1rm]) => ({ date, e1rm: Math.round(e1rm * 10) / 10 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [history]);

  if (!athlete) {
    return (
      <div className="px-4 py-6 text-sm text-gray-400">
        Pick an athlete from the profile picker.
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 80px)' }}>
      <header className="sticky top-0 z-10 bg-gray-950 px-4 pt-4 pb-3 border-b border-gray-900 flex items-center gap-2">
        <button
          onClick={() => navigate('/athlete/prs')}
          className="text-xs text-gray-400 hover:text-white -ml-1 p-1"
          aria-label="Back"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-white truncate">
            {exercise?.name ?? 'Loading…'}
          </h1>
          {exercise && (
            <p className="text-[11px] text-gray-500">{exercise.category || 'Other'}</p>
          )}
        </div>
      </header>

      <div className="flex-1 px-4 py-4 pb-24 space-y-4">
        {loading && !row && (
          <div className="flex items-center justify-center py-12 text-gray-500 text-sm gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        )}

        {error && (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        )}

        {row && exercise && (
          <>
            <section className="rounded-xl bg-gray-900 border border-gray-800 p-4 text-center">
              {row.implied1RM != null ? (
                <>
                  <div className="text-4xl font-bold text-white tabular-nums leading-none">
                    {Math.round(row.implied1RM)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mt-1">
                    kg · implied 1RM
                  </div>
                  <div className="text-[10px] text-gray-500 mt-2">
                    based on best of {row.cells.filter(c => c.current != null).length} rep counts
                  </div>
                </>
              ) : (
                <div className="py-3">
                  <div className="text-sm text-gray-500 italic">
                    No PRs recorded yet. Tap a row below to log one.
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-800">
                <h2 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  By rep count
                </h2>
              </div>
              <ul className="divide-y divide-gray-800">
                {row.cells.map(cell => {
                  const isReal = cell.current != null;
                  const onClick = () => {
                    if (cell.current) {
                      setForm({
                        open: true,
                        mode: 'edit',
                        repCount: cell.repCount,
                        entryId: cell.current.id,
                        initialValueKg: cell.current.value_kg,
                        initialDate: cell.current.achieved_date,
                      });
                    } else {
                      setForm({ open: true, mode: 'add', repCount: cell.repCount });
                    }
                  };
                  return (
                    <li key={cell.repCount}>
                      <button
                        type="button"
                        onClick={onClick}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-800/40 transition-colors"
                      >
                        <span className="text-xs text-gray-400 tabular-nums w-7 text-right flex-shrink-0">
                          {cell.repCount}
                          <span className="text-[10px] text-gray-600 ml-0.5">RM</span>
                        </span>
                        <div className="flex-1 min-w-0">
                          {isReal ? (
                            <>
                              <div className="text-sm font-bold text-white tabular-nums">
                                {cell.current!.value_kg.toFixed(1)}{' '}
                                <span className="text-xs text-gray-500 font-normal">kg</span>
                              </div>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                {formatRowDate(cell.current!.achieved_date)}
                              </div>
                            </>
                          ) : cell.phantom != null ? (
                            <div className="text-sm text-gray-600 italic tabular-nums">
                              (est. {Math.round(cell.phantom)} kg)
                            </div>
                          ) : (
                            <div className="text-sm text-gray-700 italic">—</div>
                          )}
                        </div>
                        <span
                          className={`text-[10px] flex-shrink-0 ${
                            isReal ? 'text-blue-400' : 'text-gray-600'
                          }`}
                        >
                          {isReal ? 'edit' : 'add'} →
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {chartData.length >= 2 && (
              <section className="rounded-xl bg-gray-900 border border-gray-800 p-3">
                <h2 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                  e1RM progression
                </h2>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatChartDate}
                        tick={{ fontSize: 9, fill: '#6b7280' }}
                        stroke="#374151"
                        minTickGap={24}
                      />
                      <YAxis
                        domain={['dataMin - 2', 'dataMax + 2']}
                        tick={{ fontSize: 9, fill: '#6b7280' }}
                        stroke="#374151"
                        width={28}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#111827',
                          border: '1px solid #374151',
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                        labelStyle={{ color: '#9ca3af' }}
                        itemStyle={{ color: '#fff' }}
                        labelFormatter={((label: unknown) => formatChartDate(String(label))) as unknown as (l: unknown) => string}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Formatter generic over-narrow
                        formatter={((v: number) => [`${v} kg`, 'e1RM']) as any}
                      />
                      <Line
                        type="monotone"
                        dataKey="e1rm"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 2.5, fill: '#3b82f6' }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <div className="fixed left-0 right-0 bottom-16 z-20 pointer-events-none px-4 pb-2">
        <div className="max-w-2xl mx-auto pointer-events-auto">
          <button
            type="button"
            onClick={() => setForm({ open: true, mode: 'add' })}
            disabled={!exercise}
            className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold text-sm py-3 rounded-xl shadow-lg shadow-black/40 transition-colors"
          >
            <Plus size={16} />
            Log a PR
          </button>
        </div>
      </div>

      {form.open && exercise && (
        <PRFormModal
          mode={
            form.mode === 'edit' && form.entryId && form.repCount && form.initialValueKg != null && form.initialDate
              ? {
                  kind: 'edit',
                  athleteId: athlete.id,
                  exerciseId: exercise.id,
                  exerciseName: exercise.name,
                  entryId: form.entryId,
                  initialValueKg: form.initialValueKg,
                  initialDate: form.initialDate,
                  repCount: form.repCount,
                }
              : {
                  kind: 'add',
                  athleteId: athlete.id,
                  exerciseId: exercise.id,
                  exerciseName: exercise.name,
                  defaultRepCount: form.repCount,
                }
          }
          onClose={() => setForm({ open: false, mode: 'add' })}
          onChanged={load}
        />
      )}
    </div>
  );
}
