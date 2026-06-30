/**
 * BodyweightHistoryDialog — full bodyweight timeline for one athlete.
 *
 * Reads from training_log_sessions.bodyweight_kg (the source of truth
 * shared with the athlete profile chart). Renders a line chart with the
 * raw weigh-ins, 7-day and 28-day moving averages, and a least-squares
 * TREND line fitted over a selectable time window (1M / 3M / 6M / 12M /
 * All). The trend's modelled rate of change (kg/week + kg/month) and the
 * change across the window are surfaced in the summary strip, alongside a
 * newest-first table of every entry.
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
import { formatDateShort, formatWeekday, formatDateToDDMMYYYY } from '../../lib/dateUtils';

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
  /** Fitted least-squares value over the active window; null outside it. */
  trend: number | null;
}

type WindowKey = '1m' | '3m' | '6m' | '12m' | 'all';
const WINDOWS: { key: WindowKey; label: string; months: number | null }[] = [
  { key: '1m', label: '1M', months: 1 },
  { key: '3m', label: '3M', months: 3 },
  { key: '6m', label: '6M', months: 6 },
  { key: '12m', label: '12M', months: 12 },
  { key: 'all', label: 'All', months: null },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.4375;

function dateMs(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getTime();
}

interface TrendStats {
  perWeek: number;
  perMonth: number;
  /** Modelled change across the fitted span (last − first weigh-in). */
  total: number;
}

/**
 * Ordinary least-squares fit of weight (kg) against time (days), anchored
 * at the first point. Returns the slope in kg/day plus the intercept, or
 * null when there are fewer than two distinct-day points.
 */
function linearFit(
  points: { date: string; weightKg: number }[],
): { slopePerDay: number; intercept: number; x0: number } | null {
  if (points.length < 2) return null;
  const x0 = dateMs(points[0].date);
  const xs = points.map(p => (dateMs(p.date) - x0) / DAY_MS);
  const ys = points.map(p => p.weightKg);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null; // all weigh-ins on the same day
  const slopePerDay = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slopePerDay * sx) / n;
  return { slopePerDay, intercept, x0 };
}

