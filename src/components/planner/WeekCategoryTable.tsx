// WeekCategoryTable — the category-box table of the week header, modelled on
// the bottom table of the legacy Wochenplan software: one box per exercise
// category, one row per exercise showing code + abbreviated name, the top set
// (stacked notation), the weighted average load and the week's total reps.
//
// When the week is covered by a macro, each tracked exercise also shows its
// macro_targets row underneath (max × reps/sets · avg · Σreps), each value
// green when the plan meets it and red when the plan comes in short or too
// high — the design-time "am I on the macro?" check. Tracked exercises with a
// target but nothing planned appear as target-only rows (all red).

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Exercise, PlannedExercise, ComboMemberEntry } from '../../lib/database.types';
import { parsePrescription, parseComboPrescription } from '../../lib/prescriptionParser';
import { expandForCounting } from '../../lib/comboExpansion';
import { StackedNotation } from './StackedNotation';
import type { MacroContext } from './WeeklyPlanner';

type PlannedRow = PlannedExercise & { exercise: Exercise };

interface WeekCategoryTableProps {
  plannedExercises: Record<number, PlannedRow[]>;
  comboMembers: Record<string, ComboMemberEntry[]>;
  activeDays: number[];
  /** Full catalogue — resolves tracked exercises that have a macro target but
   *  nothing planned this week (they must still appear, all red). */
  allExercises: Exercise[];
  macroContext: MacroContext | null;
  expanded: boolean;
  onToggle: () => void;
}

interface MaxSet {
  load: number;
  loadMax: number | null;
  reps: number;
  sets: number;
  unit: string | null;
}

interface Target {
  reps: number | null;
  avg: number | null;
  max: number | null;
  repsAtMax: number | null;
  setsAtMax: number | null;
}

interface ExRow {
  exerciseId: string;
  code: string | null;
  name: string;
  category: string;
  reps: number;
  /** Weighted-avg accumulators, split by unit so kg and % never mix. */
  kgSum: number; kgReps: number;
  pctSum: number; pctReps: number;
  maxSet: MaxSet | null;
}

// COACH-CONFIG candidate — relative deviation still counted as "on target".
const TARGET_TOLERANCE = 0.05;

type TargetStatus = 'on' | 'off';
function statusOf(planned: number | null, target: number | null): TargetStatus | null {
  if (target == null) return null;
  if (planned == null || planned <= 0) return 'off';
  return Math.abs(planned - target) / target <= TARGET_TOLERANCE ? 'on' : 'off';
}
const statusColor = (s: TargetStatus | null): string =>
  s === 'on' ? 'var(--color-success-text)' : s === 'off' ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)';

