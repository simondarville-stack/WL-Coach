import { useState, useEffect } from 'react';
import { X, AlertTriangle, Clipboard, ArrowRight } from 'lucide-react';
import type { Athlete, TrainingGroup } from '../../lib/database.types';
import { formatDateRange } from '../../lib/dateUtils';
import { useCombos } from '../../hooks/useCombos';

interface CopyWeekModalProps {
  onClose: () => void;
  onPasteComplete: () => void;
  destinationWeekStart: string;
  sourceWeekStart: string;
  sourceAthlete: Athlete | null;
  sourceGroup: TrainingGroup | null;
  destinationAthlete: Athlete | null;
  destinationGroup: TrainingGroup | null;
  allAthletes: Athlete[];
  allGroups: TrainingGroup[];
}

type TargetType = 'athlete' | 'group';

export function CopyWeekModal({
  onClose,
  onPasteComplete,
  destinationWeekStart,
  sourceWeekStart,
  sourceAthlete,
  sourceGroup,
  destinationAthlete,
  destinationGroup,
  allAthletes,
  allGroups,
}: CopyWeekModalProps) {
  const getInitialTargetType = (): TargetType => {
    if (destinationGroup) return 'group';
    return 'athlete';
  };

  const [targetType, setTargetType] = useState<TargetType>(getInitialTargetType());
  const [selectedTargetAthleteId, setSelectedTargetAthleteId] = useState<string>(
    destinationAthlete?.id || ''
  );
  const [selectedTargetGroupId, setSelectedTargetGroupId] = useState<string>(
    destinationGroup?.id || ''
  );
  const [destinationHasData, setDestinationHasData] = useState(false);
  const [pasting, setPasting] = useState(false);

  const { checkDestinationWeekHasData, copyWeekPlan } = useCombos();

  const resolveTarget = (): { athlete: Athlete | null; group: TrainingGroup | null } => {
    if (targetType === 'athlete') {
      const athlete = allAthletes.find(a => a.id === selectedTargetAthleteId) || null;
      return { athlete, group: null };
    }
    if (targetType === 'group') {
      const group = allGroups.find(g => g.id === selectedTargetGroupId) || null;
      return { athlete: null, group };
    }
    return { athlete: null, group: null };
  };

  const target = resolveTarget();

  const isSameContext =
    sourceWeekStart === destinationWeekStart &&
    sourceAthlete?.id === target.athlete?.id &&
    sourceGroup?.id === target.group?.id;

  useEffect(() => {
    void checkDestinationData();
  }, [destinationWeekStart, targetType, selectedTargetAthleteId, selectedTargetGroupId]);

  const checkDestinationData = async () => {
    try {
      const hasData = await checkDestinationWeekHasData(
        destinationWeekStart,
        target.athlete?.id || null,
        target.group?.id || null,
      );
      setDestinationHasData(hasData);
    } catch { /* ignore */ }
  };

  const handlePaste = async () => {
    if (isSameContext) {
      alert('Source and destination are identical');
      return;
    }
    setPasting(true);
    try {
      await copyWeekPlan({
        sourceWeekStart,
        destinationWeekStart,
        sourceAthleteId: sourceAthlete?.id || null,
        sourceGroupId: sourceGroup?.id || null,
        targetAthleteId: target.athlete?.id || null,
        targetGroupId: target.group?.id || null,
        destinationHasData,
      });
      onPasteComplete();
      onClose();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to paste week: ${errorMessage}`);
    } finally {
      setPasting(false);
    }
  };

  const sourceLabel = sourceAthlete
    ? sourceAthlete.name
    : sourceGroup
    ? `${sourceGroup.name} (Group)`
    : 'Unassigned';

  const targetLabel = target.athlete
    ? target.athlete.name
    : target.group
    ? `${target.group.name} (Group)`
    : 'Select target...';

  const isCrossContext =
    sourceAthlete?.id !== target.athlete?.id ||
    sourceGroup?.id !== target.group?.id;

  const hasValidTarget =
    (targetType === 'athlete' && !!selectedTargetAthleteId) ||
    (targetType === 'group' && !!selectedTargetGroupId);

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', fontSize: 13,
    border: '1px solid var(--color-border-secondary)',
    borderRadius: 'var(--radius-md)', outline: 'none',
    background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
    appearance: 'auto', boxSizing: 'border-box',
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
          maxWidth: 448, width: '100%',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid var(--color-border-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clipboard size={20} style={{ color: 'var(--color-accent)' }} />
            <h2 style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>Paste Week</h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', padding: 4, borderRadius: 'var(--radius-sm)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)'; }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Source info */}
          <div style={{ background: 'var(--color-accent-muted)', border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--color-accent)', margin: 0 }}>
              <span style={{ fontWeight: 500 }}>Source:</span> {sourceLabel} — {formatDateRange(sourceWeekStart)}
            </p>
          </div>

          {/* Target selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Paste to</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  setTargetType('athlete');
                  if (!selectedTargetAthleteId && allAthletes.length > 0) setSelectedTargetAthleteId(allAthletes[0].id);
                }}
                style={{
                  flex: 1, padding: '6px 12px', fontSize: 11, fontWeight: 500,
                  borderRadius: 'var(--radius-md)',
                  border: targetType === 'athlete' ? '1px solid var(--color-accent)' : '1px solid var(--color-border-secondary)',
                  background: targetType === 'athlete' ? 'var(--color-accent)' : 'transparent',
                  color: targetType === 'athlete' ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                  cursor: 'pointer', transition: 'all 0.1s',
                }}
              >
                Athlete
              </button>
              {allGroups.length > 0 && (
                <button
                  onClick={() => {
                    setTargetType('group');
                    if (!selectedTargetGroupId && allGroups.length > 0) setSelectedTargetGroupId(allGroups[0].id);
                  }}
                  style={{
                    flex: 1, padding: '6px 12px', fontSize: 11, fontWeight: 500,
                    borderRadius: 'var(--radius-md)',
                    border: targetType === 'group' ? '1px solid var(--color-accent)' : '1px solid var(--color-border-secondary)',
                    background: targetType === 'group' ? 'var(--color-accent)' : 'transparent',
                    color: targetType === 'group' ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                    cursor: 'pointer', transition: 'all 0.1s',
                  }}
                >
                  Group
                </button>
              )}
            </div>

            {targetType === 'athlete' && (
              <select value={selectedTargetAthleteId} onChange={(e) => setSelectedTargetAthleteId(e.target.value)} style={selectStyle}>
                <option value="">Select athlete...</option>
                {allAthletes.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}

            {targetType === 'group' && (
              <select value={selectedTargetGroupId} onChange={(e) => setSelectedTargetGroupId(e.target.value)} style={selectStyle}>
                <option value="">Select group...</option>
                {allGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>

          {hasValidTarget && (
            <div style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowRight size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                <span style={{ fontWeight: 500 }}>Destination:</span> {targetLabel} — {formatDateRange(destinationWeekStart)}
              </p>
            </div>
          )}

          {isCrossContext && hasValidTarget && (
            <div style={{ background: 'var(--color-accent-muted)', border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-md)', padding: 12, fontSize: 13, color: 'var(--color-accent)' }}>
              Cross-context paste: exercises and structure will be copied from <strong>{sourceLabel}</strong> to <strong>{targetLabel}</strong>.
            </div>
          )}

          {destinationHasData && hasValidTarget && (
            <div style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)', borderRadius: 'var(--radius-md)', padding: 12, display: 'flex', gap: 8 }}>
              <AlertTriangle size={18} style={{ color: 'var(--color-warning-text)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13, color: 'var(--color-warning-text)' }}>
                <p style={{ fontWeight: 500, margin: '0 0 4px 0' }}>Warning: Destination week has existing data</p>
                <p style={{ fontSize: 11, margin: 0 }}>All existing exercises and combos will be deleted and replaced.</p>
              </div>
            </div>
          )}

          {isSameContext && hasValidTarget && (
            <div style={{ background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-md)', padding: 12, fontSize: 13, color: 'var(--color-danger-text)' }}>
              Source and destination are identical. Select a different athlete, group, or week.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, padding: 16, borderTop: '1px solid var(--color-border-secondary)' }}>
          <button
            onClick={onClose}
            disabled={pasting}
            style={{
              flex: 1, padding: '8px 16px', fontSize: 13, fontWeight: 500,
              color: 'var(--color-text-secondary)', background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)',
              cursor: pasting ? 'not-allowed' : 'pointer', transition: 'background 0.1s',
            }}
            onMouseEnter={e => { if (!pasting) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-primary)'; }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handlePaste()}
            disabled={pasting || isSameContext || !hasValidTarget}
            style={{
              flex: 1, padding: '8px 16px', fontSize: 13, fontWeight: 500,
              background: pasting || isSameContext || !hasValidTarget ? 'var(--color-bg-tertiary)' : 'var(--color-accent)',
              color: pasting || isSameContext || !hasValidTarget ? 'var(--color-text-tertiary)' : 'var(--color-text-on-accent)',
              border: 'none', borderRadius: 'var(--radius-md)',
              cursor: pasting || isSameContext || !hasValidTarget ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: pasting || isSameContext || !hasValidTarget ? 0.6 : 1,
              transition: 'background 0.1s',
            }}
          >
            {pasting ? (
              <>
                <div className="animate-spin" style={{ width: 16, height: 16, border: '2px solid var(--color-text-on-accent)', borderTopColor: 'transparent', borderRadius: '50%' }} />
                Pasting...
              </>
            ) : (
              <>
                <Clipboard size={16} />
                Paste Week
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
