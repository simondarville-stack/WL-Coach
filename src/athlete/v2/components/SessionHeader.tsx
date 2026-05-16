/**
 * SessionHeader — date, status, BW, RAW, session notes.
 *
 * No RPE input. Per coach request, RPE is intentionally omitted from
 * athlete logging. Bodyweight and readiness fire patches as the athlete
 * edits them.
 */
import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { BodyweightField } from './BodyweightField';
import { RawScoreDial, type RawScores } from './RawScoreDial';
import type { TrainingLogSession } from '../../../lib/database.types';

interface SessionHeaderProps {
  date: string;
  slotLabel: string;
  session: TrainingLogSession | null;
  onPatchBodyweight: (bw: number | null) => Promise<void>;
  onPatchRaw: (raw: RawScores, total: number | null) => Promise<void>;
  onPatchNotes: (notes: string) => Promise<void>;
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
  slotLabel,
  session,
  onPatchBodyweight,
  onPatchRaw,
  onPatchNotes,
  saving,
}: SessionHeaderProps) {
  const [notes, setNotes] = useState(session?.session_notes ?? '');

  useEffect(() => setNotes(session?.session_notes ?? ''), [session?.session_notes]);

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white truncate">{slotLabel}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-0.5">
            <Calendar size={11} />
            <span>{prettyDate}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${STATUS_CLASS[status] ?? STATUS_CLASS.pending}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
          {saving && <span className="text-[10px] text-gray-500">Saving…</span>}
        </div>
      </div>

      <BodyweightField value={session?.bodyweight_kg ?? null} onChange={onPatchBodyweight} />

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
