import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, X, Trophy, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
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
      <div className="flex items-center justify-center py-16 text-sm text-gray-400">
        Loading PRs…
      </div>
    );
  }

  if (exercises.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <Trophy size={28} className="text-gray-300" />
        <p className="text-sm text-gray-500">No PR-tracked exercises found.</p>
        <p className="text-xs text-gray-400">Enable PR tracking on exercises in the exercise settings.</p>
      </div>
    );
  }

  const logExercise = exercises.find(e => e.id === logForm?.exerciseId);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <Trophy size={15} className="text-amber-500" />
          <span className="text-sm font-semibold text-gray-800">Personal Records</span>
          <span className="text-xs text-gray-400">— {athlete.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 italic">
            Solid = actual PR · <span className="text-gray-300">~italic = estimated</span>
          </span>
          <button
            onClick={() => openLogForm(exercises[0].id, 1)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={12} />
            Log PR
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 w-[220px]">
                Exercise
              </th>
              {REP_COUNTS.map(rc => (
                <th key={rc} className="text-center px-3 py-2 text-[11px] font-semibold text-gray-500 min-w-[90px]">
                  {rc}RM
                </th>
              ))}
              <th className="text-center px-3 py-2 text-[11px] font-semibold text-gray-500 min-w-[80px]">
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
                    className={`border-b border-gray-100 transition-colors ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} hover:bg-blue-50/30`}
                  >
                    {/* Exercise name */}
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: row.exercise.color }}
                        />
                        <div>
                          <div className="text-[12px] font-medium text-gray-800">
                            {row.exercise.exercise_code
                              ? <><span className="font-mono">{row.exercise.exercise_code}</span><span className="text-gray-400 ml-1 font-normal">{row.exercise.name}</span></>
                              : row.exercise.name}
                          </div>
                          <div className="text-[9px] text-gray-400">{row.exercise.category}</div>
                        </div>
                      </div>
                    </td>

                    {/* xRM cells */}
                    {row.cells.map(cell => {
                      const isReal = cell.real !== null;
                      const displayValue = isReal ? cell.real!.value_kg : cell.phantom;

                      return (
                        <td key={cell.repCount} className="px-2 py-1.5 text-center">
                          <button
                            className={`group relative w-full flex flex-col items-center gap-px px-2 py-1.5 rounded-lg transition-colors border ${
                              isReal
                                ? 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                                : displayValue
                                  ? 'bg-gray-50/60 border-gray-100 hover:border-blue-200 hover:bg-blue-50/40'
                                  : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                            }`}
                            onClick={() => openLogForm(row.exercise.id, cell.repCount, displayValue ? Math.round(displayValue) : undefined)}
                            title={isReal ? `${cell.real!.value_kg} kg on ${formatDate(cell.real!.achieved_date)}${cell.real!.notes ? ' — ' + cell.real!.notes : ''}` : 'Click to log PR'}
                          >
                            {displayValue !== null ? (
                              <>
                                <span className={`font-mono font-semibold text-[13px] leading-tight ${isReal ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                                  {isReal ? displayValue : `~${displayValue}`}
                                  <span className="text-[9px] font-normal ml-0.5 not-italic text-gray-400">kg</span>
                                </span>
                                {isReal && (
                                  <span className="text-[8px] text-gray-400 leading-none">
                                    {formatDate(cell.real!.achieved_date)}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-gray-200 text-[11px]">—</span>
                            )}
                            <Plus size={9} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-40 transition-opacity text-blue-500" />
                          </button>
                        </td>
                      );
                    })}

                    {/* Implied 1RM */}
                    <td className="px-3 py-2 text-center">
                      {row.implied1RM !== null ? (
                        <span className="text-[12px] font-mono font-medium text-gray-500">
                          {row.implied1RM}
                          <span className="text-[9px] text-gray-400 ml-0.5">kg</span>
                        </span>
                      ) : (
                        <span className="text-gray-200 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>

                  {/* Inline log form — expands below the active row */}
                  {isLogging && logForm && (
                    <tr key={`${row.exercise.id}_form`} className="bg-blue-50/50 border-b border-blue-100">
                      <td colSpan={REP_COUNTS.length + 2} className="px-4 py-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-1.5 text-xs text-blue-700 font-medium min-w-[140px]">
                            <TrendingUp size={12} />
                            {logExercise?.exercise_code || logExercise?.name} — {logForm.repCount}RM
                          </div>

                          {/* Rep count selector */}
                          <div className="flex gap-1">
                            {REP_COUNTS.map(rc => (
                              <button
                                key={rc}
                                onClick={() => setLogForm(f => f ? { ...f, repCount: rc } : f)}
                                className={`w-7 h-7 text-[11px] rounded font-medium transition-colors ${
                                  logForm.repCount === rc
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
                                }`}
                              >
                                {rc}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              placeholder="kg"
                              value={logForm.value}
                              onChange={e => setLogForm(f => f ? { ...f, value: e.target.value } : f)}
                              className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400 font-mono"
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') saveLogForm(); if (e.key === 'Escape') setLogForm(null); }}
                            />
                            <span className="text-xs text-gray-500">kg</span>
                          </div>

                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              value={logForm.date}
                              onChange={e => setLogForm(f => f ? { ...f, date: e.target.value } : f)}
                              className="px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                            />
                          </div>

                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={logForm.notes}
                            onChange={e => setLogForm(f => f ? { ...f, notes: e.target.value } : f)}
                            className="flex-1 min-w-[120px] max-w-[200px] px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                          />

                          <div className="flex items-center gap-1.5 ml-auto">
                            <button
                              onClick={saveLogForm}
                              disabled={saving || !logForm.value}
                              className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                              <Check size={11} />
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setLogForm(null)}
                              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
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
        <div className="border-t border-gray-100 px-4 py-2 bg-gray-50/30">
          <div className="flex items-center gap-1 mb-1.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Recent entries</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.slice(0, 8).map(entry => {
              const ex = exercises.find(e => e.id === entry.exercise_id);
              return (
                <div key={entry.id} className="flex items-center gap-1.5 px-2 py-1 bg-white border border-gray-200 rounded-md text-[10px] group">
                  <span className="font-mono font-medium text-gray-700">{entry.value_kg}kg</span>
                  <span className="text-gray-400">@ {entry.rep_count}RM</span>
                  <span className="text-gray-500 font-medium">{ex?.exercise_code || ex?.name}</span>
                  <span className="text-gray-300">{formatDate(entry.achieved_date)}</span>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-red-400 transition-opacity ml-0.5"
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
