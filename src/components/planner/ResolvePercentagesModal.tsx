import { useMemo, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { formatPrescriptionPreview } from '../../lib/prescriptionParser';

interface BaseCandidate {
  plannedExerciseId: string;
  exerciseColor: string;
  prescriptionRaw: string;
}

export interface SingleResolveCandidate extends BaseCandidate {
  kind: 'single';
  exerciseName: string;
  /** Display name of the exercise whose PR is used (only set when PR is via a reference exercise). */
  prSourceName: string | null;
  /** Athlete PR for the resolved reference exercise, in kg. Null = no PR on file. */
  defaultPR: number | null;
}

export interface ComboMemberOption {
  exerciseId: string;
  name: string;
  color: string;
  pr: number | null;
}

export interface ComboResolveCandidate extends BaseCandidate {
  kind: 'combo';
  comboName: string;
  members: ComboMemberOption[];
}

export type ResolveCandidate = SingleResolveCandidate | ComboResolveCandidate;

export interface ResolveRoundingOptions {
  enabled: boolean;
  increment: number;
}

interface ResolvePercentagesModalProps {
  candidates: ResolveCandidate[];
  onClose: () => void;
  onConfirm: (overrides: Record<string, number>, rounding: ResolveRoundingOptions) => Promise<void>;
  /** Initial state for the rounding controls. Sourced from
   *  general_settings; falls back to (true, 0.5) when omitted. */
  defaultRounding?: ResolveRoundingOptions;
}

const CUSTOM = '__custom__';

function pickComboDefaultSource(members: ComboMemberOption[]): string {
  const firstWithPR = members.find(m => m.pr != null);
  if (firstWithPR) return firstWithPR.exerciseId;
  return members[0]?.exerciseId ?? CUSTOM;
}

export function ResolvePercentagesModal({
  candidates,
  onClose,
  onConfirm,
  defaultRounding,
}: ResolvePercentagesModalProps) {
  // Per-row selection: for singles this is unused; for combos, holds the
  // exerciseId of the member whose PR is being used, or CUSTOM for free entry.
  const [sources, setSources] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of candidates) {
      if (c.kind === 'combo') init[c.plannedExerciseId] = pickComboDefaultSource(c.members);
    }
    return init;
  });

  // Per-row numeric input (kg).
  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of candidates) {
      if (c.kind === 'single') {
        init[c.plannedExerciseId] = c.defaultPR != null ? String(c.defaultPR) : '';
      } else {
        const sourceId = pickComboDefaultSource(c.members);
        const member = c.members.find(m => m.exerciseId === sourceId);
        init[c.plannedExerciseId] = member?.pr != null ? String(member.pr) : '';
      }
    }
    return init;
  });

  const [submitting, setSubmitting] = useState(false);
  const [roundEnabled, setRoundEnabled] = useState(defaultRounding?.enabled ?? true);
  const [roundIncrementRaw, setRoundIncrementRaw] = useState(String(defaultRounding?.increment ?? 0.5));

  const parsed = useMemo(() => {
    return candidates.map(c => {
      const raw = (inputs[c.plannedExerciseId] ?? '').trim().replace(',', '.');
      if (raw === '') return { id: c.plannedExerciseId, value: null as number | null, valid: false, empty: true };
      const num = Number(raw);
      const valid = Number.isFinite(num) && num > 0;
      return { id: c.plannedExerciseId, value: valid ? num : null, valid, empty: false };
    });
  }, [candidates, inputs]);

  const convertibleCount = parsed.filter(p => p.valid).length;
  const hasInvalid = parsed.some(p => !p.empty && !p.valid);

  const roundIncrement = useMemo(() => {
    const raw = roundIncrementRaw.trim().replace(',', '.');
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
  }, [roundIncrementRaw]);
  const roundInvalid = roundEnabled && roundIncrement === null;

  function handleComboSourceChange(candidate: ComboResolveCandidate, sourceId: string) {
    setSources(prev => ({ ...prev, [candidate.plannedExerciseId]: sourceId }));
    if (sourceId === CUSTOM) return;
    const member = candidate.members.find(m => m.exerciseId === sourceId);
    if (member?.pr != null) {
      setInputs(prev => ({ ...prev, [candidate.plannedExerciseId]: String(member.pr) }));
    } else {
      setInputs(prev => ({ ...prev, [candidate.plannedExerciseId]: '' }));
    }
  }

  function handleInputChange(id: string, value: string) {
    setInputs(prev => ({ ...prev, [id]: value }));
  }

  async function handleConfirm() {
    if (convertibleCount === 0 || submitting || roundInvalid) return;
    const overrides: Record<string, number> = {};
    for (const p of parsed) if (p.valid && p.value != null) overrides[p.id] = p.value;
    const rounding: ResolveRoundingOptions = {
      enabled: roundEnabled,
      increment: roundIncrement ?? 0.5,
    };
    setSubmitting(true);
    try {
      await onConfirm(overrides, rounding);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: 90, padding: '4px 8px', fontSize: 12,
    border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)',
    outline: 'none', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
    boxSizing: 'border-box', textAlign: 'right', fontFamily: 'var(--font-mono)',
  };

  const selectStyle: React.CSSProperties = {
    fontSize: 11, padding: '3px 6px',
    border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
    outline: 'none', background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)',
    cursor: 'pointer', maxWidth: 220,
  };

  return (
    <div
      className="animate-backdrop-in"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
    >
      <div
        className="animate-dialog-in"
        style={{
          background: 'var(--color-bg-primary)',
          borderRadius: 'var(--radius-xl)',
          border: '0.5px solid var(--color-border-primary)',
          maxWidth: 720, width: '100%', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-secondary)',
          padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>Convert percentages to kg</h2>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>
              For combos, pick which exercise's PR to use — or override with a custom value.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ padding: 6, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {candidates.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '32px 0', margin: 0 }}>
              No percentage prescriptions on this week.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-secondary)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Exercise</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prescription (%)</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PR source</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>PR (kg)</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => {
                  const input = inputs[c.plannedExerciseId] ?? '';
                  const p = parsed.find(x => x.id === c.plannedExerciseId);
                  const showInvalid = !!p && !p.empty && !p.valid;

                  return (
                    <tr key={c.plannedExerciseId} style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
                      {/* Exercise / combo */}
                      <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>
                        {c.kind === 'single' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.exerciseColor, flexShrink: 0 }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.exerciseName}
                              </div>
                              {c.prSourceName && (
                                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                  uses {c.prSourceName} PR
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                                {c.members.map(m => (
                                  <span key={m.exerciseId} style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }} />
                                ))}
                              </div>
                              <div style={{ fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.comboName}
                              </div>
                              <span style={{ fontSize: 9, background: 'var(--color-accent-muted)', color: 'var(--color-accent)', fontWeight: 500, padding: '1px 5px', borderRadius: 'var(--radius-sm)' }}>Combo</span>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                              {c.members.map(m => m.name).join(' + ')}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Prescription */}
                      <td style={{ padding: '8px 12px', verticalAlign: 'top', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {formatPrescriptionPreview(c.prescriptionRaw) || c.prescriptionRaw}
                      </td>

                      {/* PR source picker */}
                      <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>
                        {c.kind === 'single' ? (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                            {c.defaultPR != null ? 'Athlete PR' : 'No PR on file'}
                          </span>
                        ) : (
                          <select
                            value={sources[c.plannedExerciseId] ?? CUSTOM}
                            onChange={e => handleComboSourceChange(c, e.target.value)}
                            style={selectStyle}
                          >
                            {c.members.map(m => (
                              <option key={m.exerciseId} value={m.exerciseId}>
                                {m.name}{m.pr != null ? ` — ${m.pr} kg` : ' — no PR'}
                              </option>
                            ))}
                            <option value={CUSTOM}>Custom value…</option>
                          </select>
                        )}
                      </td>

                      {/* Numeric input */}
                      <td style={{ padding: '8px 12px', verticalAlign: 'top', textAlign: 'right' }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={input}
                          onChange={e => handleInputChange(c.plannedExerciseId, e.target.value)}
                          placeholder={c.kind === 'single' && c.defaultPR != null ? String(c.defaultPR) : '—'}
                          style={{
                            ...inputStyle,
                            borderColor: showInvalid ? 'var(--color-danger-text)' : 'var(--color-border-secondary)',
                          }}
                        />
                        {input.trim() === '' && (
                          <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            No PR — will be skipped
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Rounding controls */}
        {candidates.length > 0 && (
          <div style={{
            borderTop: '1px solid var(--color-border-secondary)',
            padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            background: 'var(--color-bg-secondary)',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={roundEnabled}
                onChange={e => setRoundEnabled(e.target.checked)}
              />
              <span style={{ fontWeight: 500 }}>Round results</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: roundEnabled ? 1 : 0.4 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>to nearest</span>
              <input
                type="text"
                inputMode="decimal"
                value={roundIncrementRaw}
                onChange={e => setRoundIncrementRaw(e.target.value)}
                disabled={!roundEnabled}
                style={{
                  width: 60, padding: '4px 6px', fontSize: 11,
                  fontFamily: 'var(--font-mono)', textAlign: 'right',
                  border: `1px solid ${roundInvalid ? 'var(--color-danger-text)' : 'var(--color-border-secondary)'}`,
                  borderRadius: 'var(--radius-md)', outline: 'none',
                  background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>kg</span>
            </div>
            {roundInvalid && (
              <span style={{ fontSize: 10, color: 'var(--color-danger-text)' }}>Enter a positive number</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--color-border-secondary)',
          padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {candidates.length === 0
              ? ''
              : convertibleCount === candidates.length
                ? `${convertibleCount} exercise${convertibleCount === 1 ? '' : 's'} ready`
                : `${convertibleCount} of ${candidates.length} ready · ${candidates.length - convertibleCount} skipped`}
            {hasInvalid && (
              <span style={{ color: 'var(--color-danger-text)', marginLeft: 6 }}>· invalid value</span>
            )}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                background: 'transparent', color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)',
                cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleConfirm()}
              disabled={convertibleCount === 0 || hasInvalid || roundInvalid || submitting}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                background: convertibleCount === 0 || hasInvalid || roundInvalid ? 'var(--color-bg-tertiary)' : 'var(--color-accent)',
                color: convertibleCount === 0 || hasInvalid || roundInvalid ? 'var(--color-text-tertiary)' : 'var(--color-text-on-accent)',
                border: 'none', borderRadius: 'var(--radius-md)',
                cursor: convertibleCount === 0 || hasInvalid || roundInvalid || submitting ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Converting…' : (
                <>
                  Convert {convertibleCount > 0 ? convertibleCount : ''}
                  <ArrowRight size={12} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
