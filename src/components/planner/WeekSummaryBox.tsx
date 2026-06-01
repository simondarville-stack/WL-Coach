// WeekSummaryBox — the load-breakdown header that sits above the day cards.
// It shows, for a single coach-selected metric (the app's standard set:
// reps / sets / max / avg / tonnage / K), the planned work broken down BY
// CATEGORY (left) and ACROSS THE WEEK (right). The selector drives both panels.
//
// - Unit-based weeks: one bar per training unit.
// - Calendar-mapped weeks: one bar per weekday (Mon–Sun); units that share a
//   weekday stack on top of each other.
// Week totals live in the control-panel banner; week navigation lives in its
// own ribbon — this box is purely the breakdown.

import { useMemo, useState } from 'react';
import type { Athlete, Exercise, PlannedExercise } from '../../lib/database.types';
import { defaultUnitLabel } from '../../lib/constants';
import { METRICS, METRIC_ORDER, type MetricKey } from '../../lib/metrics';

type PlannedRow = PlannedExercise & { exercise: Exercise };

interface WeekSummaryBoxProps {
  selectedAthlete: Athlete | null;
  plannedExercises: Record<number, PlannedRow[]>;
  activeDays: number[];
  dayDisplayOrder: number[];
  dayLabels: Record<number, string>;
  daySchedule: Record<number, { weekday: number; time: string | null }> | null;
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ADDITIVE: Record<MetricKey, boolean> = {
  reps: true, sets: true, tonnage: true, max: false, avg: false, k: false,
};

// Deterministic, stable colour per category so any coach-defined category gets
// a consistent swatch without a hardcoded lift enum.
const CAT_PALETTE = [
  '#E58CA8', '#5891CB', '#E89866', '#9C95E2', '#5DBA94',
  '#E2C56F', '#7AAEDD', '#D85A30', '#1D9E75', '#B0AEA7',
];
function categoryColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}

// ── metric aggregation ────────────────────────────────────────────────────
interface Agg { reps: number; sets: number; tonnageKg: number; max: number; repsKg: number; }
const emptyAgg = (): Agg => ({ reps: 0, sets: 0, tonnageKg: 0, max: 0, repsKg: 0 });

