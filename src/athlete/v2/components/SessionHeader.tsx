/**
 * SessionHeader — date, status, BW, RAW, VAS, custom metrics, session notes.
 *
 * No RPE input. Per coach request, RPE is intentionally omitted from
 * athlete logging.
 *
 * Which inputs render is driven by the coach's per-week metrics config:
 *   trackRaw          → RawScoreDial
 *   trackBodyweight   → BodyweightField
 *   trackVas          → VasField
 *   enabledMetricDefs → one CustomMetricField per definition
 *
 * Defaults when no config exists: RAW + BW on, VAS off, no custom —
 * matches the pre-feature UX.
 */
import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { DoneChip } from '../../../components/log/DoneChip';
import { useAutoCommit } from '../lib/useAutoCommit';
import { BodyweightField } from './BodyweightField';
import { RawScoreDial, type RawScores } from './RawScoreDial';
import { VasField } from './VasField';
import { CustomMetricField } from './CustomMetricField';
import type {
  AthleteMetricDefinition,
  AthleteWeekMetricsConfig,
  CustomMetricEntry,
  TrainingLogSession,
} from '../../../lib/database.types';

interface SessionHeaderProps {
  date: string;
  slotLabel: string;
  session: TrainingLogSession | null;
  /** Coach-toggled tracking config for the week. Null = use defaults. */
  metricsConfig: AthleteWeekMetricsConfig | null;
  /** Definitions enabled this week (post-filter, in render order). */
  enabledMetricDefs: AthleteMetricDefinition[];
  onPatchBodyweight: (bw: number | null) => Promise<void>;
  onPatchRaw: (raw: RawScores, total: number | null) => Promise<void>;
  onPatchVas: (vas: number | null) => Promise<void>;
  onPatchCustomMetric: (defId: string, value: CustomMetricEntry | null) => Promise<void>;
  onPatchNotes: (notes: string) => Promise<void>;
  saving?: boolean;
  /** Actual performed-on date (may differ from plan date). Editable inline. */
  performedOnDate?: string;
  /** Whether a session row exists in the DB (affects helper text). */
  sessionExists?: boolean;
  /** Persist a change to the performed-on date. */
  onPatchPerformedOn?: (next: string) => void;
}

// Binary states: only "Done" surfaces.

export function SessionHeader({
  date,
  slotLabel,
  session,
  metricsConfig,
  enabledMetricDefs,
  onPatchBodyweight,
  onPatchRaw,
  onPatchVas,
  onPatchCustomMetric,
  onPatchNotes,
  saving,
  performedOnDate,
  sessionExists,
  onPatchPerformedOn,
}: SessionHeaderProps) {
  const [notes, setNotes] = useState(session?.session_notes ?? '');

  useEffect(() => setNotes(session?.session_notes ?? ''), [session?.session_notes]);

  // Persist on blur AND on debounce / app-background, so a note typed right
  // before the phone is locked isn't lost. Self-guards on a real change.
  const commitNotes = () => {
    if ((session?.session_notes ?? '') !== notes) void onPatchNotes(notes);
  };
  useAutoCommit(notes, commitNotes);

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

  // No config row yet → fall back to the pre-feature defaults so the
  // UI doesn't suddenly hide RAW/BW for athletes whose coach hasn't
  // opened the metrics popover.
  const showRaw = metricsConfig ? metricsConfig.track_raw : true;
  const showBw = metricsConfig ? metricsConfig.track_bodyweight : true;
  const showVas = metricsConfig ? metricsConfig.track_vas : false;
  const customValues = session?.custom_metrics ?? {};

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white truncate">{slotLabel}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-0.5">
            <Calendar size={11} />
            <span>{prettyDate}</span>
          </div>
          {performedOnDate != null && onPatchPerformedOn != null && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold">
                Performed on
              </span>
              <input
                type="date"
                value={performedOnDate}
                onChange={e => onPatchPerformedOn(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
                title={sessionExists ? 'Stored date' : 'Defaults to today; saved when you log anything'}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {status === 'completed' && <DoneChip variant="dark" />}
          {saving && <span className="text-[10px] text-gray-500">Saving…</span>}
        </div>
      </div>

      {showBw && (
        <BodyweightField value={session?.bodyweight_kg ?? null} onChange={onPatchBodyweight} />
      )}

      {showRaw && (
        <RawScoreDial value={raw} onChange={(next, total) => void onPatchRaw(next, total)} />
      )}

      {showVas && (
        <VasField value={session?.vas_score ?? null} onChange={onPatchVas} />
      )}

      {enabledMetricDefs.map(def => (
        <CustomMetricField
          key={def.id}
          definition={def}
          value={customValues[def.id]}
          onChange={value => onPatchCustomMetric(def.id, value)}
        />
      ))}

      <div className="rounded-xl bg-gray-900 border border-gray-800 p-3">
        <label className="block text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
          Session notes
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={commitNotes}
          placeholder="How did it feel? Anything to flag to the coach?"
          rows={2}
          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>
    </div>
  );
}
