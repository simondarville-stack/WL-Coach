import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatKg } from '../../lib/loadRepsFormat';
import { isoMonday } from '../../lib/dateUtils';
import { LoggedStackedNotation, StackedNotation, type LoggedSetLike } from './StackedNotation';
import { comboIdentity, fetchComboPlannedRows, fetchPlannedRowsForExercise } from '../../lib/comboHistory';

interface ActualRow {
  /** The real date the session happened — a log is an event, not a week. */
  date: string;
  /** Monday of that date, so the row can be filtered by the chart's week window. */
  weekStart: string;
  /** The completed set rows themselves, rendered as Stacked Load Notation.
   *  Empty for a v1 row that only has a summary string. */
  sets: LoggedSetLike[];
  /** v1 fallback: the free-text summary the athlete typed, when there are no
   *  per-set rows to draw. */
  performedRaw: string | null;
  /** Set when these sets were performed inside a complex the viewed exercise
   *  is a member of, so the coach sees the context. */
  comboLabel: string | null;
  totalSets: number | null;
  totalReps: number | null;
  highestLoad: number | null;
  isCurrentWeek: boolean;
}

interface ExerciseActualsHistoryProps {
  exerciseId: string;
  athleteId: string;
  /** The week being planned, so its own logged sessions can be marked. */
  weekStart: string;
  /** Rows shown before the coach expands the table. */
  limit?: number;
  /** How far back to fetch. Matches the history chart's three-year fetch so a
   *  coach panning the chart back never outruns the table. */
  fetchWeeks?: number;
  /** Restrict rows to the chart's visible window (inclusive, Monday-anchored).
   *  Omitted → show everything fetched. */
  range?: { from: string; to: string } | null;
  /** For a combo row: its members IN ORDER — see ExercisePrescriptionHistory.
   *  Logged combos are matched through planned_exercise_id, the only exact
   *  link back from a log to the complex it was performed for. */
  comboMemberIds?: string[] | null;
}

