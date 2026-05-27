/**
 * PRsScreen — athlete-facing PR list grouped by exercise category.
 *
 * Each card leads with implied 1RM (the strongest derivable number for
 * decision-making, calculated from the best of all rep counts). Tap a
 * card to drill into the per-exercise detail screen. Sections start
 * expanded; categories with no PRs are collapsed by default so the
 * list opens to filled rows first.
 *
 * Data: same `exercises` + `athlete_pr_history` tables the coach panel
 * reads, derived via buildPRRows so coach & athlete never disagree on
 * the current cell value.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Loader2, Plus, Search, Trophy } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { describeError } from '../../../lib/errorMessage';
import { buildPRRows, fetchPRHistory, type ExerciseRow } from '../../../lib/prTable';
import type { Exercise } from '../../../lib/database.types';
import { useAuth } from '../lib/AuthContext';
import { PRFormModal } from '../components/PRFormModal';

/** Order of category sections in the list: competition lifts first
 *  (always expanded), then alpha. Athletes glance at SN / CJ / squats
 *  more often than accessories. */
function compareCategories(a: string, b: string): number {
  return a.localeCompare(b);
}

export function PRsScreen() {
  const navigate = useNavigate();
  const { athlete } = useAuth();

  const [rows, setRows] = useState<ExerciseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [addTargetExerciseId, setAddTargetExerciseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!athlete) return;
    setError(null);
    try {
      const { data: exData, error: exErr } = await supabase
        .from('exercises')
        .select('*')
        .eq('track_pr', true)
        .eq('is_archived', false)
        .eq('owner_id', athlete.owner_id)
        .order('category')
        .order('name');
      if (exErr) throw exErr;
      const hist = await fetchPRHistory(athlete.id);
      setRows(buildPRRows((exData ?? []) as Exercise[], hist));
    } catch (e) {
      console.error('[PRsScreen] load failed', e);
      setError(describeError(e));
    }
  }, [athlete]);

  useEffect(() => {
    void load();
  }, [load]);

  // Group rows by category. Within each category, exercises with a PR
  // sort to the top, then by name. Categories themselves use
  // compareCategories so the list opens consistently.
  const grouped = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter(r => r.exercise.name.toLowerCase().includes(q))
      : rows;
    const byCat = new Map<string, ExerciseRow[]>();
    for (const r of filtered) {
      const cat = r.exercise.category || 'Other';
      const list = byCat.get(cat) ?? [];
      list.push(r);
      byCat.set(cat, list);
    }
    return Array.from(byCat.entries())
      .sort((a, b) => compareCategories(a[0], b[0]))
      .map(([category, exRows]) => ({
        category,
        rows: exRows.sort((a, b) => {
          const aHas = a.implied1RM != null ? 0 : 1;
          const bHas = b.implied1RM != null ? 0 : 1;
          if (aHas !== bHas) return aHas - bHas;
          return a.exercise.name.localeCompare(b.exercise.name);
        }),
      }));
  }, [rows, query]);

  if (!athlete) {
    return (
      <div className="px-4 py-6 text-sm text-gray-400">
        Pick an athlete from the profile picker.
      </div>
    );
  }

  const totalPRs = rows?.filter(r => r.implied1RM != null).length ?? 0;

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 80px)' }}>
      <header className="sticky top-0 z-10 bg-gray-950 px-4 pt-4 pb-3 border-b border-gray-900">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => navigate('/athlete/profile')}
            className="text-xs text-gray-400 hover:text-white -ml-1 p-1"
            aria-label="Back to profile"
          >
            ←
          </button>
          <h1 className="text-base font-semibold text-white">Personal Records</h1>
          <span className="text-[11px] text-gray-500 ml-auto">
            {totalPRs} with PRs
          </span>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search exercises"
            className="w-full bg-gray-900 border border-gray-800 rounded-md pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:border-blue-500 outline-none"
          />
        </div>
      </header>

      <div className="flex-1 px-3 py-3 pb-24 space-y-3">
        {rows == null && !error && (
          <div className="flex items-center justify-center py-12 text-gray-500 text-sm gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading PRs…
          </div>
        )}

        {error && (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        )}

        {rows != null && grouped.length === 0 && !error && (
          <div className="text-center text-xs text-gray-500 italic py-12">
            {query ? 'No exercises match your search.' : 'Your coach hasn’t marked any exercises for PR tracking yet.'}
          </div>
        )}

        {grouped.map(({ category, rows: catRows }) => {
          const collapsed = collapsedCats.has(category);
          const withPRs = catRows.filter(r => r.implied1RM != null).length;
          return (
            <section
              key={category}
              className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden"
            >
              <button
                type="button"
                onClick={() =>
                  setCollapsedCats(prev => {
                    const next = new Set(prev);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  })
                }
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800/40 transition-colors"
                aria-expanded={!collapsed}
              >
                {collapsed ? (
                  <ChevronRight size={14} className="text-gray-500" />
                ) : (
                  <ChevronDown size={14} className="text-gray-500" />
                )}
                <span className="text-[11px] uppercase tracking-wider text-gray-300 font-semibold">
                  {category}
                </span>
                <span className="text-[10px] text-gray-500 ml-auto tabular-nums">
                  {withPRs}/{catRows.length}
                </span>
              </button>
              {!collapsed && (
                <ul className="divide-y divide-gray-800">
                  {catRows.map(row => (
                    <li key={row.exercise.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/athlete/prs/${row.exercise.id}`)}
                        className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-gray-800/40 transition-colors"
                      >
                        <span
                          className="w-1 self-stretch rounded-full flex-shrink-0"
                          style={{ background: row.exercise.color ?? '#6b7280' }}
                          aria-hidden
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">
                            {row.exercise.name}
                          </div>
                          <div className="text-[10px] text-gray-500 mt-0.5">
                            {row.cells.filter(c => c.current != null).length}/10 rep buckets
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {row.implied1RM != null ? (
                            <>
                              <div className="text-lg font-bold text-white tabular-nums leading-none">
                                {Math.round(row.implied1RM)}
                              </div>
                              <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">
                                kg e1RM
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-gray-600 italic">no PR</span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="fixed left-0 right-0 bottom-16 z-20 pointer-events-none px-4 pb-2">
        <div className="max-w-2xl mx-auto pointer-events-auto">
          <button
            type="button"
            onClick={() => {
              setAddTargetExerciseId(null);
              setShowAdd(true);
            }}
            disabled={!rows || rows.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold text-sm py-3 rounded-xl shadow-lg shadow-black/40 transition-colors"
          >
            <Plus size={16} />
            Log a PR
          </button>
        </div>
      </div>

      {showAdd && (
        <ExercisePicker
          rows={rows ?? []}
          selectedExerciseId={addTargetExerciseId}
          onPick={id => setAddTargetExerciseId(id)}
          onClose={() => {
            setShowAdd(false);
            setAddTargetExerciseId(null);
          }}
          onConfirm={async () => {
            // The form modal handles the actual save; ExercisePicker just
            // hands us the exercise id, then we render PRFormModal.
            // No-op here; the picker closes itself when an id is chosen.
          }}
        />
      )}

      {addTargetExerciseId && rows && (
        <PRFormModal
          mode={{
            kind: 'add',
            athleteId: athlete.id,
            exerciseId: addTargetExerciseId,
            exerciseName:
              rows.find(r => r.exercise.id === addTargetExerciseId)?.exercise.name ?? '',
          }}
          onClose={() => {
            setAddTargetExerciseId(null);
            setShowAdd(false);
          }}
          onChanged={load}
        />
      )}
    </div>
  );
}

/**
 * Lightweight "which exercise?" picker shown before the actual form
 * when the athlete taps Log a PR from the list view. On the detail
 * screen the exercise is already known, so this isn't used there.
 */
function ExercisePicker({
  rows,
  selectedExerciseId,
  onPick,
  onClose,
}: {
  rows: ExerciseRow[];
  selectedExerciseId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  // Once the user picks one, this picker collapses and the parent's
  // PRFormModal renders. So we close ourselves as soon as a pick happens.
  useEffect(() => {
    if (selectedExerciseId) {
      // give the click animation a beat, then close
      const id = window.setTimeout(onClose, 50);
      return () => window.clearTimeout(id);
    }
  }, [selectedExerciseId, onClose]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(r => r.exercise.name.toLowerCase().includes(q))
    : rows;

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 px-3 py-6">
      <div
        className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl shadow-xl flex flex-col"
        style={{ maxHeight: '80vh' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Trophy size={14} className="text-blue-400" />
            <span className="text-sm font-bold text-white">Log a PR — pick an exercise</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-white px-2 py-1"
          >
            Cancel
          </button>
        </div>
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search exercises"
              className="w-full bg-gray-950 border border-gray-800 rounded-md pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:border-blue-500 outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-xs text-gray-500 italic px-4 py-8 text-center">
              No exercises match.
            </div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {filtered.map(r => (
                <li key={r.exercise.id}>
                  <button
                    type="button"
                    onClick={() => onPick(r.exercise.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-800/50 transition-colors"
                  >
                    <span
                      className="w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ background: r.exercise.color ?? '#6b7280' }}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{r.exercise.name}</div>
                      <div className="text-[10px] text-gray-500">{r.exercise.category || 'Other'}</div>
                    </div>
                    {r.implied1RM != null && (
                      <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                        {Math.round(r.implied1RM)} kg
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
