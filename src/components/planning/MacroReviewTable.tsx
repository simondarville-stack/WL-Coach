// MacroReviewTable — read-only review grid shown under the macro timeline in
// the Weekly Planner header (toggleable). Two levels:
//
// 1. GENERAL table (always shown when the table is open): one row per
//    week-level guiding metric — Σ reps, tonnage, heaviest load, Ø load —
//    each cell `planned∕target` against the macro week. This is the guiding
//    principle level.
// 2. LIFTS & CATEGORIES (expandable): the detailed per-category / per-lift
//    grid with a K / Max / Ø metric switcher; the active (selected) week's
//    column expands to every metric chosen in settings
//    (timeline_week_detail), so the week being planned is reviewed at full
//    detail while the rest of the macro stays compact.
//
// Category rows aggregate ALL programmed work of that category — including
// lifts that aren't tracked in the macro — so the coach sees total category
// volume; targets aggregate across the macro's tracked lifts only (that's
// where targets live). Aggregation per metric: reps sum, max takes the
// heaviest, avg is rep-weighted (target avg is not aggregated — averaging
// targets across different lifts has no meaning).

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSettings } from '../../hooks/useSettings';
import {
  fetchWeeklyPerformed,
  fetchWeeklyProgrammed,
  resolveScopeAthleteIds,
  type WeeklyPerformed,
  type WeeklyProgrammed,
} from '../../lib/macroTimelineData';
import { getExerciseCategoryShade } from '../../lib/colorUtils';
import type { MacroTarget, MacroTrackedExerciseWithExercise, MacroWeek } from '../../lib/database.types';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReviewMetric = 'reps' | 'max' | 'avg';

// Canonical macro-metric vocabulary — must match the macro table/toggle bar
// (Σreps / Max / Avg). 'K' is NOT used for reps here: on the macro page 'K'
// already means the K-value column (tonnage ÷ competition total).
export const REVIEW_METRIC_LABELS: Record<ReviewMetric, string> = {
  reps: 'Σreps',
  max: 'Max',
  avg: 'Avg',
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
  /** Performed (logged) value; rendered as a third ∕done element coloured
   *  by compliance against `planned`. */
  done?: number | null;
}

/** All metric pairs for one lift-row × week. */
export type ReviewCell = Record<ReviewMetric, ReviewPair>;

/** One guiding-metric row of the general table. */
export interface GeneralRow {
  key: string;
  label: string;
  /** One pair per week, same order as `weeks`. */
  cells: ReviewPair[];
  /** Optional value formatter (e.g. kg → t). */
  format?: (v: number) => string;
}

export interface ReviewRow {
  key: string;
  kind: 'category' | 'exercise';
  label: string;
  /** Dot color for exercise rows (category shade). */
  color?: string;
  /** One cell per week, same order as `weeks`. */
  cells: ReviewCell[];
}

export interface MacroReviewTableViewProps {
  weeks: ReviewWeek[];
  generalRows: GeneralRow[];
  liftRows: ReviewRow[];
  expanded: boolean;
  onToggleExpanded?: () => void;
  /** Metric shown in the compact (non-selected) lift columns. */
  metric: ReviewMetric;
  onMetricChange?: (metric: ReviewMetric) => void;
  /** Metrics expanded on the selected week's column (lift rows). */
  detailMetrics: ReviewMetric[];
  /** Compliance threshold (done / planned) as a fraction. Default 0.9. */
  complianceThreshold?: number;
  selectedWeekStart?: string | null;
  onSelectWeek?: (weekStart: string) => void;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const LABEL_COL = 130;

/** Loads print with comma decimals when fractional (German locale). */
function fmtValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}

function pairEmpty(p: ReviewPair): boolean {
  return p.planned == null && p.target == null && p.done == null;
}

/** true = compliant, false = under threshold, null = not comparable. */
function complianceOf(p: ReviewPair, threshold: number): boolean | null {
  if (p.done == null || p.planned == null || p.planned <= 0) return null;
  return p.done / p.planned >= threshold;
}

