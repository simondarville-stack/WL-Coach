/**
 * ExercisePicker — modal search/select for athlete add-exercise flow.
 *
 * Mobile-first dark-themed dropdown over the page. Filters the
 * exercises table by name. On pick, the parent receives the row and
 * decides what to do (typically: addOffPlanLogExercise).
 */
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchExercisesByName } from '../../../lib/trainingLogService';

interface ExercisePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (exercise: { id: string; name: string; color: string | null }) => Promise<void>;
}

type Row = { id: string; name: string; color: string | null; category: string | null };

export function ExercisePicker({ open, onClose, onPick }: ExercisePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const id = window.setTimeout(() => {
      searchExercisesByName(query, 30)
        .then(rows => { if (!cancelled) setResults(rows); })
        .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [open, query]);

  if (!open) return null;

  const handlePick = async (row: Row) => {
    setPicking(row.id);
    try {
      await onPick({ id: row.id, name: row.name, color: row.color });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
          <Search size={14} className="text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search exercises…"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 bg-red-950/50 border-b border-red-900 text-[11px] text-red-300">
            {error}
          </div>
        )}

        <ul className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
          {loading && results.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-gray-500">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-gray-500 italic">
              No matches
            </li>
          ) : (
            results.map(row => (
              <li key={row.id}>
                <button
                  onClick={() => void handlePick(row)}
                  disabled={picking != null}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-800/50 disabled:opacity-50"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: row.color ?? '#6b7280' }}
                    aria-hidden
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-gray-100 truncate">{row.name}</span>
                    {row.category && (
                      <span className="block text-[10px] text-gray-500 truncate">{row.category}</span>
                    )}
                  </span>
                  {picking === row.id && (
                    <span className="text-[10px] text-gray-400">Adding…</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
