// The collapsed form of a training unit in the scheduled (calendar) week.
//
// The full DayCard carries an editable prescription grid per exercise, which is
// right when you are writing one unit and wrong when seven columns of them are
// on screen at once — that density is what made the scheduled week unreadable.
// This shows the shape of the unit (what, how heavy, how much) and nothing you
// cannot read at a glance; clicking it swaps in the real DayCard, so editing is
// unchanged and lives in exactly one component.

import { ChevronRight } from 'lucide-react';
import type { PlannedExercise, Exercise, ComboMemberEntry } from '../../lib/database.types';
import type { MetricKey, ComputedMetrics } from '../../lib/metrics';
import { MetricStrip } from '../ui/MetricStrip';
import { plannedRowLabel } from '../../lib/plannedRowLabel';
import { condensedExerciseSummary } from '../../lib/condensedExerciseSummary';

interface DayCardCondensedProps {
  dayName: string;
  /** Clock time from the week's schedule, shown as a chip. */
  time: string | null;
  exercises: (PlannedExercise & { exercise: Exercise })[];
  comboMembers: Record<string, ComboMemberEntry[]>;
  dayMetrics: ComputedMetrics;
  visibleMetrics: MetricKey[];
  onOpen: () => void;
}

/** Comma decimals, and no trailing ",0" on a whole number. */
function num(v: number | null): string {
  if (v == null) return '—';
  return (Math.round(v * 10) / 10).toString().replace('.', ',');
}

/** One stacked column: a load over its reps — the canonical arrangement. */
function StackedPair({ load, reps, muted }: { load: number | null; reps: number | null; muted?: boolean }) {
  const colour = muted ? 'var(--color-text-secondary)' : 'var(--color-text-primary)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, minWidth: '1.6rem' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', fontWeight: 500, color: colour }}>
        {num(load)}
      </span>
      <div style={{
        width: '100%',
        borderTop: `0.5px solid ${muted ? 'var(--color-border-secondary)' : 'var(--color-border-primary)'}`,
        margin: '1px 0',
      }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', fontWeight: 500, color: colour }}>
        {num(reps)}
      </span>
    </div>
  );
}

export function DayCardCondensed({
  dayName,
  time,
  exercises,
  comboMembers,
  dayMetrics,
  visibleMetrics,
  onOpen,
}: DayCardCondensedProps) {
  const isEmpty = exercises.length === 0;

  return (
    <div
      onClick={onOpen}
      title="Click to open this unit"
      style={{
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.12s, box-shadow 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent-border)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-secondary)'; }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
      }}>
        <span style={{
          fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {dayName}
        </span>
        {time && (
          <span style={{
            marginLeft: 'auto', flexShrink: 0,
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)',
            color: 'var(--color-text-secondary)',
            background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', padding: '0 4px',
          }}>
            {time}
          </span>
        )}
        <ChevronRight size={11} style={{ flexShrink: 0, color: 'var(--color-text-tertiary)', marginLeft: time ? 0 : 'auto' }} />
      </div>

      {!isEmpty && (
        <div style={{ padding: '4px 8px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          <MetricStrip
            metrics={dayMetrics}
            visibleMetrics={visibleMetrics}
            size="sm"
            showLabels
            separator="·"
          />
        </div>
      )}

      <div style={{ padding: '5px 8px 7px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {isEmpty && (
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            No exercises
          </span>
        )}
        {exercises.map(ex => {
          const members = (comboMembers[ex.id] ?? []).slice().sort((a, b) => a.position - b.position);
          const label = plannedRowLabel(ex, {
            memberNames: members.map(m => m.exercise.name),
            exerciseName: ex.exercise.name,
          });
          const s = condensedExerciseSummary(ex);
          return (
            <div key={ex.id} style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: ex.combo_color || ex.exercise.color || '#94a3b8',
                }} />
                <span style={{
                  fontSize: 'var(--text-caption)', color: 'var(--color-text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {label}
                </span>
              </div>
              {s && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  paddingLeft: 11, marginTop: 2,
                }}>
                  {(s.max != null || s.avgLoad != null) && (
                    <>
                      <StackedPair load={s.max} reps={s.repsAtMax} />
                      <StackedPair load={s.avgLoad} reps={s.avgReps} muted />
                    </>
                  )}
                  {/* Total reps and sets, after the two stacked loads — the
                      Max → Ø → R → S order the whole app reads in. */}
                  {(s.reps != null || s.sets != null) && (
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 10, display: 'flex', gap: 6,
                      color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {s.reps != null && (
                        <span><b style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>R</b> {s.reps}</span>
                      )}
                      {s.sets != null && (
                        <span><b style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>S</b> {s.sets}</span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
