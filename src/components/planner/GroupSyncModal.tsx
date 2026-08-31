/**
 * GroupSyncModal — the Sync wizard.
 *
 * "Sync to athletes" used to be one silent bulk action: every member, one
 * fixed rule, no way to see beforehand that athlete X carries hand-edited
 * weights the sync would (or would deliberately not) touch. This dialog is
 * the dry run made visible: every active member with a per-athlete preview of
 * what the sync would do, a tick to exclude athletes, and a per-athlete mode
 * (with a global default) choosing how existing data is treated.
 *
 * One dense screen, not a stepper — the coach scans the roster, adjusts the
 * odd row, confirms. Preview counts come from the same pure classification
 * (`groupSyncModel.ts`) the execution uses, so what it shows is what runs.
 * The preview is a snapshot; execution re-reads each athlete and last-write-
 * wins on the database state at that moment.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AdaptiveDialog } from '../ui/AdaptiveDialog';
import { Button } from '../ui/Button';
import {
  computeGroupSyncPreview,
  executeGroupSync,
  outcomeForMode,
  type AthleteSyncPreview,
  type AthleteSyncResult,
  type GroupSyncPreview,
  type SyncMode,
  type SyncSlot,
} from '../../lib/groupSyncService';
import { describeError } from '../../lib/errorMessage';

interface GroupSyncModalProps {
  groupPlanId: string;
  groupId: string;
  groupName: string;
  weekStart: string;
  onClose: () => void;
  /** Called once after a successful run so the planner can refresh. */
  onSynced: () => void;
}

const MODE_LABEL: Record<SyncMode, string> = {
  update: 'Update',
  overwrite: 'Overwrite',
  append: 'Append',
};

const MODE_HINT: Record<SyncMode, string> = {
  update: 'Replaces group-sourced exercises. Individual (I) edits and logged work are kept.',
  overwrite: 'The group plan wins: individual (I) edits on group slots are replaced too. Logged work is always kept.',
  append: 'Only adds exercises the athlete doesn’t have yet. Nothing existing is replaced or removed.',
};

interface RowState {
  included: boolean;
  mode: SyncMode;
}

type Phase = 'loading' | 'preview' | 'syncing' | 'done';

