/**
 * DuplicatesPanel — Phase 4 of the shared-catalogue plan (§5.4).
 *
 * Ongoing hygiene, not a one-time migration: lists the coach's PERSONAL
 * exercises that duplicate a club-catalogue exercise (same code / name /
 * alias, via the shared matching rule), each with a one-row version of the
 * Phase-3 remap. Merging repoints every plan, log and PR onto the club id
 * and archives the personal row — this is what keeps "core + personal"
 * from quietly re-splitting the shared ids over time.
 *
 * Each merge runs a server-side dry run first and shows the reference
 * counts in a confirm before executing (same one-transaction RPC as the
 * adopt wizard, with a single-entry mapping).
 */
import { useState } from 'react';
import { AlertTriangle, GitMerge, Loader2, X } from 'lucide-react';
import type { Exercise } from '../../lib/database.types';
import { useExerciseLibraries } from '../../hooks/useExerciseLibraries';
import type { MatchBy } from '../../lib/exerciseMatching';
import { LibraryChip } from './LibraryChip';
import { Button } from '../ui';

export interface DuplicatePair {
  personal: Exercise;
  club: Exercise;
  matchBy: MatchBy;
  clubLabel: string; // catalogue name, for the chip
}

interface DuplicatesPanelProps {
  pairs: DuplicatePair[];
  personalLibraryId: string;
  onClose: () => void;
  /** Called after each successful merge so the library refetches. */
  onChanged: () => void;
}

const td: React.CSSProperties = {
  fontSize: 'var(--text-label)', color: 'var(--color-text-primary)',
  padding: '5px 8px', borderBottom: '0.5px solid var(--color-border-tertiary)', whiteSpace: 'nowrap',
};

export function DuplicatesPanel({ pairs, personalLibraryId, onClose, onChanged }: DuplicatesPanelProps) {
  const libs = useExerciseLibraries();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergedIds, setMergedIds] = useState<Set<string>>(new Set());

  const remaining = pairs.filter(p => !mergedIds.has(p.personal.id));

  const handleMerge = async (pair: DuplicatePair) => {
    if (!pair.club.library_id) return;
    setBusyId(pair.personal.id);
    setError(null);
    try {
      const mapping = [{ source_id: pair.personal.id, action: 'merge' as const, target_id: pair.club.id }];
      const preview = await libs.adoptLibrary({
        fromLibraryId: personalLibraryId,
        toLibraryId: pair.club.library_id,
        mapping,
        dryRun: true,
      });
      const ok = window.confirm(
        `Merge your "${pair.personal.name}" into the club exercise "${pair.club.name}" (${pair.clubLabel})?\n\n` +
        `${preview.references_repointed} reference(s) — plans, logs, PRs — will repoint to the club exercise, ` +
        'and your personal exercise will be archived (never deleted).',
      );
      if (!ok) return;
      await libs.adoptLibrary({
        fromLibraryId: personalLibraryId,
        toLibraryId: pair.club.library_id,
        mapping,
        dryRun: false,
      });
      setMergedIds(prev => new Set(prev).add(pair.personal.id));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        className="rounded-lg w-full max-h-[85vh] flex flex-col"
        style={{ maxWidth: 640, backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}
      >
        {/* Header */}
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '0.5px solid var(--color-border-secondary)', flexShrink: 0 }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} style={{ color: 'var(--color-warning-text, #92400e)' }} />
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Duplicates vs club catalogues
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100" title="Close">
            <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto" style={{ flex: 1 }}>
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
            These personal exercises match a club-catalogue exercise. Two ids for one lift means two
            half-series in Analysis — merging folds your history onto the shared id and archives the
            personal row. Each merge shows its reference counts before anything commits.
          </p>

          {error && (
            <div style={{
              fontSize: 'var(--text-caption)', color: 'var(--color-danger-text, #b91c1c)',
              background: 'var(--color-danger-bg, #fef2f2)', border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)', padding: '8px 10px', marginBottom: 10,
            }}>
              {error}
            </div>
          )}

          {remaining.length === 0 ? (
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', padding: '12px 0' }}>
              No duplicates left — your catalogue is clean.
            </div>
          ) : (
            <div style={{ border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  {remaining.map(pair => (
                    <tr key={pair.personal.id}>
                      <td style={td}>
                        {pair.personal.exercise_code && (
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', marginRight: 6 }}>
                            {pair.personal.exercise_code}
                          </span>
                        )}
                        {pair.personal.name}
                      </td>
                      <td style={{ ...td, color: 'var(--color-text-tertiary)', fontSize: 'var(--text-caption)' }}>
                        matches (by {pair.matchBy})
                      </td>
                      <td style={td}>
                        {pair.club.exercise_code && (
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', marginRight: 6 }}>
                            {pair.club.exercise_code}
                          </span>
                        )}
                        {pair.club.name}
                        <span style={{ marginLeft: 6 }}><LibraryChip label={pair.clubLabel} /></span>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={busyId === pair.personal.id ? <Loader2 size={11} className="animate-spin" /> : <GitMerge size={11} />}
                          disabled={busyId !== null}
                          onClick={() => void handleMerge(pair)}
                        >
                          Merge…
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
