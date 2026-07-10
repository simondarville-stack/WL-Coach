// MacroReviewTable — read-only review grid shown under the macro timeline in
// the Weekly Planner header (toggleable). Weeks as columns (mirroring the
// timeline), rows per exercise category and per tracked lift. Each cell
// compares what is programmed in the weekly planner (micro-level plan)
// against the macro-level target: `planned∕target`.
//
// The coach switches the reviewed metric (K reps / max / avg) with the
// segmented control in the top-left; the active (selected) week's column
// expands to show every metric chosen in settings (timeline_week_detail),
// so the week being planned is reviewed at full detail while the rest of
// the macro stays compact.
//
// Category rows aggregate ALL programmed work of that category — including
// lifts that aren't tracked in the macro — so the coach sees total category
// volume; targets aggregate across the macro's tracked lifts only (that's
// where targets live). Aggregation per metric: reps sum, max takes the
// heaviest, avg is rep-weighted (target avg is not aggregated — averaging
// targets across different lifts has no meaning).

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSettings } from '../../hooks/useSettings';
import { fetchWeeklyProgrammed, type WeeklyProgrammed } from '../../lib/macroTimelineData';
import { getExerciseCategoryShade } from '../../lib/colorUtils';
import type { MacroTarget, MacroTrackedExerciseWithExercise, MacroWeek } from '../../lib/database.types';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReviewMetric = 'reps' | 'max' | 'avg';

export const REVIEW_METRIC_LABELS: Record<ReviewMetric, string> = {
  reps: 'K',
  max: 'Max',
  avg: 'Ø',
};

export interface ReviewWeek {
  weekStart: string;
  weekNumber: number;
  /** Macro-level week note ('' / undefined = none) — shown as a dot on the
   *  week header with the text in the tooltip. */
  note?: string;
}

export interface ReviewPair {
  planned: number | null;
  target: number | null;
}

/** All metric pairs for one row × week. */
export type ReviewCell = Record<ReviewMetric, ReviewPair>;

export interface ReviewRow {
  key: string;
  kind: 'total' | 'category' | 'exercise';
  label: string;
  /** Dot color for exercise rows (category shade). */
  color?: string;
  /** One cell per week, same order as `weeks`. */
  cells: ReviewCell[];
}

export interface MacroReviewTableViewProps {
  weeks: ReviewWeek[];
  rows: ReviewRow[];
  /** Metric shown in the compact (non-selected) columns. */
  metric: ReviewMetric;
  onMetricChange?: (metric: ReviewMetric) => void;
  /** Metrics expanded on the selected week's column. */
  detailMetrics: ReviewMetric[];
  selectedWeekStart?: string | null;
  onSelectWeek?: (weekStart: string) => void;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const LABEL_COL = 130;

/** Loads print with comma decimals when fractional (German locale). */
function fmtValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}

function pairText(p: ReviewPair): { planned: string; target: string | null } {
  return {
    planned: p.planned != null ? fmtValue(p.planned) : '–',
    target: p.target != null ? fmtValue(p.target) : null,
  };
}

function pairEmpty(p: ReviewPair): boolean {
  return p.planned == null && p.target == null;
}

function cellTooltip(row: ReviewRow, week: ReviewWeek, cell: ReviewCell): string {
  const parts = [`W${week.weekNumber} · ${row.label}`];
  (Object.keys(REVIEW_METRIC_LABELS) as ReviewMetric[]).forEach(m => {
    const p = cell[m];
    if (pairEmpty(p)) return;
    let pct = '';
    if (p.planned != null && p.target != null && p.target > 0) {
      pct = ` (${Math.round((p.planned / p.target) * 100)} %)`;
    }
    parts.push(`${REVIEW_METRIC_LABELS[m]} ${p.planned != null ? fmtValue(p.planned) : '–'}∕${p.target != null ? fmtValue(p.target) : '–'}${pct}`);
  });
  return parts.join(' · ');
}

// ── Pure view ────────────────────────────────────────────────────────────────

function Pair({ pair, bold }: { pair: ReviewPair; bold?: boolean }) {
  const t = pairText(pair);
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{
        color: pair.planned != null ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
        fontWeight: bold ? 600 : 500,
      }}>
        {t.planned}
      </span>
      {t.target != null && <span style={{ color: 'var(--color-text-tertiary)' }}>∕{t.target}</span>}
    </span>
  );
}