export function GroupSyncModal({ groupPlanId, groupId, groupName, weekStart, onClose, onSynced }: GroupSyncModalProps) {
  const [preview, setPreview] = useState<GroupSyncPreview | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [defaultMode, setDefaultMode] = useState<SyncMode>('update');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<AthleteSyncResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await computeGroupSyncPreview(groupPlanId, groupId, weekStart);
        if (cancelled) return;
        setPreview(p);
        const initial: Record<string, RowState> = {};
        p.athletes.forEach(a => { initial[a.athleteId] = { included: true, mode: 'update' }; });
        setRows(initial);
        setPhase('preview');
      } catch (err) {
        if (!cancelled) { setError(describeError(err)); setPhase('preview'); }
      }
    })();
    return () => { cancelled = true; };
  }, [groupPlanId, groupId, weekStart]);

  const athletes = preview?.athletes ?? [];
  const included = athletes.filter(a => rows[a.athleteId]?.included);

  const totals = useMemo(() => {
    const t = { added: 0, replaced: 0, overwritten: 0, keptPinned: 0, keptLogged: 0, removed: 0 };
    for (const a of included) {
      const o = outcomeForMode(a, rows[a.athleteId].mode);
      t.added += o.added; t.replaced += o.replaced; t.overwritten += o.overwritten;
      t.keptPinned += o.keptPinned; t.keptLogged += o.keptLogged; t.removed += o.removed;
    }
    return t;
  }, [included, rows]);

  const setAllModes = (mode: SyncMode) => {
    setDefaultMode(mode);
    setRows(prev => {
      const next: Record<string, RowState> = {};
      for (const [id, r] of Object.entries(prev)) next[id] = { ...r, mode };
      return next;
    });
  };

  const toggleAll = (include: boolean) => {
    setRows(prev => {
      const next: Record<string, RowState> = {};
      for (const [id, r] of Object.entries(prev)) next[id] = { ...r, included: include };
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runSync = async () => {
    if (included.length === 0) return;
    setPhase('syncing');
    setError(null);
    setProgress({ done: 0, total: included.length });
    try {
      const res = await executeGroupSync(
        groupPlanId,
        groupId,
        weekStart,
        included.map(a => ({ athleteId: a.athleteId, mode: rows[a.athleteId].mode })),
        (done, total) => setProgress({ done, total }),
      );
      setResults(res);
      setPhase('done');
      onSynced();
    } catch (err) {
      // Some athletes may already be synced — say so instead of pretending atomicity.
      setError(`${describeError(err)} — some athletes may have been synced before the failure.`);
      setPhase('preview');
      onSynced();
    }
  };

  const busy = phase === 'syncing';

  return (
    <AdaptiveDialog
      mode="center"
      maxWidth={720}
      dismiss="guarded"
      dirty={busy}
      onClose={busy ? () => {} : onClose}
      title={`Sync “${groupName}” to athletes`}
      footer={
        phase === 'done' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              {phase === 'loading' ? '' : `${included.length} of ${athletes.length} athletes selected`}
              {totals.overwritten > 0 && (
                <span style={{ color: 'var(--color-danger-text)', marginLeft: 8 }}>
                  {totals.overwritten} individual edit{totals.overwritten === 1 ? '' : 's'} will be overwritten
                </span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button
                variant={totals.overwritten > 0 ? 'danger' : 'primary'}
                onClick={() => void runSync()}
                disabled={busy || phase === 'loading' || included.length === 0}
              >
                {busy
                  ? `Syncing… ${progress ? `${progress.done}/${progress.total}` : ''}`
                  : `Sync ${included.length} athlete${included.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        )
      }
    >
      {error && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger-text)', fontSize: 'var(--text-caption)' }}>
          {error}
        </div>
      )}

      {phase === 'loading' && (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)' }}>
          Computing preview…
        </div>
      )}

      {phase === 'done' && <ResultSummary results={results} />}

      {(phase === 'preview' || phase === 'syncing') && preview && (
        <>
          {/* Global default mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Mode</span>
            <div style={{ display: 'inline-flex', border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              {(['update', 'overwrite', 'append'] as SyncMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setAllModes(m)}
                  disabled={busy}
                  style={{
                    fontSize: 'var(--text-caption)', padding: '4px 10px', border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
                    background: defaultMode === m ? 'var(--color-accent)' : 'var(--color-bg-primary)',
                    color: defaultMode === m ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                    fontWeight: defaultMode === m ? 600 : 400,
                  }}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              {MODE_HINT[defaultMode]}
            </span>
          </div>

          {/* Roster */}
          <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-secondary)' }}>
              <input
                type="checkbox"
                checked={included.length === athletes.length && athletes.length > 0}
                ref={el => { if (el) el.indeterminate = included.length > 0 && included.length < athletes.length; }}
                onChange={e => toggleAll(e.target.checked)}
                disabled={busy}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--color-text-secondary)', flex: 1 }}>Athlete</span>
              <span style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--color-text-secondary)', width: 92 }}>Mode</span>
              <span style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>This sync</span>
            </div>
            <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
              {athletes.map(a => (
                <AthleteRow
                  key={a.athleteId}
                  athlete={a}
                  state={rows[a.athleteId]}
                  disabled={busy}
                  expanded={expanded.has(a.athleteId)}
                  onToggleExpanded={() => toggleExpanded(a.athleteId)}
                  onToggleIncluded={v => setRows(prev => ({ ...prev, [a.athleteId]: { ...prev[a.athleteId], included: v } }))}
                  onModeChange={m => setRows(prev => ({ ...prev, [a.athleteId]: { ...prev[a.athleteId], mode: m } }))}
                />
              ))}
              {athletes.length === 0 && !error && (
                <div style={{ padding: 16, fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                  This group has no active members.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </AdaptiveDialog>
  );
}

// ---------------------------------------------------------------------------

function chip(text: string, fg: string, bg: string, title: string) {
  return (
    <span key={title} title={title} style={{ fontSize: 'var(--text-caption)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: bg, color: fg, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

function AthleteRow({ athlete, state, disabled, expanded, onToggleExpanded, onToggleIncluded, onModeChange }: {
  athlete: AthleteSyncPreview;
  state: RowState;
  disabled: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleIncluded: (v: boolean) => void;
  onModeChange: (m: SyncMode) => void;
}) {
  const o = outcomeForMode(athlete, state.mode);
  const dim = !state.included;

  const chips = [
    o.added > 0 && chip(`+${o.added}`, 'var(--color-success-text)', 'var(--color-success-bg)', `${o.added} new exercise${o.added === 1 ? '' : 's'} added`),
    o.replaced > 0 && chip(`↻${o.replaced}`, 'var(--color-accent)', 'var(--color-accent-muted)', `${o.replaced} group exercise${o.replaced === 1 ? '' : 's'} replaced with the current group version`),
    o.overwritten > 0 && chip(`!${o.overwritten} I`, 'var(--color-danger-text)', 'var(--color-danger-bg)', `${o.overwritten} individual edit${o.overwritten === 1 ? '' : 's'} OVERWRITTEN by the group version`),
    o.keptPinned > 0 && chip(`${o.keptPinned} I kept`, '#D97706', 'rgba(245,158,11,0.08)', `${o.keptPinned} individual edit${o.keptPinned === 1 ? '' : 's'} kept (pinned against sync)`),
    o.keptLogged > 0 && chip(`${o.keptLogged} logged`, 'var(--color-text-tertiary)', 'var(--color-bg-secondary)', `${o.keptLogged} exercise${o.keptLogged === 1 ? '' : 's'} already logged — never touched`),
    o.removed > 0 && chip(`−${o.removed}`, 'var(--color-text-tertiary)', 'var(--color-bg-secondary)', `${o.removed} group exercise${o.removed === 1 ? '' : 's'} no longer in the group plan removed`),
  ].filter(Boolean);

  const hasDetail = athlete.add.length + athlete.replace.length + athlete.pinned.length + athlete.logged.length + athlete.stale.length > 0;

  return (
    <div style={{ borderBottom: '1px solid var(--color-border-tertiary, var(--color-border-secondary))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', opacity: dim ? 0.45 : 1 }}>
        <input
          type="checkbox"
          checked={state.included}
          onChange={e => onToggleIncluded(e.target.checked)}
          disabled={disabled}
          style={{ cursor: 'pointer' }}
        />
        <button
          onClick={onToggleExpanded}
          disabled={!hasDetail}
          title={hasDetail ? 'Show affected exercises' : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: hasDetail ? 'pointer' : 'default', padding: 0, textAlign: 'left' }}
        >
          {hasDetail
            ? (expanded ? <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} /> : <ChevronRight size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />)
            : <span style={{ width: 12, flexShrink: 0 }} />}
          <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {athlete.athleteName}
          </span>
          {!athlete.planExists && (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>· new plan</span>
          )}
        </button>
        <select
          value={state.mode}
          onChange={e => onModeChange(e.target.value as SyncMode)}
          disabled={disabled || !state.included}
          title={MODE_HINT[state.mode]}
          style={{
            width: 92, fontSize: 'var(--text-caption)', padding: '2px 4px',
            border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-primary)', color: state.mode === 'update' ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
            fontWeight: state.mode === 'update' ? 400 : 600,
          }}
        >
          {(['update', 'overwrite', 'append'] as SyncMode[]).map(m => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 150 }}>
          {chips.length > 0 ? chips : (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>no changes</span>
          )}
        </div>
      </div>
      {expanded && <SlotDetail athlete={athlete} mode={state.mode} />}
    </div>
  );
}

/** The expanded per-exercise view: what exactly lands where, per unit. */
function SlotDetail({ athlete, mode }: { athlete: AthleteSyncPreview; mode: SyncMode }) {
  const sections: { title: string; slots: SyncSlot[]; fg?: string }[] = [
    { title: 'New', slots: athlete.add, fg: 'var(--color-success-text)' },
    {
      title: mode === 'append' ? 'Kept (append mode)' : 'Replaced with group version',
      slots: athlete.replace,
    },
    {
      title: mode === 'overwrite' ? 'Individual edits — OVERWRITTEN' : 'Individual edits — kept',
      slots: athlete.pinned,
      fg: mode === 'overwrite' ? 'var(--color-danger-text)' : '#D97706',
    },
    { title: 'Logged — never touched', slots: athlete.logged },
    {
      title: mode === 'append' ? 'No longer in group plan — kept (append mode)' : 'No longer in group plan — removed',
      slots: athlete.stale,
    },
  ].filter(s => s.slots.length > 0);

  return (
    <div style={{ padding: '2px 10px 8px 34px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--color-bg-secondary)' }}>
      {sections.map(s => (
        <div key={s.title}>
          <div style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: s.fg ?? 'var(--color-text-secondary)', marginBottom: 1 }}>
            {s.title}
          </div>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
            {s.slots.map((slot, i) => (
              <span key={`${slot.key}:${i}`} style={{ whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--color-text-tertiary)' }}>U{slot.dayIndex}</span> {slot.label}
                {i < s.slots.length - 1 && <span style={{ color: 'var(--color-text-tertiary)' }}>{'  ·  '}</span>}
              </span>
            ))}
          </div>
        </div>
      ))}
      {athlete.extras > 0 && (
        <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
          {athlete.extras} athlete-own row{athlete.extras === 1 ? '' : 's'} untouched
        </div>
      )}
    </div>
  );
}

function ResultSummary({ results }: { results: AthleteSyncResult[] }) {
  const t = results.reduce(
    (acc, r) => ({
      added: acc.added + r.added,
      replaced: acc.replaced + r.replaced,
      overwritten: acc.overwritten + r.overwritten,
      keptPinned: acc.keptPinned + r.keptPinned,
      keptLogged: acc.keptLogged + r.keptLogged,
      removed: acc.removed + r.removed,
    }),
    { added: 0, replaced: 0, overwritten: 0, keptPinned: 0, keptLogged: 0, removed: 0 },
  );
  const parts = [
    t.added > 0 && `${t.added} added`,
    t.replaced > 0 && `${t.replaced} replaced`,
    t.overwritten > 0 && `${t.overwritten} individual edit${t.overwritten === 1 ? '' : 's'} overwritten`,
    t.keptPinned > 0 && `${t.keptPinned} pinned kept`,
    t.keptLogged > 0 && `${t.keptLogged} logged kept`,
    t.removed > 0 && `${t.removed} removed`,
  ].filter(Boolean);

  return (
    <div>
      <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-primary)', marginBottom: 8 }}>
        Synced {results.length} athlete{results.length === 1 ? '' : 's'}
        {parts.length > 0 && <span style={{ color: 'var(--color-text-secondary)' }}> — {parts.join(' · ')}</span>}
        {parts.length === 0 && <span style={{ color: 'var(--color-text-secondary)' }}> — nothing to change</span>}
      </div>
      <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {results.map(r => {
          const rowParts = [
            r.added > 0 && `+${r.added}`,
            r.replaced > 0 && `↻${r.replaced}`,
            r.overwritten > 0 && `!${r.overwritten} I`,
            r.keptPinned > 0 && `${r.keptPinned} I kept`,
            r.keptLogged > 0 && `${r.keptLogged} logged`,
            r.removed > 0 && `−${r.removed}`,
          ].filter(Boolean);
          return (
            <div key={r.athleteId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderBottom: '1px solid var(--color-border-secondary)', fontSize: 'var(--text-caption)' }}>
              <span style={{ flex: 1, color: 'var(--color-text-primary)' }}>{r.athleteName}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{MODE_LABEL[r.mode]}</span>
              <span style={{ color: 'var(--color-text-secondary)', minWidth: 120, textAlign: 'right' }}>
                {rowParts.length > 0 ? rowParts.join(' · ') : 'no changes'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
