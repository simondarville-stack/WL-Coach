import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { StackedNotation } from './StackedNotation';

interface HistoryRow {
  weekStart: string;
  prescription: string | null;
  /** Carried alongside the raw string because Stacked Load Notation cannot be
   *  rendered without them — % vs kg, and combo tuple reps. */
  unit: string | null;
  isCombo: boolean;
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
  /** How many prior prescriptions to show before the coach expands the table. */
  limit?: number;
  /** How far back to fetch. Matches the history chart's three-year fetch so a
   *  coach panning the chart back never outruns the table. */
  fetchWeeks?: number;
  /** Restrict rows to the chart's visible window (inclusive, Monday-anchored).
   *  Omitted → show everything fetched. */
  range?: { from: string; to: string } | null;
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
  fetchWeeks = 156,
  range = null,
}: ExercisePrescriptionHistoryProps) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

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
          .limit(fetchWeeks);

        if (!weekPlans?.length) {
          if (!cancelled) setRows([]);
          return;
        }

        const wpStartById = new Map(weekPlans.map(w => [w.id, w.week_start]));
        const { data: planRows } = await supabase
          .from('planned_exercises')
          .select('weekplan_id, prescription_raw, unit, is_combo, summary_total_sets, summary_total_reps, summary_highest_load')
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
              unit: r.unit,
              isCombo: r.is_combo === true,
              totalSets: r.summary_total_sets,
              totalReps: r.summary_total_reps,
              highestLoad: r.summary_highest_load,
              isCurrentWeek: ws === weekStart,
            } as HistoryRow;
          })
          .filter((r): r is HistoryRow => r !== null)
          .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
        // NOT truncated here any more — the fetch used to throw ~34 weeks of
        // already-loaded history away before it reached state, with no
        // affordance saying the list was cut. Slicing moved to render.

        if (!cancelled) setRows(collected);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [exerciseId, athleteId, weekStart, fetchWeeks]);

  if (loading) {
    return (
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        Loading history…
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
          Recent prescriptions
        </span>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          {rows.length > 0
            ? 'Nothing prescribed in the chart window'
            : 'No earlier prescriptions for this exercise'}
        </div>
      </div>
    );
  }

  // Slice at RENDER, not in the fetch — everything collected stays available
  // so "Show all" is instant and needs no second query.
  const visible = expanded ? inRange : inRange.slice(0, limit);

  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{
        display: 'block', fontSize: 11, fontWeight: 500, letterSpacing: '0.05em',
        color: 'var(--color-text-secondary)', marginBottom: 6,
      }}>
        Recent prescriptions{' '}
        <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>{inRange.length}</span>
      </span>
      {/* Cap the expanded height so a long history cannot push past the
          dialog's own 85vh and strand the content below it. */}
      <div style={expanded ? { maxHeight: 260, overflowY: 'auto' } : undefined}>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <tbody>
          {visible.map((r, i) => (
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
                  verticalAlign: 'top',
                  color: r.isCurrentWeek ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  fontWeight: r.isCurrentWeek ? 600 : 500,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatShort(r.weekStart)}
              </td>
              {/* Stacked Load Notation, not the raw `load×reps×sets` string —
                  the inline form is input/storage only (DISPLAY_CONVENTIONS §1). */}
              <td style={{ padding: '6px 0', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                {r.prescription ? (
                  <StackedNotation raw={r.prescription} unit={r.unit} isCombo={r.isCombo} />
                ) : (
                  <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic', fontFamily: 'var(--font-sans)' }}>
                    not planned
                  </span>
                )}
              </td>
              <td style={{
                padding: '6px 0 6px 8px', textAlign: 'right', whiteSpace: 'nowrap',
                verticalAlign: 'top',
                color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums',
              }}>
                {/* Sets and reps were fetched and stored but never rendered.
                    Same S/R string as the "Other days this week" table above,
                    so the two read identically. */}
                {expanded && (r.totalSets != null || r.totalReps != null) && (
                  <span style={{ marginRight: 8, fontSize: 10 }}>
                    S{r.totalSets ?? 0} R{r.totalReps ?? 0}
                  </span>
                )}
                {r.highestLoad != null && r.highestLoad > 0 ? `${r.highestLoad}` : ''}
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
          // stopPropagation on Enter: the surrounding dialog closes on it, so
          // keyboard-activating this would toggle AND close the panel.
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
