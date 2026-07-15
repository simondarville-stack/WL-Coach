// WeekReviewPanel — the review stage of the weekly coaching loop, shown in
// the planner header when the selected week has logged training (individual
// athletes only; group plans have no single log stream).
//
// One band answers "what happened and what do I do next": per-day compliance
// chips, done-vs-planned totals (threshold-coloured), the RAW wellbeing
// average, the athlete's notes/flags — and the jump into planning the next
// week with its macro intent (week type, K target, macro note) in view.

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Flag, MessageSquare, Minus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO } from '../../lib/dateUtils';
import { defaultUnitLabel } from '../../lib/constants';
import { copyWeekAsDraft } from '../../lib/weekDraftService';
import {
  fetchWeeklyPerformed,
  fetchWeeklyProgrammed,
  type WeeklyPerformed,
  type WeeklyProgrammed,
} from '../../lib/macroTimelineData';

interface WeekReviewPanelProps {
  athleteId: string;
  weekStart: string;
  /** Compliance threshold as a fraction (done / planned). */
  complianceThreshold: number;
  onSelectWeek: (weekStart: string) => void;
}

type DayState = 'done' | 'partial' | 'skipped' | 'missed' | 'pending';

interface DayChip {
  key: string;
  label: string;
  state: DayState;
}

interface ReviewNote {
  key: string;
  dayLabel: string;
  kind: 'flag' | 'note';
  text: string;
}

interface NextWeekIntent {
  weekNumber: number;
  weekType: string;
  repsTarget: number | null;
  notes: string;
}

interface ReviewData {
  days: DayChip[];
  rawAvg: number | null;
  notes: ReviewNote[];
  programmed: WeeklyProgrammed | null;
  performed: WeeklyPerformed | null;
  nextIntent: NextWeekIntent | null;
}

const fmt = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
const fmtT = (kg: number): string => (Math.round(kg / 100) / 10).toFixed(1).replace('.', ',') + ' t';

