// WeekSummaryBox — the "Load distribution" band of the week header. For one
// coach-selected metric (the app's standard set: reps / sets / max / avg /
// tonnage / K) it breaks the planned work down BY CATEGORY (left) and ACROSS
// THE WEEK (right). The selector drives both panels.
//
// - Unit-based weeks: one bar per training unit.
// - Calendar-mapped weeks: one bar per weekday (Mon–Sun); units that share a
//   weekday stack on top of each other.
//
// It renders as a collapsible band inside the unified week-header card; only
// this band collapses (toggled by the load-distribution button or the "D" key).

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
  expanded: boolean;
  onToggle: () => void;
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ADDITIVE: Record<MetricKey, boolean> = {
  reps: true, sets: true, tonnage: true, max: false, avg: false, k: false,
};
const BALANCE_HELP =
  'Balance = how evenly the selected metric is spread across the training days '
  + '(coefficient of variation of the daily values). Lower is more even. '
  + 'Under 25% reads as “even”, 25–50% as “moderate”, over 50% as “concentrated”.';

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

interface Agg { reps: number; sets: number; tonnageKg: number; max: number; repsKg: number; }
const emptyAgg = (): Agg => ({ reps: 0, sets: 0, tonnageKg: 0, max: 0, repsKg: 0 });

function addEx(a: Agg, ex: PlannedRow): void {
  // A combo always counts: its reps belong to its member movements. The
  // counts_towards_totals flag on a combo row reflects only its lead member,
  // so it must not gate the whole combo out of the totals.
  if (ex.exercise.counts_towards_totals === false && !ex.is_combo) return;
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

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
const eyebrow: React.CSSProperties = {
  fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500,
};

export function WeekSummaryBox({
  selectedAthlete, plannedExercises, activeDays, dayDisplayOrder, dayLabels, daySchedule,
  expanded, onToggle,
}: WeekSummaryBoxProps) {
  const [metric, setMetric] = useState<MetricKey>('tonnage');
  const compTotal = selectedAthlete?.competition_total ?? null;
  const calendarMapped = !!daySchedule && Object.keys(daySchedule).length > 0;

  const { columns, cats } = useMemo(() => {
    const labelOf = (i: number) => dayLabels[i] || defaultUnitLabel(i, dayDisplayOrder);
    const visible = dayDisplayOrder.filter(d => activeDays.includes(d));

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

    const catMap = new Map<string, CatRow>();
    for (const i of visible) {
      for (const ex of plannedExercises[i] ?? []) {
        if (ex.exercise.counts_towards_totals === false && !ex.is_combo) continue;
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

  const PLOT_H = 60;
  const cols = `repeat(${Math.max(columns.length, 1)}, 1fr)`;

  return (
    <div>
      {/* Collapsible header */}
      <button
        onClick={onToggle}
        title="Toggle load distribution (L)"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '8px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
          borderBottom: expanded ? '0.5px solid var(--color-border-tertiary)' : 'none',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)' }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span style={eyebrow}>Load distribution</span>
        </span>
        {expanded ? (
          <div
            onClick={e => e.stopPropagation()}
            style={{ display: 'inline-flex', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}
          >
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
        ) : (
          <span style={{ ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>press L</span>
        )}
      </button>

      {expanded && (
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

          {/* RIGHT — across the week (fills the panel height) */}
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column' }}>
            <div style={eyebrow}>{calendarMapped ? 'Across the week' : 'Across the units'}</div>

            {/* plot — grows to fill the panel; value labels float above each bar */}
            <div style={{
              display: 'grid', gridTemplateColumns: cols, gap: 6,
              flex: 1, minHeight: PLOT_H, alignItems: 'end', marginTop: 20,
              borderBottom: '0.5px solid var(--color-border-tertiary)',
            }}>
              {columns.map(col => {
                const v = colVal(col);
                const pct = v > 0 ? Math.max(4, (v / maxCol) * 90) : 2;
                const isPeak = additive && peak?.key === col.key;
                const stack = additive && col.units.length > 1
                  ? col.units.filter(u => (metricValue(u.agg, metric, compTotal) ?? 0) > 0)
                  : [];
                return (
                  <div key={col.key} style={{
                    height: `${pct}%`, width: '72%', justifySelf: 'center',
                    position: 'relative', display: 'flex', flexDirection: 'column',
                    transition: 'height 0.2s',
                  }}>
                    <span style={{
                      position: 'absolute', bottom: '100%', left: 0, right: 0, textAlign: 'center', marginBottom: 3,
                      ...mono, fontSize: 'var(--text-caption)', whiteSpace: 'nowrap',
                      color: v > 0 ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
                    }}>
                      {fmtMetric(metric, v || null)}
                    </span>
                    <div style={{
                      flex: 1, borderRadius: '2px 2px 0 0', overflow: 'hidden',
                      display: 'flex', flexDirection: 'column',
                      background: v > 0 ? undefined : 'var(--color-border-tertiary)',
                      opacity: v > 0 ? 1 : 0.45,
                    }}>
                      {v > 0 && stack.length > 0
                        ? stack.map((u, idx) => {
                            const uv = metricValue(u.agg, metric, compTotal) ?? 0;
                            return (
                              <div key={u.index} title={`${u.label}: ${fmtMetric(metric, uv)}`} style={{
                                height: `${(uv / v) * 100}%`,
                                background: idx % 2 === 0 ? 'var(--color-accent)' : 'var(--color-accent-border)',
                                borderTop: idx > 0 ? '0.5px solid var(--color-bg-primary)' : 'none',
                              }} />
                            );
                          })
                        : v > 0 && <div style={{ height: '100%', background: isPeak ? 'var(--color-accent)' : 'var(--color-accent-border)' }} />}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* day labels */}
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, marginTop: 4 }}>
              {columns.map(col => (
                <span key={col.key} style={{ ...mono, fontSize: 'var(--text-caption)', textAlign: 'center', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {col.label}
                </span>
              ))}
            </div>

            {peak && (
              <div style={{ display: 'flex', gap: 14, marginTop: 10, ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                <span>peak <b style={{ color: 'var(--color-text-secondary)' }}>{peak.label} · {fmtMetric(metric, colVal(peak))}</b></span>
                <span title={BALANCE_HELP} style={{ cursor: 'help', borderBottom: '1px dotted var(--color-border-tertiary)' }}>
                  balance <b style={{ color: 'var(--color-text-secondary)' }}>CV {cvPct}%</b> <span style={{ color: verdictColor }}>{verdict}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