function pairTooltip(label: string, week: ReviewWeek, p: ReviewPair, fmt: (v: number) => string): string {
  const parts = [`W${week.weekNumber} · ${label}`];
  parts.push(`Planned ${p.planned != null ? fmt(p.planned) : '–'}`);
  if (p.target != null) {
    const pct = p.planned != null && p.target > 0 ? ` (${Math.round((p.planned / p.target) * 100)} %)` : '';
    parts.push(`Target ${fmt(p.target)}${pct}`);
  }
  if (p.done != null) {
    const pct = p.planned != null && p.planned > 0 ? ` (${Math.round((p.done / p.planned) * 100)} % of plan)` : '';
    parts.push(`Done ${fmt(p.done)}${pct}`);
  }
  return parts.join(' · ');
}

function liftCellTooltip(row: ReviewRow, week: ReviewWeek, cell: ReviewCell): string {
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

function Pair({ pair, bold, format = fmtValue, threshold = 0.9 }: {
  pair: ReviewPair; bold?: boolean; format?: (v: number) => string; threshold?: number;
}) {
  const compliant = complianceOf(pair, threshold);
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{
        color: pair.planned != null ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
        fontWeight: bold ? 600 : 500,
      }}>
        {pair.planned != null ? format(pair.planned) : '–'}
      </span>
      {pair.target != null && <span style={{ color: 'var(--color-text-tertiary)' }}>∕{format(pair.target)}</span>}
      {pair.done != null && (
        <span style={{
          fontWeight: 600,
          color: compliant == null
            ? 'var(--color-text-secondary)'
            : compliant ? 'var(--color-success-text)' : 'var(--color-warning-text)',
        }}>
          ∕{format(pair.done)}
        </span>
      )}
    </span>
  );
}