function addEx(a: Agg, ex: PlannedRow): void {
  if (ex.exercise.counts_towards_totals === false) return;
  const r = ex.summary_total_reps ?? 0;
  const s = ex.summary_total_sets ?? 0;
  const avg = ex.summary_avg_load ?? 0;
  const hi = ex.summary_highest_load ?? 0;
  a.reps += r; a.sets += s;
  if (hi > a.max) a.max = hi;
  if (ex.unit === 'absolute_kg' && avg > 0) { a.tonnageKg += avg * r; a.repsKg += r; }
}
function aggList(exs: PlannedRow[]): Agg {
  const a = emptyAgg();
  for (const ex of exs) addEx(a, ex);
  return a;
}
function metricValue(a: Agg, key: MetricKey, compTotal: number | null): number | null {
  switch (key) {
    case 'reps': return a.reps;
    case 'sets': return a.sets;
    case 'tonnage': return a.tonnageKg;
    case 'max': return a.max || null;
    case 'avg': return a.repsKg > 0 ? Math.round(a.tonnageKg / a.repsKg) : null;
    case 'k': {
      const avg = a.repsKg > 0 ? a.tonnageKg / a.repsKg : 0;
      return compTotal && compTotal > 0 && avg > 0 ? Math.round((avg / compTotal) * 100) : null;
    }
  }
}
function fmtMetric(key: MetricKey, v: number | null): string {
  if (v === null || v === 0) return '–';
  switch (key) {
    case 'reps': case 'sets': return String(v);
    case 'tonnage': return v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v)}kg`;
    case 'max': case 'avg': return `${v}`;
    case 'k': return `${v}%`;
  }
}

interface Unit { index: number; label: string; agg: Agg; }
interface Column { key: string; label: string; units: Unit[]; agg: Agg; }
interface CatRow { category: string; color: string; agg: Agg; }

export function WeekSummaryBox({
  selectedAthlete,
  plannedExercises,
  activeDays,
  dayDisplayOrder,
  dayLabels,
  daySchedule,
}: WeekSummaryBoxProps) {
  const [metric, setMetric] = useState<MetricKey>('tonnage');
  const compTotal = selectedAthlete?.competition_total ?? null;
  const calendarMapped = !!daySchedule && Object.keys(daySchedule).length > 0;

  const { columns, cats } = useMemo(() => {
    const labelOf = (i: number) => dayLabels[i] || defaultUnitLabel(i, dayDisplayOrder);
    const visible = dayDisplayOrder.filter(d => activeDays.includes(d));

    // Build columns: one per unit (unit mode) or one per weekday (calendar mode).
    let columns: Column[];
    if (calendarMapped && daySchedule) {
      columns = WEEKDAY_SHORT.map((wdLabel, wd) => {
        const dayIdxs = visible
          .filter(i => daySchedule[i]?.weekday === wd)
          .sort((a, b) => (daySchedule[a]?.time ?? '').localeCompare(daySchedule[b]?.time ?? ''));
        const units: Unit[] = dayIdxs.map(i => ({ index: i, label: labelOf(i), agg: aggList(plannedExercises[i] ?? []) }));
        const agg = emptyAgg();
        for (const i of dayIdxs) for (const ex of plannedExercises[i] ?? []) addEx(agg, ex);
        return { key: `wd${wd}`, label: wdLabel, units, agg };
      });
    } else {
      columns = visible.map(i => {
        const agg = aggList(plannedExercises[i] ?? []);
        return { key: `u${i}`, label: labelOf(i), units: [{ index: i, label: labelOf(i), agg }], agg };
      });
    }

    // Categories across the whole week.
    const catMap = new Map<string, CatRow>();
    for (const i of visible) {
      for (const ex of plannedExercises[i] ?? []) {
        if (ex.exercise.counts_towards_totals === false) continue;
        const category = ex.exercise.category;
        if (!category || category === '— System') continue;
        const row = catMap.get(category) ?? { category, color: categoryColor(category), agg: emptyAgg() };
        addEx(row.agg, ex);
        catMap.set(category, row);
      }
    }
    const cats = Array.from(catMap.values())
      .sort((a, b) => (metricValue(b.agg, metric, compTotal) ?? 0) - (metricValue(a.agg, metric, compTotal) ?? 0));

    return { columns, cats };
  }, [plannedExercises, activeDays, dayDisplayOrder, dayLabels, daySchedule, calendarMapped, metric, compTotal]);

  const additive = ADDITIVE[metric];
  const colVal = (c: Column) => metricValue(c.agg, metric, compTotal) ?? 0;
  const maxCol = Math.max(1, ...columns.map(colVal));
  const maxCat = Math.max(1, ...cats.map(c => metricValue(c.agg, metric, compTotal) ?? 0));
  const catSum = cats.reduce((s, c) => s + (metricValue(c.agg, metric, compTotal) ?? 0), 0);

  // Peak + balance (only meaningful / shown for additive metrics).
  const { peak, cvPct, verdict, verdictColor } = useMemo(() => {
    const active = columns.filter(c => colVal(c) > 0);
    if (!additive || active.length === 0) {
      return { peak: null as Column | null, cvPct: 0, verdict: '', verdictColor: '' };
    }
    const peak = active.reduce((a, b) => (colVal(b) > colVal(a) ? b : a));
    const mean = active.reduce((s, c) => s + colVal(c), 0) / active.length;
    const variance = active.reduce((s, c) => s + (colVal(c) - mean) ** 2, 0) / active.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    return {
      peak, cvPct: Math.round(cv * 100),
      verdict: cv < 0.25 ? 'even' : cv < 0.5 ? 'moderate' : 'concentrated',
      verdictColor: cv < 0.25 ? 'var(--color-success-text)' : cv < 0.5 ? 'var(--color-warning-text)' : 'var(--color-danger-text)',
    };
  }, [columns, additive, metric, compTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  const BAR_AREA = 56;
  const eyebrow: React.CSSProperties = {
    fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
    textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500,
  };
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      {/* Metric selector */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '8px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)',
      }}>
        <span style={eyebrow}>Load breakdown</span>
        <div style={{ display: 'inline-flex', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {METRIC_ORDER.map((m, i) => {
            const def = METRICS.find(d => d.key === m)!;
            return (
              <button
                key={m}
                onClick={() => setMetric(m)}
                title={def.description}
                style={{
                  fontSize: 'var(--text-caption)', padding: '3px 10px', cursor: 'pointer', border: 'none',
                  fontFamily: 'var(--font-sans)',
                  borderLeft: i > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                  background: metric === m ? 'var(--color-accent)' : 'transparent',
                  color: metric === m ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                  fontWeight: metric === m ? 500 : 400,
                }}
              >
                {def.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr' }}>
        {/* LEFT — by category */}
        <div style={{ padding: '10px 14px', borderRight: '0.5px solid var(--color-border-tertiary)' }}>
          <div style={eyebrow}>By category</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {cats.length === 0 && (
              <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                Nothing planned yet.
              </span>
            )}
            {cats.map(cat => {
              const v = metricValue(cat.agg, metric, compTotal) ?? 0;
              const pct = additive && catSum > 0 ? Math.round((v / catSum) * 100) : null;
              return (
                <div key={cat.category} style={{ display: 'grid', gridTemplateColumns: '9px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ width: 9, height: 15, borderRadius: 2, background: cat.color }} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cat.category}
                      </span>
                      <span style={{ ...mono, fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        {fmtMetric(metric, v)}
                      </span>
                      {pct !== null && (
                        <span style={{ ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', width: 30, textAlign: 'right' }}>
                          {pct}%
                        </span>
                      )}
                    </div>
                    <div style={{ height: 4, background: 'var(--color-bg-tertiary)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
                      <div style={{ height: '100%', borderRadius: 2, width: `${(v / maxCat) * 100}%`, background: cat.color, transition: 'width 0.2s' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — across the week */}
        <div style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={eyebrow}>{calendarMapped ? 'Across the week' : 'Across the units'}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, 1fr)`, gap: 6, marginTop: 8 }}>
            {columns.map(col => {
              const v = colVal(col);
              const totalH = v > 0 ? Math.max(3, (v / maxCol) * BAR_AREA) : 2;
              const isPeak = additive && peak?.key === col.key;
              const stackUnits = additive && col.units.length > 1 ? col.units.filter(u => (metricValue(u.agg, metric, compTotal) ?? 0) > 0) : [];
              return (
                <div key={col.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                  {/* value label */}
                  <span style={{ ...mono, fontSize: 'var(--text-caption)', color: v > 0 ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)', height: 13, lineHeight: '13px' }}>
                    {fmtMetric(metric, v || null)}
                  </span>
                  {/* baseline-anchored bar area */}
                  <div style={{ height: BAR_AREA, width: '68%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{
                      height: totalH, minHeight: 2, borderRadius: '2px 2px 0 0', overflow: 'hidden',
                      display: 'flex', flexDirection: 'column',
                      background: v > 0 ? undefined : 'var(--color-border-tertiary)',
                      opacity: v > 0 ? 1 : 0.5,
                      transition: 'height 0.2s',
                    }}>
                      {v > 0 && stackUnits.length > 0
                        ? stackUnits.map((u, idx) => {
                            const uv = metricValue(u.agg, metric, compTotal) ?? 0;
                            return (
                              <div
                                key={u.index}
                                title={`${u.label}: ${fmtMetric(metric, uv)}`}
                                style={{
                                  height: `${(uv / v) * 100}%`,
                                  background: idx % 2 === 0 ? 'var(--color-accent)' : 'var(--color-accent-border)',
                                  borderTop: idx > 0 ? '0.5px solid var(--color-bg-primary)' : 'none',
                                }}
                              />
                            );
                          })
                        : v > 0 && <div style={{ height: '100%', background: isPeak ? 'var(--color-accent)' : 'var(--color-accent-border)' }} />}
                    </div>
                  </div>
                  {/* day / unit label */}
                  <span style={{
                    ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                    borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 3, marginTop: 2,
                    width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {col.label}
                  </span>
                </div>
              );
            })}
          </div>

          {peak && (
            <div style={{ display: 'flex', gap: 14, marginTop: 8, ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              <span>peak <b style={{ color: 'var(--color-text-secondary)' }}>{peak.label} · {fmtMetric(metric, colVal(peak))}</b></span>
              <span>balance <b style={{ color: 'var(--color-text-secondary)' }}>CV {cvPct}%</b></span>
              <span style={{ color: verdictColor }}>{verdict}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
