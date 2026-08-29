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
import { Calendar, Ban } from 'lucide-react';
import { DoneChip } from '../../../components/log/DoneChip';
import { AutoGrowTextarea } from '../../../components/ui';
import { useNoteDraft } from '../lib/useNoteDraft';
import { BodyweightField } from './BodyweightField';
import { RawScoreDial, type RawScores } from './RawScoreDial';
import { VasField } from './VasField';
import { CustomMetricField } from './CustomMetricField';
import { formatWeekdayDateLong } from '../../../lib/dateUtils';
import { METRIC_TRACKING_DEFAULTS } from '../../../lib/trainingLogModel';
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
  /** Actual performed-at time of day ('HH:mm', 24h). Defaults to the time
   *  logging started; editable inline. */
  performedAtTime?: string;
  /** Whether a session row exists in the DB (affects helper text). */
  sessionExists?: boolean;
  /** Persist a change to the performed-on date. */
  onPatchPerformedOn?: (next: string) => void;
  /** Persist a change to the performed-at time of day ('HH:mm'). */
  onPatchPerformedAt?: (next: string) => void;
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
  performedAtTime,
  sessionExists,
  onPatchPerformedOn,
  onPatchPerformedAt,
}: SessionHeaderProps) {
  // Persists on blur + debounce + app-background, and refuses to let the
  // server's echo of its own save overwrite what is being typed.
  const notes = useNoteDraft(session?.session_notes ?? '', onPatchNotes);

  const raw: RawScores = {
    sleep: session?.raw_sleep ?? null,
    physical: session?.raw_physical ?? null,
    mood: session?.raw_mood ?? null,
    nutrition: session?.raw_nutrition ?? null,
  };

  const status = session?.status ?? 'pending';
  const prettyDate = formatWeekdayDateLong(date);

  // No config row yet → fall back to the pre-feature defaults so the
  // UI doesn't suddenly hide RAW/BW for athletes whose coach hasn't
  // opened the metrics popover.
  const showRaw = metricsConfig ? metricsConfig.track_raw : METRIC_TRACKING_DEFAULTS.track_raw;
  const showBw = metricsConfig ? metricsConfig.track_bodyweight : METRIC_TRACKING_DEFAULTS.track_bodyweight;
  const showVas = metricsConfig ? metricsConfig.track_vas : METRIC_TRACKING_DEFAULTS.track_vas;
  const customValues = session?.custom_metrics ?? {};

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white truncate">{slotLabel}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--color-text-secondary)] mt-0.5">
            <Calendar size={11} />
            <span>{prettyDate}</span>
          </div>
          {performedOnDate != null && onPatchPerformedOn != null && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-[length:var(--text-caption)] uppercase tracking-wide text-[color:var(--color-text-tertiary)] font-semibold">
                Performed on
              </span>
              <input
                type="date"
                value={performedOnDate}
                onChange={e => onPatchPerformedOn(e.target.value)}
                className="bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded px-1.5 py-0.5 text-xs text-[color:var(--color-text-primary)] focus:outline-none focus:border-[color:var(--color-accent-hover)]"
                title={sessionExists ? 'Stored date' : 'Defaults to today; saved when you log anything'}
              />
              {performedAtTime != null && onPatchPerformedAt != null && (
                <input
                  type="time"
                  value={performedAtTime}
                  onChange={e => onPatchPerformedAt(e.target.value)}
                  className="bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded px-1.5 py-0.5 text-xs text-[color:var(--color-text-primary)] focus:outline-none focus:border-[color:var(--color-accent-hover)] tabular-nums"
                  title={sessionExists ? 'Stored time' : 'Defaults to now; saved when you log anything'}
                />
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {status === 'completed' && <DoneChip variant="dark" />}
          {status === 'skipped' && (
            <span className="inline-flex items-center gap-1 text-[length:var(--text-caption)] uppercase tracking-wide font-semibold px-2 py-0.5 rounded bg-red-900/50 text-red-300">
              <Ban size={11} />
              Not done
            </span>
          )}
          {saving && <span className="text-[length:var(--text-caption)] text-[color:var(--color-text-secondary)]">Saving…</span>}
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

      <div className="rounded-xl bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] p-3">
        <label className="block text-[11px] uppercase tracking-wide text-[color:var(--color-text-secondary)] font-semibold mb-2">
          Session notes
        </label>
        <AutoGrowTextarea
          {...notes.bind}
          placeholder="How did it feel? Anything to flag to the coach?"
          rows={2}
          className="w-full text-xs bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded px-2 py-1.5 text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus:border-[color:var(--color-accent-hover)]"
        />
      </div>
    </div>
  );
}
