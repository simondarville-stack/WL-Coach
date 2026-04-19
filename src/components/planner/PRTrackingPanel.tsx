import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, X, Trophy, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { estimate1RM, estimateWeightAtReps, roundToHalf } from '../../lib/xrmUtils';
import type { Exercise, AthletePRHistory, Athlete } from '../../lib/database.types';

const REP_COUNTS = [1, 2, 3, 4, 5] as const;
type RepCount = typeof REP_COUNTS[number];

// ─── Types ────────────────────────────────────────────────────────────────────

interface PRCell {
  repCount: RepCount;
  /** Real PR entry (best for this rep count) */
  real: AthletePRHistory | null;
  /** Phantom value derived from best implied 1RM */
  phantom: number | null;
}

interface ExerciseRow {
  exercise: Exercise;
  cells: PRCell[];
  /** The best implied 1RM for this exercise (used as tooltip/reference) */
  implied1RM: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Component ───────────────────────────────────────────────────────────────

interface PRTrackingPanelProps {
  athlete: Athlete;
}

export function PRTrackingPanel({ athlete }: PRTrackingPanelProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [history, setHistory] = useState<AthletePRHistory[]>([]);
  const [rows, setRows] = useState<ExerciseRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Log PR form state
  const [logForm, setLogForm] = useState<{
    exerciseId: string;
    repCount: RepCount;
    value: string;
    date: string;
    notes: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: exData }, { data: histData }] = await Promise.all([
        supabase
          .from('exercises')
          .select('*')
          .eq('track_pr', true)
          .eq('is_archived', false)
          .eq('owner_id', getOwnerId())
          .order('category')
          .order('name'),
        supabase
          .from('athlete_pr_history')
          .select('*')
          .eq('athlete_id', athlete.id)
          .order('achieved_date', { ascending: false }),
      ]);