export function WeekReviewPanel({
  athleteId,
  weekStart,
  complianceThreshold,
  onSelectWeek,
}: WeekReviewPanelProps) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    void (async () => {
      try {
        type SessionRow = {
          id: string; day_index: number; status: string; session_label: string | null;
          session_notes: string; skipped_reason: string | null; raw_total: number | null;
        };
        const { data: sessionsRaw } = await supabase
          .from('training_log_sessions')
          .select('id, day_index, status, session_label, session_notes, skipped_reason, raw_total')
          .eq('athlete_id', athleteId)
          .eq('week_start', weekStart)
          .order('day_index');
        const sessions = (sessionsRaw as SessionRow[]) ?? [];
        if (sessions.length === 0) {
          if (!cancelled) setData(null);
          return;
        }

        type WpRow = {
          active_days: number[];
          day_labels: Record<number, string> | null;
          day_display_order: number[] | null;
        };
        const [{ data: wpRaw }, { data: logExRaw }, programmedMap, performedMap, nextIntent] = await Promise.all([
          supabase
            .from('week_plans')
            .select('active_days, day_labels, day_display_order')
            .eq('athlete_id', athleteId)
            .eq('is_group_plan', false)
            .eq('week_start', weekStart)
            .maybeSingle(),
          supabase
            .from('training_log_exercises')
            .select('id, session_id, performed_notes, exercise:exercise_id(name)')
            .in('session_id', sessions.map(s => s.id)),
          fetchWeeklyProgrammed(athleteId, null, weekStart, weekStart),
          fetchWeeklyPerformed([athleteId], weekStart, weekStart),
          fetchNextIntent(athleteId, addDaysToISO(weekStart, 7)),
        ]);
        if (cancelled) return;

        const wp = wpRaw as WpRow | null;
        const sessionByDay = new Map(sessions.map(s => [s.day_index, s]));
        // Same derivation as WeeklyPlanner (see its currentWeekPlan effect):
        // fall back to active_days *sorted*, or the two surfaces would number
        // the units differently for the same week.
        const displayOrder =
          wp?.day_display_order ?? (wp?.active_days ?? []).slice().sort((a, b) => a - b);
        // The unit's name is whatever the coach called it — the same
        // resolution the planner uses (day_labels → "Unit N" by display
        // position). The athlete's session_label only names sessions the
        // coach never planned (bonus days), so it is the last resort, not
        // the first: letting it win would rename the coach's own units.
        const dayLabel = (i: number, s?: SessionRow): string =>
          wp?.day_labels?.[i]
          || s?.session_label
          || defaultUnitLabel(i, displayOrder);

        // Day chips: the plan's active days first, then bonus sessions.
        const weekIsPast = addDaysToISO(weekStart, 6) < getMondayOfWeekISO(new Date());
        const stateOf = (s: SessionRow | undefined): DayState => {
          if (!s) return weekIsPast ? 'missed' : 'pending';
          if (s.status === 'completed') return 'done';
          if (s.status === 'skipped') return 'skipped';
          if (s.status === 'in_progress') return 'partial';
          return weekIsPast ? 'missed' : 'pending';
        };
        const planDays = (wp?.active_days ?? []).slice().sort((a, b) => a - b);
        const days: DayChip[] = planDays.map(i => ({
          key: `d-${i}`,
          label: dayLabel(i, sessionByDay.get(i)),
          state: stateOf(sessionByDay.get(i)),
        }));
        for (const s of sessions) {
          if (!planDays.includes(s.day_index)) {
            days.push({ key: `b-${s.day_index}`, label: dayLabel(s.day_index, s), state: stateOf(s) });
          }
        }

        const rawValues = sessions.map(s => s.raw_total).filter((v): v is number => v != null);
        const rawAvg = rawValues.length > 0
          ? Math.round((rawValues.reduce((a, b) => a + b, 0) / rawValues.length) * 10) / 10
          : null;

        // Athlete feedback: skip reasons (flags), session notes, exercise notes.
        type LogExRow = { id: string; session_id: string; performed_notes: string; exercise: { name: string } | null };
        const logExercises = (logExRaw as unknown as LogExRow[]) ?? [];
        const sessionById = new Map(sessions.map(s => [s.id, s]));
        const notes: ReviewNote[] = [];
        for (const s of sessions) {
          if (s.status === 'skipped') {
            notes.push({
              key: `sk-${s.id}`, dayLabel: dayLabel(s.day_index, s), kind: 'flag',
              text: s.skipped_reason?.trim() || 'Session skipped',
            });
          }
          if (s.session_notes?.trim()) {
            notes.push({ key: `sn-${s.id}`, dayLabel: dayLabel(s.day_index, s), kind: 'note', text: s.session_notes.trim() });
          }
        }
        for (const le of logExercises) {
          if (!le.performed_notes?.trim()) continue;
          const s = sessionById.get(le.session_id);
          notes.push({
            key: `en-${le.id}`,
            dayLabel: s ? dayLabel(s.day_index, s) : '',
            kind: 'note',
            text: `${le.exercise?.name ? le.exercise.name + ': ' : ''}${le.performed_notes.trim()}`,
          });
        }

        setData({
          days,
          rawAvg,
          notes,
          programmed: programmedMap.get(weekStart) ?? null,
          performed: performedMap.get(weekStart) ?? null,
          nextIntent,
        });
      } catch (err) {
        if (cancelled) return;
        console.error('WeekReviewPanel: load failed', err);
        setData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [athleteId, weekStart]);

  if (!data) return null;

  const { days, rawAvg, notes, programmed, performed, nextIntent } = data;
  const nextWeekStart = addDaysToISO(weekStart, 7);

  // "Plan next from this week": copy the reviewed week's plan into the next
  // week as a starting draft, then open it. Never overwrites — an occupied
  // next week is opened untouched.
  const handleCopyAndPlanNext = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const result = await copyWeekAsDraft(athleteId, weekStart, nextWeekStart);
      if (result === 'occupied') {
        window.alert('Next week already has planned work — opening it without copying.');
      } else if (result === 'empty') {
        window.alert('This week has no planned work to copy — opening next week empty.');
      }
      onSelectWeek(nextWeekStart);
    } catch (err) {
      console.error('WeekReviewPanel: copy-as-draft failed', err);
      window.alert('Copying the week failed — opening next week without a draft.');
      onSelectWeek(nextWeekStart);
    } finally {
      setCopying(false);
    }
  };

  // ── Totals: done / planned with threshold colour ──
  interface Total { label: string; done: string; planned: string | null; pct: number | null }
  const totals: Total[] = [];
  const pushTotal = (label: string, done: number | null, planned: number | null, format: (v: number) => string) => {
    if (done == null) return;
    totals.push({
      label,
      done: format(done),
      planned: planned != null ? format(planned) : null,
      pct: planned != null && planned > 0 ? Math.round((done / planned) * 100) : null,
    });
  };
  pushTotal('Σreps', performed?.reps ?? null, programmed?.reps ?? null, fmt);
  pushTotal('Tonnage', performed?.tonnage ?? null, programmed?.tonnage ?? null, fmtT);
  // No "Max" here: it was the heaviest single load across every exercise
  // in the week, with no planned counterpart and no exercise attribution
  // — a bare number with nothing to read it against. The per-exercise and
  // per-day Max in the log itself (LogExerciseRow / LogDayCard) keep the
  // context that makes the figure mean something.
  // Top categories by planned reps.
  if (performed && programmed) {
    const cats = [...programmed.byCategory.entries()]
      .sort((a, b) => b[1].reps - a[1].reps)
      .slice(0, 3);
    for (const [cat, plannedStats] of cats) {
      const doneStats = performed.byCategory.get(cat);
      if (!doneStats) continue;
      pushTotal(`${cat} Σreps`, doneStats.reps, plannedStats.reps, fmt);
    }
  }

  const chipStyle = (state: DayState) => {
    switch (state) {
      case 'done': return { icon: <Check size={10} />, bg: 'var(--color-success-bg)', fg: 'var(--color-success-text)' };
      case 'partial': return { icon: <Minus size={10} />, bg: 'var(--color-warning-bg)', fg: 'var(--color-warning-text)' };
      case 'skipped':
      case 'missed': return { icon: <X size={10} />, bg: 'var(--color-danger-bg)', fg: 'var(--color-danger-text)' };
      default: return { icon: null, bg: 'var(--color-bg-tertiary)', fg: 'var(--color-text-tertiary)' };
    }
  };

  return (
    <div style={{
      marginTop: 8, paddingTop: 8,
      borderTop: '0.5px solid var(--color-border-tertiary)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Header line: label + plan-next action */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--color-text-tertiary)',
        }}>
          Week review
        </span>

        {/* Day chips */}
        <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
          {days.map(d => {
            const c = chipStyle(d.state);
            return (
              <span
                key={d.key}
                title={`${d.label} — ${d.state}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 7px', borderRadius: 999,
                  background: c.bg, color: c.fg,
                  fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                {c.icon}{d.label}
              </span>
            );
          })}
        </span>

        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {rawAvg != null && (
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }} title="RAW wellbeing average (Eleiko, 4–12)">
              RAW Ø <b style={{ color: 'var(--color-text-primary)' }}>{String(rawAvg).replace('.', ',')}</b>/12
            </span>
          )}
          <span style={{ display: 'inline-flex' }}>
            <button
              onClick={() => onSelectWeek(nextWeekStart)}
              title={nextIntent
                ? `Plan W${nextIntent.weekNumber}${nextIntent.weekType ? ` · ${nextIntent.weekType}` : ''}${nextIntent.repsTarget != null ? ` · Σreps ${nextIntent.repsTarget}` : ''}${nextIntent.notes ? ` · ✎ ${nextIntent.notes}` : ''}`
                : 'Plan next week'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 10px',
                borderRadius: 'var(--radius-md) 0 0 var(--radius-md)', border: 'none',
                background: 'var(--color-accent)', color: '#fff',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Plan {nextIntent ? `W${nextIntent.weekNumber}` : 'next week'} <ArrowRight size={12} />
            </button>
            <button
              onClick={() => void handleCopyAndPlanNext()}
              disabled={copying}
              title="Plan next week starting from a copy of this week's plan (never overwrites existing work)"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '3px 7px',
                borderRadius: '0 var(--radius-md) var(--radius-md) 0',
                border: 'none', borderLeft: '1px solid rgba(255,255,255,0.35)',
                background: 'var(--color-accent)', color: '#fff',
                cursor: copying ? 'wait' : 'pointer',
                opacity: copying ? 0.7 : 1,
              }}
            >
              <Copy size={11} />
            </button>
          </span>
        </span>
      </div>

      {/* Totals strip */}
      {totals.length > 0 && (
        <div style={{
          display: 'flex', gap: 18, flexWrap: 'wrap',
          padding: '6px 10px', background: 'var(--color-bg-tertiary)',
          borderRadius: 'var(--radius-md)',
        }}>
          {totals.map(t => (
            <div key={t.label} style={{ minWidth: 72 }}>
              <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                {t.label}
              </div>
              <div
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 12, whiteSpace: 'nowrap' }}
                title="done ∕ planned"
              >
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{t.done}</span>
                {t.planned != null && <span style={{ color: 'var(--color-text-tertiary)' }}> ∕ {t.planned}</span>}
                {t.pct != null && (
                  <span style={{
                    marginLeft: 4, fontSize: 10, fontWeight: 700,
                    color: t.pct >= complianceThreshold * 100 ? 'var(--color-success-text)' : 'var(--color-warning-text)',
                  }}>
                    {t.pct} %
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Athlete feedback */}
      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 96, overflowY: 'auto' }}>
          {notes.map(n => (
            <div key={n.key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, minWidth: 0 }}>
              {n.kind === 'flag'
                ? <Flag size={11} style={{ color: 'var(--color-warning-text)', flexShrink: 0 }} />
                : <MessageSquare size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />}
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5,
                color: 'var(--color-text-tertiary)', width: 52, flexShrink: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {n.dayLabel}
              </span>
              <span style={{
                color: 'var(--color-text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={n.text}>
                {n.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The macro intent for the following week, if a macro covers it. */
async function fetchNextIntent(athleteId: string, weekStart: string): Promise<NextWeekIntent | null> {
  const { data } = await supabase
    .from('macro_weeks')
    .select('week_number, week_type, week_type_text, total_reps_target, notes, macrocycles!inner(athlete_id)')
    .eq('macrocycles.athlete_id', athleteId)
    .eq('week_start', weekStart)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    week_number: number; week_type: string | null; week_type_text: string | null;
    total_reps_target: number | null; notes: string | null;
  };
  return {
    weekNumber: row.week_number,
    weekType: row.week_type || row.week_type_text || '',
    repsTarget: row.total_reps_target,
    notes: row.notes ?? '',
  };
}
