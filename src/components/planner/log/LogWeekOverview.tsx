/**
 * LogWeekOverview — coach ribbon comparing planned vs performed totals
 * across one week, with a day-trained strip and per-metric tables.
 *
 * Tables (only rendered when the matching toggle is on for this week):
 *   RAW readiness: one row per pillar (Sleep/Physical/Mood/Nutrition)
 *                  plus a Total row, columns = days, last col = average.
 *                  Coach can scan a row to spot "this athlete keeps
 *                  bombing nutrition every week".
 *   Other metrics: rows for Bodyweight / VAS / each enabled custom
 *                  metric, columns = days, average column (numeric only).
 *
 * Both tables share the same columnar layout so days line up vertically
 * regardless of which metrics are on.
 *
 * Pure: derives all numbers from plannedExercises + weekLog + config.
 */
import type {
  Exercise,
  PlannedExercise,
  AthleteMetricDefinition,
  AthleteWeekMetricsConfig,
  CustomMetricEntry,
} from '../../../lib/database.types';
import type { DayLog } from '../../../lib/trainingLogModel';
import { hasLoggedWork } from '../../../lib/trainingLogModel';
import { plannedExerciseTotals, countsTowardsTotals } from './logSummary';

/**
 * Day-strip dot status. Surfaces a distinct "logged but not finished" state
 * so a fully-trained day the athlete never tapped "Finish session" on isn't
 * shown as untrained. (COACH-REVIEW-5)
 */
function deriveDayStatus(log: DayLog | undefined): string {
  const raw = log?.session?.status ?? 'pending';
  if (raw === 'completed') return 'completed';
  if (hasLoggedWork(log)) return 'logged';
  return raw;
}

interface LogWeekOverviewProps {
  visibleDays: Array<{ index: number; name: string }>;
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  weekLog: Record<number, DayLog>;
  /** Coach-toggled tracking config. Null = pre-feature defaults. */
  metricsConfig: AthleteWeekMetricsConfig | null;
  /** Custom metric definitions enabled this week, in render order. */
  enabledMetricDefs: AthleteMetricDefinition[];
}

interface Totals {
  sets: number;
  reps: number;
  tonnage: number;
}