function formatShort(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}
function formatFull(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The performed counterpart to ExercisePrescriptionHistory: what the athlete
 * actually lifted, one row per completed session. Planned and performed stay
 * separate records — this table never reads or writes plan data, it only
 * reports the log.
 *
 * v2 logging writes per-set rows into `training_log_sets` and leaves
 * `performed_raw` empty; v1 rows only have the summary string. Both are read,
 * with the set rows preferred, matching ExerciseHistoryChart's Performed series
 * so the table and the chart cannot disagree.
 */
export function ExerciseActualsHistory({
  exerciseId,
  athleteId,
  weekStart,
  limit = 6,
  fetchWeeks = 156,
  range = null,
  comboMemberIds = null,
}: ExerciseActualsHistoryProps) {
  const [rows, setRows] = useState<ActualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const from = new Date(weekStart + 'T00:00:00Z');
        from.setUTCDate(from.getUTCDate() - fetchWeeks * 7);
        const lookBack = from.toISOString().slice(0, 10);

        // A logged combo carries exercise_id = its FIRST member, exactly like
        // the planned row, so exercise_id alone can neither isolate a complex
        // nor find the complexes a given lift was trained inside.
        // planned_exercise_id can: resolve the planned rows first, then take
        // the logs that point at them.
        const { data: weekPlans } = await supabase
          .from('week_plans')
          .select('id')
          .eq('athlete_id', athleteId)
          .gte('week_start', lookBack);
        const wpIds = (weekPlans ?? []).map(w => w.id);
        const plannedRows = comboMemberIds?.length
          ? await fetchComboPlannedRows(wpIds, comboMemberIds)
          : await fetchPlannedRowsForExercise(wpIds, exerciseId);
        const comboRowIds = plannedRows.filter(r => r.is_combo).map(r => r.id);
        const comboLabelById = new Map(
          plannedRows.filter(r => r.is_combo).map(r => [r.id, r.combo_notation]),
        );

        type LogRow = {
          id: string;
          performed_raw: string | null;
          planned_exercise_id: string | null;
          session: unknown;
        };
        let logRows: LogRow[] = [];
        if (comboMemberIds?.length) {
          if (comboRowIds.length === 0) {
            if (!cancelled) setRows([]);
            return;
          }
          const { data } = await supabase
            .from('training_log_exercises')
            .select('id, performed_raw, planned_exercise_id, session:training_log_sessions!inner(date, athlete_id, status)')
            .in('planned_exercise_id', comboRowIds)
            .eq('session.athlete_id', athleteId)
            .eq('session.status', 'completed')
            .gte('session.date', lookBack);
          logRows = (data ?? []) as LogRow[];
        } else {
          const { data: own } = await supabase
            .from('training_log_exercises')
            .select('id, performed_raw, planned_exercise_id, planned:planned_exercises(is_combo), session:training_log_sessions!inner(date, athlete_id, status)')
            .eq('exercise_id', exerciseId)
            .eq('session.athlete_id', athleteId)
            .eq('session.status', 'completed')
            .gte('session.date', lookBack);
          logRows = ((own ?? []) as unknown as (LogRow & { planned: { is_combo: boolean } | null })[])
            .filter(r => !r.planned?.is_combo);
          if (comboRowIds.length > 0) {
            const { data: inCombos } = await supabase
              .from('training_log_exercises')
              .select('id, performed_raw, planned_exercise_id, session:training_log_sessions!inner(date, athlete_id, status)')
              .in('planned_exercise_id', comboRowIds)
              .eq('session.athlete_id', athleteId)
              .eq('session.status', 'completed')
              .gte('session.date', lookBack);
            logRows = [...logRows, ...((inCombos ?? []) as LogRow[])];
          }
        }

        const ids = (logRows ?? []).map(r => r.id);
        // The display columns LoggedStackedNotation reads, plus the grouping
        // key — so the notation can be rendered from these rows directly
        // instead of being flattened into a string first.
        type SetRow = LoggedSetLike & { log_exercise_id: string };
        let loggedSets: SetRow[] = [];
        if (ids.length > 0) {
          const { data } = await supabase
            .from('training_log_sets')
            .select('id, log_exercise_id, performed_load, performed_reps, performed_text, rpe, status, notes')
            // Ordered so each exercise's columns read left-to-right in the
            // order the athlete actually lifted them.
            .order('set_number', { ascending: true })
            .in('log_exercise_id', ids);
          loggedSets = (data ?? []) as SetRow[];
        }
        const setsByLogEx = new Map<string, SetRow[]>();
        for (const s of loggedSets) {
          if (s.status !== 'completed') continue;
          const list = setsByLogEx.get(s.log_exercise_id) ?? [];
          list.push(s);
          setsByLogEx.set(s.log_exercise_id, list);
        }

        const collected: ActualRow[] = [];
        for (const r of logRows ?? []) {
          const session = r.session as unknown as { date: string } | null;
          if (!session?.date) continue;

          const sets = setsByLogEx.get(r.id) ?? [];
          const entries = sets
            .filter(s => (s.performed_load ?? 0) > 0 && (s.performed_reps ?? 0) > 0)
            .map(s => ({ load: s.performed_load as number, reps: s.performed_reps as number }));

          let totalSets: number | null;
          let totalReps: number | null;
          let highestLoad: number | null;
          let performedRaw: string | null = null;

          if (entries.length > 0) {
            totalSets = entries.length;
            totalReps = entries.reduce((sum, e) => sum + e.reps, 0);
            highestLoad = Math.max(...entries.map(e => e.load));
          } else {
            // v1 row: the summary string is all there is. Reported as written
            // rather than re-derived, and its set/rep counts stay unknown.
            performedRaw = r.performed_raw?.trim() || null;
            totalSets = null;
            totalReps = null;
            highestLoad = null;
          }

          // A session with no completed set and no summary string recorded
          // nothing — showing it as a blank row would read as a failed lift.
          // Completed sets without numbers (a prose/GPP completion) still
          // count: LoggedStackedNotation renders those as the athlete's text.
          if (sets.length === 0 && !performedRaw) continue;

          collected.push({
            date: session.date,
            weekStart: isoMonday(session.date),
            sets,
            performedRaw,
            comboLabel: comboMemberIds?.length
              ? null
              : (r.planned_exercise_id ? comboLabelById.get(r.planned_exercise_id) ?? null : null),
            totalSets,
            totalReps,
            highestLoad,
            isCurrentWeek: isoMonday(session.date) === weekStart,
          });
        }
        collected.sort((a, b) => (a.date < b.date ? 1 : -1));

        if (!cancelled) setRows(collected);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
    // See ExercisePrescriptionHistory: depend on the identity string, not the
    // array reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseId, athleteId, weekStart, fetchWeeks, comboIdentity(comboMemberIds ?? [])]);

  if (loading) {
    return (
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        Loading actuals…
      </div>
    );
  }

  // Filter to the chart's window, so panning the chart moves this table with it.
  const inRange = range
    ? rows.filter(r => r.weekStart >= range.from && r.weekStart <= range.to)
    : rows;

  if (inRange.length === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        <span style={{
          display: 'block', fontSize: 11, fontWeight: 500, letterSpacing: '0.05em',
          color: 'var(--color-text-secondary)', marginBottom: 6,
        }}>
          Recent actuals
        </span>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          {rows.length > 0
            ? 'Nothing logged in the chart window'
            : 'No logged sessions for this exercise'}
        </div>
      </div>
    );
  }

  const visible = expanded ? inRange : inRange.slice(0, limit);

  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{
        display: 'block', fontSize: 11, fontWeight: 500, letterSpacing: '0.05em',
        color: 'var(--color-text-secondary)', marginBottom: 6,
      }}>
        Recent actuals{' '}
        <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>{inRange.length}</span>
      </span>
      <div style={expanded ? { maxHeight: 260, overflowY: 'auto' } : undefined}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <tbody>
            {visible.map((r, i) => (
              <tr
                key={`${r.date}-${i}`}
                style={{
                  borderBottom: '1px solid var(--color-border-tertiary)',
                  background: r.isCurrentWeek ? 'var(--color-accent-muted)' : 'transparent',
                }}
              >
                <td
                  title={formatFull(r.date)}
                  style={{
                    padding: '6px 8px 6px 0', width: 52, whiteSpace: 'nowrap',
                    verticalAlign: 'top',
                    color: r.isCurrentWeek ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    fontWeight: r.isCurrentWeek ? 600 : 500,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatShort(r.date)}
                </td>
                {/* Stacked Load Notation, same as everywhere else a lift is
                    shown — the inline `load×reps` string is storage, not a
                    display form (DISPLAY_CONVENTIONS §1). */}
                <td style={{ padding: '6px 0', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                  {r.comboLabel && (
                    <span
                      title={'Performed inside the complex: ' + r.comboLabel}
                      style={{
                        display: 'block', fontSize: 9, letterSpacing: '0.03em',
                        color: 'var(--color-text-tertiary)', marginBottom: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {r.comboLabel}
                    </span>
                  )}
                  {r.sets.length > 0
                    ? <LoggedStackedNotation sets={r.sets} includeIncomplete={false} />
                    : <StackedNotation raw={r.performedRaw} unit={null} />}
                </td>
                <td style={{
                  padding: '6px 0 6px 8px', textAlign: 'right', whiteSpace: 'nowrap',
                  verticalAlign: 'top',
                  color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {expanded && (r.totalSets != null || r.totalReps != null) && (
                    <span style={{ marginRight: 8, fontSize: 10 }}>
                      S{r.totalSets ?? 0} R{r.totalReps ?? 0}
                    </span>
                  )}
                  {r.highestLoad != null && r.highestLoad > 0 ? formatKg(r.highestLoad) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inRange.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          onKeyDown={e => { if (e.key === 'Enter') e.stopPropagation(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', padding: '6px 0 0',
            cursor: 'pointer', fontSize: 11, color: 'var(--color-text-tertiary)',
          }}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Show less' : `Show all ${inRange.length}`}
        </button>
      )}
    </div>
  );
}