export function BodyweightHistoryDialog({ athleteId, athleteName, onClose }: Props) {
  const [entries, setEntries] = useState<BodyweightPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>('all');

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

  // Full series with trailing 7d / 28d moving averages. MAs are computed
  // over ALL points (not just the visible window) so the value at a
  // window's left edge stays correct when the view is narrowed. Weigh-ins
  // are irregular, so a date-based window is the only honest answer.
  const fullSeries = useMemo<Omit<ChartPoint, 'trend'>[]>(() => {
    if (!entries) return [];
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((p, idx) => {
      const ms = dateMs(p.date);
      const ma7Vals: number[] = [];
      const ma28Vals: number[] = [];
      for (let j = idx; j >= 0; j -= 1) {
        const q = sorted[j];
        const diffDays = (ms - dateMs(q.date)) / DAY_MS;
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

  // Window slice anchored on the latest weigh-in (so "3M" means the most
  // recent 3 months of DATA — robust to an athlete who stopped logging).
  const windowed = useMemo(() => {
    if (fullSeries.length === 0) return [];
    const months = WINDOWS.find(w => w.key === windowKey)?.months ?? null;
    if (months == null) return fullSeries;
    const lastMs = dateMs(fullSeries[fullSeries.length - 1].date);
    const cutoff = lastMs - months * DAYS_PER_MONTH * DAY_MS;
    return fullSeries.filter(p => dateMs(p.date) >= cutoff);
  }, [fullSeries, windowKey]);

  // Least-squares trend over the windowed weigh-ins.
  const { chartData, trendStats } = useMemo<{ chartData: ChartPoint[]; trendStats: TrendStats | null }>(() => {
    const bwPoints = windowed
      .filter((p): p is Omit<ChartPoint, 'trend'> & { bw: number } => p.bw != null)
      .map(p => ({ date: p.date, weightKg: p.bw }));
    const fit = linearFit(bwPoints);
    const data: ChartPoint[] = windowed.map(p => ({
      ...p,
      trend: fit ? fit.intercept + fit.slopePerDay * ((dateMs(p.date) - fit.x0) / DAY_MS) : null,
    }));
    let stats: TrendStats | null = null;
    if (fit && bwPoints.length >= 2) {
      const spanDays = (dateMs(bwPoints[bwPoints.length - 1].date) - dateMs(bwPoints[0].date)) / DAY_MS;
      stats = {
        perWeek: fit.slopePerDay * 7,
        perMonth: fit.slopePerDay * DAYS_PER_MONTH,
        total: fit.slopePerDay * spanDays,
      };
    }
    return { chartData: data, trendStats: stats };
  }, [windowed]);

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
          ) : (entries ?? []).length === 0 ? (
            <div className="text-sm text-gray-400 italic text-center py-12">
              No bodyweight entries yet.
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <SummaryStrip
                    points={chartData}
                    trend={trendStats}
                    windowLabel={WINDOWS.find(w => w.key === windowKey)?.label ?? 'All'}
                  />
                  <WindowSelector value={windowKey} onChange={setWindowKey} />
                </div>
                {windowed.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-sm text-gray-400 italic">
                    No weigh-ins in this window.
                  </div>
                ) : (
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
                          // Recharts' Tooltip generics demand a Formatter / label
                          // shape with positional Payload args we never use; runtime
                          // happily accepts the simpler arity. Cast through unknown
                          // to keep the callsite legible.
                          labelFormatter={formatChartDate as unknown as (label: unknown) => string}
                          formatter={((value: number | null | undefined, name: string) => {
                            if (value == null) return ['—', name];
                            return [`${value.toFixed(1)} kg`, name];
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          }) as any}
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
                        <Line
                          type="linear"
                          dataKey="trend"
                          name="Trend"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
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

function WindowSelector({ value, onChange }: { value: WindowKey; onChange: (k: WindowKey) => void }) {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1">Trend</span>
      {WINDOWS.map(w => {
        const selected = w.key === value;
        return (
          <button
            key={w.key}
            type="button"
            onClick={() => onChange(w.key)}
            className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
              selected
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryStrip({
  points,
  trend,
  windowLabel,
}: {
  points: ChartPoint[];
  trend: TrendStats | null;
  windowLabel: string;
}) {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
      <Stat label="Latest" value={last.bw} unit="kg" />
      <Stat label="7d MA" value={last.ma7} unit="kg" tone="blue" />
      <Stat label="28d MA" value={last.ma28} unit="kg" tone="teal" />
      {trend && (
        <span
          className="inline-flex items-baseline gap-1"
          title={`Least-squares trend over the ${windowLabel} window: ${signed(trend.perMonth)} kg/month · ${signed(trend.total)} kg across the window`}
        >
          <span className="text-[10px] uppercase tracking-wider text-amber-500">
            Trend {windowLabel}
          </span>
          <span
            className={`text-base font-medium ${
              trend.perWeek > 0.02 ? 'text-red-600' : trend.perWeek < -0.02 ? 'text-green-600' : 'text-gray-500'
            }`}
          >
            {signed(trend.perWeek)}
          </span>
          <span className="text-[10px] text-gray-400">kg/wk</span>
        </span>
      )}
    </div>
  );
}

function Stat({
  label, value, unit, signed: isSigned, tone = 'gray',
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
          {isSigned && value > 0 ? '+' : ''}
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

/** Signed one-decimal number, e.g. +0.4 / −0.4 / 0.0. */
function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}`;
}

/** DD/MM — European short date for chart ticks (see CLAUDE.md). */
function formatChartDate(iso: string): string {
  return formatDateShort(iso) || iso;
}

/** "Mon 30/06/2026" — weekday + European day-first date for the entries table. */
function formatRowDate(iso: string): string {
  const wd = formatWeekday(iso, 'short');
  const d = formatDateToDDMMYYYY(iso);
  return d ? `${wd} ${d}` : iso;
}