const fmtKg = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} t` : `${Math.round(n)} kg`);
const fmtInt = (n: number) => String(Math.round(n));

function plannedTotals(rows: (PlannedExercise & { exercise: Exercise })[]): Totals {
  let sets = 0;
  let reps = 0;
  let tonnage = 0;
  rows.forEach(ex => {
    // Exclude exercises flagged out of totals (accessories / sentinels /
    // GPP) so this matches the Plan-mode summary, which already skips them.
    if (!countsTowardsTotals(ex.exercise)) return;
    // Use the shared planned-totals helper so a stale-zero summary cache
    // (combos, free_text_reps zone labels) is recomputed from the
    // prescription instead of counting as 0 — matching the day/exercise rows.
    const t = plannedExerciseTotals(ex);
    const s = t.sets ?? 0;
    const r = t.reps ?? 0;
    const avg = t.avg ?? 0;
    sets += s;
    reps += r;
    if (ex.unit === 'absolute_kg' && avg > 0 && r > 0) {
      tonnage += avg * r;
    }
  });
  return { sets, reps, tonnage };
}

function performedTotals(log: DayLog): Totals {
  let sets = 0;
  let reps = 0;
  let tonnage = 0;
  log.exercises.forEach(le => {
    // Skip performed work for exercises flagged out of totals, so the
    // performed side stays symmetric with the planned side above.
    if (!countsTowardsTotals(le.exercise)) return;
    le.sets.forEach(s => {
      if (s.status !== 'completed') return;
      sets += 1;
      const r = s.performed_reps ?? 0;
      reps += r;
      if (s.performed_load != null && r > 0) {
        tonnage += s.performed_load * r;
      }
    });
  });
  return { sets, reps, tonnage };
}

function pct(performed: number, planned: number): number | null {
  if (planned <= 0) return null;
  return performed / planned;
}

function deltaClass(p: number | null): string {
  if (p == null) return 'text-gray-500';
  if (p >= 0.95) return 'text-emerald-700';
  if (p >= 0.7) return 'text-amber-700';
  return 'text-red-700';
}

interface DayColumn {
  key: string;
  label: string;
  /** Index into weekLog to read this column's session data. */
  dayIndex: number;
  isBonus: boolean;
}

export function LogWeekOverview({
  visibleDays,
  plannedExercises,
  weekLog,
  metricsConfig,
  enabledMetricDefs,
}: LogWeekOverviewProps) {
  // Planned aggregate across all visible days.
  const plannedAgg = visibleDays.reduce<Totals>(
    (acc, day) => {
      const t = plannedTotals(plannedExercises[day.index] ?? []);
      return {
        sets: acc.sets + t.sets,
        reps: acc.reps + t.reps,
        tonnage: acc.tonnage + t.tonnage,
      };
    },
    { sets: 0, reps: 0, tonnage: 0 },
  );

  // Performed aggregate across every day with a log (incl. bonus days).
  const performedAgg = Object.values(weekLog).reduce<Totals>(
    (acc, log) => {
      const t = performedTotals(log);
      return {
        sets: acc.sets + t.sets,
        reps: acc.reps + t.reps,
        tonnage: acc.tonnage + t.tonnage,
      };
    },
    { sets: 0, reps: 0, tonnage: 0 },
  );

  const plannedSessions = visibleDays.length;
  // Count any day with real training — not only those formally finished —
  // so a fully-logged-but-not-finished session isn't under-reported.
  const completedSessions = Object.values(weekLog).filter(hasLoggedWork).length;

  const performedAvg = performedAgg.reps > 0 ? performedAgg.tonnage / performedAgg.reps : 0;
  const plannedAvg = plannedAgg.reps > 0 ? plannedAgg.tonnage / plannedAgg.reps : 0;

  // Day strip data: one entry per visible day + each bonus day after.
  const visibleIndices = new Set(visibleDays.map(d => d.index));
  const bonusIndices = Object.keys(weekLog)
    .map(Number)
    .filter(idx => !visibleIndices.has(idx))
    .sort((a, b) => a - b);
  const stripDays = [
    ...visibleDays.map(d => ({
      key: `v${d.index}`,
      label: d.name,
      status: deriveDayStatus(weekLog[d.index]),
      isBonus: false,
    })),
    ...bonusIndices.map(idx => ({
      key: `b${idx}`,
      label: 'Bonus',
      status: deriveDayStatus(weekLog[idx]),
      isBonus: true,
    })),
  ];

  // Columns for the per-metric tables, in same order as the day strip.
  const columns: DayColumn[] = [
    ...visibleDays.map(d => ({
      key: `v${d.index}`,
      label: d.name.slice(0, 3),
      dayIndex: d.index,
      isBonus: false,
    })),
    ...bonusIndices.map(idx => ({
      key: `b${idx}`,
      label: '+',
      dayIndex: idx,
      isBonus: true,
    })),
  ];

  // Default to pre-feature behaviour (RAW + BW shown) when no config row
  // exists yet. VAS / custom stay off until the coach opts in.
  const trackRaw = metricsConfig ? metricsConfig.track_raw : true;
  const trackBw = metricsConfig ? metricsConfig.track_bodyweight : true;
  const trackVas = metricsConfig ? metricsConfig.track_vas : false;
  const showOtherMetrics = trackBw || trackVas || enabledMetricDefs.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 mb-3">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
          Week overview
        </h2>
        <span className="text-[10px] text-gray-400">planned vs performed</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
        <StatCell
          label="Sets"
          performed={fmtInt(performedAgg.sets)}
          planned={fmtInt(plannedAgg.sets)}
          ratio={pct(performedAgg.sets, plannedAgg.sets)}
        />
        <StatCell
          label="Reps"
          performed={fmtInt(performedAgg.reps)}
          planned={fmtInt(plannedAgg.reps)}
          ratio={pct(performedAgg.reps, plannedAgg.reps)}
        />
        <StatCell
          label="Tonnage"
          performed={fmtKg(performedAgg.tonnage)}
          planned={fmtKg(plannedAgg.tonnage)}
          ratio={pct(performedAgg.tonnage, plannedAgg.tonnage)}
        />
        <StatCell
          label="Avg kg/rep"
          performed={performedAvg > 0 ? `${performedAvg.toFixed(1)} kg` : '—'}
          planned={plannedAvg > 0 ? `${plannedAvg.toFixed(1)} kg` : '—'}
          ratio={pct(performedAvg, plannedAvg)}
        />
        <StatCell
          label="Sessions"
          performed={fmtInt(completedSessions)}
          planned={fmtInt(plannedSessions)}
          ratio={pct(completedSessions, plannedSessions)}
        />
      </div>

      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">
          Days trained
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {stripDays.length === 0 ? (
            <span className="text-[11px] text-gray-400 italic">No days planned</span>
          ) : (
            stripDays.map(d => (
              <DayDot key={d.key} label={d.label} status={d.status} isBonus={d.isBonus} />
            ))
          )}
        </div>
      </div>

      {trackRaw && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">
            RAW readiness
          </div>
          <RawTable columns={columns} weekLog={weekLog} />
        </div>
      )}

      {showOtherMetrics && (
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">
            Other metrics
          </div>
          <OtherMetricsTable
            columns={columns}
            weekLog={weekLog}
            trackBw={trackBw}
            trackVas={trackVas}
            customDefs={enabledMetricDefs}
          />
        </div>
      )}
    </div>
  );
}

function StatCell({
  label, performed, planned, ratio,
}: {
  label: string;
  performed: string;
  planned: string;
  ratio: number | null;
}) {
  const ratioText = ratio != null ? `${Math.round(ratio * 100)}%` : '—';
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide font-semibold text-gray-500">{label}</div>
      <div className="text-base font-bold text-gray-900 leading-tight">
        {performed}
        <span className="text-[10px] text-gray-400 font-normal ml-1">/ {planned}</span>
      </div>
      <div className={`text-[10px] font-semibold ${deltaClass(ratio)}`}>{ratioText}</div>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-gray-200 border-gray-300',
  in_progress: 'bg-amber-300 border-amber-400',
  // Trained but not formally finished — lighter than the explicit completed
  // dot so the coach can tell the two apart at a glance. (COACH-REVIEW-5)
  logged: 'bg-emerald-300 border-emerald-400',
  completed: 'bg-emerald-500 border-emerald-600',
  skipped: 'bg-red-400 border-red-500',
};

const STATUS_LABEL: Record<string, string> = {
  logged: 'logged (not finished)',
};

function DayDot({ label, status, isBonus }: { label: string; status: string; isBonus: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[28px]" title={`${label}: ${STATUS_LABEL[status] ?? status}`}>
      <div
        className={`w-3 h-3 rounded-full border ${STATUS_DOT[status] ?? STATUS_DOT.pending} ${isBonus ? 'ring-2 ring-amber-300/40' : ''}`}
        aria-hidden
      />
      <span className="text-[9px] text-gray-500 truncate max-w-[44px]">
        {isBonus ? '+' : ''}{label}
      </span>
    </div>
  );
}

// ─── RAW table ───────────────────────────────────────────────────────────────

const PILLARS = ['sleep', 'physical', 'mood', 'nutrition'] as const;
const PILLAR_LABEL: Record<typeof PILLARS[number], string> = {
  sleep: 'Sleep',
  physical: 'Physical',
  mood: 'Mood',
  nutrition: 'Nutrition',
};

/** Eleiko 1-3 colour bands per pillar value. Pale fills keep the table
 *  legible while making "low score" instantly visible.
 *  'nr' = session exists but pillar was not entered (amber tint to
 *  distinguish from no session at all, which renders as '—' in gray). */
function pillarCellClass(v: number | null | 'nr'): string {
  if (v === 'nr') return 'bg-amber-50 text-amber-500';
  if (v == null || v <= 0) return 'bg-gray-50 text-gray-300';
  if (v === 1) return 'bg-red-100 text-red-800';
  if (v === 2) return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-100 text-emerald-800';
}

/** Eleiko 4-12 total band — colours the Total row.
 *  'nr' = session exists but total not filled (amber tint). */
function totalCellClass(v: number | null | 'nr'): string {
  if (v === 'nr') return 'bg-amber-50 text-amber-500';
  if (v == null || v <= 0) return 'bg-gray-50 text-gray-300';
  if (v <= 6) return 'bg-red-100 text-red-800 font-semibold';
  if (v <= 9) return 'bg-amber-100 text-amber-800 font-semibold';
  return 'bg-emerald-100 text-emerald-800 font-semibold';
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function RawTable({
  columns,
  weekLog,
}: {
  columns: DayColumn[];
  weekLog: Record<number, DayLog>;
}) {
  // 'nr' = session exists but pillar not entered; null = no session at all.
  const pillarValues: Record<typeof PILLARS[number], Array<number | null | 'nr'>> = {
    sleep: [],
    physical: [],
    mood: [],
    nutrition: [],
  };
  const totals: Array<number | null | 'nr'> = [];

  columns.forEach(col => {
    const s = weekLog[col.dayIndex]?.session;
    PILLARS.forEach(key => {
      const field = ('raw_' + key) as 'raw_sleep' | 'raw_physical' | 'raw_mood' | 'raw_nutrition';
      const v = s?.[field];
      if (s == null) {
        pillarValues[key].push(null);
      } else if (v == null || v === 0) {
        pillarValues[key].push('nr');
      } else {
        pillarValues[key].push(v);
      }
    });
    if (s == null) {
      totals.push(null);
    } else if (s.raw_total == null || s.raw_total === 0) {
      totals.push('nr');
    } else {
      totals.push(s.raw_total);
    }
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="text-left text-[9px] uppercase tracking-wide font-semibold text-gray-500 px-2 py-1">
              Pillar
            </th>
            {columns.map(col => (
              <th
                key={col.key}
                className="text-center text-[9px] uppercase tracking-wide font-semibold text-gray-500 px-1.5 py-1"
                title={col.label}
              >
                {col.isBonus ? '+' : col.label}
              </th>
            ))}
            <th className="text-center text-[9px] uppercase tracking-wide font-semibold text-gray-500 px-2 py-1">
              Avg
            </th>
          </tr>
        </thead>
        <tbody>
          {PILLARS.map(key => {
            const nonNull = pillarValues[key].filter((v): v is number => typeof v === 'number');
            const a = avg(nonNull);
            return (
              <tr key={key} className="border-t border-gray-100">
                <td className="px-2 py-1 text-gray-700 font-medium">{PILLAR_LABEL[key]}</td>
                {pillarValues[key].map((v, i) => (
                  <td
                    key={i}
                    className={`px-1 py-1 text-center tabular-nums ${pillarCellClass(v)}`}
                    title={`${PILLAR_LABEL[key]}: ${v === 'nr' ? 'not rated' : (v ?? 'no session')}`}
                  >
                    {v === 'nr' ? 'nr' : (v ?? '—')}
                  </td>
                ))}
                <td className={`px-2 py-1 text-center tabular-nums ${
                  a == null
                    ? 'text-gray-300'
                    : a < 1.5
                    ? 'text-red-700 font-semibold'
                    : a < 2.5
                    ? 'text-amber-700 font-semibold'
                    : 'text-emerald-700 font-semibold'
                }`}>
                  {a != null ? a.toFixed(1) : '—'}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-gray-200">
            <td className="px-2 py-1 text-gray-700 font-semibold uppercase tracking-wide text-[9px]">
              Total
            </td>
            {totals.map((v, i) => (
              <td
                key={i}
                className={`px-1 py-1 text-center tabular-nums ${totalCellClass(v)}`}
                title={`Total: ${v === 'nr' ? 'not rated' : (v ?? 'no session')} / 12`}
              >
                {v === 'nr' ? 'nr' : (v ?? '—')}
              </td>
            ))}
            <td className="px-2 py-1 text-center tabular-nums text-gray-700 font-semibold">
              {(() => {
                const ts = totals.filter((v): v is number => typeof v === 'number');
                return ts.length ? avg(ts)!.toFixed(1) : '—';
              })()}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Other metrics table ────────────────────────────────────────────────────

interface OtherMetricsRow {
  key: string;
  label: string;
  unit: string | null;
  values: Array<number | string | null>;
  numeric: boolean;
}

function OtherMetricsTable({
  columns,
  weekLog,
  trackBw,
  trackVas,
  customDefs,
}: {
  columns: DayColumn[];
  weekLog: Record<number, DayLog>;
  trackBw: boolean;
  trackVas: boolean;
  customDefs: AthleteMetricDefinition[];
}) {
  const rows: OtherMetricsRow[] = [];

  if (trackBw) {
    rows.push({
      key: 'bw',
      label: 'Bodyweight',
      unit: 'kg',
      values: columns.map(c => weekLog[c.dayIndex]?.session?.bodyweight_kg ?? null),
      numeric: true,
    });
  }
  if (trackVas) {
    rows.push({
      key: 'vas',
      label: 'VAS pain',
      unit: '0–10',
      values: columns.map(c => weekLog[c.dayIndex]?.session?.vas_score ?? null),
      numeric: true,
    });
  }
  customDefs.forEach(def => {
    const numeric = def.value_type === 'number';
    const values: Array<number | string | null> = columns.map(c => {
      const entry = weekLog[c.dayIndex]?.session?.custom_metrics?.[def.id] as
        | CustomMetricEntry
        | undefined;
      if (!entry) return null;
      if ('value_number' in entry && entry.value_number != null) return entry.value_number;
      if ('value_text' in entry && entry.value_text != null) return entry.value_text;
      return null;
    });
    rows.push({
      key: `def-${def.id}`,
      label: def.label,
      unit: def.unit,
      values,
      numeric,
    });
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="text-left text-[9px] uppercase tracking-wide font-semibold text-gray-500 px-2 py-1">
              Metric
            </th>
            {columns.map(col => (
              <th
                key={col.key}
                className="text-center text-[9px] uppercase tracking-wide font-semibold text-gray-500 px-1.5 py-1"
              >
                {col.isBonus ? '+' : col.label}
              </th>
            ))}
            <th className="text-center text-[9px] uppercase tracking-wide font-semibold text-gray-500 px-2 py-1">
              Avg
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const numericValues = row.numeric
              ? row.values.filter((v): v is number => typeof v === 'number')
              : [];
            const a = row.numeric ? avg(numericValues) : null;
            return (
              <tr key={row.key} className="border-t border-gray-100">
                <td className="px-2 py-1 text-gray-700 font-medium">
                  {row.label}
                  {row.unit && (
                    <span className="text-[9px] text-gray-400 font-normal ml-1">{row.unit}</span>
                  )}
                </td>
                {row.values.map((v, i) => (
                  <td
                    key={i}
                    className={`px-1 py-1 text-center ${
                      v == null
                        ? 'bg-gray-50 text-gray-300'
                        : row.numeric
                        ? 'bg-blue-50 text-blue-900 tabular-nums'
                        : 'bg-amber-50 text-amber-900 text-left text-[10px]'
                    }`}
                    title={v == null ? '—' : `${row.label}: ${v}`}
                  >
                    {v == null
                      ? '—'
                      : row.numeric
                      ? typeof v === 'number'
                        ? Number.isInteger(v)
                          ? v
                          : v.toFixed(1)
                        : v
                      : String(v).slice(0, 14)}
                  </td>
                ))}
                <td className="px-2 py-1 text-center tabular-nums text-gray-700">
                  {a != null ? (Number.isInteger(a) ? a : a.toFixed(1)) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
