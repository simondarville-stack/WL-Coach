// WeekReviewPanel — compact review line in the planner header, shown when the
// selected week has logged training (individual athletes only; group plans
// have no single log stream). One chip per training unit: the coach-given
// unit name plus whether the athlete did it (done / partial / skipped /
// missed / pending).

import { useEffect, useState } from 'react';
import { Check, Minus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO } from '../../lib/dateUtils';
import { defaultUnitLabel } from '../../lib/constants';
import { resolveAthleteWeekPlanId } from '../../lib/trainingLogService';

interface WeekReviewPanelProps {
  athleteId: string;
  weekStart: string;
}

type DayState = 'done' | 'partial' | 'skipped' | 'missed' | 'pending';

interface DayChip {
  key: string;
  label: string;
  state: DayState;
}

export function WeekReviewPanel({ athleteId, weekStart }: WeekReviewPanelProps) {
  const [days, setDays] = useState<DayChip[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDays(null);
    void (async () => {
      try {
        type SessionRow = {
          id: string; day_index: number; status: string; session_label: string | null;
        };
        const { data: sessionsRaw } = await supabase
          .from('training_log_sessions')
          .select('id, day_index, status, session_label')
          .eq('athlete_id', athleteId)
          .eq('week_start', weekStart)
          .order('day_index');
        const sessions = (sessionsRaw as SessionRow[]) ?? [];
        if (sessions.length === 0) {
          if (!cancelled) setDays(null);
          return;
        }

        // Unit names come from the plan the athlete actually trains under —
        // individual first, else the group plan (coaches routinely write at
        // group level and never sync). Querying only individual plans loses
        // the coach-given unit names for group-planned athletes.
        const { weekPlanId } = await resolveAthleteWeekPlanId(athleteId, weekStart);
        type WpRow = {
          active_days: number[];
          day_labels: Record<number, string> | null;
          day_display_order: number[] | null;
        };
        let wp: WpRow | null = null;
        if (weekPlanId) {
          const { data: wpRaw } = await supabase
            .from('week_plans')
            .select('active_days, day_labels, day_display_order')
            .eq('id', weekPlanId)
            .maybeSingle();
          wp = wpRaw as WpRow | null;
        }
        if (cancelled) return;

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
        const chips: DayChip[] = planDays.map(i => ({
          key: `d-${i}`,
          label: dayLabel(i, sessionByDay.get(i)),
          state: stateOf(sessionByDay.get(i)),
        }));
        for (const s of sessions) {
          if (!planDays.includes(s.day_index)) {
            chips.push({ key: `b-${s.day_index}`, label: dayLabel(s.day_index, s), state: stateOf(s) });
          }
        }

        setDays(chips);
      } catch (err) {
        if (cancelled) return;
        console.error('WeekReviewPanel: load failed', err);
        setDays(null);
      }
    })();
    return () => { cancelled = true; };
  }, [athleteId, weekStart]);

  if (!days) return null;

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
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--color-text-tertiary)',
      }}>
        Week review
      </span>

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
    </div>
  );
}
