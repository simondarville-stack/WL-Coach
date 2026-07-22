/**
 * MacroExerciseDetail — the athlete's context for one tracked exercise,
 * opened from the macro table's exercise header (or its toggle chip).
 *
 * Two things a coach wants while writing macro targets and never had in
 * this view: what the athlete actually lifts (the PR table) and where the
 * exercise has been going (the load history, including this cycle's SOLL).
 * Both are existing modules — buildPRRows/fetchPRHistory from lib/prTable
 * and the planner's ExerciseHistoryChart — reused, not reimplemented.
 */
import { useEffect, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Exercise, AthletePRHistory } from '../../lib/database.types';
import { buildPRRows, fetchPRHistory, REP_COUNTS } from '../../lib/prTable';
import { usePREstimationMode } from '../../hooks/usePREstimationMode';
import { PREstimationModeToggle } from '../PREstimationModeToggle';
import { ExerciseHistoryChart } from '../planner/ExerciseHistoryChart';
import type { MacroContext } from '../planner/WeeklyPlanner';
import { formatDateShort } from '../../lib/dateUtils';
import { Button } from '../ui';

interface MacroExerciseDetailProps {
  exercise: Exercise;
  /** Null for a group macro with no individual athlete in view. */
  athleteId: string | null;
  athleteName: string | null;
  /** Drives the SOLL series + "this week" marker on the history chart. */
  macroContext: MacroContext | null;
  /** Monday of the macro week the chart should anchor on. */
  anchorWeekStart?: string;
  onClose: () => void;
}

export function MacroExerciseDetail({
  exercise,
  athleteId,
  athleteName,
  macroContext,
  anchorWeekStart,
  onClose,
}: MacroExerciseDetailProps) {
  const navigate = useNavigate();
  const [mode, setMode] = usePREstimationMode();
  const [history, setHistory] = useState<AthletePRHistory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!athleteId) { setHistory([]); return; }
    let alive = true;
    setLoading(true);
    fetchPRHistory(athleteId)
      .then(rows => { if (alive) setHistory(rows.filter(r => r.exercise_id === exercise.id)); })
      .catch(() => { if (alive) setHistory([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [athleteId, exercise.id]);

  const row = buildPRRows([exercise], history, mode)[0];
  const hasAnyPR = row.cells.some(c => c.current != null);

  return (
    <>
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 16px',
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          flexShrink: 0,
        }}
      >
        <span
          style={{ width: 8, height: 8, borderRadius: 999, background: exercise.color || 'var(--color-gray-400)', flexShrink: 0 }}
          aria-hidden
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {exercise.exercise_code ? `${exercise.exercise_code} — ${exercise.name}` : exercise.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {athleteName ?? 'No athlete in view'}
            {macroContext ? ` · ${macroContext.macroName}` : ''}
          </div>
        </div>
        <Button variant="ghost" size="sm" iconOnly icon={<X size={16} />} title="Close" onClick={onClose} />
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
        {!athleteId ? (
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            This is a group macrocycle. Pick an athlete in the group view to see their PRs and
            history for this exercise.
          </p>
        ) : (
          <>
            {/* ── PR table ── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', letterSpacing: '0.05em' }}>
                  PRs
                  {row.implied1RM != null && (
                    <span style={{ marginLeft: 8, color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                      e1RM <strong style={{ color: 'var(--color-text-primary)' }}>{row.implied1RM}</strong> kg
                    </span>
                  )}
                </span>
                <PREstimationModeToggle mode={mode} onChange={setMode} />
              </div>

              {loading ? (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '8px 0' }}>Loading PRs…</div>
              ) : !hasAnyPR ? (
                <div
                  style={{
                    fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic',
                    border: '1px dashed var(--color-border-tertiary)', borderRadius: 'var(--radius-md)',
                    padding: '12px', textAlign: 'center',
                  }}
                >
                  No PRs recorded for this exercise yet.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary)' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Reps</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>kg</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Date</th>
                        {mode === 'one_rm_only' && (
                          <th
                            style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 500, color: 'var(--color-text-secondary)' }}
                            title="Real value minus what the real 1RM predicts at this rep count"
                          >
                            Δ
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {REP_COUNTS.map(rc => {
                        const cell = row.cells[rc - 1];
                        const real = cell.current;
                        return (
                          <tr key={rc} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                            <td style={{ padding: '3px 6px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                              {rc}RM
                            </td>
                            <td
                              style={{
                                padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                color: real ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                                fontWeight: real ? 600 : 400,
                                fontStyle: real ? 'normal' : 'italic',
                              }}
                              title={real ? 'Recorded PR' : 'Estimated'}
                            >
                              {real ? real.value_kg : cell.phantom ?? '—'}
                            </td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-text-tertiary)' }}>
                              {real ? formatDateShort(real.achieved_date) : ''}
                            </td>
                            {mode === 'one_rm_only' && (
                              <td
                                style={{
                                  padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                  color: cell.delta == null
                                    ? 'var(--color-text-tertiary)'
                                    : cell.delta >= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)',
                                }}
                              >
                                {cell.delta == null ? '' : `${cell.delta > 0 ? '+' : ''}${cell.delta}`}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                type="button"
                onClick={() => navigate('/prs')}
                style={{
                  marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 11, color: 'var(--color-accent)',
                }}
              >
                <ExternalLink size={11} /> Edit PRs
              </button>
            </div>

            {/* ── History ── */}
            <ExerciseHistoryChart
              exerciseId={exercise.id}
              athleteId={athleteId}
              macroContext={macroContext}
              currentWeekStart={anchorWeekStart}
            />
          </>
        )}
      </div>
    </>
  );
}
