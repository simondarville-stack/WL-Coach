/**
 * BodyweightHistoryDialog — full bodyweight timeline for one athlete.
 *
 * Reads from training_log_sessions.bodyweight_kg (the source of truth
 * shared with the athlete profile chart). Renders a line chart with
 * the raw weigh-ins plus 7-day and 28-day moving averages, alongside
 * a newest-first list of every entry.
 *
 * Self-contained: takes only athleteId + name + onClose, fetches on
 * mount. Keeps the dashboard hook's payload small and avoids passing
 * the full history through props when most coaches never open this.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { fetchBodyweightHistory, type BodyweightPoint } from '../../lib/trainingLogService';
import { describeError } from '../../lib/errorMessage';

interface Props {
  athleteId: string;
  athleteName: string;
  onClose: () => void;
}

interface ChartPoint {
  date: string;
  bw: number | null;
  ma7: number | null;
  ma28: number | null;
}

export function BodyweightHistoryDialog({ athleteId, athleteName, onClose }: Props) {
  const [entries, setEntries] = useState<BodyweightPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setEntries(null);
    fetchBodyweightHistory(athleteId)
      .then(rows => {
        if (alive) setEntries(rows);
      })
      .catch(e => {
        console.error('[BodyweightHistoryDialog] fetch failed', e);
        if (alive) setError(describeError(e));
      });
    return () => {
      alive = false;
    };
  }, [athleteId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!entries) return [];
    // Sort ascending defensively; fetchBodyweightHistory already does.
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    // For each point, compute trailing 7d / 28d MA over the points that
    // fall within the window. Sample-count windows would be simpler but
    // weigh-ins are irregular (some athletes log daily, others weekly);
    // a date-based window is the only honest answer.
    return sorted.map((p, idx) => {
      const dateMs = new Date(p.date + 'T00:00:00Z').getTime();
      const ma7Vals: number[] = [];
      const ma28Vals: number[] = [];
      for (let j = idx; j >= 0; j -= 1) {
        const q = sorted[j];
        const qMs = new Date(q.date + 'T00:00:00Z').getTime();
        const diffDays = (dateMs - qMs) / (1000 * 60 * 60 * 24);
        if (diffDays <= 28) ma28Vals.push(q.weightKg);
        if (diffDays <= 7) ma7Vals.push(q.weightKg);
        if (diffDays > 28) break;
      }
      return {
        date: p.date,
        bw: p.weightKg,
        ma7: ma7Vals.length ? avg(ma7Vals) : null,
        ma28: ma28Vals.length ? avg(ma28Vals) : null,
      };
    });
  }, [entries]);

  const newestFirst = useMemo(() => {
    if (!entries) return [];
    return [...entries].sort((a, b) => b.date.localeCompare(a.date));
  }, [entries]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`Bodyweight history · ${athleteName}`}
        className="relative bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="px-5 py-4 flex items-center gap-3 border-b border-gray-100">
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">
              Bodyweight history
            </span>
            <span className="text-base font-medium text-gray-900 truncate">{athleteName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {entries == null && !error ? (
            <div className="flex items-center justify-center py-12 text-gray-400 text-sm gap-2">
              <Loader2 size={14} className="animate-spin" />
              Loading history…
            </div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-gray-400 italic text-center py-12">
              No bodyweight entries yet.
            </div>
          ) : (
            <>
              <div>
                <SummaryStrip points={chartData} />
                <div className="h-64 mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        tickFormatter={formatChartDate}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        domain={['dataMin - 1', 'dataMax + 1']}
                        width={36}
                        tickFormatter={v => `${v}`}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
                        labelFormatter={formatChartDate}
                        formatter={(value: number | null | undefined, name: string) => {
                          if (value == null) return ['—', name];
                          return [`${value.toFixed(1)} kg`, name];
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        iconType="line"
                        verticalAlign="top"
                        height={24}
                      />
                      <Line
                        type="monotone"
                        dataKey="bw"
                        name="Weigh-in"
                        stroke="#9ca3af"
                        strokeWidth={1}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="ma7"
                        name="7d MA"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="ma28"
                        name="28d MA"
                        stroke="#0d9488"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-400 font-medium mb-2">
                  Entries · {newestFirst.length}
                </div>
                <div className="border border-gray-100 rounded-md overflow-hidden">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                        <th className="text-left px-3 py-1.5 font-medium">Date</th>
                        <th className="text-right px-3 py-1.5 font-medium">Weight</th>
                        <th className="text-right px-3 py-1.5 font-medium">Δ vs prev</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newestFirst.map((e, i) => {
                        const prev = newestFirst[i + 1] ?? null;
                        const diff = prev ? e.weightKg - prev.weightKg : null;
                        return (
                          <tr key={e.date} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 text-gray-700">{formatRowDate(e.date)}</td>
                            <td className="px-3 py-1.5 text-right text-gray-900">
                              {e.weightKg.toFixed(1)} kg
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {diff == null ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                <span
                                  className={
                                    diff > 0.1
                                      ? 'text-red-600'
                                      : diff < -0.1
                                        ? 'text-green-600'
                                        : 'text-gray-400'
                                  }
                                >
                                  {diff > 0 ? '+' : ''}
                                  {diff.toFixed(1)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryStrip({ points }: { points: ChartPoint[] }) {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const first = points[0];
  const total = last.bw != null && first.bw != null ? last.bw - first.bw : null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
      <Stat label="Latest" value={last.bw} unit="kg" />
      <Stat label="7d MA" value={last.ma7} unit="kg" tone="blue" />
      <Stat label="28d MA" value={last.ma28} unit="kg" tone="teal" />
      {total != null && (
        <Stat
          label="Since first entry"
          value={total}
          unit="kg"
          signed
          tone={total > 0.2 ? 'red' : total < -0.2 ? 'green' : 'gray'}
        />
      )}
      <span className="text-[11px] text-gray-400 ml-auto">
        {points.length} entries · {formatRowDate(first.date)} → {formatRowDate(last.date)}
      </span>
    </div>
  );
}

function Stat({
  label, value, unit, signed, tone = 'gray',
}: {
  label: string;
  value: number | null;
  unit: string;
  signed?: boolean;
  tone?: 'gray' | 'blue' | 'teal' | 'red' | 'green';
}) {
  const toneClass = {
    gray: 'text-gray-900',
    blue: 'text-blue-600',
    teal: 'text-teal-600',
    red: 'text-red-600',
    green: 'text-green-600',
  }[tone];
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
      {value == null ? (
        <span className="text-gray-300">—</span>
      ) : (
        <span className={`text-base font-medium ${toneClass}`}>
          {signed && value > 0 ? '+' : ''}
          {value.toFixed(1)}
        </span>
      )}
      <span className="text-[10px] text-gray-400">{unit}</span>
    </span>
  );
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function formatChartDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatRowDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