const fmtNum = (v: number): string =>
  (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('.', ',');

/** Tight display name: the code carries identity; this is only a reminder. */
function abbrevName(name: string, max = 14): string {
  if (name.length <= max) return name;
  const words = name.split(/\s+/);
  const first = words[0].length > 7 ? words[0].slice(0, 6) + '.' : words[0];
  const second = words.length > 1
    ? ' ' + (words[1].length > 5 ? words[1].slice(0, 4) + '.' : words[1])
    : '';
  const s = first + second;
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

const skipExercise = (e: Exercise): boolean =>
  e.counts_towards_totals === false || !e.category || e.category === '— System';

/** Keep the higher-topping set (interval upper bound wins ties by recency). */
function keepMax(a: MaxSet | null, b: MaxSet): MaxSet {
  if (!a) return b;
  return (b.loadMax ?? b.load) > (a.loadMax ?? a.load) ? b : a;
}

const eyebrow: React.CSSProperties = {
  fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500,
};
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
const cellBase: React.CSSProperties = { padding: '3px 6px', verticalAlign: 'top' };

export function WeekCategoryTable({
  plannedExercises, comboMembers, activeDays, allExercises, macroContext, expanded, onToggle,
}: WeekCategoryTableProps) {
  const [targets, setTargets] = useState<Map<string, Target>>(new Map());

  // Macro targets for this week: macro_weeks row → macro_targets joined to
  // the macro's tracked exercises (two-step, same pattern as ExerciseDetail).
  useEffect(() => {
    let cancelled = false;
    setTargets(new Map());
    if (!macroContext || !expanded) return;
    void (async () => {
      try {
        const [{ data: mw }, { data: tracked }] = await Promise.all([
          supabase.from('macro_weeks').select('id')
            .eq('macrocycle_id', macroContext.macroId)
            .eq('week_number', macroContext.weekNumber)
            .maybeSingle(),
          supabase.from('macro_tracked_exercises').select('id, exercise_id')
            .eq('macrocycle_id', macroContext.macroId),
        ]);
        if (cancelled || !mw || !tracked || tracked.length === 0) return;
        const exByTracked = new Map(
          (tracked as Array<{ id: string; exercise_id: string }>).map(t => [t.id, t.exercise_id]),
        );
        const { data: tgts } = await supabase.from('macro_targets')
          .select('tracked_exercise_id, target_reps, target_avg, target_max, target_reps_at_max, target_sets_at_max')
          .eq('macro_week_id', (mw as { id: string }).id)
          .in('tracked_exercise_id', [...exByTracked.keys()]);
        if (cancelled) return;
        const map = new Map<string, Target>();
        // Postgres numeric columns arrive as strings — coerce before math.
        const num = (v: number | string | null): number | null => (v == null ? null : Number(v));
        for (const t of (tgts ?? []) as Array<{
          tracked_exercise_id: string; target_reps: number | null; target_avg: number | string | null;
          target_max: number | string | null; target_reps_at_max: number | null; target_sets_at_max: number | null;
        }>) {
          const exId = exByTracked.get(t.tracked_exercise_id);
          if (!exId) continue;
          if (t.target_reps == null && t.target_avg == null && t.target_max == null) continue;
          map.set(exId, {
            reps: t.target_reps, avg: num(t.target_avg), max: num(t.target_max),
            repsAtMax: t.target_reps_at_max, setsAtMax: t.target_sets_at_max,
          });
        }
        setTargets(map);
      } catch (err) {
        if (!cancelled) console.error('WeekCategoryTable: targets load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [macroContext, expanded]);

  const { boxes, totalReps } = useMemo(() => {
    const rows = new Map<string, ExRow>();
    const rowFor = (e: Exercise): ExRow => {
      let r = rows.get(e.id);
      if (!r) {
        r = {
          exerciseId: e.id, code: e.exercise_code, name: e.name, category: e.category ?? '',
          reps: 0, kgSum: 0, kgReps: 0, pctSum: 0, pctReps: 0, maxSet: null,
        };
        rows.set(e.id, r);
      }
      return r;
    };

    for (const day of activeDays) {
      for (const pe of plannedExercises[day] ?? []) {
        // Totals via the shared combo expansion — identical counting rules to
        // WeekSummaryBox and the metrics engine.
        for (const c of expandForCounting(pe, comboMembers[pe.id])) {
          if (skipExercise(c.exercise)) continue;
          const r = rowFor(c.exercise);
          const reps = c.summary_total_reps;
          const avg = c.summary_avg_load ?? 0;
          r.reps += reps;
          if (avg > 0 && reps > 0) {
            if (c.unit === 'absolute_kg') { r.kgSum += avg * reps; r.kgReps += reps; }
            else if (c.unit === 'percentage') { r.pctSum += avg * reps; r.pctReps += reps; }
          }
        }

        // Top set from the prescription itself (the summaries don't carry
        // reps/sets at the highest load).
        if (!pe.prescription_raw) continue;
        if (pe.is_combo) {
          const members = (comboMembers[pe.id] ?? []).slice().sort((a, b) => a.position - b.position);
          const lines = parseComboPrescription(pe.prescription_raw);
          members.forEach((m, i) => {
            if (skipExercise(m.exercise)) return;
            const r = rowFor(m.exercise);
            for (const ln of lines) {
              if (ln.loadText) continue; // free-text load — no numeric top set
              const part = parseInt(ln.repsText.split('+')[i] ?? '', 10) || 0;
              if (part <= 0) continue;
              r.maxSet = keepMax(r.maxSet, {
                load: ln.load, loadMax: ln.loadMax,
                reps: part * (ln.multiplier ?? 1), sets: ln.sets, unit: pe.unit,
              });
            }
          });
        } else if (!skipExercise(pe.exercise) && pe.unit !== 'free_text_reps') {
          const r = rowFor(pe.exercise);
          for (const ln of parsePrescription(pe.prescription_raw)) {
            r.maxSet = keepMax(r.maxSet, {
              load: ln.load, loadMax: ln.loadMax, reps: ln.reps, sets: ln.sets, unit: pe.unit,
            });
          }
        }
      }
    }

    // Tracked exercises with a target but nothing planned still get a row.
    for (const exId of targets.keys()) {
      if (rows.has(exId)) continue;
      const ex = allExercises.find(e => e.id === exId);
      if (!ex || !ex.category || ex.category === '— System') continue;
      rowFor(ex);
    }

    const byCat = new Map<string, ExRow[]>();
    for (const r of rows.values()) {
      const list = byCat.get(r.category) ?? [];
      list.push(r);
      byCat.set(r.category, list);
    }
    const boxes = [...byCat.entries()]
      .map(([category, list]) => ({
        category,
        rows: list.sort((a, b) =>
          (a.code ?? '￿').localeCompare(b.code ?? '￿', undefined, { numeric: true })
          || a.name.localeCompare(b.name)),
        reps: list.reduce((s, r) => s + r.reps, 0),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
    const totalReps = boxes.reduce((s, b) => s + b.reps, 0);
    return { boxes, totalReps };
  }, [plannedExercises, comboMembers, activeDays, allExercises, targets]);

  const repsTarget = macroContext?.totalRepsTarget ?? null;

  return (
    <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
      {/* Collapsible header */}
      <button
        onClick={onToggle}
        title="Toggle category table (K)"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '8px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
          borderBottom: expanded ? '0.5px solid var(--color-border-tertiary)' : 'none',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)' }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span style={eyebrow}>Category table</span>
        </span>
        {expanded ? (
          <span style={{ ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}
            title="Planned Σreps this week vs the macro's Σreps target">
            ΣR <b style={{ color: 'var(--color-text-primary)' }}>{totalReps}</b>
            {repsTarget != null && (
              <span style={{ color: statusColor(statusOf(totalReps, repsTarget)) }}> ∕ {repsTarget}</span>
            )}
          </span>
        ) : (
          <span style={{ ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>press K</span>
        )}
      </button>

      {expanded && (
        boxes.length === 0 ? (
          <div style={{ padding: '10px 14px', fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            Nothing planned yet.
          </div>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 8, padding: '10px 14px',
          }}>
            {boxes.map(box => (
              <div key={box.category} style={{
                border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-md)',
                overflow: 'hidden', alignSelf: 'start',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
                  padding: '4px 8px', background: 'var(--color-bg-tertiary)',
                }}>
                  <span style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {box.category}
                  </span>
                  <span style={{ ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }} title="Category Σreps (planned)">
                    Σ {box.reps}
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['', 'top set', 'avg', 'Σr'].map((h, i) => (
                        <th key={i} style={{
                          ...cellBase, textAlign: i === 0 ? 'left' : 'right',
                          fontSize: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em',
                          color: 'var(--color-text-tertiary)', borderBottom: '0.5px solid var(--color-border-tertiary)',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {box.rows.map(r => {
                    const t = targets.get(r.exerciseId);
                    const avgKg = r.kgReps > 0 ? Math.round(r.kgSum / r.kgReps) : null;
                    const avgPct = r.pctReps > 0 ? Math.round(r.pctSum / r.pctReps) : null;
                    const maxRaw = r.maxSet
                      ? `${r.maxSet.load}${r.maxSet.loadMax != null ? `-${r.maxSet.loadMax}` : ''}x${r.maxSet.reps}${r.maxSet.sets > 1 ? `x${r.maxSet.sets}` : ''}`
                      : null;
                    const plannedMaxLoad = r.maxSet ? (r.maxSet.loadMax ?? r.maxSet.load) : null;
                    return (
                      <tbody key={r.exerciseId} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                        <tr title={r.name}>
                          <td style={{ ...cellBase, whiteSpace: 'nowrap' }}>
                            {r.code && <b style={{ ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-primary)', marginRight: 5 }}>{r.code}</b>}
                            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>{abbrevName(r.name)}</span>
                          </td>
                          <td style={{ ...cellBase }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              {maxRaw
                                ? <StackedNotation raw={maxRaw} unit={r.maxSet!.unit} />
                                : <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>—</span>}
                            </div>
                          </td>
                          <td style={{ ...cellBase, ...mono, fontSize: 'var(--text-caption)', textAlign: 'right', color: 'var(--color-text-primary)' }}>
                            {avgKg != null ? fmtNum(avgKg) : avgPct != null ? `${fmtNum(avgPct)}%` : '—'}
                          </td>
                          <td style={{ ...cellBase, ...mono, fontSize: 'var(--text-caption)', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {r.reps > 0 ? r.reps : '—'}
                          </td>
                        </tr>
                        {t && (
                          <tr title="Macro target — green: plan on target, red: short or over">
                            <td style={{ ...cellBase, paddingTop: 0, fontSize: 9, color: 'var(--color-text-tertiary)' }}>↳ target</td>
                            <td style={{ ...cellBase, paddingTop: 0, ...mono, fontSize: 'var(--text-caption)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {t.max != null && (
                                <span style={{ color: statusColor(statusOf(plannedMaxLoad, t.max)) }}>{fmtNum(t.max)}</span>
                              )}
                              {t.repsAtMax != null && (
                                <span
                                  title="Target reps/sets at max"
                                  style={{
                                    color: statusColor(
                                      r.maxSet
                                        ? (r.maxSet.reps === t.repsAtMax && (t.setsAtMax == null || r.maxSet.sets === t.setsAtMax) ? 'on' : 'off')
                                        : 'off',
                                    ),
                                  }}
                                >
                                  {' '}×{t.repsAtMax}{t.setsAtMax != null ? `/${t.setsAtMax}` : ''}
                                </span>
                              )}
                              {t.max == null && t.repsAtMax == null && '—'}
                            </td>
                            <td style={{ ...cellBase, paddingTop: 0, ...mono, fontSize: 'var(--text-caption)', textAlign: 'right', color: statusColor(statusOf(avgKg, t.avg)) }}>
                              {t.avg != null ? fmtNum(t.avg) : ''}
                            </td>
                            <td style={{ ...cellBase, paddingTop: 0, ...mono, fontSize: 'var(--text-caption)', textAlign: 'right', color: statusColor(statusOf(r.reps || null, t.reps)) }}>
                              {t.reps != null ? t.reps : ''}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
