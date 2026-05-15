/**
 * SessionHeader — date, status, BW, RAW, session notes.
 *
 * The header is always rendered above the exercise list. Bodyweight and
 * RAW scores fire patches as the athlete edits them.
 */
import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { BodyweightField } from './BodyweightField';
import { RawScoreDial, type RawScores } from './RawScoreDial';
import type { TrainingLogSession } from '../../../lib/database.types';

interface SessionHeaderProps {
  date: string;
  athleteName: string;
  session: TrainingLogSession | null;
  onPatchBodyweight: (bw: number | null) => Promise<void>;
  onPatchRaw: (raw: RawScores, total: number | null) => Promise<void>;
  onPatchNotes: (notes: string) => Promise<void>;
  onPatchSessionRpe: (rpe: number | null) => Promise<void>;
  saving?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Done',
  skipped: 'Skipped',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-gray-800 text-gray-400',
  in_progress: 'bg-amber-900/50 text-amber-300',
  completed: 'bg-emerald-900/50 text-emerald-300',
  skipped: 'bg-red-900/50 text-red-300',
};

export function SessionHeader({
  date,
  athleteName,
  session,
  onPatchBodyweight,
  onPatchRaw,
  onPatchNotes,
  onPatchSessionRpe,
  saving,
}: SessionHeaderProps) {
  const [notes, setNotes] = useState(session?.session_notes ?? '');
  const [rpeText, setRpeText] = useState(session?.session_rpe != null ? String(session.session_rpe) : '');

  useEffect(() => setNotes(session?.session_notes ?? ''), [session?.session_notes]);
  useEffect(() => setRpeText(session?.session_rpe != null ? String(session.session_rpe) : ''), [session?.session_rpe]);

  const raw: RawScores = {
    sleep: session?.raw_sleep ?? null,
    physical: session?.raw_physical ?? null,
    mood: session?.raw_mood ?? null,
    nutrition: session?.raw_nutrition ?? null,
  };

  const status = session?.status ?? 'pending';
  const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const commitRpe = () => {
    const trimmed = rpeText.trim();
    if (trimmed === '') {
      if (session?.session_rpe != null) void onPatchSessionRpe(null);
      return;
    }
    const parsed = parseFloat(trimmed.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10) {
      if (session?.session_rpe !== parsed) void onPatchSessionRpe(parsed);
    } else {
      setRpeText(session?.session_rpe != null ? String(session.session_rpe) : '');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-300">
          <Calendar size={14} className="text-gray-500" />
          <span className="text-sm font-semibold">{prettyDate}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${STATUS_CLASS[status] ?? STATUS_CLASS.pending}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
          {saving && <span className="text-[10px] text-gray-500">Saving…</span>}
        </div>
      </div>
      <p className="text-xs text-gray-500">Logging as <span className="text-gray-300 font-medium">{athleteName}</span></p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <BodyweightField value={session?.bodyweight_kg ?? null} onChange={onPatchBodyweight} />
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-3">
          <label className="block text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
            Session RPE
          </label>
          <div className="flex items-baseline gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={rpeText}
              onChange={e => setRpeText(e.target.value)}
              onBlur={commitRpe}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="—"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-lg font-semibold focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-500">/ 10</span>
          </div>
        </div>
      </div>

      <RawScoreDial value={raw} onChange={(next, total) => void onPatchRaw(next, total)} />

      <div className="rounded-xl bg-gray-900 border border-gray-800 p-3">
        <label className="block text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
          Session notes
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => {
            if ((session?.session_notes ?? '') !== notes) {
              void onPatchNotes(notes);
            }
          }}
          placeholder="How did it feel? Anything to flag to the coach?"
          rows={2}
          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>
    </div>
  );
}
