/**
 * PrunePanel — review and archive the exercises a coach has stopped using.
 *
 * Opened from the "N unused" hint next to the usage window. Lists every
 * exercise with no planned and no logged use inside that window, ordered
 * DEADEST FIRST (never used, then longest-stale), grouped by category, with
 * the last time each was actually planned or logged. That staleness column is
 * the point: "unused for 12 weeks" is not a reason to archive — "never used"
 * or "last programmed in April" is.
 *
 * Safety by design rather than by dialog: archiving is reversible (the
 * Archived toggle restores in one click), nothing is deleted, rows in
 * catalogues the coach may not edit are shown but not selectable, and a row
 * that still has variations says so — archiving a parent leaves its children
 * behind as top-level rows.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Archive, Loader2, X, Lock, Info } from 'lucide-react';
import type { Exercise } from '../../lib/database.types';
import { fetchExerciseLastUsed, type LastUsed } from '../../hooks/useExerciseUsage';
import { formatDateToDDMMYYYY } from '../../lib/dateUtils';
import { buildChildrenIndex } from '../../lib/exerciseHierarchy';
import { LibraryChip } from './LibraryChip';
import { Button } from '../ui';

interface PrunePanelProps {
  /** Exercises with no planned and no logged use in the window. */
  candidates: Exercise[];
  /** All active exercises — for counting variations left behind. */
  allExercises: Exercise[];
  weeks: number;
  canArchive: (exercise: Exercise) => boolean;
  libraryBadge: (exercise: Exercise) => string | null;
  onArchive: (ids: string[]) => Promise<{ archived: number; skipped: number }>;
  onClose: () => void;
  /** Called after a successful archive so the catalogue refetches. */
  onChanged: () => void;
}

/** Most recent of the two dates, or null when never used at all. */
function lastTouched(u: LastUsed | undefined): string | null {
  if (!u) return null;
  const dates = [u.lastPlanned, u.lastLogged].filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  // ISO dates sort lexicographically; take the most recent.
  return dates.sort()[dates.length - 1];
}

const th: React.CSSProperties = {
  fontSize: 'var(--text-caption)', fontWeight: 500, color: 'var(--color-text-secondary)',
  textAlign: 'left', padding: '4px 8px', whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  fontSize: 'var(--text-label)', color: 'var(--color-text-primary)',
  padding: '4px 8px', borderTop: '0.5px solid var(--color-border-tertiary)', whiteSpace: 'nowrap',
};

