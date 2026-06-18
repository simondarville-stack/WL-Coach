/**
 * AddTrainingSheet — guided, mobile-first sheet for an athlete to add their
 * own training to a day. Replaces the single-mode ExercisePicker for the
 * add flow, exposing the coach's building blocks as plain labelled modes
 * (no slash-command jargon):
 *
 *   - Exercise:    catalogue search (ranked, code-aware), tap to add.
 *   - Combination: pick 2+ catalogue exercises → one combo entry.
 *   - Note:        a free-text line (TEXT sentinel).
 *   - GPP block:   a circuit/accessory table the athlete fills (GPP sentinel).
 *
 * Everything is logged ad-hoc (row by row) — there is no prescription entry.
 * The sheet only collects intent; the parent owns persistence.
 */
import { useEffect, useRef, useState } from 'react';
import { Search, X, Dumbbell, Layers, StickyNote, ListChecks, Plus, Check } from 'lucide-react';
import { searchExercisesByName, type ExerciseSearchResult } from '../../../lib/trainingLogService';

type Mode = 'exercise' | 'combo' | 'note' | 'gpp';

interface AddTrainingSheetProps {
  open: boolean;
  onClose: () => void;
  onAddExercise: (ex: ExerciseSearchResult) => Promise<void>;
  onAddCombo: (payload: { members: ExerciseSearchResult[]; name: string | null }) => Promise<void>;
  onAddNote: (text: string) => Promise<void>;
  onAddGpp: () => Promise<void>;
}

const MODES: { key: Mode; label: string; icon: typeof Dumbbell }[] = [
  { key: 'exercise', label: 'Exercise', icon: Dumbbell },
  { key: 'combo', label: 'Combination', icon: Layers },
  { key: 'note', label: 'Note', icon: StickyNote },
  { key: 'gpp', label: 'GPP block', icon: ListChecks },
];

export function AddTrainingSheet({
  open,
  onClose,
  onAddExercise,
  onAddCombo,
  onAddNote,
  onAddGpp,
}: AddTrainingSheetProps) {
  const [mode, setMode] = useState<Mode>('exercise');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExerciseSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Selected members for the combo builder, in order. */
  const [members, setMembers] = useState<ExerciseSearchResult[]>([]);
  const [comboName, setComboName] = useState('');
  const [noteText, setNoteText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset everything when the sheet (re)opens.
  useEffect(() => {
    if (!open) return;
    setMode('exercise');
    setQuery('');
    setResults([]);
    setError(null);
    setMembers([]);
    setComboName('');
    setNoteText('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Debounced search, used by both the exercise and combo modes.
  const searching = mode === 'exercise' || mode === 'combo';
  useEffect(() => {
    if (!open || !searching) return;
    let cancelled = false;
    setLoading(true);
    const id = window.setTimeout(() => {
      searchExercisesByName(query, 30)
        .then(rows => { if (!cancelled) setResults(rows); })
        .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [open, searching, query]);

  if (!open) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickExercise = (row: ExerciseSearchResult) => {
    if (mode === 'combo') {
      // Combo builder: accumulate members rather than closing.
      setMembers(prev => [...prev, row]);
      setQuery('');
      inputRef.current?.focus();
      return;
    }
    void run(() => onAddExercise(row));
  };

  const removeMember = (idx: number) => setMembers(prev => prev.filter((_, i) => i !== idx));

  const autoComboName = members.map(m => m.name).join(' + ');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800">
          <span className="text-sm font-semibold text-white">Add training</span>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Mode selector */}
        <div className="grid grid-cols-4 gap-1.5 p-2.5 border-b border-gray-800">
          {MODES.map(m => {
            const Icon = m.icon;
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => { setMode(m.key); setQuery(''); setError(null); }}
                className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-[10px] transition-colors ${
                  active
                    ? 'bg-blue-600/20 border-blue-600 text-blue-200'
                    : 'bg-gray-800/40 border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700'
                }`}
              >
                <Icon size={16} />
                <span className="leading-none">{m.label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="px-3 py-2 bg-red-950/50 border-b border-red-900 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {/* Body */}
        {searching && (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
              <Search size={14} className="text-gray-500 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={mode === 'combo' ? 'Search to add a movement…' : 'Search name or code…'}
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
              />
            </div>

            {mode === 'combo' && members.length > 0 && (
              <div className="px-3 py-2 border-b border-gray-800 flex flex-wrap gap-1.5">
                {members.map((m, idx) => (
                  <span
                    key={m.id + idx}
                    className="inline-flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-full pl-2 pr-1 py-0.5 text-[11px] text-gray-200"
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.color ?? '#6b7280' }} aria-hidden />
                    <span className="truncate max-w-[120px]">{m.name}</span>
                    <button
                      onClick={() => removeMember(idx)}
                      className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-red-400"
                      aria-label={`Remove ${m.name}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <ul className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
              {loading && results.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-gray-500">Searching…</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-gray-500 italic">No matches</li>
              ) : (
                results.map(row => (
                  <li key={row.id}>
                    <button
                      onClick={() => pickExercise(row)}
                      disabled={busy}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-800/50 disabled:opacity-50"
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color ?? '#6b7280' }} aria-hidden />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-gray-100 truncate">{row.name}</span>
                        {row.category && <span className="block text-[10px] text-gray-500 truncate">{row.category}</span>}
                      </span>
                      {row.exercise_code && <span className="text-[10px] text-gray-500 flex-shrink-0">{row.exercise_code}</span>}
                      {mode === 'combo' && <Plus size={13} className="text-gray-500 flex-shrink-0" />}
                    </button>
                  </li>
                ))
              )}
            </ul>

            {mode === 'combo' && (
              <div className="border-t border-gray-800 p-3 space-y-2">
                <input
                  type="text"
                  value={comboName}
                  onChange={e => setComboName(e.target.value)}
                  placeholder={autoComboName || 'Combination name (optional)'}
                  className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => void run(() => onAddCombo({ members, name: comboName.trim() || null }))}
                  disabled={busy || members.length < 2}
                  className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
                >
                  <Check size={15} />
                  {members.length < 2 ? 'Pick at least 2 movements' : `Create combination (${members.length})`}
                </button>
              </div>
            )}
          </>
        )}

        {mode === 'note' && (
          <div className="p-3 space-y-2">
            <p className="text-[11px] text-gray-500">A free-text line for the day — a reminder, how you felt, anything.</p>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Write a note…"
              rows={3}
              autoFocus
              className="w-full text-sm bg-gray-800 border border-gray-700 rounded px-2 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
            <button
              onClick={() => void run(() => onAddNote(noteText.trim()))}
              disabled={busy || noteText.trim() === ''}
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
            >
              <Check size={15} />
              Add note
            </button>
          </div>
        )}

        {mode === 'gpp' && (
          <div className="p-3 space-y-2">
            <p className="text-[11px] text-gray-500">
              A circuit / accessory block — a small table of exercises with reps, sets and load. You'll fill in the rows after adding it.
            </p>
            <button
              onClick={() => void run(() => onAddGpp())}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
            >
              <Plus size={15} />
              Add GPP block
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
