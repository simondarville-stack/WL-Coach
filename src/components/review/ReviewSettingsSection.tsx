/**
 * ReviewSettingsSection — Settings → Review.
 *
 * Two cards backed by general_settings:
 *   - Quick reactions: the coach's own reaction chips on Review cards.
 *     Stored as review_quick_reactions (NULL = app defaults); list order is
 *     the chip order AND the 1–9 keyboard shortcut order.
 *   - Technique rating: toggles the 1–5 rating control on video and session
 *     cards (writes training_log_exercises.technique_rating).
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { GeneralSettings } from '../../lib/database.types';
import {
  DEFAULT_QUICK_REACTIONS,
  MAX_QUICK_REACTIONS,
  techniqueRatingEnabledFrom,
} from '../../lib/reviewSettings';
import { TechniqueRating } from './ReviewCards';

function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        on ? 'bg-[var(--color-accent)]' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      aria-pressed={on}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export function ReviewSettingsSection({
  settings,
  saving,
  updateSettings,
}: {
  settings: GeneralSettings | null;
  saving: boolean;
  updateSettings: (
    id: string,
    updates: Partial<Omit<GeneralSettings, 'id' | 'created_at' | 'updated_at'>>,
  ) => Promise<void>;
}) {
  // Draft list the coach edits; committed on blur / add / remove / move.
  // Seeded from the stored list (or defaults) once the row is in.
  const [rows, setRows] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings || seeded) return;
    setRows(settings.review_quick_reactions ?? [...DEFAULT_QUICK_REACTIONS]);
    setSeeded(true);
  }, [settings, seeded]);

  if (!settings) return null;

  const usingDefaults = settings.review_quick_reactions == null;
  const techniqueOn = techniqueRatingEnabledFrom(settings);

  const commit = async (next: string[]) => {
    setSaveError(null);
    // Blank rows are editing debris, not reactions — drop them on save.
    const cleaned = next.map(r => r.trim()).filter(r => r !== '');
    try {
      await updateSettings(settings.id, { review_quick_reactions: cleaned });
    } catch {
      setSaveError('Saving failed — check your connection and try again.');
    }
  };

  const setRow = (idx: number, value: string) => {
    setRows(prev => prev.map((r, i) => (i === idx ? value : r)));
  };

  const removeRow = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    void commit(next);
  };

  const moveRow = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[idx], next[to]] = [next[to], next[idx]];
    setRows(next);
    void commit(next);
  };

  const addRow = () => {
    if (rows.length >= MAX_QUICK_REACTIONS) return;
    setRows(prev => [...prev, '']);
    // No commit yet — an empty row only persists once the coach types into
    // it and leaves the field.
  };

  const resetDefaults = async () => {
    setRows([...DEFAULT_QUICK_REACTIONS]);
    setSaveError(null);
    try {
      await updateSettings(settings.id, { review_quick_reactions: null });
    } catch {
      setSaveError('Saving failed — check your connection and try again.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Quick reactions */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-gray-900 mb-1">Quick reactions</h2>
            <p className="text-sm text-gray-600 mb-4">
              Your one-tap reactions on Review cards. Each posts as a normal message into the
              athlete-visible thread. The order here is the chip order and the 1–
              {MAX_QUICK_REACTIONS} keyboard order.
            </p>
          </div>
          {!usingDefaults && (
            <button
              type="button"
              onClick={() => void resetDefaults()}
              disabled={saving}
              className="text-xs text-gray-500 hover:text-[color:var(--color-accent-hover)] underline-offset-2 hover:underline whitespace-nowrap"
            >
              Reset defaults
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          {rows.map((r, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="w-5 text-right text-xs text-gray-400 tabular-nums shrink-0">
                {idx + 1}
              </span>
              <input
                type="text"
                value={r}
                placeholder="e.g. 🔥 Great session"
                onChange={e => setRow(idx, e.target.value)}
                onBlur={() => void commit(rows)}
                className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent-hover)]"
              />
              <button
                type="button"
                onClick={() => moveRow(idx, -1)}
                disabled={saving || idx === 0}
                title="Move up"
                className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveRow(idx, 1)}
                disabled={saving || idx === rows.length - 1}
                title="Move down"
                className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => removeRow(idx)}
                disabled={saving}
                title="Remove reaction"
                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-xs text-gray-400 italic">
              No reactions — Review cards show only the comment box.
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={addRow}
            disabled={saving || rows.length >= MAX_QUICK_REACTIONS}
            className="inline-flex items-center gap-1 text-sm text-[color:var(--color-accent)] hover:text-[color:var(--color-accent-hover)] disabled:opacity-40"
          >
            <Plus size={14} />
            Add reaction
          </button>
          {rows.length >= MAX_QUICK_REACTIONS && (
            <span className="text-xs text-gray-400">
              Maximum {MAX_QUICK_REACTIONS} — every reaction keeps a number-key shortcut.
            </span>
          )}
        </div>
        {saveError && <p className="mt-2 text-xs text-red-600">{saveError}</p>}
      </div>

      {/* Technique rating */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-gray-900 mb-1">Technique rating</h2>
            <p className="text-sm text-gray-600">
              Rate technique 1–5 straight from Review cards — on each video clip and on every
              exercise of a session card. Ratings are stored on the logged exercise and shown in
              Log mode.
            </p>
          </div>
          <Toggle
            on={techniqueOn}
            disabled={saving}
            onChange={v => {
              void updateSettings(settings.id, { review_technique_rating_enabled: v }).catch(
                () => setSaveError('Saving failed — check your connection and try again.'),
              );
            }}
          />
        </div>
        {techniqueOn && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <span>Preview:</span>
            <TechniqueRating value={3} onRate={async () => undefined} theme="light" />
          </div>
        )}
      </div>
    </div>
  );
}
