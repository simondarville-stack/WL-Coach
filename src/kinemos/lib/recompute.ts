/**
 * recompute — the P2 pipeline over a stored bundle, and a refresh of the
 * metrics cache for reps that were analysed before the cache existed.
 *
 * Two callers run the same pipeline the viewer runs: the comparison view, for
 * the lift it is judging against, and this file's refresh, for a season of
 * reps the trend view found without numbers. One function, `computeFromBundle`,
 * so both agree with the viewer to the last decimal — the cache is only
 * trustworthy while every writer computes the same way.
 *
 * What the refresh writes is the metrics cache and nothing else. The grade is
 * left alone: it needs the frame server's sample rate and its verdict on
 * variable frame rate, which only the viewer has, and a grade recomputed
 * without them would be a worse guess overwriting a better one.
 */
import { calibrateFromEllipse } from '../engine/calibration';
import { computeKinematics, summariseRep, type KinematicSeries, type RepSummary } from '../engine/kinematics';
import { STORED_METRICS_SCHEMA, toStoredMetrics } from '../engine/metricCatalogue';
import {
  computeLiftMetrics,
  proposePhases,
  spansFrom,
  type LiftMetrics,
  type PhaseBoundary,
} from '../engine/phases';
import { DEFAULT_FILTER } from '../engine/signal';
import type { KinemosTrackPoint } from '../../lib/database.types';
import type { KinemosLiftRecord } from './analysisAdapter';
import {
  loadBundle,
  plateEllipseFrom,
  saveAnalysisState,
  type AnalysisBundle,
} from './analysisService';

export interface ComputedBundle {
  /** The track in the clip's own display-space pixels. */
  points: KinemosTrackPoint[];
  series: KinematicSeries;
  boundaries: PhaseBoundary[];
  metrics: LiftMetrics;
  summary: RepSummary;
}

/**
 * Run the pipeline over a stored rep. Null when it cannot produce numbers —
 * no track, no calibration, or too few points for a velocity.
 *
 * A coach-corrected phase set is the answer; anything else is re-proposed
 * against the series as it is now, exactly as the viewer does on load.
 */
export function computeFromBundle(bundle: AnalysisBundle): ComputedBundle | null {
  if (!bundle.track || !bundle.calibration) return null;
  const points = bundle.track.points ?? [];
  if (points.length < 2) return null;

  const calibration = calibrateFromEllipse(
    plateEllipseFrom(bundle.calibration),
    Number(bundle.calibration.plate_diameter_cm),
  );
  const series = computeKinematics(points, calibration, {
    massKg: bundle.analysis.mass_kg === null ? null : Number(bundle.analysis.mass_kg),
    filter: DEFAULT_FILTER,
  });
  if (!series) return null;

  const stored = bundle.analysis.phase_boundaries;
  const boundaries =
    stored && stored.some(b => b.source === 'coach')
      ? (stored as PhaseBoundary[])
      : proposePhases(series).boundaries;

  return {
    points,
    series,
    boundaries,
    metrics: computeLiftMetrics(series, spansFrom(boundaries)),
    summary: summariseRep(series),
  };
}

export interface RefreshOutcome {
  /** Analysis ids whose cache was rewritten. */
  refreshed: string[];
  /** Analysis ids left alone, with the reason in the coach's terms. */
  skipped: Array<{ analysisId: string; reason: string }>;
}

export interface RefreshOptions {
  /** Rewrite reps already on the current schema too. Off by default: a rep
   *  the viewer wrote yesterday is not stale. */
  force?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** Injected for tests. */
  load?: typeof loadBundle;
  save?: typeof saveAnalysisState;
}

/** Whether a record's cache is behind what the viewer would write today. */
export function isStale(record: Pick<KinemosLiftRecord, 'schema'>): boolean {
  return record.schema < STORED_METRICS_SCHEMA;
}

/**
 * Rewrite the metrics cache of the given reps, one at a time.
 *
 * Sequential on purpose: a season is a few hundred reps at most, each a small
 * read and a small write, and a coach who pressed a button can watch the count
 * climb. Firing them all at once would only find out what the connection's
 * limit is.
 */
export async function refreshStoredMetrics(
  records: readonly KinemosLiftRecord[],
  options: RefreshOptions = {},
): Promise<RefreshOutcome> {
  const load = options.load ?? loadBundle;
  const save = options.save ?? saveAnalysisState;
  const outcome: RefreshOutcome = { refreshed: [], skipped: [] };
  const todo = options.force ? [...records] : records.filter(isStale);
  let done = 0;

  for (const record of todo) {
    try {
      const bundle = await load(record.sourceKind, record.sourceId, record.repIndex);
      const computed = bundle ? computeFromBundle(bundle) : null;
      if (!bundle) {
        outcome.skipped.push({ analysisId: record.analysisId, reason: 'no longer stored' });
      } else if (!computed) {
        outcome.skipped.push({
          analysisId: record.analysisId,
          reason: !bundle.calibration
            ? 'not calibrated'
            : !bundle.track || (bundle.track.points ?? []).length < 2
              ? 'no track'
              : 'too few marks for a velocity',
        });
      } else {
        await save(record.analysisId, {
          metrics: toStoredMetrics(computed.metrics, computed.summary),
        });
        outcome.refreshed.push(record.analysisId);
      }
    } catch (e) {
      outcome.skipped.push({
        analysisId: record.analysisId,
        reason: e instanceof Error ? e.message : 'could not be read',
      });
    }
    done += 1;
    options.onProgress?.(done, todo.length);
  }

  return outcome;
}
