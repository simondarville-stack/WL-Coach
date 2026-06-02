import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Trophy, X, ArrowLeft, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { supabase } from '../../lib/supabase';
import { estimate1RM, roundToHalf } from '../../lib/xrmUtils';
import {
  buildPRRows,
  REP_COUNTS,
  syncAthletePRs as syncAthletePRsService,
  type ExerciseRow,
  type RepCount,
} from '../../lib/prTable';
import { usePREstimationMode } from '../../hooks/usePREstimationMode';
import { PREstimationModeToggle } from '../PREstimationModeToggle';
import type { Exercise, AthletePRHistory, Athlete } from '../../lib/database.types';

interface EditingCell {
  exerciseId: string;
  repCount: RepCount;
  value: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Shared box for the cell button and the inline input so the cell never grows
// or shrinks when the user clicks to edit. Both use border-box + identical
// height/padding/border so the row keeps its layout.
const CELL_HEIGHT = 24;

function cellChromeStyle(opts: { isReal: boolean; hasContent: boolean; color: string; italic: boolean }): React.CSSProperties {
  return {
    boxSizing: 'border-box',
    width: '100%',
    height: CELL_HEIGHT,
    padding: '0 4px',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    cursor: 'text',
    transition: 'background 0.1s, border-color 0.1s',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: opts.isReal ? 600 : 400,
    lineHeight: `${CELL_HEIGHT - 2}px`,
    textAlign: 'center',
    color: opts.color,
    fontStyle: opts.italic ? 'italic' : 'normal',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

interface PRTrackingPanelProps {
  athlete: Athlete;
  /** Optional back-button handler. When provided, a left-arrow button is
   * rendered in the header — used when this panel is opened from the
   * athlete profile. The sidebar /prs route omits this. */
  onClose?: () => void;
  /** When set (from a dashboard PR activity), scroll to and blink this cell. */
  highlightExerciseId?: string | null;
  highlightRepCount?: number | null;
}

export function PRTrackingPanel({ athlete, onClose, highlightExerciseId, highlightRepCount }: PRTrackingPanelProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [history, setHistory] = useState<AthletePRHistory[]>([]);
  const [mode, setMode] = usePREstimationMode();
  // Derive rows from exercises + history + mode so the table re-blends
  // instantly when the coach flips between Weighted and 1RM-only.
  const rows = useMemo<ExerciseRow[]>(
    () => buildPRRows(exercises, history, mode),
    [exercises, history, mode],
  );
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter + sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  // Sort key is 'name' (alpha), 'category' (alpha), a RepCount number
  // (sort by current cell value), or 'e1RM' (sort by the implied 1RM
  // column). Numeric sorts default to desc so the strongest lift surfaces
  // first.
  type SortKey = 'name' | 'category' | RepCount | 'e1RM';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // History dialog state — clicking an exercise's identity cells (code /
  // name / category) opens a per-exercise history view with all logged
  // entries and a progression chart.
  const [historyExerciseId, setHistoryExerciseId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: exData }, { data: histData }] = await Promise.all([
        supabase
          .from('exercises')
          .select('*')
          // Use the HOST coach's library (athlete.owner_id), not the
          // active coach's. For a shared athlete the PR table must show
          // the catalogue the athlete's programmes are written against —
          // otherwise a co-coach sees their own exercises here.
          .eq('track_pr', true)
          .eq('is_archived', false)
          .eq('owner_id', athlete.owner_id)
          // Hide the "— System" category — those rows are sentinel
          // placeholders for TEXT / IMAGE / VIDEO / GPP blocks, not
          // lifts the athlete sets a PR on.
          .neq('category', '— System')
          .order('category')
          .order('name'),
        supabase
          .from('athlete_pr_history')
          .select('*')
          .eq('athlete_id', athlete.id)
          // Most recent first, breaking ties by created_at so a same-day entry
          // overrides an earlier one for the same rep count.
          .order('achieved_date', { ascending: false })
          .order('created_at', { ascending: false }),
      ]);

      const exList = (exData as Exercise[] | null) || [];
      const hist = (histData as AthletePRHistory[] | null) || [];
      setExercises(exList);
      setHistory(hist);
    } finally {
      setLoading(false);
    }
  }, [athlete.id]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Deep-link highlight (from a dashboard PR activity): scroll the cell into
  // view once loaded; the .pr-cell-blink class (applied on the matching cell
  // below) plays the attention pulse.
  const highlightKey =
    highlightExerciseId && highlightRepCount != null
      ? `${highlightExerciseId}:${highlightRepCount}`
      : null;
  useEffect(() => {
    if (!highlightKey || loading) return;
    const id = window.setTimeout(() => {
      document
        .querySelector(`[data-pr-cell="${highlightKey}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 60);
    return () => window.clearTimeout(id);
  }, [highlightKey, loading]);

  // Unique non-system categories in this owner's PR-tracked exercises.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.exercise.category && r.exercise.category !== '— System') set.add(r.exercise.category);
    return Array.from(set).sort();
  }, [rows]);

  // Apply search + category filter then sort. Numeric columns sort by the
  // cell's current value_kg (real entries only — phantom estimates rank
  // last). Name column sorts alphabetically.
  const displayedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let out = rows.filter(r => {
      if (categoryFilter !== 'all' && r.exercise.category !== categoryFilter) return false;
      if (!q) return true;
      const name = r.exercise.name.toLowerCase();
      const code = (r.exercise.exercise_code ?? '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });

    const valueFor = (row: ExerciseRow): number | null => {
      if (sortKey === 'name') return null;
      if (sortKey === 'e1RM') return row.implied1RM;
      const cell = row.cells.find(c => c.repCount === sortKey);
      return cell?.current?.value_kg ?? null;
    };

    out = [...out].sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.exercise.name.localeCompare(b.exercise.name);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      if (sortKey === 'category') {
        const cmp = (a.exercise.category ?? '').localeCompare(b.exercise.category ?? '');
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = valueFor(a);
      const bv = valueFor(b);
      // Null/empty always sinks to the bottom regardless of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = av - bv;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return out;
  }, [rows, searchQuery, categoryFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Numeric columns default to desc (heaviest first); alpha defaults to asc.
      setSortDir(key === 'name' || key === 'category' ? 'asc' : 'desc');
    }
  }

  function startEdit(exerciseId: string, repCount: RepCount, prefill: string) {
    setError(null);
    setEditing({ exerciseId, repCount, value: prefill });
  }

  // Re-derive the current implied 1RM for an exercise from the history
  // table and write it to athlete_prs. The planner percentage-resolver,
  // analysis charts, etc. all still read from athlete_prs — keeping it in
  // sync here means the new historical grid is the single editing surface
  // without breaking those consumers.
  const syncAthletePRs = (exerciseId: string) => syncAthletePRsService(athlete.id, exerciseId);

  async function commitEdit() {
    if (!editing || saving) return;
    const target = editing;
    const raw = target.value.trim().replace(',', '.');

    // Empty input → clear the current value for this cell. We delete only
    // the most-recent entry for (exercise, rep_count) so older history
    // rows stay around for analysis. If there are no older rows, the cell
    // simply becomes empty.
    if (raw === '') {
      const currentEntry = rows
        .find(r => r.exercise.id === target.exerciseId)
        ?.cells.find(c => c.repCount === target.repCount)?.current;
      if (!currentEntry) { setEditing(null); return; }

      setSaving(true);
      try {
        const { error: delErr } = await supabase
          .from('athlete_pr_history')
          .delete()
          .eq('id', currentEntry.id);
        if (delErr) {
          console.error('PR clear failed:', delErr);
          setError(delErr.message || 'Failed to clear PR');
          return;
        }
        await syncAthletePRs(target.exerciseId);
        setEditing(null);
        await fetchData();
      } finally {
        setSaving(false);
      }
      return;
    }

    const kg = Number(raw);
    if (!Number.isFinite(kg) || kg <= 0) {
      setError(`"${target.value}" is not a valid weight`);
      setEditing(null);
      return;
    }

    setSaving(true);
    try {
      const { error: insertErr } = await supabase
        .from('athlete_pr_history')
        .insert({
          athlete_id: athlete.id,
          exercise_id: target.exerciseId,
          rep_count: target.repCount,
          value_kg: kg,
          achieved_date: today(),
        });
      if (insertErr) {
        console.error('PR insert failed:', insertErr);
        setError(insertErr.message || 'Failed to save PR');
        return;
      }
      await syncAthletePRs(target.exerciseId);
      setEditing(null);
      await fetchData();
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function deleteEntry(id: string) {
    const entry = history.find(h => h.id === id);
    const { error: delErr } = await supabase.from('athlete_pr_history').delete().eq('id', id);
    if (delErr) {
      console.error('PR delete failed:', delErr);
      setError(delErr.message || 'Failed to delete PR');
      return;
    }
    if (entry) await syncAthletePRs(entry.exercise_id);
    await fetchData();
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
        Loading PRs…
      </div>
    );
  }

  if (exercises.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', textAlign: 'center', gap: 6 }}>
        <Trophy size={22} style={{ color: 'var(--color-border-secondary)' }} />
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>No PR-tracked exercises found.</p>
        <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: 0 }}>Enable PR tracking on exercises in the exercise settings.</p>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-secondary)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid var(--color-border-tertiary)', background: 'var(--color-bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onClose && (
            <button
              onClick={onClose}
              title="Back"
              style={{ padding: 2, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <Trophy size={13} style={{ color: '#F59E0B' }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>Personal Records</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>— {athlete.name}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          Click a cell · Enter saves with today's date
        </span>
      </div>

      {error && (
        <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--color-danger-text)', background: 'rgba(239, 68, 68, 0.06)', borderBottom: '1px solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}

      {/* Filter toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        padding: '5px 10px', borderBottom: '1px solid var(--color-border-tertiary)',
        background: 'var(--color-bg-primary)',
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={11} style={{ position: 'absolute', left: 6, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search exercise or code"
            style={{
              width: 180, padding: '3px 6px 3px 22px', fontSize: 11,
              border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
              outline: 'none', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              title="Clear"
              style={{ position: 'absolute', right: 4, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center' }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{
            padding: '3px 6px', fontSize: 11,
            border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
            outline: 'none', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
            cursor: 'pointer',
          }}
        >
          <option value="all">All categories</option>
          {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
        </select>
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
          {displayedRows.length} of {rows.length} exercises
        </span>
        <PREstimationModeToggle mode={mode} onChange={setMode} />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 60 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 90 }} />
            {REP_COUNTS.map(rc => <col key={rc} style={{ width: 56 }} />)}
            <col style={{ width: 60 }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-secondary)' }}>
              <SortableHeader
                label="Code"
                align="left"
                active={sortKey === 'name'}
                dir={sortDir}
                onClick={() => toggleSort('name')}
                style={{ position: 'sticky', left: 0, background: 'var(--color-bg-secondary)', zIndex: 1 }}
              />
              <SortableHeader
                label="Exercise"
                align="left"
                active={sortKey === 'name'}
                dir={sortDir}
                onClick={() => toggleSort('name')}
              />
              <SortableHeader
                label="Category"
                align="left"
                active={sortKey === 'category'}
                dir={sortDir}
                onClick={() => toggleSort('category')}
              />
              {REP_COUNTS.map(rc => (
                <SortableHeader
                  key={rc}
                  label={`${rc}RM`}
                  align="center"
                  active={sortKey === rc}
                  dir={sortDir}
                  onClick={() => toggleSort(rc)}
                />
              ))}
              <SortableHeader
                label="e1RM"
                align="center"
                active={sortKey === 'e1RM'}
                dir={sortDir}
                onClick={() => toggleSort('e1RM')}
              />
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 && (
              <tr>
                <td colSpan={3 + REP_COUNTS.length + 1} style={{ padding: '16px 12px', textAlign: 'center', fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                  No exercises match the current filter.
                </td>
              </tr>
            )}
            {displayedRows.map((row, ri) => {
              const idCellStyle: React.CSSProperties = {
                padding: '3px 8px',
                cursor: 'pointer',
                background: 'inherit',
              };
              const onIdClick = () => setHistoryExerciseId(row.exercise.id);
              return (
              <tr
                key={row.exercise.id}
                style={{
                  borderBottom: '1px solid var(--color-border-tertiary)',
                  background: ri % 2 === 0 ? 'var(--color-bg-primary)' : 'var(--color-bg-secondary)',
                }}
              >
                {/* Code */}
                <td onClick={onIdClick} style={{ ...idCellStyle, position: 'sticky', left: 0, zIndex: 1 }} title="Click to view history">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, display: 'inline-block', backgroundColor: row.exercise.color ?? '#94a3b8' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.exercise.exercise_code ?? ''}
                    </span>
                  </div>
                </td>
                {/* Exercise name */}
                <td onClick={onIdClick} style={idCellStyle} title="Click to view history">
                  <span style={{ fontSize: 11, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                    {row.exercise.name}
                  </span>
                </td>
                {/* Category */}
                <td onClick={onIdClick} style={idCellStyle} title="Click to view history">
                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                    {row.exercise.category}
                  </span>
                </td>

                {/* xRM cells */}
                {row.cells.map(cell => {
                  const isEditing = editing?.exerciseId === row.exercise.id && editing.repCount === cell.repCount;
                  const isReal = cell.current !== null;
                  const displayValue = isReal ? cell.current!.value_kg : cell.phantom;
                  // Delta is only populated in 1RM-only mode on real
                  // non-1RM cells. Positive = athlete beat the 1RM-based
                  // prediction; negative = fell short.
                  const delta = cell.delta;

                  return (
                    <td key={cell.repCount} data-pr-cell={`${row.exercise.id}:${cell.repCount}`} style={{ padding: '2px 3px', textAlign: 'center', verticalAlign: 'middle' }}>
                      {isEditing ? (
                        <PRCellEditor
                          value={editing!.value}
                          saving={saving}
                          onChange={v => setEditing(e => e ? { ...e, value: v } : e)}
                          onCommit={() => void commitEdit()}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        <button
                          className={highlightKey === `${row.exercise.id}:${cell.repCount}` ? 'pr-cell-blink' : undefined}
                          onClick={() => startEdit(row.exercise.id, cell.repCount, isReal ? String(cell.current!.value_kg) : '')}
                          title={isReal
                            ? `${cell.current!.value_kg} kg on ${formatDate(cell.current!.achieved_date)}${delta != null ? ` · ${delta >= 0 ? '+' : ''}${delta} kg vs 1RM-predicted` : ''} · click to log new`
                            : 'Click to log a PR'}
                          style={cellChromeStyle({ isReal, hasContent: displayValue !== null, color: isReal ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', italic: !isReal })}
                          onMouseEnter={e => {
                            const el = e.currentTarget as HTMLButtonElement;
                            el.style.background = 'var(--color-accent-muted)';
                            el.style.borderColor = 'var(--color-accent-border)';
                          }}
                          onMouseLeave={e => {
                            const el = e.currentTarget as HTMLButtonElement;
                            el.style.background = 'transparent';
                            el.style.borderColor = 'transparent';
                          }}
                        >
                          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                            <span>
                              {displayValue !== null
                                ? (isReal ? displayValue : `~${displayValue}`)
                                : <span style={{ color: 'var(--color-border-secondary)' }}>—</span>}
                            </span>
                            {delta != null && (
                              <span style={{ fontSize: 9, color: delta >= 0 ? 'var(--color-success-text, #15803d)' : 'var(--color-danger-text, #b91c1c)' }}>
                                {delta >= 0 ? '+' : ''}{delta}
                              </span>
                            )}
                          </span>
                        </button>
                      )}
                    </td>
                  );
                })}

                {/* Implied 1RM */}
                <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                  {row.implied1RM !== null ? (
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                      {row.implied1RM}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-border-secondary)', fontSize: 11 }}>—</span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {historyExerciseId && (
        <PRHistoryDialog
          athleteId={athlete.id}
          exercise={exercises.find(e => e.id === historyExerciseId)!}
          history={history.filter(h => h.exercise_id === historyExerciseId)}
          onClose={() => setHistoryExerciseId(null)}
          onDelete={async (id) => { await deleteEntry(id); }}
        />
      )}

      {/* Recent entries — inline delete in case of typo */}
      {history.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-border-tertiary)', padding: '5px 10px', background: 'var(--color-bg-secondary)' }}>
          <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
            {history.slice(0, 8).map(entry => {
              const ex = exercises.find(e => e.id === entry.exercise_id);
              return (
                <div
                  key={entry.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 6px', background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)', fontSize: 10 }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{entry.value_kg}kg</span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>@{entry.rep_count}</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{ex?.exercise_code || ex?.name}</span>
                  <span style={{ color: 'var(--color-border-secondary)' }}>{formatDate(entry.achieved_date)}</span>
                  <button
                    onClick={() => void deleteEntry(entry.id)}
                    style={{ color: 'var(--color-danger-text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', opacity: 0.5 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'; }}
                    title="Remove entry"
                  >
                    <X size={9} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cell editor ─────────────────────────────────────────────────────────────

interface PRCellEditorProps {
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function PRCellEditor({ value, saving, onChange, onCommit, onCancel }: PRCellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      size={4}
      value={value}
      disabled={saving}
      onChange={e => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      placeholder=""
      style={{
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
        height: CELL_HEIGHT,
        padding: '0 4px',
        border: '1px solid var(--color-accent-border)',
        borderRadius: 'var(--radius-sm)',
        outline: 'none',
        background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: `${CELL_HEIGHT - 2}px`,
        textAlign: 'center',
        margin: 0,
        appearance: 'none',
      }}
    />
  );
}

// ─── Sortable header ─────────────────────────────────────────────────────────

interface SortableHeaderProps {
  label: string;
  align: 'left' | 'center';
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  style?: React.CSSProperties;
}

function SortableHeader({ label, align, active, dir, onClick, style }: SortableHeaderProps) {
  return (
    <th
      onClick={onClick}
      style={{
        textAlign: align, padding: '4px 6px', fontSize: 10, fontWeight: 500,
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        background: 'var(--color-bg-secondary)',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
        {label}
        {active && (dir === 'asc' ? <ArrowUp size={9} /> : <ArrowDown size={9} />)}
      </span>
    </th>
  );
}

// ─── Per-exercise history dialog ─────────────────────────────────────────────

interface PRHistoryDialogProps {
  athleteId: string;
  exercise: Exercise;
  history: AthletePRHistory[];
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
}

function PRHistoryDialog({ exercise, history, onClose, onDelete }: PRHistoryDialogProps) {
  // Sort the entries chronologically for the chart, but show most-recent
  // first in the list.
  const sortedAsc = useMemo(() => {
    return [...history].sort((a, b) => a.achieved_date.localeCompare(b.achieved_date));
  }, [history]);
  const sortedDesc = useMemo(() => [...sortedAsc].reverse(), [sortedAsc]);

  // Implied-1RM progression: one point per entry, mapped via Epley.
  const chartData = useMemo(() => {
    return sortedAsc.map(h => ({
      date: h.achieved_date,
      label: formatDate(h.achieved_date),
      e1rm: roundToHalf(
        h.rep_count === 1 ? h.value_kg : estimate1RM(h.value_kg, h.rep_count),
      ),
      raw: h.value_kg,
      reps: h.rep_count,
    }));
  }, [sortedAsc]);

  return (
    <div
      className="animate-backdrop-in"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
      onClick={onClose}
    >
      <div
        className="animate-dialog-in"
        onClick={e => e.stopPropagation()}
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
          padding: '10px 16px', borderBottom: '1px solid var(--color-border-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: exercise.color ?? '#94a3b8', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {exercise.exercise_code && (
                <span style={{ fontFamily: 'var(--font-mono)', marginRight: 6 }}>{exercise.exercise_code}</span>
              )}
              {exercise.name}
            </span>
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>· {exercise.category}</span>
          </div>
          <button
            onClick={onClose}
            style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {sortedAsc.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              No history yet. Log a PR in the table to start tracking progression.
            </div>
          ) : (
            <>
              <PRHistoryChart data={chartData} color={exercise.color ?? '#3B82F6'} />
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  All entries
                </div>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg-secondary)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Date</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Reps</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)' }}>kg</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)' }}>e1RM</th>
                      <th style={{ width: 24, padding: '4px 4px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDesc.map(h => {
                      const e1rm = h.rep_count === 1 ? h.value_kg : roundToHalf(estimate1RM(h.value_kg, h.rep_count));
                      return (
                        <tr key={h.id} style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
                          <td style={{ padding: '4px 8px', color: 'var(--color-text-secondary)' }}>{formatDate(h.achieved_date)}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{h.rep_count}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--color-text-primary)' }}>{h.value_kg}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{e1rm}</td>
                          <td style={{ padding: '4px 4px', textAlign: 'right' }}>
                            <button
                              onClick={() => void onDelete(h.id)}
                              title="Remove entry"
                              style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', opacity: 0.5, display: 'inline-flex' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger-text)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)'; }}
                            >
                              <X size={11} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PRHistoryChart({ data, color }: { data: { date: string; label: string; e1rm: number; raw: number; reps: number }[]; color: string }) {
  if (data.length === 0) return null;
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary)" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} stroke="var(--color-border-secondary)" />
          <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} stroke="var(--color-border-secondary)" width={36} />
          <Tooltip
            contentStyle={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)', borderRadius: 6, fontSize: 11 }}
            labelStyle={{ color: 'var(--color-text-secondary)' }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Formatter generic over-narrow
            formatter={((value: number, _name: string, entry: { payload: { raw: number; reps: number } }) => {
              const p = entry.payload;
              return [`${value} kg (raw ${p.raw}×${p.reps})`, 'e1RM'];
            }) as any}
          />
          <Line type="monotone" dataKey="e1rm" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
