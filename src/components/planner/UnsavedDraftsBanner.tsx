import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DefaultUnit, Exercise, PlannedExercise } from '../../lib/database.types';
import {
  getPrescriptionDraftsForWeek,
  clearPrescriptionDraft,
  clearPrescriptionDraftsForWeek,
  type PrescriptionDraft,
} from '../../lib/prescriptionDraftStore';

interface UnsavedDraftsBannerProps {
  /** The currently loaded week plan id (null while none is loaded). */
  weekPlanId: string | null;
  /** Exercises as loaded from the DB, grouped by day. Used to tell genuinely
   *  unsaved drafts (prescription differs) from stale ones (already saved). */
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  /** The planner's prescription save path — drafts replay through this on restore. */
  savePrescription: (
    plannedExId: string,
    data: { prescription: string; unit: DefaultUnit; isCombo?: boolean },
  ) => Promise<void>;
  /** Reload the week after a restore so the grid reflects persisted values. */
  onReload: () => void | Promise<void>;
}

/**
 * Surfaces prescription edits that were saved locally but never confirmed to
 * the server (e.g. the connection dropped mid-save), and lets the coach
 * restore or discard them. Renders nothing when there are no unsaved drafts.
 */
export function UnsavedDraftsBanner({
  weekPlanId,
  plannedExercises,
  savePrescription,
  onReload,
}: UnsavedDraftsBannerProps) {
  const [drafts, setDrafts] = useState<PrescriptionDraft[]>([]);
  const [restoring, setRestoring] = useState(false);

  // Reconcile stored drafts against what's now in the DB whenever the loaded
  // week or its exercises change. Drafts that match the DB are stale and
  // self-clear; the rest are genuinely unsaved and shown.
  useEffect(() => {
    if (!weekPlanId) {
      setDrafts([]);
      return;
    }
    const stored = getPrescriptionDraftsForWeek(weekPlanId);
    if (stored.length === 0) {
      setDrafts([]);
      return;
    }
    const dbPrescriptions = new Map<string, string>();
    Object.values(plannedExercises).flat().forEach(ex => {
      dbPrescriptions.set(ex.id, ex.prescription_raw ?? '');
    });
    const unsaved = stored.filter(d => {
      // The exercise no longer exists in this week — the draft is orphaned.
      if (!dbPrescriptions.has(d.plannedExId)) {
        clearPrescriptionDraft(d.plannedExId);
        return false;
      }
      // The DB already holds this exact prescription — the save did land.
      if (dbPrescriptions.get(d.plannedExId) === d.prescription) {
        clearPrescriptionDraft(d.plannedExId);
        return false;
      }
      return true;
    });
    setDrafts(unsaved);
  }, [weekPlanId, plannedExercises]);

  if (drafts.length === 0) return null;

  const handleRestore = async () => {
    setRestoring(true);
    let failed = 0;
    for (const d of drafts) {
      try {
        await savePrescription(d.plannedExId, {
          prescription: d.prescription,
          unit: d.unit,
          isCombo: d.isCombo,
        });
      } catch {
        failed += 1;
      }
    }
    setRestoring(false);
    await onReload();
    if (failed > 0) {
      alert(
        `${failed} change${failed === 1 ? '' : 's'} could not be restored — you may still be offline. ` +
          'They remain saved on this device, so you can try again once the connection is back.',
      );
    }
  };

  const handleDiscard = () => {
    if (!weekPlanId) return;
    const ok = confirm(
      'Discard all locally saved changes for this week? This removes the unsaved edits stored on this device and cannot be undone.',
    );
    if (!ok) return;
    clearPrescriptionDraftsForWeek(weekPlanId);
    setDrafts([]);
  };

  const preview = drafts
    .slice(0, 3)
    .map(d => d.exerciseName)
    .join(', ');
  const more = drafts.length > 3 ? ` +${drafts.length - 3} more` : '';

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
        padding: '10px 14px',
        background: 'var(--color-warning-bg)',
        border: '1px solid var(--color-warning-border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <AlertTriangle size={18} style={{ color: 'var(--color-warning-text)', flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 13, color: 'var(--color-warning-text)', minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>
          {drafts.length} unsaved change{drafts.length === 1 ? '' : 's'} from a previous session
        </span>
        <span style={{ opacity: 0.85 }}>
          {' '}— these never confirmed saving (the connection may have dropped):{' '}
          {preview}
          {more}.
        </span>
      </div>
      <button
        onClick={() => void handleRestore()}
        disabled={restoring}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 500,
          background: 'var(--color-accent)',
          color: 'var(--color-text-on-accent)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: restoring ? 'not-allowed' : 'pointer',
          opacity: restoring ? 0.6 : 1,
          flexShrink: 0,
        }}
      >
        {restoring ? 'Restoring…' : 'Restore'}
      </button>
      <button
        onClick={handleDiscard}
        disabled={restoring}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 500,
          background: 'transparent',
          color: 'var(--color-warning-text)',
          border: '1px solid var(--color-warning-border)',
          borderRadius: 'var(--radius-md)',
          cursor: restoring ? 'not-allowed' : 'pointer',
          flexShrink: 0,
        }}
      >
        Discard
      </button>
    </div>
  );
}