export function MacroReviewTableView({
  weeks,
  generalRows,
  liftRows,
  expanded,
  onToggleExpanded,
  metric,
  onMetricChange,
  detailMetrics,
  complianceThreshold = 0.9,
  selectedWeekStart = null,
  onSelectWeek,
}: MacroReviewTableViewProps) {
  if (weeks.length === 0) return null;

  const anyDone =
    generalRows.some(r => r.cells.some(c => c.done != null)) ||
    liftRows.some(r => r.cells.some(c =>
      (Object.keys(REVIEW_METRIC_LABELS) as ReviewMetric[]).some(m => c[m].done != null)
    ));

  const selectedIdx = weeks.findIndex(w => w.weekStart === selectedWeekStart);
  // The selected column widens to fit the lift rows' detail metrics — only
  // relevant while the lift level is expanded.
  const detailCount = expanded ? Math.max(detailMetrics.length, 1) : 1;
  const gridTemplateColumns = [
    `${LABEL_COL}px`,
    ...weeks.map((_, i) =>
      i === selectedIdx && detailCount > 1
        ? `minmax(${detailCount * 58}px, ${detailCount}fr)`
        // 58px floor fits a 3-digit planned∕target∕done triple — long macros
        // scroll horizontally instead of silently clipping digits.
        : 'minmax(58px, 1fr)'
    ),
  ].join(' ');

  const colBg = (idx: number): string | undefined =>
    idx === selectedIdx ? 'var(--color-accent-muted)' : undefined;

  const cellBase: React.CSSProperties = {
    textAlign: 'center', fontSize: 9.5, lineHeight: '18px',
    whiteSpace: 'nowrap', overflow: 'hidden',
    cursor: onSelectWeek ? 'pointer' : 'default',
  };

  const renderLiftCell = (row: ReviewRow, cell: ReviewCell, i: number) => {
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
              <Pair pair={cell[m]} bold={row.kind === 'category'} threshold={complianceThreshold} />
            </span>
          ))}
        </span>
      );
    }
    const p = cell[metric];
    if (pairEmpty(p)) return '';
    return <Pair pair={p} bold={row.kind === 'category'} threshold={complianceThreshold} />;
  };

  return (
    <div style={{ overflowX: 'auto' }}>
    <div style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', width: 'fit-content', minWidth: '100%' }}>
      {/* Header: week numbers + note dots */}
      <div style={{ display: 'grid', gridTemplateColumns }}>
        <div style={{
          fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-sans)',
          display: 'flex', alignItems: 'flex-end', paddingBottom: 2,
        }}>
          {anyDone ? 'planned ∕ target ∕ done' : 'planned ∕ target'}
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

      {/* General level — the guiding week metrics */}
      {generalRows.map(row => (
        <div
          key={row.key}
          style={{ display: 'grid', gridTemplateColumns, borderTop: '0.5px solid var(--color-border-tertiary)' }}
        >
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: 10, lineHeight: '18px',
            fontWeight: 500, color: 'var(--color-text-secondary)',
            paddingLeft: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {row.label}
          </div>
          {row.cells.map((p, i) => (
            <div
              key={weeks[i].weekStart}
              title={pairEmpty(p) ? undefined : pairTooltip(row.label, weeks[i], p, row.format ?? fmtValue)}
              onClick={onSelectWeek ? () => onSelectWeek(weeks[i].weekStart) : undefined}
              style={{ ...cellBase, background: colBg(i) }}
            >
              {pairEmpty(p) ? '' : <Pair pair={p} bold format={row.format} threshold={complianceThreshold} />}
            </div>
          ))}
        </div>
      ))}

      {/* Expand control + metric switcher for the lift level */}
      {onToggleExpanded && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          borderTop: '0.5px solid var(--color-border-tertiary)',
          padding: '2px 0',
        }}>
          <button
            onClick={onToggleExpanded}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 4px', background: 'transparent', border: 'none',
              fontSize: 9, fontFamily: 'var(--font-sans)', fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--color-text-tertiary)', cursor: 'pointer',
            }}
            title={expanded ? 'Collapse lift detail' : 'Expand per-lift and per-category detail'}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Lifts & categories
          </button>
          {expanded && onMetricChange && (
            <span style={{ display: 'inline-flex', gap: 2 }}>
              {(Object.keys(REVIEW_METRIC_LABELS) as ReviewMetric[]).map(m => {
                const active = m === metric;
                return (
                  <button
                    key={m}
                    onClick={() => onMetricChange(m)}
                    title={m === 'reps' ? 'Σreps target' : m === 'max' ? 'Max target' : 'Average load target'}
                    style={{
                      padding: '0px 6px',
                      fontSize: 8.5, lineHeight: '12px',
                      fontFamily: 'var(--font-sans)', fontWeight: 600,
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                      background: active ? 'var(--color-accent-muted)' : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                      border: '0.5px solid',
                      borderColor: active ? 'var(--color-accent-border)' : 'var(--color-border-tertiary)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    {REVIEW_METRIC_LABELS[m]}
                  </button>
                );
              })}
            </span>
          )}
        </div>
      )}

      {/* Lift level (expanded) */}
      {expanded && liftRows.map(row => (
        <div
          key={row.key}
          style={{
            display: 'grid', gridTemplateColumns,
            background: row.kind === 'category' ? 'var(--color-bg-secondary)' : undefined,
            borderTop: row.kind === 'category'
              ? '0.5px solid var(--color-border-tertiary)'
              : undefined,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
            paddingLeft: row.kind === 'exercise' ? 12 : 2,
            fontFamily: 'var(--font-sans)',
            fontSize: row.kind === 'category' ? 9.5 : 10,
            lineHeight: '18px',
            fontWeight: row.kind === 'category' ? 600 : 400,
            textTransform: row.kind === 'category' ? 'uppercase' : undefined,
            letterSpacing: row.kind === 'category' ? '0.05em' : undefined,
            color: row.kind === 'category' ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
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
              title={liftCellTooltip(row, weeks[i], cell)}
              onClick={onSelectWeek ? () => onSelectWeek(weeks[i].weekStart) : undefined}
              style={{ ...cellBase, background: colBg(i) }}
            >
              {renderLiftCell(row, cell, i)}
            </div>
          ))}
        </div>
      ))}
    </div>
    </div>
  );
}

// ── Container ────────────────────────────────────────────────────────────────

const METRIC_STORAGE_KEY = 'emos.planner.macroTableMetric';
const LIFTS_STORAGE_KEY = 'emos.planner.macroTableLifts';