export function MacroReviewTableView({
  weeks,
  rows,
  metric,
  onMetricChange,
  detailMetrics,
  selectedWeekStart = null,
  onSelectWeek,
}: MacroReviewTableViewProps) {
  if (weeks.length === 0) return null;

  const selectedIdx = weeks.findIndex(w => w.weekStart === selectedWeekStart);
  // The selected column widens to fit its detail metrics.
  const detailCount = Math.max(detailMetrics.length, 1);
  const gridTemplateColumns = [
    `${LABEL_COL}px`,
    ...weeks.map((_, i) =>
      i === selectedIdx && detailCount > 1
        ? `minmax(${detailCount * 58}px, ${detailCount}fr)`
        : 'minmax(0, 1fr)'
    ),
  ].join(' ');

  const colBg = (idx: number): string | undefined =>
    idx === selectedIdx ? 'var(--color-accent-muted)' : undefined;

  const renderCell = (row: ReviewRow, cell: ReviewCell, i: number) => {
    if (i === selectedIdx) {
      const shown = detailMetrics.length > 0 ? detailMetrics : [metric];
      const nonEmpty = shown.filter(m => !pairEmpty(cell[m]));
      if (nonEmpty.length === 0) return '';
      return (
        <span style={{ display: 'inline-flex', gap: 8, justifyContent: 'center' }}>
          {nonEmpty.map(m => (
            <span key={m} style={{ whiteSpace: 'nowrap' }}>
              {shown.length > 1 && (
                <span style={{
                  fontSize: 7.5, color: 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-sans)', marginRight: 2,
                }}>
                  {REVIEW_METRIC_LABELS[m]}
                </span>
              )}
              <Pair pair={cell[m]} bold={row.kind !== 'exercise'} />
            </span>
          ))}
        </span>
      );
    }
    const p = cell[metric];
    if (pairEmpty(p)) return '';
    return <Pair pair={p} bold={row.kind !== 'exercise'} />;
  };

  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
      {/* Header: metric switcher + week numbers */}
      <div style={{ display: 'grid', gridTemplateColumns }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, paddingBottom: 2 }}>
          {(Object.keys(REVIEW_METRIC_LABELS) as ReviewMetric[]).map(m => {
            const active = m === metric;
            return (
              <button
                key={m}
                onClick={onMetricChange ? () => onMetricChange(m) : undefined}
                title={m === 'reps' ? 'Rep target (K)' : m === 'max' ? 'Max target' : 'Average target'}
                style={{
                  padding: '1px 6px',
                  fontSize: 8.5, lineHeight: '12px',
                  fontFamily: 'var(--font-sans)', fontWeight: 600,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  background: active ? 'var(--color-accent-muted)' : 'transparent',
                  color: active ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                  border: '0.5px solid',
                  borderColor: active ? 'var(--color-accent-border)' : 'var(--color-border-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: onMetricChange ? 'pointer' : 'default',
                }}
              >
                {REVIEW_METRIC_LABELS[m]}
              </button>
            );
          })}
        </div>
        {weeks.map((w, i) => {
          const hasNote = !!w.note && w.note.trim() !== '';
          return (
            <div
              key={w.weekStart}
              onClick={onSelectWeek ? () => onSelectWeek(w.weekStart) : undefined}
              title={hasNote ? `Week ${w.weekNumber} · ✎ ${w.note}` : `Week ${w.weekNumber}`}
              style={{
                textAlign: 'center', fontSize: 9, lineHeight: '16px',
                color: i === selectedIdx ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                fontWeight: i === selectedIdx ? 700 : 400,
                background: colBg(i),
                borderRadius: '3px 3px 0 0',
                cursor: onSelectWeek ? 'pointer' : 'default',
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {w.weekNumber}
              {hasNote && (
                <span style={{
                  display: 'inline-block', verticalAlign: 'middle',
                  width: 3.5, height: 3.5, borderRadius: '50%',
                  background: 'var(--color-text-secondary)',
                  marginLeft: 3, marginTop: -1,
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Rows */}
      {rows.map(row => (
        <div
          key={row.key}
          style={{
            display: 'grid', gridTemplateColumns,
            background: row.kind !== 'exercise' ? 'var(--color-bg-secondary)' : undefined,
            borderTop: row.kind !== 'exercise'
              ? '0.5px solid var(--color-border-tertiary)'
              : undefined,
            borderBottom: row.kind === 'total'
              ? '0.5px solid var(--color-border-secondary)'
              : undefined,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
            paddingLeft: row.kind === 'exercise' ? 12 : 2,
            fontFamily: 'var(--font-sans)',
            fontSize: row.kind === 'exercise' ? 10 : 9.5,
            lineHeight: '18px',
            fontWeight: row.kind === 'total' ? 700 : row.kind === 'category' ? 600 : 400,
            textTransform: row.kind !== 'exercise' ? 'uppercase' : undefined,
            letterSpacing: row.kind !== 'exercise' ? '0.05em' : undefined,
            color: row.kind === 'total'
              ? 'var(--color-text-secondary)'
              : row.kind === 'category' ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {row.kind === 'exercise' && row.color && (
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: row.color,
              }} />
            )}
            {row.label}
          </div>

          {row.cells.map((cell, i) => (
            <div
              key={weeks[i].weekStart}
              title={cellTooltip(row, weeks[i], cell)}
              onClick={onSelectWeek ? () => onSelectWeek(weeks[i].weekStart) : undefined}
              style={{
                textAlign: 'center', fontSize: 9.5, lineHeight: '18px',
                background: colBg(i),
                cursor: onSelectWeek ? 'pointer' : 'default',
                whiteSpace: 'nowrap', overflow: 'hidden',
              }}
            >
              {renderCell(row, cell, i)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Container ────────────────────────────────────────────────────────────────

const METRIC_STORAGE_KEY = 'emos.planner.macroTableMetric';

const isReviewMetric = (v: string): v is ReviewMetric =>
  v === 'reps' || v === 'max' || v === 'avg';

export interface MacroReviewTableProps {
  cycleId: string;
  athleteId: string | null;
  groupId: string | null;
  selectedWeekStart?: string | null;
  onSelectWeek?: (weekStart: string) => void;
}

export function MacroReviewTable({
  cycleId,
  athleteId,
  groupId,
  selectedWeekStart = null,
  onSelectWeek,
}: MacroReviewTableProps) {
  const { settings, fetchSettingsSilent } = useSettings();
  const [macroWeeks, setMacroWeeks] = useState<MacroWeek[]>([]);
  const [tracked, setTracked] = useState<MacroTrackedExerciseWithExercise[]>([]);
  const [targets, setTargets] = useState<MacroTarget[]>([]);
  const [programmed, setProgrammed] = useState<Map<string, WeeklyProgrammed>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<ReviewMetric>(() => {
    const stored = localStorage.getItem(METRIC_STORAGE_KEY) ?? '';
    return isReviewMetric(stored) ? stored : 'reps';
  });

  useEffect(() => {
    void fetchSettingsSilent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMetricChange = (m: ReviewMetric) => {
    setMetric(m);
    localStorage.setItem(METRIC_STORAGE_KEY, m);
  };

  const detailMetrics: ReviewMetric[] = useMemo(() => {
    const configured = settings?.timeline_week_detail;
    if (!configured) return ['reps', 'max', 'avg'];
    return configured.filter(isReviewMetric);
  }, [settings?.timeline_week_detail]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [weeksRes, trackedRes] = await Promise.all([
          supabase
            .from('macro_weeks')
            .select('*')
            .eq('macrocycle_id', cycleId)
            .order('week_number'),
          supabase
            .from('macro_tracked_exercises')
            .select('*, exercise:exercise_id(id, name, category, color)')
            .eq('macrocycle_id', cycleId)
            .order('position'),
        ]);
        if (weeksRes.error) throw weeksRes.error;
        if (trackedRes.error) throw trackedRes.error;
        const weeks = (weeksRes.data as MacroWeek[]) ?? [];
        const weekIds = weeks.map(w => w.id);

        const [targetsRes, programmedMap] = await Promise.all([
          weekIds.length > 0
            ? supabase.from('macro_targets').select('*').in('macro_week_id', weekIds)
            : Promise.resolve({ data: [], error: null }),
          weeks.length > 0
            ? fetchWeeklyProgrammed(
                athleteId,
                groupId,
                weeks[0].week_start,
                weeks[weeks.length - 1].week_start
              )
            : Promise.resolve(new Map<string, WeeklyProgrammed>()),
        ]);
        if (targetsRes.error) throw targetsRes.error;

        if (cancelled) return;
        setMacroWeeks(weeks);
        setTracked((trackedRes.data as unknown as MacroTrackedExerciseWithExercise[]) ?? []);
        setTargets((targetsRes.data as MacroTarget[]) ?? []);
        setProgrammed(programmedMap);
      } catch (err) {
        if (cancelled) return;
        console.error('MacroReviewTable: load failed', err);
        setMacroWeeks([]);
        setTracked([]);
        setTargets([]);
        setProgrammed(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cycleId, athleteId, groupId]);

  const { weeks, rows } = useMemo(() => {
    const weeks: ReviewWeek[] = macroWeeks.map(w => ({
      weekStart: w.week_start,
      weekNumber: w.week_number,
      note: w.notes ?? '',
    }));

    const trackedById = new Map(tracked.map(te => [te.id, te]));
    const weekStartById = new Map(macroWeeks.map(w => [w.id, w.week_start]));
    // weekStart|exerciseId → macro target row
    const targetByWeekAndExercise = new Map<string, MacroTarget>();
    for (const t of targets) {
      const te = trackedById.get(t.tracked_exercise_id);
      const ws = weekStartById.get(t.macro_week_id);
      if (!te || !ws) continue;
      targetByWeekAndExercise.set(`${ws}|${te.exercise_id}`, t);
    }
    const targetFor = (weekStart: string, exerciseId: string): MacroTarget | undefined =>
      targetByWeekAndExercise.get(`${weekStart}|${exerciseId}`);

    // Categories in order of first appearance among tracked lifts.
    const categories: string[] = [];
    for (const te of tracked) {
      const cat = te.exercise.category || 'other';
      if (!categories.includes(cat)) categories.push(cat);
    }

    const rows: ReviewRow[] = [];

    // Week totals — the general metrics of the whole week. Rep target comes
    // from the macro week (total_reps_target); max/avg have no week-level
    // macro target (avg_intensity_target is a % and would mismatch the kg
    // planned values), so those show the planned side only.
    rows.push({
      key: 'week-total',
      kind: 'total',
      label: 'Week total',
      cells: macroWeeks.map(mw => {
        const p = programmed.get(mw.week_start);
        return {
          reps: { planned: p != null && p.reps > 0 ? p.reps : null, target: mw.total_reps_target },
          max: { planned: p?.maxLoad ?? null, target: null },
          avg: { planned: p?.avgLoad ?? null, target: null },
        };
      }),
    });

    for (const cat of categories) {
      const catTracked = tracked.filter(te => (te.exercise.category || 'other') === cat);

      rows.push({
        key: `cat-${cat}`,
        kind: 'category',
        label: cat,
        cells: weeks.map(w => {
          const stats = programmed.get(w.weekStart)?.byCategory.get(cat);
          let repsTarget: number | null = null;
          let maxTarget: number | null = null;
          for (const te of catTracked) {
            const t = targetFor(w.weekStart, te.exercise_id);
            if (t?.target_reps != null) repsTarget = (repsTarget ?? 0) + t.target_reps;
            if (t?.target_max != null) maxTarget = maxTarget == null ? t.target_max : Math.max(maxTarget, t.target_max);
          }
          return {
            reps: { planned: stats?.reps ?? null, target: repsTarget },
            max: { planned: stats?.maxLoad ?? null, target: maxTarget },
            // Averaging avg-targets across different lifts has no meaning.
            avg: { planned: stats?.avgLoad ?? null, target: null },
          };
        }),
      });

      for (const te of catTracked) {
        rows.push({
          key: `ex-${te.id}`,
          kind: 'exercise',
          label: te.exercise.name,
          color: getExerciseCategoryShade(
            te.exercise.id,
            te.exercise.color,
            te.exercise.category,
            tracked
          ),
          cells: weeks.map(w => {
            const stats = programmed.get(w.weekStart)?.byExercise.get(te.exercise_id);
            const t = targetFor(w.weekStart, te.exercise_id);
            return {
              reps: { planned: stats?.reps ?? null, target: t?.target_reps ?? null },
              max: { planned: stats?.maxLoad ?? null, target: t?.target_max ?? null },
              avg: { planned: stats?.avgLoad ?? null, target: t?.target_avg ?? null },
            };
          }),
        });
      }
    }

    return { weeks, rows };
  }, [macroWeeks, tracked, targets, programmed]);

  if (loading) {
    return (
      <div style={{
        padding: '8px 0', fontSize: 'var(--text-caption)',
        color: 'var(--color-text-tertiary)',
      }}>
        Loading macro table…
      </div>
    );
  }

  if (tracked.length === 0) {
    return (
      <div style={{
        padding: '8px 0', fontSize: 'var(--text-caption)',
        color: 'var(--color-text-tertiary)',
      }}>
        No tracked lifts in this macro — add them on the macro cycle page to review targets here.
      </div>
    );
  }

  return (
    <MacroReviewTableView
      weeks={weeks}
      rows={rows}
      metric={metric}
      onMetricChange={handleMetricChange}
      detailMetrics={detailMetrics}
      selectedWeekStart={selectedWeekStart}
      onSelectWeek={onSelectWeek}
    />
  );
}
