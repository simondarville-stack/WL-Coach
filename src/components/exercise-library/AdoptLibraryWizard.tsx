/**
 * AdoptLibraryWizard — Phase 3 of the shared-catalogue plan (§5.3).
 *
 * Folds the active coach's personal exercise library into a club catalogue:
 *
 *   1. MAPPING — every active personal exercise is auto-matched against the
 *      club catalogue (code first, then name, then aliases — both ways) and
 *      the coach chooses per row: Merge into the club exercise (all history
 *      repoints to the club id, source archived), Move into the club
 *      catalogue (id preserved), or Keep personal.
 *   2. PREVIEW — a server-side dry run reports exactly what would change
 *      (rows merged/moved/kept, every reference repointed per table,
 *      parent/PR edges, category copies, conflicts left behind). Nothing
 *      commits until the coach has read it.
 *   3. ADOPT — the same mapping executes in ONE transaction; the final
 *      report mirrors the preview.
 *
 * Viewers can adopt too (merging touches only their own athletes' data and
 * archives their own rows), but only editors may MOVE exercises into the
 * shared catalogue.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, GitMerge, Loader2, X } from 'lucide-react';
import { useCoachStore } from '../../store/coachStore';
import { useExerciseStore } from '../../store/exerciseStore';
import {
  useExerciseLibraries,
  type AdoptAction, type AdoptExercise, type AdoptMappingEntry, type AdoptReport,
} from '../../hooks/useExerciseLibraries';
import { resolveLibraryScope } from '../../lib/libraryScope';
import { matchExercise, type MatchBy } from '../../lib/exerciseMatching';
import { Button } from '../ui';

interface AdoptLibraryWizardProps {
  targetLibrary: { id: string; name: string };
  /** Editor role on the target catalogue — gates the Move action. */
  isEditor: boolean;
  onClose: () => void;
  /** Called after a successful (non-dry) adoption. */
  onComplete: () => void;
}

interface MappingRow {
  source: AdoptExercise;
  match: AdoptExercise | null;
  matchBy: MatchBy | null;
  /** The source's code exists verbatim in the target — Move would violate
   *  the per-catalogue code uniqueness. */
  codeConflict: boolean;
  action: AdoptAction;
  targetId: string | null;
}

const cellSelect: React.CSSProperties = {
  fontSize: 'var(--text-caption)', padding: '2px 4px',
  border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
};

const th: React.CSSProperties = {
  fontSize: 'var(--text-caption)', fontWeight: 500, color: 'var(--color-text-secondary)',
  textAlign: 'left', padding: '5px 8px', borderBottom: '0.5px solid var(--color-border-secondary)',
  position: 'sticky', top: 0, background: 'var(--color-bg-primary)', whiteSpace: 'nowrap', zIndex: 1,
};

const td: React.CSSProperties = {
  fontSize: 'var(--text-label)', color: 'var(--color-text-primary)',
  padding: '4px 8px', borderBottom: '0.5px solid var(--color-border-tertiary)', whiteSpace: 'nowrap',
};

/** Human labels for the report's per-table reference counts. */
const REFERENCE_LABELS: Record<string, string> = {
  planned_exercises: 'Planned exercises',
  planned_combo_members: 'Planned combo members',
  planned_combo_items: 'Planned combo items',
  training_log_exercises: 'Training-log exercises',
  athlete_prs: 'Athlete PRs',
  athlete_pr_history: 'PR history entries',
  macro_tracked_exercises: 'Macro tracked exercises',
  program_template_exercises: 'Template exercises',
  program_template_combo_members: 'Template combo members',
  combo_template_parts: 'Combo template parts',
  sollist_model_rows: 'Soll–Ist model rows',
};

