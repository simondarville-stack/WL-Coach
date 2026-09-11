/**
 * SweepStatus — what the backlog sweep is doing, one dense line above the table.
 *
 * Before this, the sweep's only voice was a bare `<p>` rendered ninety lines of
 * JSX above the filter row: off screen the moment the coach scrolled down to
 * watch the rows it was describing. And it said `label` — "Caroline · Snatch",
 * or, for an unattached import, literally "Clip" — which cannot pick a row out
 * of a hundred. So the clip eating the laptop was typographically identical to
 * every other row reading `waiting`.
 *
 * This sits directly above the table instead, so "which clip" is one glance
 * from "which row", and the row itself is highlighted through the same state
 * (`DataTable`'s `isCurrentRow`).
 *
 * **No percentage is ever printed.** `done`/`steps` change units between
 * stages — frames while the scan walks the clip, lift index while plates are
 * found, frames again while the bar is followed, rep index while they are
 * stored — so one number across the clip would be a lie. The counter and the
 * bar describe the current stage only, and the stage is named beside them.
 *
 * Reduced motion: `src/index.css` caps every animation at one 0,01 ms
 * iteration, so the spinner is decoration. The moving NUMBERS and the changing
 * stage are the evidence that anything is alive.
 */
import { Loader2, Square } from 'lucide-react';

export type SweepPhase = 'idle' | 'starting' | 'sweeping' | 'stopping' | 'finishing';

export interface SweepAt {
  /** `clipKeyOf(source, sourceId)` — which row to mark. */
  clipKey: string;
  index: number;
  total: number;
  label: string;
  stage: string;
  done: number;
  steps: number;
}

export function SweepStatus({
  phase,
  at,
  note,
}: {
  phase: SweepPhase;
  at: SweepAt | null;
  note: string | null;
}) {
  if (phase === 'idle' && !note) return null;

  const running = phase === 'sweeping' || phase === 'stopping';
  const pct = at && at.steps > 1 ? Math.round((at.done / Math.max(1, at.steps)) * 100) : 0;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        minHeight: 20,
        margin: '0 0 var(--space-sm)',
        fontSize: 'var(--text-caption)',
        color: 'var(--color-text-secondary)',
        flexWrap: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {phase === 'idle' ? (
        note
      ) : (
        <>
          {running ? (
            <Square size={11} style={{ flexShrink: 0 }} />
          ) : (
            <Loader2 size={11} className="animate-spin" style={{ flexShrink: 0 }} />
          )}

          {phase === 'starting' && !at ? (
            <span>Opening the first clip…</span>
          ) : phase === 'finishing' ? (
            <span>Reading back the stored reps…</span>
          ) : at ? (
            <>
              <span
                style={{
                  color: 'var(--color-text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}
              >
                {`Clip ${at.index} of ${at.total}`}
              </span>
              <span
                style={{
                  maxWidth: 240,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={at.label}
              >
                {at.label}
              </span>
              {phase === 'stopping' ? (
                <span style={{ color: 'var(--color-danger-text)' }}>
                  Stopping — nothing from this clip will be stored.
                </span>
              ) : (
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {at.stage}
                </span>
              )}

              {at.steps > 1 && phase !== 'stopping' && (
                // aria-hidden: `role="status"` is an implicit polite live
                // region, and this changes four times a second. The coarse
                // "Clip 3 of 12 · label · stage" above is what gets announced.
                <span
                  aria-hidden="true"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
                >
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {`${at.done} / ${at.steps}`}
                  </span>
                  <span
                    style={{
                      width: 120,
                      height: 3,
                      borderRadius: 999,
                      background: 'var(--color-bg-tertiary)',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        height: '100%',
                        borderRadius: 999,
                        background: 'var(--color-accent)',
                        width: `${pct}%`,
                        transition: 'width 0.2s',
                      }}
                    />
                  </span>
                </span>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
