// MacroReviewTable — read-only review grid shown under the macro timeline in
// the Weekly Planner header (toggleable). Weeks as columns (mirroring the
// timeline), rows per exercise category and per tracked lift. Each cell
// compares the reps programmed in the weekly planner (micro-level plan)
// against the macro-level target: `planned∕target`.
//
// Category rows aggregate ALL programmed work of that category — including
// lifts that aren't tracked in the macro — so the coach sees total category
// volume; targets aggregate across the macro's tracked lifts only (that's
// where targets live).

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchWeeklyProgrammed, type WeeklyProgrammed } from '../../lib/macroTimelineData';
import { getExerciseCategoryShade } from '../../lib/colorUtils';
import type { MacroTarget, MacroTrackedExerciseWithExercise, MacroWeek } from '../../lib/database.types';

// ── Pure view ────────────────────────────────────────────────────────────────

export interface ReviewWeek {
  weekStart: string;
  weekNumber: number;
}

export interface ReviewCell {
  planned: number | null;
  target: number | null;
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
  rows: ReviewRow[];
  selectedWeekStart?: string | null;
  onSelectWeek?: (weekStart: string) => void;
}

const LABEL_COL = 130;

function cellText(c: ReviewCell): { planned: string; target: string | null } {
  return {
    planned: c.planned != null ? String(c.planned) : '–',
    target: c.target != null ? String(c.target) : null,
  };
}

function cellTooltip(row: ReviewRow, week: ReviewWeek, c: ReviewCell): string {
  const parts = [`W${week.weekNumber} · ${row.label}`];
  parts.push(`Planned ${c.planned ?? '–'}`);
  if (c.target != null) {
    const pct = c.planned != null && c.target > 0 ? ` (${Math.round((c.planned / c.target) * 100)} %)` : '';
    parts.push(`Target ${c.target}${pct}`);
  }
  return parts.join(' · ');
}

export function MacroReviewTableView({
  weeks,
  rows,
  selectedWeekStart = null,
  onSelectWeek,
}: MacroReviewTableViewProps) {
  if (weeks.length === 0) return null;

  const gridTemplateColumns = `${LABEL_COL}px repeat(${weeks.length}, 1fr)`;
  const selectedIdx = weeks.findIndex(w => w.weekStart === selectedWeekStart);

  const colBg = (idx: number): string | undefined =>
    idx === selectedIdx ? 'var(--color-accent-muted)' : undefined;

  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
      {/* Header: week numbers */}
      <div style={{ display: 'grid', gridTemplateColumns }}>
        <div style={{
          fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-sans)',
          display: 'flex', alignItems: 'flex-end', paddingBottom: 2,
        }}>
          planned ∕ target
        </div>
        {weeks.map((w, i) => (
          <div
            key={w.weekStart}
            onClick={onSelectWeek ? () => onSelectWeek(w.weekStart) : undefined}
            title={`Week ${w.weekNumber}`}
            style={{
              textAlign: 'center', fontSize: 9, lineHeight: '16px',
              color: i === selectedIdx ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              fontWeight: i === selectedIdx ? 700 : 400,
              background: colBg(i),
              borderRadius: '3px 3px 0 0',
              cursor: onSelectWeek ? 'pointer' : 'default',
              userSelect: 'none',
            }}
          >
            {w.weekNumber}
          </div>
        ))}
      </div>

      {/* Rows */}
      {rows.map(row => (
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

          {row.cells.map((c, i) => {
            const t = cellText(c);
            const empty = c.planned == null && c.target == null;
            return (
              <div
                key={weeks[i].weekStart}
                title={empty ? undefined : cellTooltip(row, weeks[i], c)}
                onClick={onSelectWeek ? () => onSelectWeek(weeks[i].weekStart) : undefined}
                style={{
                  textAlign: 'center', fontSize: 9.5, lineHeight: '18px',
                  background: colBg(i),
                  cursor: onSelectWeek ? 'pointer' : 'default',
                  whiteSpace: 'nowrap', overflow: 'hidden',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                {empty ? '' : (
                  <>
                    <span style={{
                      color: c.planned != null ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                      fontWeight: row.kind === 'category' ? 600 : 500,
                    }}>
                      {t.planned}
                    </span>
                    {t.target != null && <span>∕{t.target}</span>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Container ────────────────────────────────────────────────────────────────

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
  const [macroWeeks, setMacroWeeks] = useState<MacroWeek[]>([]);
  const [tracked, setTracked] = useState<MacroTrackedExerciseWithExercise[]>([]);
  const [targets, setTargets] = useState<MacroTarget[]>([]);
  const [programmed, setProgrammed] = useState<Map<string, WeeklyProgrammed>>(() => new Map());
  const [loading, setLoading] = useState(true);

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
    }));

    const targetByWeekAndExercise = new Map<string, number>();
    const trackedById = new Map(tracked.map(te => [te.id, te]));
    for (const t of targets) {
      if (t.target_reps == null) continue;
      const te = trackedById.get(t.tracked_exercise_id);
      if (!te) continue;
      const mw = macroWeeks.find(w => w.id === t.macro_week_id);
      if (!mw) continue;
      targetByWeekAndExercise.set(`${mw.week_start}|${te.exercise_id}`, t.target_reps);
    }

    // Categories in order of first appearance among tracked lifts.
    const categories: string[] = [];
    for (const te of tracked) {
      const cat = te.exercise.category || 'other';
      if (!categories.includes(cat)) categories.push(cat);
    }

    const rows: ReviewRow[] = [];
    for (const cat of categories) {
      const catTracked = tracked.filter(te => (te.exercise.category || 'other') === cat);

      rows.push({
        key: `cat-${cat}`,
        kind: 'category',
        label: cat,
        cells: weeks.map(w => {
          const planned = programmed.get(w.weekStart)?.repsByCategory.get(cat) ?? null;
          let target: number | null = null;
          for (const te of catTracked) {
            const t = targetByWeekAndExercise.get(`${w.weekStart}|${te.exercise_id}`);
            if (t != null) target = (target ?? 0) + t;
          }
          return { planned, target };
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
          cells: weeks.map(w => ({
            planned: programmed.get(w.weekStart)?.repsByExercise.get(te.exercise_id) ?? null,
            target: targetByWeekAndExercise.get(`${w.weekStart}|${te.exercise_id}`) ?? null,
          })),
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
      selectedWeekStart={selectedWeekStart}
      onSelectWeek={onSelectWeek}
    />
  );
}