      const exList = exData || [];
      const hist = histData || [];
      setExercises(exList);
      setHistory(hist);
      setRows(buildRows(exList, hist));
    } finally {
      setLoading(false);
    }
  }, [athlete.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Row builder ─────────────────────────────────────────────────────────────

  function buildRows(exList: Exercise[], hist: AthletePRHistory[]): ExerciseRow[] {
    return exList.map(ex => {
      const exHist = hist.filter(h => h.exercise_id === ex.id);

      // Best real PR per rep count (highest value_kg)
      const bestByRep = new Map<RepCount, AthletePRHistory>();
      for (const entry of exHist) {
        if (entry.rep_count < 1 || entry.rep_count > 5) continue;
        const rc = entry.rep_count as RepCount;
        const current = bestByRep.get(rc);
        if (!current || entry.value_kg > current.value_kg) bestByRep.set(rc, entry);
      }

      // Best implied 1RM across all real PRs for this exercise
      let best1RM: number | null = null;
      for (const [rep, entry] of bestByRep) {
        const implied = estimate1RM(entry.value_kg, rep);
        if (best1RM === null || implied > best1RM) best1RM = implied;
      }
      // Also consider direct 1RM entry as-is
      const direct1RM = bestByRep.get(1);
      if (direct1RM && direct1RM.value_kg > (best1RM ?? 0)) best1RM = direct1RM.value_kg;

      const cells: PRCell[] = REP_COUNTS.map(rc => {
        const real = bestByRep.get(rc) ?? null;
        const phantom = best1RM !== null && !real
          ? roundToHalf(estimateWeightAtReps(best1RM, rc))
          : null;
        return { repCount: rc, real, phantom };
      });

      return {
        exercise: ex,
        cells,
        implied1RM: best1RM !== null ? roundToHalf(best1RM) : null,
      };
    });
  }

  // ── Log PR ──────────────────────────────────────────────────────────────────

  function openLogForm(exerciseId: string, repCount: RepCount, prefillKg?: number) {
    setLogForm({
      exerciseId,
      repCount,
      value: prefillKg ? String(prefillKg) : '',
      date: today(),
      notes: '',
    });
  }

  async function saveLogForm() {
    if (!logForm) return;
    const kg = parseFloat(logForm.value);
    if (!kg || kg <= 0) return;

    setSaving(true);
    try {
      await supabase.from('athlete_pr_history').insert({
        athlete_id: athlete.id,
        exercise_id: logForm.exerciseId,
        rep_count: logForm.repCount,
        value_kg: kg,
        achieved_date: logForm.date,
        notes: logForm.notes.trim() || null,
      });
      setLogForm(null);
      await fetchData();
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    await supabase.from('athlete_pr_history').delete().eq('id', id);
    await fetchData();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', fontSize: 13, color: 'var(--color-text-tertiary)' }}>
        Loading PRs…
      </div>
    );
  }

  if (exercises.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', textAlign: 'center', gap: 8 }}>
        <Trophy size={28} style={{ color: 'var(--color-border-secondary)' }} />
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>No PR-tracked exercises found.</p>
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>Enable PR tracking on exercises in the exercise settings.</p>
      </div>
    );
  }

  const logExercise = exercises.find(e => e.id === logForm?.exerciseId);

  const inputStyle: React.CSSProperties = {
    padding: '4px 8px', fontSize: 12,
    border: '1px solid var(--color-border-secondary)',
    borderRadius: 'var(--radius-md)', outline: 'none',
    background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
  };

  return (
    <div style={{ background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-secondary)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--color-border-tertiary)', background: 'var(--color-bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Trophy size={15} style={{ color: '#F59E0B' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Personal Records</span>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>— {athlete.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            Solid = actual PR · <span style={{ color: 'var(--color-border-secondary)' }}>~italic = estimated</span>
          </span>
          <button
            onClick={() => openLogForm(exercises[0].id, 1)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
              fontSize: 11, background: 'var(--color-accent)', color: 'var(--color-text-on-accent)',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >
            <Plus size={12} />
            Log PR
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-secondary)' }}>
              <th style={{ textAlign: 'left', padding: '8px 16px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', width: 220 }}>
                Exercise
              </th>
              {REP_COUNTS.map(rc => (
                <th key={rc} style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', minWidth: 90 }}>
                  {rc}RM
                </th>
              ))}
              <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', minWidth: 80 }}>
                Impl. 1RM
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isLogging = logForm?.exerciseId === row.exercise.id;
              return (
                <>
                  <tr
                    key={row.exercise.id}
                    style={{ borderBottom: '1px solid var(--color-border-tertiary)', background: ri % 2 === 0 ? 'var(--color-bg-primary)' : 'var(--color-bg-secondary)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--color-accent-muted)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = ri % 2 === 0 ? 'var(--color-bg-primary)' : 'var(--color-bg-secondary)'; }}
                  >
                    {/* Exercise name */}
                    <td style={{ padding: '8px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block', backgroundColor: row.exercise.color ?? '#94a3b8' }} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                            {row.exercise.exercise_code
                              ? <><span style={{ fontFamily: 'var(--font-mono)' }}>{row.exercise.exercise_code}</span><span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4, fontWeight: 400 }}>{row.exercise.name}</span></>
                              : row.exercise.name}
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>{row.exercise.category}</div>
                        </div>
                      </div>
                    </td>

                    {/* xRM cells */}
                    {row.cells.map(cell => {
                      const isReal = cell.real !== null;
                      const displayValue = isReal ? cell.real!.value_kg : cell.phantom;

                      return (
                        <td key={cell.repCount} style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <button
                            style={{
                              position: 'relative', width: '100%', display: 'flex', flexDirection: 'column',
                              alignItems: 'center', gap: 2, padding: '6px 8px', borderRadius: 'var(--radius-md)',
                              border: isReal
                                ? '1px solid var(--color-border-secondary)'
                                : displayValue
                                  ? '1px solid var(--color-border-tertiary)'
                                  : '1px solid transparent',
                              background: isReal ? 'var(--color-bg-primary)' : displayValue ? 'var(--color-bg-secondary)' : 'transparent',
                              cursor: 'pointer', transition: 'background 0.1s, border-color 0.1s',
                            }}
                            onMouseEnter={e => {
                              const el = e.currentTarget as HTMLButtonElement;
                              el.style.background = 'var(--color-accent-muted)';
                              el.style.borderColor = 'var(--color-accent-border)';
                            }}
                            onMouseLeave={e => {
                              const el = e.currentTarget as HTMLButtonElement;
                              el.style.background = isReal ? 'var(--color-bg-primary)' : displayValue ? 'var(--color-bg-secondary)' : 'transparent';
                              el.style.borderColor = isReal ? 'var(--color-border-secondary)' : displayValue ? 'var(--color-border-tertiary)' : 'transparent';
                            }}
                            onClick={() => openLogForm(row.exercise.id, cell.repCount, displayValue ? Math.round(displayValue) : undefined)}
                            title={isReal ? `${cell.real!.value_kg} kg on ${formatDate(cell.real!.achieved_date)}${cell.real!.notes ? ' — ' + cell.real!.notes : ''}` : 'Click to log PR'}
                          >
                            {displayValue !== null ? (
                              <>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, lineHeight: 1.25, color: isReal ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', fontStyle: isReal ? 'normal' : 'italic' }}>
                                  {isReal ? displayValue : `~${displayValue}`}
                                  <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 2, fontStyle: 'normal', color: 'var(--color-text-tertiary)' }}>kg</span>
                                </span>
                                {isReal && (
                                  <span style={{ fontSize: 8, color: 'var(--color-text-tertiary)', lineHeight: 1 }}>
                                    {formatDate(cell.real!.achieved_date)}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span style={{ color: 'var(--color-border-secondary)', fontSize: 11 }}>—</span>
                            )}
                            <Plus size={9} style={{ position: 'absolute', top: 2, right: 2, opacity: 0, color: 'var(--color-accent)', transition: 'opacity 0.1s' }} />
                          </button>
                        </td>
                      );
                    })}

                    {/* Implied 1RM */}
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {row.implied1RM !== null ? (
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                          {row.implied1RM}
                          <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginLeft: 2 }}>kg</span>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-border-secondary)', fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>

                  {/* Inline log form — expands below the active row */}
                  {isLogging && logForm && (
                    <tr key={`${row.exercise.id}_form`} style={{ background: 'var(--color-accent-muted)', borderBottom: '1px solid var(--color-accent-border)' }}>
                      <td colSpan={REP_COUNTS.length + 2} style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-accent)', fontWeight: 500, minWidth: 140 }}>
                            <TrendingUp size={12} />
                            {logExercise?.exercise_code || logExercise?.name} — {logForm.repCount}RM
                          </div>

                          {/* Rep count selector */}
                          <div style={{ display: 'flex', gap: 4 }}>
                            {REP_COUNTS.map(rc => (
                              <button
                                key={rc}
                                onClick={() => setLogForm(f => f ? { ...f, repCount: rc } : f)}
                                style={{
                                  width: 28, height: 28, fontSize: 11, borderRadius: 'var(--radius-sm)',
                                  fontWeight: 500, cursor: 'pointer', transition: 'background 0.1s',
                                  background: logForm.repCount === rc ? 'var(--color-accent)' : 'var(--color-bg-primary)',
                                  color: logForm.repCount === rc ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                                  border: logForm.repCount === rc ? 'none' : '1px solid var(--color-border-secondary)',
                                }}
                              >
                                {rc}
                              </button>
                            ))}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              placeholder="kg"
                              value={logForm.value}
                              onChange={e => setLogForm(f => f ? { ...f, value: e.target.value } : f)}
                              style={{ ...inputStyle, width: 80, fontFamily: 'var(--font-mono)' }}
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') saveLogForm(); if (e.key === 'Escape') setLogForm(null); }}
                            />
                            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>kg</span>
                          </div>

                          <input
                            type="date"
                            value={logForm.date}
                            onChange={e => setLogForm(f => f ? { ...f, date: e.target.value } : f)}
                            style={inputStyle}
                          />

                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={logForm.notes}
                            onChange={e => setLogForm(f => f ? { ...f, notes: e.target.value } : f)}
                            style={{ ...inputStyle, flex: 1, minWidth: 120, maxWidth: 200 }}
                          />

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                            <button
                              onClick={() => void saveLogForm()}
                              disabled={saving || !logForm.value}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px',
                                fontSize: 11, background: saving || !logForm.value ? 'var(--color-bg-tertiary)' : 'var(--color-accent)',
                                color: saving || !logForm.value ? 'var(--color-text-tertiary)' : 'var(--color-text-on-accent)',
                                border: 'none', borderRadius: 'var(--radius-md)',
                                cursor: saving || !logForm.value ? 'not-allowed' : 'pointer',
                                opacity: saving || !logForm.value ? 0.5 : 1,
                                transition: 'background 0.1s',
                              }}
                            >
                              <Check size={11} />
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setLogForm(null)}
                              style={{ padding: 4, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', borderRadius: 'var(--radius-sm)' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)'; }}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent entries footer */}
      {history.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-border-tertiary)', padding: '8px 16px', background: 'var(--color-bg-secondary)' }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent entries</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {history.slice(0, 8).map(entry => {
              const ex = exercises.find(e => e.id === entry.exercise_id);
              return (
                <div
                  key={entry.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', fontSize: 10 }}
                  className="group"
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{entry.value_kg}kg</span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>@ {entry.rep_count}RM</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{ex?.exercise_code || ex?.name}</span>
                  <span style={{ color: 'var(--color-border-secondary)' }}>{formatDate(entry.achieved_date)}</span>
                  <button
                    onClick={() => void deleteEntry(entry.id)}
                    style={{ color: 'var(--color-danger-text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', opacity: 0.6, marginLeft: 2 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.6'; }}
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
