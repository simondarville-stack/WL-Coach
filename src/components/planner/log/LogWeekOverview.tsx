/**
 * LogWeekOverview — coach ribbon comparing planned vs performed totals
 * across one week, with a day-trained strip and a per-day RAW bar chart.
 *
 * Pure: derives all numbers from plannedExercises + weekLog. No fetches.
 * Sits at the top of LogModeView so the coach can read the week at a
 * glance before drilling into days.
 *
 * Metrics:
 * - Sets:  count of planned set lines (summary_total_sets) vs count of
 *          training_log_sets with status='completed'
 * - Reps:  summary_total_reps vs sum of performed_reps on completed sets
 * - Tonnage: sum (planned_load × planned_reps × sets) approximated via
 *           summary_avg_load × summary_total_reps, vs sum of
 *           performed_load × performed_reps over completed sets
 * - Avg / K: tonnage / total reps for each side (kg per rep — same
 *            number a coach calls "K-value" or "average intensity")
 * - Sessions: count of distinct planned-day indices vs count of
 *             session rows where status='completed'
 *
 * Day strip: one filled dot per planned slot, green when its session
 * is completed, red on skip, amber when started, grey when pending.
 * Bonus athlete-added days appear after the planned ones with an "+"
 * marker.
 *
 * RAW chart: tiny bar per day with a logged session whose raw_total is
 * set; bar height proportional to raw_total/12, colour by guidance band.
 */
import type { PlannedExercise, Exercise } from '../../../lib/database.types';
import type { DayLog } from '../../../lib/trainingLogModel';
import { getRawGuidance, type RawBand } from '../../../lib/trainingLogModel';

interface LogWeekOverviewProps {
  visibleDays: Array<{ index: number; name: string }>;
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  weekLog: Record<number, DayLog>;
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
    const s = ex.summary_total_sets ?? 0;
    const r = ex.summary_total_reps ?? 0;
    const avg = ex.summary_avg_load ?? 0;
    sets += s;
    reps += r;
    // % prescriptions and "free_text_reps" don't have a meaningful kg
    // average yet; skip them so the planned tonnage doesn't get inflated
    // by zeros. Coach can still compare sets and reps.
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

const BAND_FILL: Record<RawBand, string> = {
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
};

export function LogWeekOverview({ visibleDays, plannedExercises, weekLog }: LogWeekOverviewProps) {
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
  const completedSessions = Object.values(weekLog).filter(
    d => d.session?.status === 'completed',
  ).length;

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
      status: weekLog[d.index]?.session?.status ?? 'pending',
      isBonus: false,
    })),
    ...bonusIndices.map(idx => ({
      key: `b${idx}`,
      label: 'Bonus',
      status: weekLog[idx]?.session?.status ?? 'pending',
      isBonus: true,
    })),
  ];

  // RAW chart points (only days with a logged total).
  const rawPoints = stripDays
    .map(d => {
      const dayLog = Object.values(weekLog).find(l => l.session?.day_index === Number(d.key.slice(1)));
      const total = dayLog?.session?.raw_total;
      return total != null ? { label: d.label, total, guidance: getRawGuidance(total) } : null;
    })
    .filter((x): x is { label: string; total: number; guidance: ReturnType<typeof getRawGuidance> } => x !== null);

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
          label="Avg / K"
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-1">
        <div>
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

        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">
            RAW readiness
          </div>
          {rawPoints.length === 0 ? (
            <span className="text-[11px] text-gray-400 italic">No RAW scores logged</span>
          ) : (
            <RawBarChart points={rawPoints} />
          )}
        </div>
      </div>
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
  completed: 'bg-emerald-500 border-emerald-600',
  skipped: 'bg-red-400 border-red-500',
};

function DayDot({ label, status, isBonus }: { label: string; status: string; isBonus: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[28px]" title={`${label}: ${status}`}>
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

function RawBarChart({
  points,
}: {
  points: Array<{ label: string; total: number; guidance: ReturnType<typeof getRawGuidance> }>;
}) {
  // Max = 12 (Eleiko ceiling). Use a fixed scale so bars are comparable
  // across weeks regardless of how many days are present.
  const HEIGHT = 38;
  const MAX = 12;
  return (
    <div className="flex items-end gap-1.5 h-12 px-1">
      {points.map((p, i) => {
        const h = Math.max(2, (p.total / MAX) * HEIGHT);
        const fill = p.guidance ? BAND_FILL[p.guidance.band] : '#9ca3af';
        return (
          <div key={i} className="flex flex-col items-center justify-end gap-0.5 flex-1 min-w-[16px]">
            <span className="text-[9px] text-gray-700 font-semibold leading-none">{p.total}</span>
            <div
              className="w-full rounded-sm"
              style={{ height: h, backgroundColor: fill, minWidth: 6 }}
              title={`${p.label}: ${p.total}/12 ${p.guidance?.label ?? ''}`}
            />
            <span className="text-[9px] text-gray-500 truncate w-full text-center">
              {p.label.slice(0, 4)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
