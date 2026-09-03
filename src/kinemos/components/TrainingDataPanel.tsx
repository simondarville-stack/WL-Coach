/**
 * TrainingDataPanel — the flywheel's consent register, on the library.
 *
 * Design §10 makes consent for training-data use per-athlete, recorded and
 * revocable, and this is where a coach does all three. It is deliberately
 * plain and deliberately closed by default: it governs one narrow thing, it
 * is not part of anybody's daily work, and a screen that nags about consent
 * is a screen where consent gets clicked through.
 *
 * Two rules the interface keeps rather than merely states:
 *
 *   - **Nothing is on by default.** An athlete with no record is not
 *     consenting, and the export skips them without comment.
 *   - **Withdrawal is one click and takes effect immediately**, and the panel
 *     says when consent was given and when it was taken back, because those
 *     are the two facts a coach may later be asked for.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../../components/ui';
import { formatDateTimeShort } from '../../lib/dateUtils';
import { getOwnerId } from '../../lib/ownerContext';
import { useCoachStore } from '../../store/coachStore';
import { exportTrainingSet, loadConsents, setConsent, type ConsentState } from '../lib/flywheel';

export function TrainingDataPanel({ athletes }: { athletes: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [consents, setConsents] = useState<Map<string, ConsentState>>(new Map());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);

  useEffect(() => {
    if (!open) return;
    loadConsents()
      .then(setConsents)
      .catch(() => setNote('The consent register could not be read — the 20260903160000 migration may not be applied.'));
  }, [open]);

  const toggle = useCallback(
    async (athleteId: string, granted: boolean) => {
      setNote(null);
      try {
        const next = await setConsent({ athleteId, ownerId: getOwnerId(), granted, coachId: activeCoachId });
        setConsents(current => new Map(current).set(athleteId, next));
      } catch {
        setNote('That could not be recorded.');
      }
    },
    [activeCoachId],
  );

  const download = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const set = await exportTrainingSet();
      if (set.samples.length === 0) {
        setNote(
          set.consent.athletes === 0
            ? 'Nothing to export: no athlete has consented.'
            : 'Nothing to export yet: consent is recorded, but no analysis has been corrected by hand. A track nobody corrected teaches the tracker what it already believed.',
        );
        return;
      }
      const blob = new Blob([JSON.stringify(set, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kinemos-labels-${set.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNote(
        `${set.samples.length} corrected rep${set.samples.length === 1 ? '' : 's'} from ${set.consent.athletes} consenting athlete${set.consent.athletes === 1 ? '' : 's'}. No video and no names — the athletes are opaque subject ids.`,
      );
    } catch {
      setNote('The export failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  const grantedCount = [...consents.values()].filter(c => c.granted).length;

  return (
    <section
      style={{
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-sm) var(--space-md)',
        marginBottom: 'var(--space-md)',
        background: 'var(--color-bg-primary)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
        }}
      >
        <span style={{ fontSize: 'var(--text-micro)', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
          TRAINING DATA
        </span>
        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
          {open ? 'hide' : grantedCount > 0 ? `${grantedCount} consenting` : 'consent and export'}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 'var(--space-sm)' }}>
          <p style={{ margin: '0 0 var(--space-sm)', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', maxWidth: '62ch' }}>
            A track you correct by hand is a human answer to a frame the tracker got wrong, which is the
            one thing an automatic tracker cannot generate for itself. With an athlete&rsquo;s consent
            those corrections can leave KinEMOS as labelled data. The export carries the points, the
            calibration and the grade — never the video, and never a name.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
            {athletes.map(a => {
              const c = consents.get(a.id);
              const granted = c?.granted ?? false;
              return (
                <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--text-caption)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexGrow: 1, minWidth: 0 }}>
                    <input type="checkbox" checked={granted} onChange={e => void toggle(a.id, e.target.checked)} />
                    <span style={{ color: 'var(--color-text-primary)' }}>{a.name}</span>
                  </label>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {granted
                      ? c?.grantedAt
                        ? `given ${formatDateTimeShort(new Date(c.grantedAt))}`
                        : 'given'
                      : c?.revokedAt
                        ? `withdrawn ${formatDateTimeShort(new Date(c.revokedAt))}`
                        : 'not given'}
                  </span>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 'var(--space-sm)' }}>
            <Button size="sm" variant="secondary" onClick={() => void download()} disabled={busy}>
              <Download size={12} />
              {busy ? 'Building…' : 'Export the labelled set'}
            </Button>
          </div>
          {note && (
            <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
              {note}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