export function PrunePanel({
  candidates, allExercises, weeks, canArchive, libraryBadge, onArchive, onClose, onChanged,
}: PrunePanelProps) {
  const [lastUsed, setLastUsed] = useState<Map<string, LastUsed> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ archived: number; skipped: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchExerciseLastUsed(candidates.map(c => c.id))
      .then(m => { if (alive) setLastUsed(m); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Couldn’t load usage dates. Check your connection and try again.'); });
    return () => { alive = false; };
  }, [candidates]);

  // How many variations each candidate would leave behind if archived.
  const childCounts = useMemo(() => {
    const index = buildChildrenIndex(allExercises);
    const out = new Map<string, number>();
    for (const c of candidates) out.set(c.id, (index.get(c.id) ?? []).length);
    return out;
  }, [candidates, allExercises]);

  /** Deadest first: never used, then longest-stale; category groups follow
   *  that order so the top of the list is always the safest to archive. */
  const groups = useMemo(() => {
    const sorted = [...candidates].sort((a, b) => {
      const da = lastTouched(lastUsed?.get(a.id));
      const db = lastTouched(lastUsed?.get(b.id));
      if (da === db) return a.name.localeCompare(b.name);
      if (da === null) return -1;
      if (db === null) return 1;
      return da.localeCompare(db);
    });
    const byCategory = new Map<string, Exercise[]>();
    for (const ex of sorted) {
      const key = (ex.category as unknown as string) || 'Unspecified';
      const arr = byCategory.get(key) ?? [];
      arr.push(ex);
      byCategory.set(key, arr);
    }
    return [...byCategory.entries()];
  }, [candidates, lastUsed]);

  const selectable = useMemo(() => candidates.filter(canArchive), [candidates, canArchive]);
  const lockedCount = candidates.length - selectable.length;
  const allSelected = selectable.length > 0 && selectable.every(e => selected.has(e.id));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleArchive = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onArchive(ids);
      setDone(result);
      setSelected(new Set());
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archiving failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        className="rounded-lg w-full max-h-[86vh] flex flex-col"
        style={{ maxWidth: 700, backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}
      >
        {/* Header */}
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '0.5px solid var(--color-border-secondary)', flexShrink: 0 }}
        >
          <div className="flex items-center gap-2">
            <Archive size={15} style={{ color: 'var(--color-accent)' }} />
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Prune unused exercises
            </h2>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              · {candidates.length} with no use in the last {weeks} weeks
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100" title="Close">
            <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        <div className="px-5 py-3 overflow-y-auto" style={{ flex: 1 }}>
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
            Ordered deadest first. <strong>Archiving is reversible</strong> — archived exercises keep all
            their history and come back from the “Archived” toggle in the toolbar. Nothing is deleted.
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

          {done && (
            <div style={{
              fontSize: 'var(--text-caption)', color: 'var(--color-success-text, #047857)',
              background: 'var(--color-success-bg, #ecfdf5)', border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)', padding: '8px 10px', marginBottom: 10,
            }}>
              Archived {done.archived} exercise{done.archived === 1 ? '' : 's'}
              {done.skipped > 0 && ` · ${done.skipped} skipped (read-only catalogue)`}.
              Restore any of them from the Archived toggle.
            </div>
          )}

          {lastUsed === null && !error && (
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>Loading usage dates…</div>
          )}

          {lastUsed !== null && candidates.length === 0 && (
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', padding: '10px 0' }}>
              Nothing unused — every exercise in the catalogue has been planned or logged in this window.
            </div>
          )}

          {lastUsed !== null && candidates.length > 0 && (
            <>
              <div className="flex items-center gap-3 mb-2">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map(e => e.id)))}
                  />
                  Select all {selectable.length}
                </label>
                {lockedCount > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                    <Lock size={10} /> {lockedCount} in a read-only catalogue
                  </span>
                )}
              </div>

              <div style={{ border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg-secondary)' }}>
                      <th style={{ ...th, width: 28 }}></th>
                      <th style={th}>Exercise</th>
                      <th style={th}>Last planned</th>
                      <th style={th}>Last logged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([category, rows]) => (
                      <Fragment key={category}>
                        <tr>
                          <td
                            colSpan={4}
                            style={{
                              ...td, background: 'var(--color-bg-secondary)',
                              fontSize: 'var(--text-caption)', fontWeight: 600,
                              color: 'var(--color-text-tertiary)',
                            }}
                          >
                            {category} · {rows.length}
                          </td>
                        </tr>
                        {rows.map(ex => {
                          const u = lastUsed.get(ex.id);
                          const editable = canArchive(ex);
                          const kids = childCounts.get(ex.id) ?? 0;
                          const label = libraryBadge(ex);
                          return (
                            <tr key={ex.id} style={{ opacity: editable ? 1 : 0.55 }}>
                              <td style={td}>
                                <input
                                  type="checkbox"
                                  checked={selected.has(ex.id)}
                                  disabled={!editable || busy}
                                  onChange={() => toggle(ex.id)}
                                  title={editable ? undefined : 'Read-only catalogue — you cannot archive this'}
                                />
                              </td>
                              <td style={td}>
                                {ex.exercise_code && (
                                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', marginRight: 6 }}>
                                    {ex.exercise_code}
                                  </span>
                                )}
                                {ex.name}
                                {label && <span style={{ marginLeft: 6 }}><LibraryChip label={label} /></span>}
                                {kids > 0 && (
                                  <span
                                    title={`Archiving this leaves ${kids} variation(s) behind as top-level exercises.`}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, fontSize: 'var(--text-caption)', color: 'var(--color-warning-text, #92400e)' }}
                                  >
                                    <Info size={10} /> {kids} variation{kids === 1 ? '' : 's'}
                                  </span>
                                )}
                              </td>
                              <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: u?.lastPlanned ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)' }}>
                                {u?.lastPlanned ? formatDateToDDMMYYYY(u.lastPlanned) : 'never'}
                              </td>
                              <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: u?.lastLogged ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)' }}>
                                {u?.lastLogged ? formatDateToDDMMYYYY(u.lastLogged) : 'never'}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 flex items-center gap-2"
          style={{ borderTop: '0.5px solid var(--color-border-secondary)', flexShrink: 0 }}
        >
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            {selected.size} selected
          </span>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Close</Button>
          <Button
            variant="primary"
            size="sm"
            icon={busy ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
            disabled={busy || selected.size === 0}
            onClick={() => void handleArchive()}
          >
            Archive {selected.size > 0 ? selected.size : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}
