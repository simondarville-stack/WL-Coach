import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface HistoryRow {
  weekStart: string;
  prescription: string | null;
  totalSets: number | null;
  totalReps: number | null;
  highestLoad: number | null;
  isCurrentWeek: boolean;
}

interface ExercisePrescriptionHistoryProps {
  exerciseId: string;
  athleteId: string;
  /** The week currently being planned (Monday-anchored), so its own row can
   *  be marked and ordered relative to past prescriptions. */
  weekStart: string;
  /** How many prior prescriptions to show. */
  limit?: number;
}

// European date: DD.MM (year omitted to stay compact; shown on hover via title).
function formatShort(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}
function formatFull(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Compact "last few times this exercise was prescribed" table for the exercise
 * side panel. Each planned occurrence is its own row — so an exercise that
 * appears twice in a week shows twice — giving the coach a quick read of how
 * loads have trended into the week they're writing.
 */
export function ExercisePrescriptionHistory({
  exerciseId,
  athleteId,
  weekStart,
  limit = 6,
}: ExercisePrescriptionHistoryProps) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // Pull this athlete's week plans up to and including the planned week,
        // then the planned rows for this exercise within them. We over-fetch a
        // generous window and trim client-side so multiple-per-week occurrences
        // are all preserved.
        const { data: weekPlans } = await supabase
          .from('week_plans')
          .select('id, week_start')
          .eq('athlete_id', athleteId)
          .lte('week_start', weekStart)
          .order('week_start', { ascending: false })
          .limit(40);

        if (!weekPlans?.length) {
          if (!cancelled) setRows([]);
          return;
        }

        const wpStartById = new Map(weekPlans.map(w => [w.id, w.week_start]));
        const { data: planRows } = await supabase
          .from('planned_exercises')
          .select('weekplan_id, prescription_raw, summary_total_sets, summary_total_reps, summary_highest_load')
          .eq('exercise_id', exerciseId)
          .in('weekplan_id', weekPlans.map(w => w.id));

        const collected: HistoryRow[] = (planRows ?? [])
          .map(r => {
            const ws = wpStartById.get(r.weekplan_id);
            if (!ws) return null;
            // Skip empty placeholder rows with nothing prescribed.
            if (!r.prescription_raw && r.summary_total_reps == null) return null;
            return {
              weekStart: ws,
              prescription: r.prescription_raw,
              totalSets: r.summary_total_sets,
              totalReps: r.summary_total_reps,
              highestLoad: r.summary_highest_load,
              isCurrentWeek: ws === weekStart,
            } as HistoryRow;
          })
          .filter((r): r is HistoryRow => r !== null)
          .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
          .slice(0, limit);

        if (!cancelled) setRows(collected);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [exerciseId, athleteId, weekStart, limit]);

  if (loading) {
    return (
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        Loading history…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{
        fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic',
        padding: '8px 0',
      }}>
        No earlier prescriptions for this exercise
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{
        display: 'block', fontSize: 11, fontWeight: 500, letterSpacing: '0.05em',
        color: 'var(--color-text-secondary)', marginBottom: 6,
      }}>
        Recent prescriptions
      </span>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.weekStart}-${i}`}
              style={{
                borderBottom: '1px solid var(--color-border-tertiary)',
                background: r.isCurrentWeek ? 'var(--color-accent-muted)' : 'transparent',
              }}
            >
              <td
                title={formatFull(r.weekStart)}
                style={{
                  padding: '6px 8px 6px 0', width: 52, whiteSpace: 'nowrap',
                  color: r.isCurrentWeek ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  fontWeight: r.isCurrentWeek ? 600 : 500,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatShort(r.weekStart)}
              </td>
              <td style={{
                padding: '6px 0', fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-primary)', wordBreak: 'break-word',
              }}>
                {r.prescription ?? (
                  <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic', fontFamily: 'var(--font-sans)' }}>
                    not planned
                  </span>
                )}
              </td>
              <td style={{
                padding: '6px 0 6px 8px', textAlign: 'right', whiteSpace: 'nowrap',
                color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums',
              }}>
                {r.highestLoad != null && r.highestLoad > 0 ? `${r.highestLoad}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