const isReviewMetric = (v: string): v is ReviewMetric =>
  v === 'reps' || v === 'max' || v === 'avg';

const formatTonnageT = (kg: number): string =>
  (Math.round(kg / 100) / 10).toFixed(1).replace('.', ',');

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
  const [performed, setPerformed] = useState<Map<string, WeeklyPerformed>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<ReviewMetric>(() => {
    const stored = localStorage.getItem(METRIC_STORAGE_KEY) ?? '';
    return isReviewMetric(stored) ? stored : 'reps';
  });
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(LIFTS_STORAGE_KEY) === '1'
  );

  useEffect(() => {
    void fetchSettingsSilent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMetricChange = (m: ReviewMetric) => {
    setMetric(m);
    localStorage.setItem(METRIC_STORAGE_KEY, m);
  };

  const handleToggleExpanded = () => {
    setExpanded(prev => {
      localStorage.setItem(LIFTS_STORAGE_KEY, prev ? '0' : '1');
      return !prev;
    });
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

        const rangeStart = weeks.length > 0 ? weeks[0].week_start : null;
        const rangeEnd = weeks.length > 0 ? weeks[weeks.length - 1].week_start : null;
        const [targetsRes, programmedMap, performedMap] = await Promise.all([
          weekIds.length > 0
            ? supabase.from('macro_targets').select('*').in('macro_week_id', weekIds)
            : Promise.resolve({ data: [], error: null }),
          rangeStart && rangeEnd
            ? fetchWeeklyProgrammed(athleteId, groupId, rangeStart, rangeEnd)
            : Promise.resolve(new Map<string, WeeklyProgrammed>()),
          rangeStart && rangeEnd
            ? resolveScopeAthleteIds(athleteId, groupId).then(ids =>
                fetchWeeklyPerformed(ids, rangeStart, rangeEnd))
            : Promise.resolve(new Map<string, WeeklyPerformed>()),
        ]);
        if (targetsRes.error) throw targetsRes.error;

        if (cancelled) return;
        setMacroWeeks(weeks);
        setTracked((trackedRes.data as unknown as MacroTrackedExerciseWithExercise[]) ?? []);
        setTargets((targetsRes.data as MacroTarget[]) ?? []);
        setProgrammed(programmedMap);
        setPerformed(performedMap);
      } catch (err) {
        if (cancelled) return;
        console.error('MacroReviewTable: load failed', err);
        setMacroWeeks([]);
        setTracked([]);
        setTargets([]);
        setProgrammed(new Map());
        setPerformed(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cycleId, athleteId, groupId]);

  const { weeks, generalRows, liftRows } = useMemo(() => {
    const weeks: ReviewWeek[] = macroWeeks.map(w => ({
      weekStart: w.week_start,
      weekNumber: w.week_number,
      note: w.notes ?? '',
    }));

    // ── General level: guiding week metrics ──
    const val = (v: number | null | undefined): number | null =>
      v != null && v > 0 ? v : null;
    const allGeneral: GeneralRow[] = [
      {
        key: 'g-reps',
        label: 'Σreps',
        cells: macroWeeks.map(mw => ({
          planned: val(programmed.get(mw.week_start)?.reps),
          target: mw.total_reps_target,
          done: val(performed.get(mw.week_start)?.reps),
        })),
      },
      {
        key: 'g-tonnage',
        label: 'Tonnage (t)',
        format: formatTonnageT,
        cells: macroWeeks.map(mw => ({
          planned: val(programmed.get(mw.week_start)?.tonnage),
          target: mw.tonnage_target,
          done: val(performed.get(mw.week_start)?.tonnage),
        })),
      },
      {
        key: 'g-max',
        label: 'Max (kg)',
        cells: macroWeeks.map(mw => ({
          planned: programmed.get(mw.week_start)?.maxLoad ?? null,
          target: null,
          done: performed.get(mw.week_start)?.maxLoad ?? null,
        })),
      },
      {
        key: 'g-avg',
        label: 'Avg (kg)',
        cells: macroWeeks.map(mw => ({
          planned: programmed.get(mw.week_start)?.avgLoad ?? null,
          target: null,
          done: performed.get(mw.week_start)?.avgLoad ?? null,
        })),
      },
    ];
    const generalRows = allGeneral.filter(r => r.cells.some(c => !pairEmpty(c)));

    // ── Lift level ──
    const trackedById = new Map(tracked.map(te => [te.id, te]));
    const weekStartById = new Map(macroWeeks.map(w => [w.id, w.week_start]));
    const targetByWeekAndExercise = new Map<string, MacroTarget>();
    for (const t of targets) {
      const te = trackedById.get(t.tracked_exercise_id);
      const ws = weekStartById.get(t.macro_week_id);
      if (!te || !ws) continue;
      targetByWeekAndExercise.set(`${ws}|${te.exercise_id}`, t);
    }
    const targetFor = (weekStart: string, exerciseId: string): MacroTarget | undefined =>
      targetByWeekAndExercise.get(`${weekStart}|${exerciseId}`);

    const categories: string[] = [];
    for (const te of tracked) {
      const cat = te.exercise.category || 'other';
      if (!categories.includes(cat)) categories.push(cat);
    }

    const liftRows: ReviewRow[] = [];
    for (const cat of categories) {
      const catTracked = tracked.filter(te => (te.exercise.category || 'other') === cat);

      liftRows.push({
        key: `cat-${cat}`,
        kind: 'category',
        label: cat,
        cells: macroWeeks.map(mw => {
          const stats = programmed.get(mw.week_start)?.byCategory.get(cat);
          const done = performed.get(mw.week_start)?.byCategory.get(cat);
          let repsTarget: number | null = null;
          let maxTarget: number | null = null;
          for (const te of catTracked) {
            const t = targetFor(mw.week_start, te.exercise_id);
            if (t?.target_reps != null) repsTarget = (repsTarget ?? 0) + t.target_reps;
            if (t?.target_max != null) maxTarget = maxTarget == null ? t.target_max : Math.max(maxTarget, t.target_max);
          }
          return {
            reps: { planned: stats?.reps ?? null, target: repsTarget, done: done?.reps ?? null },
            max: { planned: stats?.maxLoad ?? null, target: maxTarget, done: done?.maxLoad ?? null },
            // Averaging avg-targets across different lifts has no meaning.
            avg: { planned: stats?.avgLoad ?? null, target: null, done: done?.avgLoad ?? null },
          };
        }),
      });

      for (const te of catTracked) {
        liftRows.push({
          key: `ex-${te.id}`,
          kind: 'exercise',
          label: te.exercise.name,
          color: getExerciseCategoryShade(
            te.exercise.id,
            te.exercise.color,
            te.exercise.category,
            tracked
          ),
          cells: macroWeeks.map(mw => {
            const stats = programmed.get(mw.week_start)?.byExercise.get(te.exercise_id);
            const done = performed.get(mw.week_start)?.byExercise.get(te.exercise_id);
            const t = targetFor(mw.week_start, te.exercise_id);
            return {
              reps: { planned: stats?.reps ?? null, target: t?.target_reps ?? null, done: done?.reps ?? null },
              max: { planned: stats?.maxLoad ?? null, target: t?.target_max ?? null, done: done?.maxLoad ?? null },
              avg: { planned: stats?.avgLoad ?? null, target: t?.target_avg ?? null, done: done?.avgLoad ?? null },
            };
          }),
        });
      }
    }

    return { weeks, generalRows, liftRows };
  }, [macroWeeks, tracked, targets, programmed, performed]);

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

  if (weeks.length === 0) return null;

  return (
    <MacroReviewTableView
      weeks={weeks}
      generalRows={generalRows}
      liftRows={liftRows}
      expanded={expanded && liftRows.length > 0}
      onToggleExpanded={liftRows.length > 0 ? handleToggleExpanded : undefined}
      metric={metric}
      onMetricChange={handleMetricChange}
      detailMetrics={detailMetrics}
      complianceThreshold={(settings?.compliance_warning_threshold ?? 90) / 100}
      selectedWeekStart={selectedWeekStart}
      onSelectWeek={onSelectWeek}
    />
  );
}