export function AdoptLibraryWizard({ targetLibrary, isEditor, onClose, onComplete }: AdoptLibraryWizardProps) {
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? '00000000-0000-0000-0000-000000000001');
  const invalidateExerciseCache = useExerciseStore(s => s.invalidate);
  const libs = useExerciseLibraries();

  const [step, setStep] = useState<'mapping' | 'preview' | 'done'>('mapping');
  const [personalLibraryId, setPersonalLibraryId] = useState<string | null>(null);
  const [rows, setRows] = useState<MappingRow[] | null>(null);
  const [targets, setTargets] = useState<AdoptExercise[]>([]);
  const [report, setReport] = useState<AdoptReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const scope = await resolveLibraryScope(activeCoachId);
      if (!scope.personalLibraryId) throw new Error('No personal library found');
      setPersonalLibraryId(scope.personalLibraryId);
      const { source, target } = await libs.fetchAdoptCandidates(scope.personalLibraryId, targetLibrary.id);
      setTargets(target);
      const targetCodes = new Set(target.map(t => t.exercise_code).filter((c): c is string => c != null));
      setRows(source.map(s => {
        const { match, matchBy } = matchExercise(s, target);
        const codeConflict = s.exercise_code != null && targetCodes.has(s.exercise_code);
        const canMove = isEditor && !codeConflict;
        // Matched rows default to merge (the whole point of adoption);
        // unmatched default to move for editors, keep for viewers.
        const action: AdoptAction = match ? 'merge' : canMove ? 'move' : 'keep';
        return { source: s, match, matchBy, codeConflict, action, targetId: match?.id ?? null };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load libraries. Check your connection and try again.');
    }
  }, [activeCoachId, targetLibrary.id, isEditor]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const merge = rows?.filter(r => r.action === 'merge').length ?? 0;
    const move = rows?.filter(r => r.action === 'move').length ?? 0;
    const keep = rows?.filter(r => r.action === 'keep').length ?? 0;
    return { merge, move, keep };
  }, [rows]);

  const mapping = useMemo<AdoptMappingEntry[]>(
    () => (rows ?? []).map(r => ({
      source_id: r.source.id,
      action: r.action,
      target_id: r.action === 'merge' ? r.targetId : null,
    })),
    [rows],
  );

  const setRow = (sourceId: string, patch: Partial<MappingRow>) => {
    setRows(prev => prev?.map(r => (r.source.id === sourceId ? { ...r, ...patch } : r)) ?? prev);
  };

  const runAdopt = async (dryRun: boolean) => {
    if (!personalLibraryId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await libs.adoptLibrary({
        fromLibraryId: personalLibraryId,
        toLibraryId: targetLibrary.id,
        mapping,
        dryRun,
      });
      setReport(result);
      if (dryRun) {
        setStep('preview');
      } else {
        invalidateExerciseCache();
        setStep('done');
        onComplete();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Adoption failed');
    } finally {
      setBusy(false);
    }
  };

  const invalidMerges = (rows ?? []).filter(r => r.action === 'merge' && !r.targetId).length;

  // ── Render ────────────────────────────────────────────────────────

  const renderReport = (r: AdoptReport) => {
    const refEntries = Object.entries(r.references).filter(([, n]) => n > 0);
    const conflictEntries = Object.entries(r.conflicts_kept).filter(([, n]) => n > 0);
    return (
      <div className="space-y-3">
        <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-primary)' }}>
          <strong>{r.merged}</strong> merged into club exercises · <strong>{r.moved}</strong> moved into
          "{targetLibrary.name}" (ids preserved) · <strong>{r.kept}</strong> kept personal
          {r.categories_created > 0 && <> · <strong>{r.categories_created}</strong> categories copied to the club</>}
        </div>
        <div>
          <div style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            References repointed to club ids — {r.references_repointed} total
          </div>
          {refEntries.length === 0 ? (
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              None — no plans, logs or PRs reference the merged exercises.
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {refEntries.map(([key, n]) => (
                  <tr key={key}>
                    <td style={{ ...td, borderBottom: 'none', padding: '1px 16px 1px 0', color: 'var(--color-text-secondary)' }}>
                      {REFERENCE_LABELS[key] ?? key}
                    </td>
                    <td style={{ ...td, borderBottom: 'none', padding: '1px 0', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {(r.parent_links_repointed > 0 || r.pr_references_repointed > 0 || r.parent_links_cleared > 0) && (
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
            Tree edges: {r.parent_links_repointed} parent link(s) and {r.pr_references_repointed} PR
            reference(s) repointed to club exercises
            {r.parent_links_cleared > 0 && (
              <>; <strong>{r.parent_links_cleared} parent link(s) cleared</strong> (a moved club exercise
              cannot stay parented to a personal one)</>
            )}.
          </div>
        )}
        {conflictEntries.length > 0 && (
          <div style={{
            fontSize: 'var(--text-caption)', color: 'var(--color-warning-text, #92400e)',
            background: 'var(--color-warning-bg, #fffbeb)', border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--radius-md)', padding: '6px 8px',
          }}>
            Left on the archived personal rows (a matching club entry already exists):{' '}
            {conflictEntries.map(([key, n]) => `${n} ${REFERENCE_LABELS[key] ?? key}`).join(', ')}.
            Nothing is deleted.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        className="rounded-lg w-full max-h-[90vh] flex flex-col"
        style={{ maxWidth: 780, backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}
      >
        {/* Header */}
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '0.5px solid var(--color-border-secondary)', flexShrink: 0 }}
        >
          <div className="flex items-center gap-2">
            <GitMerge size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Adopt my library into "{targetLibrary.name}"
            </h2>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              · {step === 'mapping' ? 'step 1 of 2 — review the mapping' : step === 'preview' ? 'step 2 of 2 — confirm' : 'done'}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100" title="Close">
            <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto" style={{ flex: 1 }}>
          {error && (
            <div style={{
              fontSize: 'var(--text-caption)', color: 'var(--color-danger-text, #b91c1c)',
              background: 'var(--color-danger-bg, #fef2f2)', border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)', padding: '8px 10px', marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          {step === 'mapping' && (
            <>
              <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
                <strong>Merge</strong> repoints every plan, log and PR from your exercise onto the club
                one and archives yours — this is what makes cross-coach analysis line up.{' '}
                <strong>Move</strong> puts your exercise into the club catalogue keeping its id.{' '}
                <strong>Keep</strong> leaves it personal. Nothing happens until you confirm the preview.
              </p>
              {rows === null && !error && (
                <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>Loading…</div>
              )}
              {rows !== null && rows.length === 0 && (
                <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                  Your personal library has no active exercises to adopt.
                </div>
              )}
              {rows !== null && rows.length > 0 && (
                <div style={{ border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'auto', maxHeight: '48vh' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={th}>Code</th>
                        <th style={th}>Your exercise</th>
                        <th style={th}>Club match</th>
                        <th style={th}>Action</th>
                        <th style={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.source.id}>
                          <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
                            {r.source.exercise_code ?? ''}
                          </td>
                          <td style={td}>
                            {r.source.name}
                            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginLeft: 6 }}>
                              {r.source.category}
                            </span>
                          </td>
                          <td style={td}>
                            <select
                              value={r.targetId ?? ''}
                              onChange={e => {
                                const targetId = e.target.value || null;
                                setRow(r.source.id, {
                                  targetId,
                                  action: targetId ? 'merge' : r.action === 'merge' ? (isEditor && !r.codeConflict ? 'move' : 'keep') : r.action,
                                });
                              }}
                              style={{ ...cellSelect, maxWidth: 200 }}
                            >
                              <option value="">— no match —</option>
                              {targets.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.exercise_code ? `${t.exercise_code} · ` : ''}{t.name}
                                </option>
                              ))}
                            </select>
                            {r.matchBy && r.targetId === r.match?.id && (
                              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginLeft: 5 }}>
                                by {r.matchBy}
                              </span>
                            )}
                          </td>
                          <td style={td}>
                            <select
                              value={r.action}
                              onChange={e => setRow(r.source.id, { action: e.target.value as AdoptAction })}
                              style={cellSelect}
                            >
                              <option value="merge" disabled={!r.targetId}>Merge</option>
                              <option value="move" disabled={!isEditor || r.codeConflict}>Move to club</option>
                              <option value="keep">Keep personal</option>
                            </select>
                          </td>
                          <td style={{ ...td, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                            {r.codeConflict && r.action !== 'merge' && 'code taken in club'}
                            {!isEditor && !r.match && 'viewer — merge or keep only'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {step !== 'mapping' && report && renderReport(report)}

          {step === 'done' && (
            <div className="flex items-center gap-2 mt-3" style={{ fontSize: 'var(--text-label)', color: 'var(--color-success-text, #047857)' }}>
              <Check size={14} /> Adoption complete — your catalogue now shares the club's exercise ids.
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 flex items-center gap-2"
          style={{ borderTop: '0.5px solid var(--color-border-secondary)', flexShrink: 0 }}
        >
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            {counts.merge} merge · {counts.move} move · {counts.keep} keep
            {invalidMerges > 0 && <span style={{ color: 'var(--color-danger-text, #b91c1c)' }}> · {invalidMerges} merge row(s) missing a target</span>}
          </span>
          <span style={{ flex: 1 }} />
          {step === 'mapping' && (
            <Button
              variant="primary" size="sm" icon={busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
              disabled={busy || !rows || rows.length === 0 || invalidMerges > 0}
              onClick={() => void runAdopt(true)}
            >
              Preview changes
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="secondary" size="sm" icon={<ArrowLeft size={12} />} disabled={busy} onClick={() => setStep('mapping')}>
                Back
              </Button>
              <Button
                variant="primary" size="sm" icon={busy ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                disabled={busy}
                onClick={() => void runAdopt(false)}
              >
                Adopt now
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button variant="primary" size="sm" onClick={onClose}>Close</Button>
          )}
        </div>
      </div>
    </div>
  );
}
